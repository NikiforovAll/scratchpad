// Headless-DOM tests: load the rendered viewer HTML into happy-dom, execute its
// client script, and assert the interactive behavior the user asked for —
// markdown rendering, mermaid blocks, syntax-highlight wiring, raw/rendered
// toggle, and auto-detected theme. (Mermaid's own SVG render needs a real
// browser, so we stub window.mermaid and assert it's invoked.)

import { afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildView, renderHtml } from "../src/ui/render.ts";
import { type Comment, newManifest, writeManifest, readManifest } from "../src/manifest.ts";
import type { Pad } from "../src/discovery.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "scratch-dom-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function renderPad(): Promise<string> {
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "doc.md"),
    "# Heading\n\nText **bold**.\n\n```ts\nconst x = 1;\n```\n\n```mermaid\ngraph TD; A-->B;\n```\n",
    "utf8",
  );
  const m = newManifest("P");
  m.files.push({ path: "doc.md", title: "Doc", description: "a doc", tags: ["t"], type: "note" });
  await writeManifest(dir, m);
  const pad: Pad = { dir, manifest: await readManifest(dir) };
  return renderHtml(await buildView([pad]), "P");
}

/** Boot happy-dom, inject HTML, stub vendor libs, run the page's inline script.
 * `pre` runs after registration but before the page script — use it to stub
 * host objects the script probes at startup (e.g. window.chrome.webview). */
async function boot(html: string, seedStorage?: Record<string, string>, pre?: (w: any) => void) {
  GlobalRegistrator.register();
  const w = globalThis as any;
  // A previous test's window.chrome stub survives unregister (it was set straight
  // on globalThis) and would make later boots think a webview channel exists.
  delete w.chrome;
  // Seed localStorage BEFORE the page script runs (it reads prefs at startup).
  if (seedStorage) for (const [k, v] of Object.entries(seedStorage)) localStorage.setItem(k, v);
  if (pre) pre(w);
  // Stub vendored libs (their real bundles are huge / need a real browser).
  const mermaidCalls: any[] = [];
  w.hljs = { highlightElement: (el: any) => el.classList.add("hljs") };
  w.mermaid = {
    initialize: (cfg: any) => mermaidCalls.push(["init", cfg]),
    run: (opts: any) => mermaidCalls.push(["run", opts?.nodes?.length ?? 0]),
  };
  // Simulate a dark-preferring OS (happy-dom's own matchMedia returns false).
  w.matchMedia = () => ({ matches: true, addEventListener() {}, addListener() {} });
  // Neutralize attribute-less inline <script> blocks except the app script (has
  // buildTree()). The vendor libs are CDN <script src=…> tags (we stubbed
  // window.hljs/mermaid above and there's no network here), and the data island
  // carries a type attribute — both have attributes, so this regex leaves them be.
  const slim = html
    // Drop CDN <link> stylesheets (hljs themes) — no network in happy-dom.
    .replace(/<link\b[^>]*\bcrossorigin\b[^>]*>/g, "")
    .replace(/<script>[\s\S]*?<\/script>/g, (m) =>
      m.includes("buildTree()") ? m : "<script></script>",
    );
  document.documentElement.innerHTML = slim
    .replace(/^[\s\S]*?<html[^>]*>/, "")
    .replace(/<\/html>[\s\S]*$/, "");
  // Execute every inline <script> in order (skip the JSON data island).
  for (const s of Array.from(document.querySelectorAll("script"))) {
    if (s.getAttribute("type") === "application/json") continue;
    // strip vendor bundles (we stubbed them); run only the app script
    if (s.textContent && s.textContent.includes("buildTree()")) {
      try {
        // eslint-disable-next-line no-eval
        (0, eval)(s.textContent);
      } catch (e) {
        console.error("APP SCRIPT THREW:", (e as Error).stack || e);
        throw e;
      }
    }
  }
  return { mermaidCalls };
}

function teardown() {
  GlobalRegistrator.unregister();
}

test("renders markdown, highlights code, invokes mermaid, builds tree", async () => {
  const html = await renderPad();
  const { mermaidCalls } = await boot(html);
  try {
    const preview = document.getElementById("preview")!;
    // markdown rendered to a heading
    expect(preview.querySelector(".md h1")?.textContent).toContain("Heading");
    // code block present + highlight wiring ran (stub adds .hljs)
    const code = preview.querySelector("pre code");
    expect(code).not.toBeNull();
    expect(code!.classList.contains("hljs")).toBe(true);
    // mermaid block emitted + mermaid.run invoked with 1 node
    expect(preview.querySelector(".mermaid")).not.toBeNull();
    expect(mermaidCalls.some((c) => c[0] === "run" && c[1] === 1)).toBe(true);
    // metadata strip
    expect(preview.querySelector(".pmeta")?.textContent).toContain("#t");
    // tree built with the file row
    expect(document.querySelector(".frow")?.textContent).toContain("Doc");
  } finally {
    teardown();
  }
});

test("groups files under group headers, keeping ungrouped under FILES", async () => {
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  for (const n of ["a.md", "b.md", "c.md"]) await writeFile(join(dir, n), "# " + n + "\n", "utf8");
  const m = newManifest("P");
  // Mixed: one ungrouped, two sharing "Appendix" — first-appearance order kept.
  m.files.push({ path: "a.md", title: "A", type: "note" });
  m.files.push({ path: "b.md", title: "B", type: "note", group: "Appendix" });
  m.files.push({ path: "c.md", title: "C", type: "note", group: "Appendix" });
  await writeManifest(dir, m);
  const pad: Pad = { dir, manifest: await readManifest(dir) };
  const html = await renderHtml(await buildView([pad]), "P");
  await boot(html);
  try {
    const labels = Array.from(document.querySelectorAll(".tree .label")).map((l) => l.textContent);
    expect(labels).toEqual(["FILES", "Appendix"]);
    // The "Appendix" header is followed by its two rows.
    const rows = Array.from(document.querySelectorAll(".frow")).map((r) => r.querySelector(".fttl")?.textContent);
    expect(rows).toEqual(["A", "B", "C"]);
  } finally {
    teardown();
  }
});

test("fence languages with special chars normalize to hljs grammar names", async () => {
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  // ```c# / ```c++ used to break: the fence regex dropped the # / +, and even when
  // captured, "language-c#" made hljs parse only "c". Both must become csharp/cpp.
  await writeFile(
    join(dir, "doc.md"),
    "# H\n\n```c#\npublic class Foo {}\n```\n\n```c++\nint main(){}\n```\n",
    "utf8",
  );
  const m = newManifest("P");
  m.files.push({ path: "doc.md", title: "Doc", type: "note" });
  await writeManifest(dir, m);
  const pad: Pad = { dir, manifest: await readManifest(dir) };
  const html = await renderHtml(await buildView([pad]), "P");
  await boot(html);
  try {
    const langs = Array.from(document.querySelectorAll("#preview pre code")).map(
      (c) => (c.className.match(/language-(\S+)/) || [])[1],
    );
    expect(langs).toContain("csharp");
    expect(langs).toContain("cpp");
  } finally {
    teardown();
  }
});

test("raw/rendered toggle swaps between source and rendered markdown", async () => {
  const html = await renderPad();
  await boot(html);
  try {
    const preview = document.getElementById("preview")!;
    expect(preview.querySelector(".md")).not.toBeNull(); // rendered by default
    (document.getElementById("vRaw") as any).click();
    expect(preview.querySelector(".md")).toBeNull();
    expect(preview.querySelector("pre.code")?.textContent).toContain("# Heading"); // raw source
    (document.getElementById("vRendered") as any).click();
    expect(preview.querySelector(".md")).not.toBeNull(); // back to rendered
  } finally {
    teardown();
  }
});

test("copy buttons write the absolute file path and content to the clipboard", async () => {
  const html = await renderPad();
  await boot(html);
  try {
    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: (t: string) => { copied = t; return Promise.resolve(); } },
    });
    const cp = document.getElementById("copyPath") as any;
    const cc = document.getElementById("copyContent") as any;
    expect(cp).not.toBeNull();
    expect(cc).not.toBeNull();
    cp.click();
    // Full on-disk path, not the pad-relative "doc.md".
    expect(copied).toBe(join(root, "p", "doc.md"));
    cc.click();
    expect(copied).toContain("# Heading");
  } finally {
    teardown();
  }
});

test("auto-detects dark theme from prefers-color-scheme", async () => {
  const html = await renderPad();
  await boot(html); // matchMedia stub returns matches:true (dark)
  try {
    expect(document.documentElement.dataset.theme).toBe("dark");
  } finally {
    teardown();
  }
});

test("a saved theme overrides the OS and toggling persists the choice", async () => {
  const html = await renderPad();
  // No webview + non-http (happy-dom) = the localStorage fallback path. OS
  // prefers dark (matchMedia stub), but the remembered choice must win — the
  // legacy 'scratch.theme' key still seeds it.
  await boot(html, { "scratch.theme": "light" });
  try {
    expect(document.documentElement.dataset.theme).toBe("light");
    // Toggling writes the new choice back to storage (new key).
    (document.getElementById("themeToggle") as any).click();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("scratch.themeMode")).toBe("dark");
  } finally {
    teardown();
  }
});

test("settings modal: mode + color theme switch, persisted via localStorage fallback", async () => {
  const html = await renderPad();
  await boot(html);
  try {
    const modal = document.getElementById("settingsModal")!;
    expect((modal as any).style.display).toBe("none");
    (document.getElementById("settingsBtn") as any).click();
    expect((modal as any).style.display).toBe("flex");

    // Explicit light mode via the segmented control.
    (modal.querySelector('#modeSeg button[data-mode="light"]') as any).click();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("scratch.themeMode")).toBe("light");

    // No stars yet → the starred strip carries just the active (ember) card.
    const starred = document.getElementById("starredGrid")!;
    expect(starred.querySelectorAll(".theme-card").length).toBe(1);
    expect(starred.querySelector('.theme-card[data-theme-id="ember"]')).not.toBeNull();

    // Browse opens the gallery with every registry theme as a card.
    const gallery = document.getElementById("galleryModal")!;
    expect((gallery as any).style.display).toBe("none");
    (document.getElementById("browseThemes") as any).click();
    expect((gallery as any).style.display).toBe("flex");

    // Clicking a gallery card applies data-color-theme and persists.
    (gallery.querySelector('.theme-card[data-theme-id="gruvbox"]') as any).click();
    expect(document.documentElement.dataset.colorTheme).toBe("gruvbox");
    expect(localStorage.getItem("scratch.colorTheme")).toBe("gruvbox");

    // Active states reflected: mode seg + gallery card, and the active (still
    // unstarred) theme replaces ember in the starred strip.
    expect(modal.querySelector('button[data-mode="light"]')!.classList.contains("on")).toBe(true);
    expect(gallery.querySelector('.theme-card[data-theme-id="gruvbox"]')!.classList.contains("on")).toBe(true);
    expect(starred.querySelectorAll(".theme-card").length).toBe(1);
    expect(starred.querySelector('.theme-card[data-theme-id="gruvbox"]')!.classList.contains("on")).toBe(true);

    (document.getElementById("galleryClose") as any).click();
    expect((gallery as any).style.display).toBe("none");

    // System mode goes back to following the (dark-preferring) OS stub.
    (modal.querySelector('#modeSeg button[data-mode="system"]') as any).click();
    expect(document.documentElement.dataset.theme).toBe("dark");

    (document.getElementById("settingsClose") as any).click();
    expect((modal as any).style.display).toBe("none");
  } finally {
    teardown();
  }
});

test("theme gallery: star toggles favorites without applying, FIFO caps at 3", async () => {
  const html = await renderPad();
  await boot(html);
  try {
    const gallery = document.getElementById("galleryModal")!;
    const starred = document.getElementById("starredGrid")!;
    const star = (id: string) =>
      (gallery.querySelector(`.theme-star[data-star="${id}"]`) as any).click();

    // Starring must NOT apply the theme.
    star("gruvbox");
    expect(document.documentElement.dataset.colorTheme).toBe("ember");
    expect(JSON.parse(localStorage.getItem("scratch.starredThemes")!)).toEqual(["gruvbox"]);
    expect(
      gallery.querySelector('.theme-star[data-star="gruvbox"]')!.classList.contains("on"),
    ).toBe(true);

    // Strip = starred + active-unstarred (ember).
    star("nord");
    star("dracula");
    let ids = Array.from(starred.querySelectorAll(".theme-card")).map(
      (c) => (c as any).dataset.themeId,
    );
    expect(ids).toEqual(["gruvbox", "nord", "dracula", "ember"]);

    // 4th star drops the oldest (gruvbox).
    star("vitesse");
    expect(JSON.parse(localStorage.getItem("scratch.starredThemes")!)).toEqual([
      "nord",
      "dracula",
      "vitesse",
    ]);
    expect(
      gallery.querySelector('.theme-star[data-star="gruvbox"]')!.classList.contains("on"),
    ).toBe(false);

    // Unstar removes without touching the rest.
    star("dracula");
    expect(JSON.parse(localStorage.getItem("scratch.starredThemes")!)).toEqual([
      "nord",
      "vitesse",
    ]);

    // A starred theme that becomes active doesn't duplicate in the strip.
    (gallery.querySelector('.theme-card[data-theme-id="nord"]') as any).click();
    ids = Array.from(starred.querySelectorAll(".theme-card")).map(
      (c) => (c as any).dataset.themeId,
    );
    expect(ids).toEqual(["nord", "vitesse"]);
  } finally {
    teardown();
  }
});

test("starred themes seed from localStorage and clamp unknown ids", async () => {
  const html = await renderPad();
  await boot(html, {
    "scratch.starredThemes": JSON.stringify(["bogus", "solarized", "solarized", "kanagawa"]),
  });
  try {
    const ids = Array.from(
      document.querySelectorAll("#starredGrid .theme-card"),
    ).map((c) => (c as any).dataset.themeId);
    // unknown + dupes dropped, active (ember) appended.
    expect(ids).toEqual(["solarized", "kanagawa", "ember"]);
  } finally {
    teardown();
  }
});

test("embedded settings from the config file apply at boot", async () => {
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "doc.md"), "# H\n", "utf8");
  const m = newManifest("P");
  m.files.push({ path: "doc.md", title: "Doc", type: "note" });
  await writeManifest(dir, m);
  const pad: Pad = { dir, manifest: await readManifest(dir) };
  const html = await renderHtml(await buildView([pad]), "P", {
    themeMode: "light",
    colorTheme: "tokyo-night",
  });
  await boot(html); // OS stub prefers dark — explicit light must win
  try {
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.colorTheme).toBe("tokyo-night");
  } finally {
    teardown();
  }
});

test("inside the WebView2 host, settings changes post __scratch_settings", async () => {
  const html = await renderPad();
  const posted: any[] = [];
  await boot(html, undefined, (w) => {
    w.window.chrome = { webview: { postMessage: (m: any) => posted.push(m) } };
  });
  try {
    (document.querySelector('.theme-card[data-theme-id="solarized"]') as any).click();
    const msg = posted.find((m) => m && m.__scratch_settings);
    expect(msg).toBeDefined();
    expect(msg.__scratch_settings.colorTheme).toBe("solarized");
    expect(msg.__scratch_settings.themeMode).toBe("system");
    expect(msg.__scratch_settings.starredThemes).toEqual([]);
    // webview present → nothing written to localStorage
    expect(localStorage.getItem("scratch.colorTheme")).toBeNull();
  } finally {
    teardown();
  }
});

test("after a native reload, __scratchSettings re-applies config saved since launch", async () => {
  // Page presented at launch with default settings (dark-first system + ember +
  // dots); a WebView2 reload re-runs this same HTML, so the island is stale.
  const html = await renderPad();
  const posted: any[] = [];
  await boot(html, undefined, (w) => {
    w.window.chrome = { webview: { postMessage: (m: any) => posted.push(m) } };
  });
  try {
    // On load the page asks the host for the authoritative config.
    expect(posted.some((m) => m && m.__scratch_get_settings)).toBe(true);
    expect(document.documentElement.dataset.colorTheme).toBe("ember");
    expect(document.documentElement.dataset.grid).toBe("dots");
    expect(document.documentElement.hasAttribute("data-wide")).toBe(false);

    // Host replies with what's actually on disk (changed since launch).
    (globalThis as any).__scratchSettings({
      themeMode: "light",
      colorTheme: "gruvbox",
      starredThemes: ["nord", "dracula"],
      gridStyle: "lines",
      wideMode: true,
      zoom: 1.2,
    });

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.colorTheme).toBe("gruvbox");
    expect(document.documentElement.dataset.grid).toBe("lines");
    expect(document.documentElement.hasAttribute("data-wide")).toBe(true);
    expect(document.documentElement.style.zoom).toBe("1.2");
    // Starred drift re-renders the strip: stars + active-unstarred gruvbox.
    const ids = Array.from(
      document.querySelectorAll("#starredGrid .theme-card"),
    ).map((c) => (c as any).dataset.themeId);
    expect(ids).toEqual(["nord", "dracula", "gruvbox"]);
  } finally {
    teardown();
  }
});

test("preview header shows file dates (deduped to 'created' for untouched files)", async () => {
  const html = await renderPad();
  await boot(html);
  try {
    const dates = document.querySelector(".phead .pdates")!;
    expect(dates).not.toBeNull();
    // Just-written file: created ≈ updated → a single "created" entry.
    expect(dates.textContent).toContain("created just now");
    expect(dates.textContent).not.toContain("updated");
    expect(dates.getAttribute("title")).toContain("created");
  } finally {
    teardown();
  }
});

test("zoom buttons step within 0.5–2, persist via localStorage fallback, and reset", async () => {
  const html = await renderPad();
  await boot(html);
  try {
    const label = document.getElementById("zoomReset")!;
    expect(label.textContent).toBe("100%");
    (document.getElementById("zoomIn") as any).click();
    (document.getElementById("zoomIn") as any).click();
    expect(label.textContent).toBe("120%");
    expect(localStorage.getItem("scratch.zoom")).toBe("1.2");
    (document.getElementById("zoomOut") as any).click();
    expect(label.textContent).toBe("110%");
    (document.getElementById("zoomReset") as any).click();
    expect(label.textContent).toBe("100%");
    expect(localStorage.getItem("scratch.zoom")).toBe("1");
  } finally {
    teardown();
  }
});

test("saved zoom is restored at boot in the localStorage fallback path", async () => {
  const html = await renderPad();
  await boot(html, { "scratch.zoom": "1.5" });
  try {
    expect(document.getElementById("zoomReset")!.textContent).toBe("150%");
  } finally {
    teardown();
  }
});

test("sidebar collapses via the in-pane button and '[', persisting to localStorage", async () => {
  const html = await renderPad();
  await boot(html);
  try {
    const sidebar = document.getElementById("sidebar")!;
    // The collapse control lives inside the pane it collapses.
    expect(document.getElementById("sidebarToggle")!.parentElement).toBe(sidebar);
    expect(sidebar.classList.contains("collapsed")).toBe(false);
    (document.getElementById("sidebarToggle") as any).click();
    expect(sidebar.classList.contains("collapsed")).toBe(true);
    expect(localStorage.getItem("scratch.sidebarCollapsed")).toBe("1");
    // The floater (CSS-shown only while collapsed) reopens the pane.
    (document.getElementById("sidebarOpen") as any).click();
    expect(sidebar.classList.contains("collapsed")).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "[" }));
    expect(sidebar.classList.contains("collapsed")).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "[" }));
    expect(sidebar.classList.contains("collapsed")).toBe(false);
    expect(localStorage.getItem("scratch.sidebarCollapsed")).toBe("0");
  } finally {
    teardown();
  }
});

test("j/k, d/u, g/G scroll the preview; arrows still switch files", async () => {
  // Two files so arrow navigation has somewhere to go.
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  for (const n of ["a.md", "b.md"]) await writeFile(join(dir, n), "# " + n + "\n", "utf8");
  const m = newManifest("P");
  m.files.push({ path: "a.md", title: "A", type: "note" });
  m.files.push({ path: "b.md", title: "B", type: "note" });
  await writeManifest(dir, m);
  const pad: Pad = { dir, manifest: await readManifest(dir) };
  const html = await renderHtml(await buildView([pad]), "P");
  await boot(html);
  try {
    const preview = document.getElementById("preview")! as any;
    // happy-dom has no layout: record scrollBy calls and fake a viewport height.
    const scrolls: number[] = [];
    const jumps: number[] = [];
    preview.scrollBy = (_x: number, y: number) => scrolls.push(y);
    preview.scrollTo = (_x: number, y: number) => jumps.push(y);
    Object.defineProperty(preview, "clientHeight", { value: 600 });
    Object.defineProperty(preview, "scrollHeight", { value: 4000 });
    const activeTitle = () => document.querySelector(".frow.active")?.textContent;
    const before = activeTitle();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "u" }));
    expect(scrolls).toEqual([60, -60, 300, -300]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "G" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "g" }));
    expect(jumps).toEqual([4000, 0]);
    // scrolling keys must not change the selected file
    expect(activeTitle()).toBe(before);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(activeTitle()).not.toBe(before);
    expect(activeTitle()).toContain("B");
  } finally {
    teardown();
  }
});

test("'q' closes the window when a close channel exists", async () => {
  const html = await renderPad();
  const posted: any[] = [];
  await boot(html, undefined, (w) => {
    w.window.chrome = { webview: { postMessage: (m: any) => posted.push(m) } };
  });
  try {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "q" }));
    expect(posted.some((m) => m && m.__glimpse_close)).toBe(true);
  } finally {
    teardown();
  }
});

test("a saved collapsed sidebar is restored at boot", async () => {
  const html = await renderPad();
  await boot(html, { "scratch.sidebarCollapsed": "1" });
  try {
    expect(document.getElementById("sidebar")!.classList.contains("collapsed")).toBe(true);
  } finally {
    teardown();
  }
});

// --- inline comments ---

async function renderPadWithComments(
  comments: Comment[],
  content?: string,
  exportMode = false,
): Promise<string> {
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "doc.md"),
    content ?? "# Heading\n\nText **bold** here.\n\nMore prose.\n",
    "utf8",
  );
  const m = newManifest("P");
  m.files.push({ path: "doc.md", title: "Doc", type: "note", comments });
  await writeManifest(dir, m);
  const pad: Pad = { dir, manifest: await readManifest(dir) };
  return renderHtml(await buildView([pad]), "P", undefined, { exportMode });
}

function cmt(over: Partial<Comment> = {}): Comment {
  return {
    id: "c-1",
    body: "my note",
    anchor: { quote: "bold", prefix: "Text ", suffix: " here." },
    created: "2026-06-11T10:00:00Z",
    updated: "2026-06-11T10:00:00Z",
    ...over,
  };
}

test("a stored comment renders a highlight; clicking it opens the popover", async () => {
  const html = await renderPadWithComments([cmt()]);
  await boot(html);
  try {
    const hl = document.querySelector(".cmt-hl") as any;
    expect(hl).not.toBeNull();
    expect(hl.textContent).toBe("bold");
    expect(hl.dataset.cid).toBe("c-1");
    // The quote spans a <strong> — the highlight wraps inside it, and the
    // paragraph's visible text is unchanged.
    expect(document.querySelector("#preview .md")!.textContent).toContain("Text bold here.");
    // Concise always-visible note pill right after the highlight (text rendered
    // via CSS from data-note, so it adds no selectable DOM text).
    const pill = document.querySelector(".cmt-note") as any;
    expect(pill).not.toBeNull();
    expect(pill.dataset.note).toBe("my note");
    expect(pill.title).toBe("my note");
    hl.click();
    const pop = document.querySelector(".cmt-pop")!;
    expect(pop).not.toBeNull();
    expect(pop.querySelector(".cmt-body")!.textContent).toBe("my note");
    expect(pop.querySelector(".cmt-when")!.textContent).toContain("created");
    // The note pill is clickable too.
    (document.querySelector(".cmt-pop") as any).remove?.();
    pill.click();
    expect(document.querySelector(".cmt-pop .cmt-body")!.textContent).toBe("my note");
  } finally {
    teardown();
  }
});

test("duplicate quotes disambiguate via prefix/suffix context", async () => {
  const html = await renderPadWithComments(
    [cmt({ anchor: { quote: "alpha", prefix: "three ", suffix: " four" } })],
    "# H\n\none alpha two\n\nthree alpha four\n",
  );
  await boot(html);
  try {
    const hls = document.querySelectorAll(".cmt-hl");
    expect(hls.length).toBe(1);
    // Anchored in the second paragraph, not the first occurrence.
    expect((hls[0] as any).parentElement.textContent).toContain("three");
  } finally {
    teardown();
  }
});

test("a quote that no longer exists is surfaced as orphaned, not dropped", async () => {
  const html = await renderPadWithComments([
    cmt({ anchor: { quote: "vanished zebra text", prefix: "", suffix: "" } }),
  ]);
  await boot(html);
  try {
    expect(document.querySelector(".cmt-hl")).toBeNull();
    const pill = document.getElementById("cmtOrphans") as any;
    expect(pill).not.toBeNull();
    expect(pill.textContent).toContain("1 orphaned comment");
    // The orphan is still editable/deletable from its popover.
    pill.click();
    const pop = document.querySelector(".cmt-pop")!;
    expect(pop.querySelector(".cmt-quote")!.textContent).toContain("vanished zebra");
    expect(pop.querySelector(".cmt-body")!.textContent).toBe("my note");
  } finally {
    teardown();
  }
});

test("delete posts the shrunken comment array and removes the highlight", async () => {
  const html = await renderPadWithComments([cmt()]);
  const posted: any[] = [];
  await boot(html, undefined, (w) => {
    w.window.chrome = { webview: { postMessage: (m: any) => posted.push(m) } };
  });
  try {
    (document.querySelector(".cmt-hl") as any).click();
    const del = Array.from(document.querySelectorAll(".cmt-pop .pbtn")).find(
      (b) => b.textContent === "delete",
    ) as any;
    del.click();
    const msg = posted.find((m) => m && m.__scratch_comments);
    expect(msg).toBeDefined();
    expect(msg.__scratch_comments.filePath).toBe("doc.md");
    expect(msg.__scratch_comments.comments).toEqual([]);
    expect(document.querySelector(".cmt-hl")).toBeNull();
    expect(document.querySelector(".cmt-note")).toBeNull();
    expect(document.querySelector(".cmt-pop")).toBeNull();
    // Unwrapping restored the original text.
    expect(document.querySelector("#preview .md")!.textContent).toContain("Text bold here.");
  } finally {
    teardown();
  }
});

test("export mode: a comment edit arms Save-a-copy; saving splices DATA into the file", async () => {
  const html = await renderPadWithComments([cmt()], undefined, true);
  const saved: Blob[] = [];
  await boot(html, undefined, (w) => {
    // boot() replaces documentElement.innerHTML, so the <html data-export>
    // attribute from renderHtml is lost — re-apply it to mirror the real page.
    document.documentElement.setAttribute("data-export", "");
    w.showSaveFilePicker = () =>
      Promise.resolve({
        createWritable: () =>
          Promise.resolve({
            write: (b: Blob) => {
              saved.push(b);
              return Promise.resolve();
            },
            close: () => Promise.resolve(),
          }),
      });
  });
  try {
    const dot = document.getElementById("saveDot") as any;
    expect(dot.hidden).toBe(true);
    // The exporter's local path means nothing to a recipient — no copy-path button.
    expect(document.getElementById("copyPath")).toBeNull();
    // 'r' must not reach the browser-fallback reload path (location.reload would
    // drop unsaved comments); the guarded handler sets no reload flag.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));
    expect(sessionStorage.getItem("scratch_reloaded")).toBeNull();
    // Delete the only comment — no host to post to; DATA mutates in place.
    (document.querySelector(".cmt-hl") as any).click();
    (
      Array.from(document.querySelectorAll(".cmt-pop .pbtn")).find(
        (b) => b.textContent === "delete",
      ) as any
    ).click();
    expect(dot.hidden).toBe(false); // dirty → save armed
    (document.getElementById("saveCopy") as any).click();
    await new Promise((r) => setTimeout(r, 10)); // let the picker promise chain settle
    expect(saved.length).toBe(1);
    const out = await saved[0]!.text();
    // The island in the saved copy reflects the deletion…
    const island = out.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/)![1]!;
    expect(JSON.parse(island).pads[0].files[0].comments).toEqual([]);
    // …and the copy is itself still a savable export.
    expect(out).toMatch(/<html[^>]* data-export/);
    expect(out).toContain('id="saveCopy"');
    expect(dot.hidden).toBe(true); // saved → clean
  } finally {
    teardown();
  }
});

test("edit updates the body and bumps updated, persisting the full array", async () => {
  const html = await renderPadWithComments([cmt()]);
  const posted: any[] = [];
  await boot(html, undefined, (w) => {
    w.window.chrome = { webview: { postMessage: (m: any) => posted.push(m) } };
  });
  try {
    (document.querySelector(".cmt-hl") as any).click();
    (Array.from(document.querySelectorAll(".cmt-pop .pbtn")).find((b) => b.textContent === "edit") as any).click();
    const ta = document.querySelector(".cmt-pop textarea") as any;
    ta.value = "revised note";
    (Array.from(document.querySelectorAll(".cmt-pop .pbtn")).find((b) => b.textContent === "save") as any).click();
    const msg = posted.find((m) => m && m.__scratch_comments);
    expect(msg).toBeDefined();
    const c = msg.__scratch_comments.comments[0];
    expect(c.body).toBe("revised note");
    expect(c.updated).not.toBe(c.created);
    expect(document.querySelector(".cmt-pop")).toBeNull();
    // The always-visible note pill reflects the new body.
    expect((document.querySelector(".cmt-note") as any).dataset.note).toBe("revised note");
  } finally {
    teardown();
  }
});

test("Ctrl+Enter in the comment textarea submits like the button", async () => {
  const html = await renderPadWithComments([cmt()]);
  const posted: any[] = [];
  await boot(html, undefined, (w) => {
    w.window.chrome = { webview: { postMessage: (m: any) => posted.push(m) } };
  });
  try {
    (document.querySelector(".cmt-hl") as any).click();
    (Array.from(document.querySelectorAll(".cmt-pop .pbtn")).find((b) => b.textContent === "edit") as any).click();
    const ta = document.querySelector(".cmt-pop textarea") as any;
    ta.value = "via keyboard";
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }));
    const msg = posted.find((m) => m && m.__scratch_comments);
    expect(msg).toBeDefined();
    expect(msg.__scratch_comments.comments[0].body).toBe("via keyboard");
    expect(document.querySelector(".cmt-pop")).toBeNull();
    // Plain Enter must NOT submit (it's a newline in the textarea).
    (document.querySelector(".cmt-hl") as any).click();
    (Array.from(document.querySelectorAll(".cmt-pop .pbtn")).find((b) => b.textContent === "edit") as any).click();
    posted.length = 0;
    (document.querySelector(".cmt-pop textarea") as any).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter" }),
    );
    expect(posted.find((m) => m && m.__scratch_comments)).toBeUndefined();
    expect(document.querySelector(".cmt-pop")).not.toBeNull();
  } finally {
    teardown();
  }
});

test("'c' toggles comment visibility and persists to localStorage", async () => {
  const html = await renderPadWithComments([cmt()]);
  await boot(html);
  try {
    expect(document.documentElement.hasAttribute("data-comments-off")).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));
    expect(document.documentElement.hasAttribute("data-comments-off")).toBe(true);
    expect(localStorage.getItem("scratch.comments")).toBe("0");
    // Hidden → clicking a highlight must not open a popover.
    (document.querySelector(".cmt-hl") as any).click();
    expect(document.querySelector(".cmt-pop")).toBeNull();
    // Toggle is keyboard-only now; the header button opens the summary instead.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));
    expect(document.documentElement.hasAttribute("data-comments-off")).toBe(false);
    expect(localStorage.getItem("scratch.comments")).toBe("1");
  } finally {
    teardown();
  }
});

test("clicking the comments button opens a pad-wide summary, click again closes it", async () => {
  const html = await renderPadWithComments([cmt()]);
  await boot(html);
  try {
    const btn = document.getElementById("commentsToggle") as any;
    btn.click();
    const pop = document.querySelector(".cmt-pop.cmt-summary");
    expect(pop).not.toBeNull();
    expect(pop!.querySelector(".cmt-shead")!.textContent).toBe("1 comment");
    expect(pop!.querySelectorAll(".cmt-srow").length).toBe(1);
    // Visibility unchanged — the button no longer toggles.
    expect(document.documentElement.hasAttribute("data-comments-off")).toBe(false);
    btn.click();
    expect(document.querySelector(".cmt-pop.cmt-summary")).toBeNull();
  } finally {
    teardown();
  }
});

test("a saved hidden-comments choice is restored at boot", async () => {
  const html = await renderPadWithComments([cmt()]);
  await boot(html, { "scratch.comments": "0" });
  try {
    expect(document.documentElement.hasAttribute("data-comments-off")).toBe(true);
    expect((document.getElementById("commentsToggle") as any).classList.contains("muted")).toBe(true);
  } finally {
    teardown();
  }
});

test("selecting text shows the add affordance; submitting persists a new comment", async () => {
  const html = await renderPadWithComments([]);
  const posted: any[] = [];
  await boot(html, undefined, (w) => {
    w.window.chrome = { webview: { postMessage: (m: any) => posted.push(m) } };
  });
  try {
    // Select the word "prose" in the last paragraph programmatically.
    const md = document.querySelector("#preview .md")!;
    const p = Array.from(md.querySelectorAll("p")).find((x) => x.textContent!.includes("More prose"))!;
    const textNode = p.firstChild!;
    const range = document.createRange();
    const idx = textNode.textContent!.indexOf("prose");
    range.setStart(textNode, idx);
    range.setEnd(textNode, idx + "prose".length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    const add = document.getElementById("cmtAdd") as any;
    expect(add).not.toBeNull();
    expect(add.style.display).not.toBe("none");
    add.click();
    const ta = document.querySelector(".cmt-pop textarea") as any;
    expect(ta).not.toBeNull();
    ta.value = "fresh thought";
    (Array.from(document.querySelectorAll(".cmt-pop .pbtn")).find((b) => b.textContent === "add") as any).click();

    const msg = posted.find((m) => m && m.__scratch_comments);
    expect(msg).toBeDefined();
    const c = msg.__scratch_comments.comments[0];
    expect(c.body).toBe("fresh thought");
    expect(c.anchor.quote).toBe("prose");
    expect(c.anchor.prefix).toContain("More ");
    expect(c.id).toBeTruthy();
    // Highlighted in place with its note pill, no re-render needed.
    const hl = document.querySelector(".cmt-hl") as any;
    expect(hl).not.toBeNull();
    expect(hl.textContent).toBe("prose");
    expect((document.querySelector(".cmt-note") as any).dataset.note).toBe("fresh thought");
  } finally {
    teardown();
  }
});

test("raw mode renders no comment highlights; rendered view restores them", async () => {
  const html = await renderPadWithComments([cmt()]);
  await boot(html);
  try {
    expect(document.querySelector(".cmt-hl")).not.toBeNull();
    (document.getElementById("vRaw") as any).click();
    expect(document.querySelector(".cmt-hl")).toBeNull();
    expect(document.querySelector(".cmt-pop")).toBeNull();
    (document.getElementById("vRendered") as any).click();
    expect(document.querySelector(".cmt-hl")).not.toBeNull();
  } finally {
    teardown();
  }
});

test("in-place reload shows a toast (success on change, info when unchanged)", async () => {
  const html = await renderPad();
  await boot(html);
  try {
    const toast = document.getElementById("toast")!;
    const w = globalThis as any;
    // The app script parsed the data island into its internal DATA; reuse it.
    const data = JSON.parse(document.getElementById("data")!.textContent!);

    // Identical payload → no changes → info toast.
    w.__scratchReload(data);
    expect(toast.classList.contains("visible")).toBe(true);
    expect(toast.classList.contains("toast-info")).toBe(true);
    expect(toast.textContent).toContain("No changes");

    // Changed payload → reloaded → success toast (variant swaps, not stacks).
    const changed = JSON.parse(JSON.stringify(data));
    changed.pads[0].files[0].content = "# Changed\n";
    w.__scratchReload(changed);
    expect(toast.classList.contains("visible")).toBe(true);
    expect(toast.classList.contains("toast-success")).toBe(true);
    expect(toast.classList.contains("toast-info")).toBe(false);
    expect(toast.textContent).toContain("Reloaded from disk");
  } finally {
    teardown();
  }
});

// --- clickable task checkboxes ---

async function renderPadWithTasks(content: string): Promise<string> {
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "doc.md"), content, "utf8");
  const m = newManifest("P");
  m.files.push({ path: "doc.md", title: "Doc", type: "note" });
  await writeManifest(dir, m);
  const pad: Pad = { dir, manifest: await readManifest(dir) };
  return renderHtml(await buildView([pad]), "P");
}

test("clicking a task checkbox toggles it and posts __scratch_checkbox with the source line", async () => {
  // Line indices (0-based): 0 "# Todos", 1 "", 2 "- [ ] one", 3 "- [x] two".
  const html = await renderPadWithTasks("# Todos\n\n- [ ] one\n- [x] two\n");
  const posted: any[] = [];
  await boot(html, undefined, (w) => {
    w.window.chrome = { webview: { postMessage: (m: any) => posted.push(m) } };
  });
  try {
    const tasks = Array.from(document.querySelectorAll("#preview .md li.task"));
    expect(tasks.length).toBe(2);
    const t0 = tasks[0] as HTMLElement;
    const t1 = tasks[1] as HTMLElement;
    // Source line carried for the writeback.
    expect(t0.dataset.line).toBe("2");
    expect(t1.dataset.line).toBe("3");
    expect(t0.classList.contains("done")).toBe(false);
    expect(t1.classList.contains("done")).toBe(true);

    // Check the first box → DOM flips + posts {line:2, checked:true}.
    (t0.querySelector(".chk") as any).click();
    expect(t0.classList.contains("done")).toBe(true);
    expect(t0.querySelector(".chk")!.textContent).toBe("✓");
    expect(t0.querySelector(".chk")!.getAttribute("aria-checked")).toBe("true");
    let msg = posted.find((m) => m && m.__scratch_checkbox);
    expect(msg.__scratch_checkbox).toMatchObject({ filePath: "doc.md", line: 2, checked: true });

    // Uncheck the second → posts {line:3, checked:false}.
    posted.length = 0;
    (t1.querySelector(".chk") as any).click();
    expect(t1.classList.contains("done")).toBe(false);
    msg = posted.find((m) => m && m.__scratch_checkbox);
    expect(msg.__scratch_checkbox).toMatchObject({ line: 3, checked: false });
  } finally {
    teardown();
  }
});
