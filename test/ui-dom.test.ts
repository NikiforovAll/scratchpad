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
import { newManifest, writeManifest, readManifest } from "../src/manifest.ts";
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

    // Color theme card applies data-color-theme and persists.
    (modal.querySelector('.theme-card[data-theme-id="gruvbox"]') as any).click();
    expect(document.documentElement.dataset.colorTheme).toBe("gruvbox");
    expect(localStorage.getItem("scratch.colorTheme")).toBe("gruvbox");

    // Active states reflected in the modal.
    expect(modal.querySelector('button[data-mode="light"]')!.classList.contains("on")).toBe(true);
    expect(modal.querySelector('.theme-card[data-theme-id="gruvbox"]')!.classList.contains("on")).toBe(true);

    // System mode goes back to following the (dark-preferring) OS stub.
    (modal.querySelector('#modeSeg button[data-mode="system"]') as any).click();
    expect(document.documentElement.dataset.theme).toBe("dark");

    (document.getElementById("settingsClose") as any).click();
    expect((modal as any).style.display).toBe("none");
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
      gridStyle: "lines",
      wideMode: true,
      zoom: 1.2,
    });

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.colorTheme).toBe("gruvbox");
    expect(document.documentElement.dataset.grid).toBe("lines");
    expect(document.documentElement.hasAttribute("data-wide")).toBe(true);
    expect(document.documentElement.style.zoom).toBe("1.2");
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

test("sidebar collapses via the topbar button and '[', persisting to localStorage", async () => {
  const html = await renderPad();
  await boot(html);
  try {
    const sidebar = document.getElementById("sidebar")!;
    expect(sidebar.classList.contains("collapsed")).toBe(false);
    (document.getElementById("sidebarToggle") as any).click();
    expect(sidebar.classList.contains("collapsed")).toBe(true);
    expect(localStorage.getItem("scratch.sidebarCollapsed")).toBe("1");
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
