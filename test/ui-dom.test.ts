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
import { type Comment, type Layout, newManifest, writeManifest, readManifest, orderGroupKeys } from "../src/manifest.ts";
import type { Pad } from "../src/discovery.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "scratch-dom-"));
});
afterEach(async () => {
  // Safety net: if a test threw before its `await teardown()`, the happy-dom
  // window is still registered. Close it here so windows never accumulate across
  // tests (un-closed windows keep their timers/observers alive → OOM crash).
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  await rm(root, { recursive: true, force: true });
});

async function renderPad(): Promise<string> {
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "doc.md"),
    "# Heading\n\nText **bold** and ~~struck~~.\n\n```ts\nconst x = 1;\n```\n\n```mermaid\ngraph TD; A-->B;\n```\n",
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
  const katexCalls: any[] = [];
  w.hljs = { highlightElement: (el: any) => el.classList.add("hljs") };
  w.mermaid = {
    initialize: (cfg: any) => mermaidCalls.push(["init", cfg]),
    run: (opts: any) => mermaidCalls.push(["run", opts?.nodes?.length ?? 0]),
  };
  // KaTeX render replaces the node's content; the stub records the source + mode
  // and marks the node so tests can assert it was rendered.
  w.katex = {
    render: (tex: string, el: any, opts: any) => {
      katexCalls.push([tex, !!opts?.displayMode]);
      el.setAttribute("data-rendered", "1");
    },
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
  // innerHTML only replaces children, so the real <html> tag's attributes would be
  // dropped — and the page reads them at boot (data-export, data-theme-pinned).
  // Copy them across first so the harness sees the same root element a browser would.
  const rootTag = /<html([^>]*)>/.exec(slim)?.[1] ?? "";
  for (const [, name, , value] of rootTag.matchAll(/([\w-]+)(="([^"]*)")?/g)) {
    if (name && name !== "lang") document.documentElement.setAttribute(name, value ?? "");
  }
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
  return { mermaidCalls, katexCalls };
}

// unregister() is async — it awaits happyDOM.close(), which aborts the page's
// timers/observers and frees the window. It MUST be awaited; firing it un-awaited
// lets each test's window leak (close races the next register()) → memory grows
// until Bun OOM-panics once the file passes ~25 tests. Callers must `await`.
async function teardown() {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
}

// happy-dom has no layout engine. To observe scrollToAnchor's clamped scroll, make
// the target heading report a top offset and capture the scrollTop it sets on
// #preview. Expected landing = headingTop - ANCHOR_GAP (24), clamped to the range.
const ANCHOR_GAP = 24;
function armAnchorScroll(headingTop = 300): () => number {
  (Element.prototype as any).getBoundingClientRect = function () {
    return { top: this.tagName === "H2" ? headingTop : 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  };
  const pv = document.getElementById("preview") as any;
  Object.defineProperty(pv, "scrollHeight", { configurable: true, get: () => 10000 });
  Object.defineProperty(pv, "clientHeight", { configurable: true, get: () => 500 });
  let scrolled = 0;
  Object.defineProperty(pv, "scrollTop", { configurable: true, get: () => scrolled, set: (v: number) => (scrolled = v) });
  return () => scrolled;
}

async function renderPadWithContent(content: string): Promise<string> {
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "doc.md"), content, "utf8");
  const m = newManifest("P");
  m.files.push({ path: "doc.md", title: "Doc", type: "note" });
  await writeManifest(dir, m);
  const pad: Pad = { dir, manifest: await readManifest(dir) };
  return renderHtml(await buildView([pad]), "P");
}

test("table of contents: off by default, 'o' reveals the full H1–H6 hierarchy", async () => {
  const html = await renderPadWithContent(
    "# Top\n\ntext\n\n## Middle\n\ntext\n\n### Deep\n\ntext\n",
  );
  await boot(html);
  try {
    const toc = document.getElementById("toc")!;
    // Built from the rendered headings (the ptitle <h1> is outside .md, excluded).
    const links = toc.querySelectorAll(".toc-link");
    expect(links.length).toBe(3);
    // Each level carries its own class, indented in CSS; full names, no truncation.
    expect(Array.from(links).map((l) => l.className.replace("toc-link ", ""))).toEqual([
      "toc-h1",
      "toc-h2",
      "toc-h3",
    ]);
    expect((links[2] as any).textContent).toBe("Deep");
    // Headings got slug ids the links point at.
    const md = document.querySelector("#preview .md")!;
    expect(md.querySelector("h2")!.id).toBe("middle");
    expect((links[1] as any).getAttribute("href")).toBe("#middle");
    // Off by default — hidden until invoked.
    expect(toc.style.display).toBe("none");
    // 'o' reveals it; again hides it (persisted setting toggles).
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "o" }));
    expect(toc.style.display).toBe("block");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "o" }));
    expect(toc.style.display).toBe("none");
  } finally {
    await teardown();
  }
});

test("code-span link text renders <code> inside <a>, not a leaked stash placeholder", async () => {
  // Regression: a stashed construct (code span) nested inside another stashed
  // one (the link) needs a fixpoint restore. A single pass left the inner
  // \x00S0\x00 token intact; its NUL sentinels are invisible, so it surfaced as
  // bare "S0"/"S1" in the rendered link.
  const html = await renderPadWithContent("- [`design.md`](design.md)\n");
  await boot(html);
  try {
    const link = document.querySelector('#preview .md a[href="design.md"]') as any;
    expect(link).not.toBeNull();
    const code = link.querySelector("code");
    expect(code).not.toBeNull();
    expect(code.textContent).toBe("design.md");
    // No leaked placeholder body or NUL sentinel bleeding into the text.
    expect(link.textContent).toBe("design.md");
    expect(link.textContent).not.toMatch(/\x00|^S\d/);
  } finally {
    await teardown();
  }
});

test("in-page anchor link [x](#heading) scrolls to the matching heading", async () => {
  // A single H1 below the body heading: too few for a TOC, but the anchor must
  // still resolve — id assignment is independent of whether the TOC renders.
  const html = await renderPadWithContent(
    "intro [jump](#what-would-be-needed)\n\n## What would be needed\n\nbody\n",
  );
  await boot(html);
  try {
    const md = document.querySelector("#preview .md")!;
    const heading = md.querySelector("h2")!;
    expect(heading.id).toBe("what-would-be-needed");
    // No TOC (only one heading), yet the anchor still has a target.
    expect(document.getElementById("toc")!.querySelectorAll(".toc-link").length).toBe(0);
    // Clicking the anchor scrolls to the heading, clamped to the scroll range.
    const scrolled = armAnchorScroll(300);
    const link = md.querySelector('a[href="#what-would-be-needed"]') as any;
    expect(link).not.toBeNull();
    link.click();
    expect(scrolled()).toBe(300 - ANCHOR_GAP);
  } finally {
    await teardown();
  }
});

test("heading ids follow GFM slugging: punctuation dropped, spaces kept 1:1 (no collapse)", async () => {
  // "method — block": the em-dash is dropped, leaving two spaces → a DOUBLE hyphen,
  // matching the id GitHub generates (and what authors hand-write in #anchors).
  const html = await renderPadWithContent(
    "[jump](#calculation-method--block-tiling)\n\n## Calculation method — block tiling\n\nbody\n",
  );
  await boot(html);
  try {
    const md = document.querySelector("#preview .md")!;
    expect(md.querySelector("h2")!.id).toBe("calculation-method--block-tiling");
    const scrolled = armAnchorScroll(300);
    (md.querySelector('a[href="#calculation-method--block-tiling"]') as any).click();
    expect(scrolled()).toBe(300 - ANCHOR_GAP);
  } finally {
    await teardown();
  }
});

test("autolinks: angle-bracket <url>/<mailto>/<email>, bare URLs and www. all become anchors", async () => {
  const html = await renderPadWithContent(
    [
      "Angle <https://learn.microsoft.com/x#y> here.",
      "",
      "Mail <mailto:a@b.com> and bare <a@b.com> too.",
      "",
      "Bare https://example.com/p?q=1 in prose, and www.example.org as well.",
      "",
      "Trailing (see https://example.com/doc).",
      "",
      "Markdown [link](https://kept.example) stays single.",
      "",
      "Remote image ![pic](https://img.example/p.png) keeps its src intact.",
      "",
      "[^n]: ref <https://fn.example/page> (fetched).",
      "",
      "Cite[^n] it.",
    ].join("\n"),
  );
  await boot(html);
  try {
    const md = document.querySelector("#preview .md")!;
    // Angle-bracket autolink: real anchor, not literal &lt;…&gt; text.
    const angle = md.querySelector('a[href="https://learn.microsoft.com/x#y"]')!;
    expect(angle).not.toBeNull();
    expect(angle.textContent).toBe("https://learn.microsoft.com/x#y");
    expect(md.innerHTML).not.toContain("&lt;https://");
    // mailto: kept; bare email gets a mailto: href.
    expect(md.querySelector('a[href="mailto:a@b.com"]')).not.toBeNull();
    // Bare URL + www. linkified (www. gets an http:// href).
    expect(md.querySelector('a[href="https://example.com/p?q=1"]')).not.toBeNull();
    expect(md.querySelector('a[href="http://www.example.org"]')).not.toBeNull();
    // Trailing ) stays outside the link.
    const trailing = md.querySelector('a[href="https://example.com/doc"]')!;
    expect(trailing).not.toBeNull();
    expect(trailing.textContent).toBe("https://example.com/doc");
    // An existing markdown link is not double-wrapped.
    const kept = md.querySelectorAll('a[href="https://kept.example"]');
    expect(kept.length).toBe(1);
    expect(kept[0]!.querySelector("a")).toBeNull();
    // A remote image's src is not linkified into a broken nested anchor — the
    // bare-URL pass never sees stashed <img>/<a> markup.
    const img = md.querySelector('img[src="https://img.example/p.png"]')!;
    expect(img).not.toBeNull();
    expect(img.querySelector("a")).toBeNull();
    // Autolink inside a footnote definition is linkified in the rendered list.
    expect(md.querySelector('.footnotes a[href="https://fn.example/page"]')).not.toBeNull();
  } finally {
    await teardown();
  }
});

test("cross-file anchor [x](other.md#heading) opens the doc and scrolls to the heading", async () => {
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  await writeFile(dir + "/doc.md", "see [there](other.md#what-would-be-needed)\n", "utf8");
  await writeFile(dir + "/other.md", "# Other\n\n## What would be needed\n\nbody\n", "utf8");
  const m = newManifest("P");
  m.files.push({ path: "doc.md", title: "Doc", type: "note" });
  m.files.push({ path: "other.md", title: "Other", type: "note" });
  await writeManifest(dir, m);
  const pad: Pad = { dir, manifest: await readManifest(dir) };
  await boot(await renderHtml(await buildView([pad]), "P"));
  try {
    // Arm before the click: the heading is created when the doc renders, but the
    // prototype rect stub applies to it and the #preview scrollTop accessor persists.
    const scrolled = armAnchorScroll(300);
    const link = document.querySelector('#preview .md a[href="other.md#what-would-be-needed"]') as any;
    expect(link).not.toBeNull();
    link.click();
    // The viewer switched to other.md...
    expect(document.querySelector("#preview .pfile")!.textContent).toBe("other.md");
    // ...and landed on the linked heading (not the top / a remembered scroll).
    const heading = document.querySelector("#preview .md h2")!;
    expect(heading.id).toBe("what-would-be-needed");
    expect(scrolled()).toBe(300 - ANCHOR_GAP);
  } finally {
    await teardown();
  }
});

test("wikilinks: [[basename]] and [[Title]] resolve to a working cross-file link; [[name|alias]] uses the alias", async () => {
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  await writeFile(
    dir + "/doc.md",
    "See [[other]] and [[Other Doc]] and [[other|a custom name]].\n",
    "utf8",
  );
  await writeFile(dir + "/other.md", "# Other\n\nbody\n", "utf8");
  const m = newManifest("P");
  m.files.push({ path: "doc.md", title: "Doc", type: "note" });
  m.files.push({ path: "other.md", title: "Other Doc", type: "note" });
  await writeManifest(dir, m);
  const pad: Pad = { dir, manifest: await readManifest(dir) };
  await boot(await renderHtml(await buildView([pad]), "P"));
  try {
    const md = document.querySelector("#preview .md")!;
    const links = md.querySelectorAll('a[href="/other.md"]');
    // basename match, title-fallback match, and the aliased form all resolve to
    // the same file.
    expect(links.length).toBe(3);
    expect(links[0]!.textContent).toBe("Other Doc"); // display = resolved title
    expect(links[2]!.textContent).toBe("a custom name"); // display = alias
    // Clicking one navigates via the existing cross-file click handler (no new
    // click-handling code — the leading '/' makes resolveRel treat it as
    // pad-root-absolute).
    (links[0] as any).click();
    expect(document.querySelector("#preview .pfile")!.textContent).toBe("other.md");
  } finally {
    await teardown();
  }
});

test("an unresolved wikilink [[nonexistent]] renders as a broken-link span, not a clickable anchor", async () => {
  const html = await renderPadWithContent("Refers to [[nonexistent]] and [[missing|Missing Thing]].\n");
  await boot(html);
  try {
    const md = document.querySelector("#preview .md")!;
    const spans = md.querySelectorAll("span.wikilink-broken");
    expect(spans.length).toBe(2);
    expect(spans[0]!.textContent).toBe("nonexistent");
    expect(spans[1]!.textContent).toBe("Missing Thing");
    // Not real anchors — no href to click through.
    expect(spans[0]!.closest("a")).toBeNull();
    expect(md.querySelectorAll("a").length).toBe(0);
  } finally {
    await teardown();
  }
});

test("a plain link opens at the top; the left nav restores the remembered scroll", async () => {
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  await writeFile(dir + "/doc.md", "go [over](other.md)\n", "utf8");
  await writeFile(dir + "/other.md", "# Other\n\nbody\n", "utf8");
  const m = newManifest("P");
  m.files.push({ path: "doc.md", title: "Doc", type: "note" });
  m.files.push({ path: "other.md", title: "Other", type: "note" });
  await writeManifest(dir, m);
  const pad: Pad = { dir, manifest: await readManifest(dir) };
  await boot(await renderHtml(await buildView([pad]), "P"));
  const preview = document.getElementById("preview") as any;
  try {
    const rows = Array.from(document.querySelectorAll(".frow[data-fi]")) as any[];
    // Visit other.md via the nav, scroll partway down, then go back to doc.md
    // (leaving other.md records its scroll position).
    rows[1].click();
    preview.scrollTop = 137;
    rows[0].click();
    // Reaching the same file through the left nav restores where we left off.
    rows[1].click();
    expect(preview.scrollTop).toBe(137);
    // Go back to doc.md, then follow its plain link to other.md: a link is a fresh
    // read → top of the doc, NOT the resume.
    rows[0].click();
    (document.querySelector('#preview .md a[href="other.md"]') as any).click();
    expect(document.querySelector("#preview .pfile")!.textContent).toBe("other.md");
    expect(preview.scrollTop).toBe(0);
  } finally {
    await teardown();
  }
});

test("Esc dismisses overlays but never closes the window; 'q' closes it", async () => {
  const html = await renderPad();
  const posted: any[] = [];
  await boot(html, undefined, (w) => {
    w.window.chrome = { webview: { postMessage: (m: any) => posted.push(m) } };
  });
  try {
    // Open settings, then Esc closes the dialog — without posting a close.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "s" }));
    expect(document.getElementById("settingsModal")!.style.display).toBe("flex");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.getElementById("settingsModal")!.style.display).toBe("none");
    expect(posted.some((m) => m && m.__glimpse_close)).toBe(false);
    // Esc with nothing open is a no-op (no window close).
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(posted.some((m) => m && m.__glimpse_close)).toBe(false);
    // 'q' is the only window-close key.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "q" }));
    expect(posted.some((m) => m && m.__glimpse_close)).toBe(true);
  } finally {
    await teardown();
  }
});

test("renders markdown, highlights code, invokes mermaid, builds tree", async () => {
  const html = await renderPad();
  const { mermaidCalls } = await boot(html);
  try {
    const preview = document.getElementById("preview")!;
    // markdown rendered to a heading
    expect(preview.querySelector(".md h1")?.textContent).toContain("Heading");
    // GFM strikethrough rendered to <del>
    expect(preview.querySelector(".md del")?.textContent).toBe("struck");
    // code block present + highlight wiring ran (stub adds .hljs)
    const code = preview.querySelector("pre code");
    expect(code).not.toBeNull();
    expect(code!.classList.contains("hljs")).toBe(true);
    // mermaid block emitted + mermaid.run invoked with 1 node
    expect(preview.querySelector(".mermaid")).not.toBeNull();
    expect(mermaidCalls.some((c) => c[0] === "run" && c[1] === 1)).toBe(true);
    // Labels must stay SVG <text>, never an HTML foreignObject (it clips to its own
    // box) — see the comment at mermaid.initialize in src/ui/render.ts. Both keys are
    // asserted because mermaid 11 ignores flowchart.htmlLabels without the top-level one.
    const init = mermaidCalls.find((c) => c[0] === "init")?.[1];
    expect(init?.htmlLabels).toBe(false);
    expect(init?.flowchart?.htmlLabels).toBe(false);
    // metadata strip
    expect(preview.querySelector(".pmeta")?.textContent).toContain("#t");
    // tree built with the file row
    expect(document.querySelector(".frow")?.textContent).toContain("Doc");
  } finally {
    await teardown();
  }
});

test("a rendered mermaid SVG expands into the diagram lightbox via its chip / 'f'; Esc closes it", async () => {
  const html = await renderPad();
  await boot(html);
  try {
    const md = document.querySelector(".mermaid")!;
    // Stand in for mermaid's rendered output (the stub doesn't emit real SVG).
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.style.maxWidth = "320px";
    md.appendChild(svg);
    // One affordance for both embed kinds: the ⛶ chip and 'f'. Double-click is gone —
    // it was undiscoverable and had no html-embed counterpart.
    const chip = document.createElement("button");
    chip.className = "embed-full";
    md.appendChild(chip);

    const modal = document.getElementById("diagramModal")!;
    expect(modal.style.display).toBe("none");
    chip.click();
    expect(modal.style.display).toBe("flex");
    // An expanded mermaid uses the lightbox, never the html full-window mode.
    expect(document.documentElement.hasAttribute("data-focus")).toBe(false);
    const cloned = document.querySelector("#diagramStage svg") as SVGElement;
    expect(cloned).not.toBeNull();
    // mermaid's inline max-width cap is stripped so the lightbox CSS can scale up.
    expect(cloned.style.maxWidth).toBe("");

    // Wheel up zooms in (transform gains a scale > 1); double-click resets.
    const stage = document.getElementById("diagramStage")!;
    stage.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true }));
    expect(cloned.style.transform).toContain("scale(1.1");
    stage.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(cloned.style.transform).toContain("scale(1)");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(modal.style.display).toBe("none");
    expect(document.querySelector("#diagramStage svg")).toBeNull();

    // 'f' over the hovered diagram is the keyboard route to the same lightbox.
    svg.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }));
    expect(modal.style.display).toBe("flex");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }));
    expect(modal.style.display).toBe("none");

    // ...and only while hovering: moving the pointer off the diagram clears the target,
    // so a bare 'f' elsewhere on the page must not re-open it.
    document.body.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }));
    expect(modal.style.display).toBe("none");

    // Double-click no longer opens it (the stage keeps its own dblclick = zoom reset).
    svg.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(modal.style.display).toBe("none");
  } finally {
    await teardown();
  }
});

test("renders TeX math via KaTeX (inline + display), guarding code spans and prose currency", async () => {
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "math.md"),
    [
      "# Math",
      "",
      "Inline $E = mc^2$ here.",
      "",
      "It costs $5 and $10, and `$a$` stays code.",
      "",
      "$$",
      "\\text{tokens} = \\operatorname{round}(W/28) \\times \\operatorname{round}(H/28) + 2",
      "$$",
      "",
    ].join("\n"),
    "utf8",
  );
  const m = newManifest("P");
  m.files.push({ path: "math.md", title: "Math", type: "note" });
  await writeManifest(dir, m);
  const pad: Pad = { dir, manifest: await readManifest(dir) };
  const html = await renderHtml(await buildView([pad]), "P");
  // KaTeX CDN linked only because the doc has math.
  expect(html).toMatch(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]+katex@[^"]+" integrity="sha384-/);
  const { katexCalls } = await boot(html);
  try {
    const preview = document.getElementById("preview")!;
    // Exactly two math nodes: one inline, one display. The currency "$5 and $10"
    // and the `$a$` code span must NOT be picked up as math.
    const maths = preview.querySelectorAll(".md .math");
    expect(maths.length).toBe(2);
    expect(preview.querySelectorAll(".md .math-display").length).toBe(1);
    // Code span survived literally, not consumed by math extraction.
    expect(preview.querySelector(".md code")?.textContent).toBe("$a$");
    // Prose currency stayed as text in the paragraph.
    expect(preview.textContent).toContain("$5 and $10");
    // KaTeX invoked for both, with the right displayMode and source.
    expect(katexCalls.some((c) => c[0] === "E = mc^2" && c[1] === false)).toBe(true);
    expect(katexCalls.some((c) => c[1] === true && c[0].includes("\\operatorname{round}"))).toBe(true);
  } finally {
    await teardown();
  }
});

test("display math with trailing prose stays inline and does not swallow following blocks", async () => {
  // Regression: a $$…$$ that opens a line but has prose after the closing $$ must
  // NOT trigger the multi-line block gather (which used to eat the heading + table).
  const html = await renderPadWithContent(
    [
      "$$x = 1$$ where $x$ is the answer.",
      "",
      "## After",
      "",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
    ].join("\n"),
  );
  const { katexCalls } = await boot(html);
  try {
    const preview = document.getElementById("preview")!;
    // The heading and table after the math rendered (were previously swallowed).
    expect(preview.querySelector(".md h2")?.textContent).toBe("After");
    expect(preview.querySelector(".md table")).not.toBeNull();
    // The $$…$$ rendered as an inline display span (not a block div eating the tail).
    expect(katexCalls.some((c) => c[0] === "x = 1" && c[1] === true)).toBe(true);
    // Trailing prose survived as text.
    expect(preview.textContent).toContain("where");
  } finally {
    await teardown();
  }
});

test("multi-line $$ block spanning lines, with trailing prose after the close, renders", async () => {
  // Mirrors cost-analysis.md: opening $$ shares its line with content, the block
  // spans to a closing $$ that is mid-line and followed by prose (with inline math).
  const html = await renderPadWithContent(
    [
      "## Cost",
      "",
      "$$\\text{cost} = \\frac{t \\cdot N}{10^6} \\cdot r",
      "\\qquad (= \\$251.91)$$ where $r$ = rate.",
      "",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
    ].join("\n"),
  );
  const { katexCalls } = await boot(html);
  try {
    const preview = document.getElementById("preview")!;
    // The two-line block became ONE display-math node carrying both lines.
    const disp = preview.querySelectorAll(".md .math-display");
    expect(disp.length).toBe(1);
    expect(katexCalls.some((c) => c[1] === true && c[0].includes("\\qquad") && c[0].includes("\\text{cost}"))).toBe(true);
    // Trailing prose after the close rendered as a paragraph, with its inline $r$.
    expect(preview.textContent).toContain("where");
    expect(katexCalls.some((c) => c[0] === "r" && c[1] === false)).toBe(true);
    // The heading before and the table after both survived (no swallowing).
    expect(preview.querySelector(".md h2")?.textContent).toBe("Cost");
    expect(preview.querySelector(".md table")).not.toBeNull();
  } finally {
    await teardown();
  }
});

test("footnotes: [^id] refs are numbered and linked to a definitions list ([^id]: …)", async () => {
  const html = await renderPadWithContent(
    [
      "A frozen-tower model[^arxiv] documented by the authors[^blog].",
      "",
      "Reusing the first ref[^arxiv] keeps its number.",
      "",
      "An unknown[^missing] stays literal.",
      "",
      "[^arxiv]: jina-embeddings-v5-omni, [arXiv](https://arxiv.org/abs/2605.08384).",
      "[^blog]: Elastic Search Labs writeup.",
      "",
    ].join("\n"),
  );
  await boot(html);
  try {
    const md = document.querySelector("#preview .md")!;
    // Two distinct definitions → an ordered footnotes list with 2 items.
    const items = md.querySelectorAll(".footnotes li");
    expect(items.length).toBe(2);
    // arxiv, blog, arxiv (reused) are refs; the unknown is NOT.
    const refs = md.querySelectorAll("sup.fnref");
    expect(refs.length).toBe(3);
    expect(refs[0]!.querySelector("a")?.getAttribute("href")).toBe("#fn-arxiv");
    expect(refs[0]!.textContent).toBe("1");
    expect(refs[2]!.textContent).toBe("1"); // reused arxiv keeps #1
    expect(refs[1]!.textContent).toBe("2"); // blog is #2
    // The definition itself renders inline markdown (the [arXiv](url) link).
    expect(md.querySelector("#fn-arxiv a[href='https://arxiv.org/abs/2605.08384']")).not.toBeNull();
    // Back-link to the reference exists.
    expect(md.querySelector("#fn-arxiv .fn-back")?.getAttribute("href")).toBe("#fnref-arxiv");
    // Unknown footnote with no definition stays literal text.
    expect(md.textContent).toContain("[^missing]");
  } finally {
    await teardown();
  }
});

test("backslash escapes: \\$ \\* \\_ render the literal punctuation (GFM), without triggering math/emphasis", async () => {
  const html = await renderPadWithContent(
    [
      "rate: r = \\$/1M tokens",
      "",
      "literal \\*stars\\* and \\_under\\_ stay literal",
      "",
      "real $x+y$ math still renders.",
      "",
    ].join("\n"),
  );
  const { katexCalls } = await boot(html);
  try {
    const md = document.querySelector("#preview .md")!;
    // \$ renders as a plain $ — no backslash, no math span around it.
    expect(md.textContent).toContain("r = $/1M tokens");
    expect(md.textContent).not.toContain("\\$");
    // Escaped emphasis markers stay literal (no <em>/<strong>).
    expect(md.textContent).toContain("*stars*");
    expect(md.textContent).toContain("_under_");
    expect(md.querySelector("em")).toBeNull();
    expect(md.querySelector("strong")).toBeNull();
    // A genuine $…$ span is untouched and still rendered by KaTeX.
    expect(katexCalls.some((c) => c[0] === "x+y" && c[1] === false)).toBe(true);
  } finally {
    await teardown();
  }
});

test("nested emphasis: italic inside bold (**a *b* c**) renders without leaking ** markers", async () => {
  const html = await renderPadWithContent(
    [
      "**Greptile — verified success *and* failure story.** Rest of the line.",
      "",
      "***all three*** stars still work.",
      "",
      "__uses snake_case inside _bold_ body__",
      "",
    ].join("\n"),
  );
  await boot(html);
  try {
    const md = document.querySelector("#preview .md")!;
    // The bold span wraps the whole lead-in, with the italic nested inside it.
    const strongs = [...md.querySelectorAll("strong")];
    const lead = strongs.find((s) => s.textContent!.startsWith("Greptile"))!;
    expect(lead.textContent).toBe("Greptile — verified success and failure story.");
    expect(lead.querySelector("em")?.textContent).toBe("and");
    // No raw markers survive anywhere on the page.
    expect(md.textContent).not.toContain("**");
    expect(md.textContent).not.toContain("__");
    // ***…*** is bold+italic (no stranded star).
    const triple = strongs.find((s) => s.textContent === "all three")!;
    expect(triple.querySelector("em")).not.toBeNull();
    expect(md.textContent).not.toContain("*");
    // Underscore bold nests italics too, and intraword snake_case stays literal.
    const under = strongs.find((s) => s.textContent!.includes("snake_case"))!;
    expect(under.textContent).toBe("uses snake_case inside bold body");
    expect(under.querySelector("em")?.textContent).toBe("bold");
  } finally {
    await teardown();
  }
});

test("![](file.html) transcludes a local html file as a sandboxed iframe; missing/remote refs don't", async () => {
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "diagram.html"), "<!doctype html><b id=x>hi</b>", "utf8");
  await writeFile(join(dir, "page.html"), "<!doctype html><title>T</title><h1>page</h1>", "utf8");
  await writeFile(
    join(dir, "doc.md"),
    "# D\n\n![Cache](diagram.html)\n\n![Gone](missing.html)\n\n![Remote](https://e.com/x.html)\n",
    "utf8",
  );
  const m = newManifest("P");
  m.files.push({ path: "doc.md", title: "D", type: "note" });
  m.files.push({ path: "page.html", title: "Page", type: "artifact" });
  await writeManifest(dir, m);
  const pad: Pad = { dir, manifest: await readManifest(dir) };
  await boot(await renderHtml(await buildView([pad]), "P"));
  try {
    const frames = Array.from(document.querySelectorAll("#preview .md iframe.htmlframe")) as any[];
    // exactly the resolvable local .html is embedded (missing + remote are not)
    expect(frames.length).toBe(1);
    expect(frames[0].getAttribute("sandbox")).toBe("allow-scripts");
    // the file's content is carried in srcdoc (no allow-same-origin → isolated)
    const srcdoc = frames[0].getAttribute("srcdoc") as string;
    expect(srcdoc).toContain("<b id=x>hi</b>");
    // the built-in kit is baked into every embed: theme tokens, SVG classes,
    // the #arrow marker, and a forced (resolved) color-scheme
    expect(srcdoc).toContain(".c-blue");
    expect(srcdoc).toContain('id="arrow"');
    expect(srcdoc).toContain("light-dark(");
    expect(srcdoc).toMatch(/color-scheme:(dark|light)/);
    // keystrokes are forwarded out so host shortcuts (t/s/?) still fire with frame focus
    expect(srcdoc).toContain("__scratchKey");
    // the doc.md is not bloated — the diagram never appears as a registered file row
    expect(document.querySelector(".frow")?.textContent).not.toContain("diagram");

    // --- full-window mode ('f'), for both embed shapes. Folded into this test
    // rather than its own: each boot() is a happy-dom window and this file sits at
    // the ceiling described on teardown().
    const wrap = document.querySelector("#preview .md .htmlembed") as any;
    const embed = wrap.querySelector("iframe.htmlframe") as any;
    document.getElementById("zoomIn")!.click(); // the real writer: applyZoom via setZoom
    expect(document.documentElement.style.zoom).toBe("1.1");
    (wrap.querySelector("button.embed-full") as any).click();
    // Reader zoom is dropped while focused (it mis-sizes the fixed full-window box)
    // and restored on exit.
    expect(document.documentElement.style.zoom).toBe("");
    // Focus mode is attribute-driven: the frame is never reparented (that would
    // reload it and lose the author page's state), so it stays the SAME node.
    expect(document.documentElement.hasAttribute("data-focus")).toBe(true);
    expect(embed.hasAttribute("data-focused")).toBe(true);
    expect(wrap.querySelector("iframe.htmlframe")).toBe(embed);

    // While focused, other shortcuts are inert — no chrome-less dead end.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "[" }));
    expect(document.documentElement.hasAttribute("data-focus")).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.documentElement.hasAttribute("data-focus")).toBe(false);
    expect(embed.hasAttribute("data-focused")).toBe(false);
    expect(document.documentElement.style.zoom).toBe("1.1");
    // A settings sync mid-focus can't resurrect the zoom: applyZoom reads data-focus.
    (wrap.querySelector("button.embed-full") as any).click();
    document.getElementById("zoomIn")!.click();
    expect(document.documentElement.style.zoom).toBe("");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.documentElement.style.zoom).toBe("1.2");

    // --- embed scale: '+' / '-' / '0' ---
    // The frame reports its natural size; the host only remembers it (fitting on load
    // shrank near-fitting pages) and scales on demand. The box width is stubbed
    // because happy-dom does no layout (clientWidth is 0).
    const posts: any[] = [];
    Object.defineProperty(embed, "clientWidth", { value: 300, configurable: true });
    (embed.contentWindow as any).postMessage = (m: any) => posts.push(m);
    window.dispatchEvent(new MessageEvent("message", {
      data: { __scratchFrame: 1, h: 400, w: 900, z: 1 }, source: embed.contentWindow,
    } as any));
    // Sized to the reported height (already scaled frame-side), and NOT scaled itself.
    expect(embed.style.height).toBe("401px");
    expect(posts.length).toBe(0);
    // '0' fits the embed under the pointer: 900 natural into a 300 box → a third.
    embed.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "0" }));
    expect(posts.at(-1)).toEqual({ __scratchZoom: 1, z: 0.33 });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "+" }));
    expect(posts.at(-1).z).toBe(0.41);
    // Bare keys only — Ctrl+= is the reader's page zoom and must not touch the embed.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "=", ctrlKey: true }));
    expect(posts.length).toBe(2);
    expect(document.documentElement.style.zoom).toBe("1.3");
    // …unless the embed owns the viewport: the reader zoom is suppressed there, so
    // moving it would do nothing on screen and then jump the page on exit.
    (wrap.querySelector("button.embed-full") as any).click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "-", ctrlKey: true }));
    expect(posts.at(-1).z).toBe(0.33);
    expect(document.documentElement.style.zoom).toBe("");
    // Ctrl+wheel inside the frame arrives as a relayed message — the frame's own
    // listener preventDefaults it, so the browser's page zoom (which, full window,
    // zoomed the host page hiding behind the frame) never sees the gesture. Only the
    // relay is asserted: happy-dom's WheelEvent drops the ctrlKey init, and the host's
    // own wheel path lands in the same scaleEmbed as the Ctrl+= keys above.
    window.dispatchEvent(new MessageEvent("message", {
      data: { __scratchWheel: 1, down: true }, source: embed.contentWindow,
    } as any));
    expect(posts.at(-1).z).toBe(0.26);
    expect(document.documentElement.style.zoom).toBe("");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.documentElement.style.zoom).toBe("1.3");
    // Leaving full window drops the embed's scale: it was chosen for the viewport, and
    // left in place it shrank the inline embed for the rest of the session.
    expect(posts.at(-1)).toEqual({ __scratchZoom: 1, z: 1 });
    // The shrink back into the column is reported at the OLD factor and lands after the
    // exit — sizing the embed from it left a tall blank box.
    window.dispatchEvent(new MessageEvent("message", {
      data: { __scratchFrame: 1, h: 1600, w: 900, z: 0.26 }, source: embed.contentWindow,
    } as any));
    expect(embed.style.height).toBe("");   // exitFocus cleared it; the stale report can't set it
    window.dispatchEvent(new MessageEvent("message", {
      data: { __scratchFrame: 1, h: 500, w: 900, z: 1 }, source: embed.contentWindow,
    } as any));
    expect(embed.style.height).toBe("501px");

    // --- a standalone .html file as the active preview ---
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    const frame = document.querySelector("#preview > .pbody > iframe.htmlframe") as any;
    // The author's own document, plus the key relay — without it, clicking into a
    // full-window page would trap the keyboard with no way to send Esc back out.
    expect(frame.getAttribute("srcdoc")).toContain("<h1>page</h1>");
    expect(frame.getAttribute("srcdoc")).toContain("__scratchKey");

    (document.getElementById("vFull") as any).click();
    expect(frame.hasAttribute("data-focused")).toBe(true);
    (document.getElementById("focusClose") as any).click();
    expect(document.documentElement.hasAttribute("data-focus")).toBe(false);

    // Bare 'f' with the pointer nowhere near the frame is a no-op (it used to expand
    // the page's only embed regardless), and expands it once hovered.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }));
    expect(document.documentElement.hasAttribute("data-focus")).toBe(false);
    frame.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }));
    expect(document.documentElement.hasAttribute("data-focus")).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }));
    expect(document.documentElement.hasAttribute("data-focus")).toBe(false);

    // raw view has no frame to expand
    (document.getElementById("vRaw") as any).click();
    expect(document.getElementById("vFull")).toBeNull();
  } finally {
    await teardown();
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
    await teardown();
  }
});

async function renderLayoutPad(): Promise<string> {
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  for (const n of ["a.md", "b.md", "c.md"]) await writeFile(join(dir, n), "# " + n + "\n", "utf8");
  const m = newManifest("P");
  m.files.push({ path: "a.md", title: "A", type: "note", group: "alpha" });
  m.files.push({ path: "b.md", title: "B", type: "note", group: "beta" });
  m.files.push({ path: "c.md", title: "C", type: "note" }); // ungrouped
  // Layout: beta before alpha (reorders vs first-appearance), beta collapsed; no ""
  // token so the ungrouped bucket falls last.
  m.layout = { groups: [{ name: "beta", collapsed: true }, { name: "alpha" }] };
  await writeManifest(dir, m);
  const pad: Pad = { dir, manifest: await readManifest(dir) };
  return renderHtml(await buildView([pad]), "P");
}

test("layout controls group order + collapsed default; header click toggles", async () => {
  await boot(await renderLayoutPad());
  try {
    const labels = Array.from(document.querySelectorAll(".tree .label")).map((l) => l.textContent);
    expect(labels).toEqual(["beta", "alpha", "FILES"]); // laid-out first, ungrouped last
    const beta = document.querySelector('.ggroup[data-group="beta"]') as any;
    const alpha = document.querySelector('.ggroup[data-group="alpha"]') as any;
    expect(beta.classList.contains("collapsed")).toBe(true); // manifest default
    expect(alpha.classList.contains("collapsed")).toBe(false);
    const betaHead = beta.querySelector(".glabel");
    betaHead.click();
    expect(beta.classList.contains("collapsed")).toBe(false);
    expect(betaHead.getAttribute("aria-expanded")).toBe("true");
    betaHead.click();
    expect(beta.classList.contains("collapsed")).toBe(true);
  } finally {
    await teardown();
  }
});

test("arrow-key nav reaches a file in a collapsed group and auto-expands it", async () => {
  await boot(await renderLayoutPad());
  try {
    const beta = document.querySelector('.ggroup[data-group="beta"]') as any;
    expect(beta.classList.contains("collapsed")).toBe(true);
    // Initial selection is A (alpha). ITEMS order is [B(beta), A(alpha), C], so
    // ArrowUp from A lands on B inside the collapsed beta group.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    expect(document.querySelector(".frow.active")?.textContent).toContain("B");
    expect(beta.classList.contains("collapsed")).toBe(false); // auto-expanded
  } finally {
    await teardown();
  }
});

// The viewer re-implements orderGroupKeys() as a client-side orderGroups() (client
// JS can't import TS). A "KEEP IN SYNC" comment isn't enough — pin the two by
// EXECUTION: extract the client copy from the bundle and run the same edge-case
// table against both. If either drifts, this fails.
test("client orderGroups mirrors orderGroupKeys (drift guard)", async () => {
  const html = await renderPadWithContent("# x\n");
  const grab = (name: string) => {
    const m = html.match(new RegExp("function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}"));
    if (!m) throw new Error("could not extract " + name + " from client bundle");
    return m[0];
  };
  const clientOrder = eval(
    "(function(){ " + grab("groupKey") + "\n" + grab("orderGroups") + "\n return orderGroups; })()",
  ) as (present: string[], layout?: Layout) => string[];
  const L = (...names: string[]): Layout => ({ groups: names.map((name) => ({ name })) });
  const cases: [string[], Layout | undefined][] = [
    [["b", "a", ""], undefined], // no layout → identity (ungrouped stays put)
    [["a", "b", "c", ""], L("c", "a")], // reorder; unlisted "b" then ungrouped last
    [["a", "b", ""], L("", "b")], // explicit "" token positions ungrouped
    [["a", "b"], L("ghost", "b")], // ghost group not present → skipped
    [["a", "b", "c"], L("b", "b", "a")], // duplicate name → first occurrence only
    [["api", "impl"], L(" API ")], // case/trim folding
  ];
  for (const [present, layout] of cases) {
    expect(clientOrder(present, layout)).toEqual(orderGroupKeys(present, layout));
  }
});

test("ArrowLeft/ArrowRight collapse/expand the active file's group (no nav)", async () => {
  await boot(await renderLayoutPad());
  try {
    // Initial selection is A (alpha, expanded by default).
    const alpha = document.querySelector('.ggroup[data-group="alpha"]') as any;
    expect(document.querySelector(".frow.active")?.textContent).toContain("A");
    expect(alpha.classList.contains("collapsed")).toBe(false);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(alpha.classList.contains("collapsed")).toBe(true); // collapsed, not navigated
    expect(document.querySelector(".frow.active")?.textContent).toContain("A"); // selection unchanged
    expect(alpha.querySelector(".glabel")?.getAttribute("aria-expanded")).toBe("false");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(alpha.classList.contains("collapsed")).toBe(false); // expanded
    expect(document.querySelector(".frow.active")?.textContent).toContain("A");
  } finally {
    await teardown();
  }
});

test("group matching is case/space-insensitive; first-seen casing labels the group", async () => {
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  for (const n of ["a.md", "b.md", "c.md"]) await writeFile(join(dir, n), "# " + n + "\n", "utf8");
  const m = newManifest("P");
  // "Resolved" / "RESOLVED" / " resolved " must collapse into ONE group (headers
  // render uppercase, so distinct casings looked like duplicate sections).
  m.files.push({ path: "a.md", title: "A", type: "note", group: "Resolved" });
  m.files.push({ path: "b.md", title: "B", type: "note", group: "RESOLVED" });
  m.files.push({ path: "c.md", title: "C", type: "note", group: " resolved " });
  await writeManifest(dir, m);
  const pad: Pad = { dir, manifest: await readManifest(dir) };
  const html = await renderHtml(await buildView([pad]), "P");
  await boot(html);
  try {
    const labels = Array.from(document.querySelectorAll(".tree .label")).map((l) => l.textContent);
    expect(labels).toEqual(["Resolved"]); // one header, first-seen casing
    const rows = Array.from(document.querySelectorAll(".frow")).map((r) => r.querySelector(".fttl")?.textContent);
    expect(rows).toEqual(["A", "B", "C"]);
  } finally {
    await teardown();
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
    await teardown();
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
    await teardown();
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
    await teardown();
  }
});

test("auto-detects dark theme from prefers-color-scheme", async () => {
  const html = await renderPad();
  await boot(html); // matchMedia stub returns matches:true (dark)
  try {
    expect(document.documentElement.dataset.theme).toBe("dark");
  } finally {
    await teardown();
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
    await teardown();
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
    await teardown();
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
    await teardown();
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
    await teardown();
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
    await teardown();
  }
});

// The point of `scratch export --theme/--mode`. All file:// pages share one
// localStorage origin, so without pinning, a reader who ever picked a theme in
// any other export repaints a published page with it.
test("a pinned axis beats the reader's localStorage; an unpinned one does not", async () => {
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "doc.md"), "# H\n", "utf8");
  const m = newManifest("P");
  m.files.push({ path: "doc.md", title: "Doc", type: "note" });
  await writeManifest(dir, m);
  const pad: Pad = { dir, manifest: await readManifest(dir) };
  const view = await buildView([pad]);
  const ui = { themeMode: "light" as const, colorTheme: "ayu" };
  const reader = { "scratch.colorTheme": "nord", "scratch.themeMode": "dark" };

  // Only colorTheme pinned: the baked ayu survives, mode still follows the reader.
  const pinnedHtml = await renderHtml(view, "P", ui, { exportMode: true, pinned: ["colorTheme"] });
  await boot(pinnedHtml, reader);
  try {
    expect(document.documentElement.dataset.colorTheme).toBe("ayu");
    expect(document.documentElement.dataset.theme).toBe("dark");
  } finally {
    await teardown();
  }

  // Nothing pinned (a flagless export): the reader wins on both axes, as before.
  const plainHtml = await renderHtml(view, "P", ui, { exportMode: true });
  await boot(plainHtml, reader);
  try {
    expect(document.documentElement.dataset.colorTheme).toBe("nord");
    expect(document.documentElement.dataset.theme).toBe("dark");
  } finally {
    await teardown();
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
    await teardown();
  }
});

test("'[' / ']' collapse the panes and persist through the host", async () => {
  const html = await renderPad();
  const posted: any[] = [];
  await boot(html, undefined, (w) => {
    w.window.chrome = { webview: { postMessage: (m: any) => posted.push(m) } };
  });
  try {
    const sidebar = document.getElementById("sidebar")!;
    const topbar = document.getElementById("topbar")!;
    expect(sidebar.classList.contains("collapsed")).toBe(false);
    expect(topbar.classList.contains("collapsed")).toBe(false);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "[" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "]" }));
    expect(sidebar.classList.contains("collapsed")).toBe(true);
    expect(topbar.classList.contains("collapsed")).toBe(true);

    const msg = posted.filter((m) => m && m.__scratch_settings).pop();
    expect(msg.__scratch_settings.sidebarCollapsed).toBe(true);
    expect(msg.__scratch_settings.topbarCollapsed).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "[" }));
    expect(sidebar.classList.contains("collapsed")).toBe(false);
    expect(posted.filter((m) => m && m.__scratch_settings).pop().__scratch_settings.sidebarCollapsed).toBe(false);
  } finally {
    await teardown();
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
    await teardown();
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
    await teardown();
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
    await teardown();
  }
});

test("saved zoom is restored at boot in the localStorage fallback path", async () => {
  const html = await renderPad();
  await boot(html, { "scratch.zoom": "1.5" });
  try {
    expect(document.getElementById("zoomReset")!.textContent).toBe("150%");
  } finally {
    await teardown();
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
    await teardown();
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
    await teardown();
  }
});

test("Ctrl+Alt+H posts __scratch_hide and drops the file from the tree without reload", async () => {
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  for (const n of ["a.md", "b.md"]) await writeFile(join(dir, n), "# " + n + "\n", "utf8");
  const m = newManifest("P");
  m.files.push({ path: "a.md", title: "A", type: "note" });
  m.files.push({ path: "b.md", title: "B", type: "note" });
  await writeManifest(dir, m);
  const pad: Pad = { dir, manifest: await readManifest(dir) };
  const html = await renderHtml(await buildView([pad]), "P");
  const posted: any[] = [];
  await boot(html, undefined, (w) => {
    w.window.chrome = { webview: { postMessage: (m: any) => posted.push(m) } };
  });
  try {
    // "A" is the active file at boot; hide it.
    expect(document.querySelector(".frow.active")?.textContent).toContain("A");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "h", ctrlKey: true, altKey: true }));

    const msg = posted.find((p) => p && p.__scratch_hide);
    expect(msg).toBeDefined();
    expect(msg.__scratch_hide.filePath).toBe("a.md");

    // Its row is gone and the neighbour ("B") is now selected — no reload.
    const titles = Array.from(document.querySelectorAll(".frow .fttl")).map((e) => e.textContent);
    expect(titles).toEqual(["B"]);
    expect(document.querySelector(".frow.active")?.textContent).toContain("B");
  } finally {
    await teardown();
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
    await teardown();
  }
});

test("a saved collapsed sidebar is restored at boot", async () => {
  const html = await renderPad();
  await boot(html, { "scratch.sidebarCollapsed": "1" });
  try {
    expect(document.getElementById("sidebar")!.classList.contains("collapsed")).toBe(true);
  } finally {
    await teardown();
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

test("Ctrl+Alt+C copies this page's comments; Ctrl+Shift+Alt+C copies every file's", async () => {
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  const body = "# Heading\n\nText **bold** here.\n\nMore prose.\n";
  await writeFile(join(dir, "a.md"), body, "utf8");
  await writeFile(join(dir, "b.md"), body, "utf8");
  const m = newManifest("P");
  m.files.push({ path: "a.md", title: "A", type: "note", comments: [cmt({ id: "c-a", body: "on a" })] });
  m.files.push({ path: "b.md", title: "B", type: "note", comments: [cmt({ id: "c-b", body: "on b" })] });
  await writeManifest(dir, m);
  const pad: Pad = { dir, manifest: await readManifest(dir) };
  await boot(await renderHtml(await buildView([pad]), "P"));
  try {
    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: (t: string) => { copied = t; return Promise.resolve(); } },
    });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "c", ctrlKey: true, altKey: true }));
    let out = JSON.parse(copied);
    expect(out.pad).toBe("P");
    expect(out.comments.map((c: any) => c.comment)).toEqual(["on a"]);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "C", ctrlKey: true, altKey: true, shiftKey: true }));
    out = JSON.parse(copied);
    expect(out.pad).toBe("P"); // single pad → same shape as `scratch comments --json`
    expect(out.comments.map((c: any) => c.comment)).toEqual(["on a", "on b"]);
    expect(out.comments.map((c: any) => c.file)).toEqual(["a.md", "b.md"]);
  } finally {
    await teardown();
  }
});

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
    await teardown();
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
    await teardown();
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
    await teardown();
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
    await teardown();
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
    expect(out).toMatch(/^<!doctype html>\n<html[^>]* data-export(?=[ =>])/);
    expect(out).toContain('id="saveCopy"');
    expect(dot.hidden).toBe(true); // saved → clean
  } finally {
    await teardown();
  }
});

test("live viewer: Ctrl+S exports a standalone copy with data-export injected", async () => {
  const html = await renderPadWithComments([cmt()]); // exportMode = false (live)
  const saved: Blob[] = [];
  await boot(html, undefined, (w) => {
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
    // The live page is not itself an export…
    expect(document.documentElement.hasAttribute("data-export")).toBe(false);
    // …but its save button is present and Ctrl+S triggers a save.
    expect(document.getElementById("saveCopy")).not.toBeNull();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }),
    );
    await new Promise((r) => setTimeout(r, 10)); // let the picker promise chain settle
    expect(saved.length).toBe(1);
    const out = await saved[0]!.text();
    // The saved copy opens as a real export (file becomes the comment store)…
    expect(out).toMatch(/^<!doctype html>\n<html[^>]* data-export(?=[ =>])/);
    expect(out).toContain('id="saveCopy"');
    // …and carries the current data island.
    const island = out.match(
      /<script id="data" type="application\/json">([\s\S]*?)<\/script>/,
    )![1]!;
    expect(JSON.parse(island).pads[0].files[0].comments.length).toBe(1);
  } finally {
    await teardown();
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
    await teardown();
  }
});

test("a comment box opens with the cursor already in its textarea", async () => {
  const html = await renderPadWithComments([cmt()]);
  await boot(html);
  try {
    (document.querySelector(".cmt-hl") as any).click();
    (Array.from(document.querySelectorAll(".cmt-pop .pbtn")).find((b) => b.textContent === "edit") as any).click();
    // Regression: the popover used to be built while still detached, so focus() was a
    // silent no-op and every comment cost an extra click before you could type.
    expect(document.activeElement).toBe(document.querySelector(".cmt-pop textarea"));
  } finally {
    await teardown();
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
    await teardown();
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
    await teardown();
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
    await teardown();
  }
});

test("a saved hidden-comments choice is restored at boot", async () => {
  const html = await renderPadWithComments([cmt()]);
  await boot(html, { "scratch.comments": "0" });
  try {
    expect(document.documentElement.hasAttribute("data-comments-off")).toBe(true);
    expect((document.getElementById("commentsToggle") as any).classList.contains("muted")).toBe(true);
  } finally {
    await teardown();
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
    await teardown();
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
    await teardown();
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
    await teardown();
  }
});

test("hard-refresh data sync: page asks for data; quiet patch is silent when unchanged", async () => {
  const html = await renderPad();
  const posted: any[] = [];
  await boot(html, undefined, (w) => {
    w.window.chrome = { webview: { postMessage: (m: any) => posted.push(m) } };
  });
  try {
    // On load the page asks the host for the authoritative pad data (sibling of
    // the settings handshake), so a native hard refresh self-heals from disk.
    expect(posted.some((m) => m && m.__scratch_get_data)).toBe(true);

    const toast = document.getElementById("toast")!;
    const w = globalThis as any;
    const data = JSON.parse(document.getElementById("data")!.textContent!);

    // quiet=true + unchanged → NO toast (every plain refresh would otherwise flash).
    w.__scratchReload(data, true);
    expect(toast.classList.contains("visible")).toBe(false);

    // quiet=true + drift → patches and reports the sync (distinct from 'r').
    const changed = JSON.parse(JSON.stringify(data));
    changed.pads[0].files[0].content = "# Synced\n";
    w.__scratchReload(changed, true);
    expect(toast.classList.contains("visible")).toBe(true);
    expect(toast.textContent).toContain("Synced from disk");
  } finally {
    await teardown();
  }
});

// The viewer's own comment write comes straight back through the watcher. Only
// commentsExport differs (the host re-resolves it; the page never does), and treating
// that as a change rebuilt the tree — reloading an .html preview's iframe and toasting.
test("a re-resolved commentsExport alone is not a change", async () => {
  const html = await renderPadWithComments([cmt()]);
  await boot(html);
  try {
    const toast = document.getElementById("toast")!;
    const w = globalThis as any;
    const data = JSON.parse(document.getElementById("data")!.textContent!);
    const echo = JSON.parse(JSON.stringify(data));
    echo.pads[0].files[0].commentsExport = [{ id: "x", file: "a.md", comment: "re-resolved", quote: "q", matched: true }];

    w.__scratchReload(echo, true);
    expect(toast.classList.contains("visible")).toBe(false);
    // Still adopted, so the copy-comments shortcut reads the fresh resolution.
    w.__scratchReload(echo);
    expect(toast.textContent).toContain("No changes");
  } finally {
    await teardown();
  }
});

// The visible symptom of the above on an .html file: rebuilding the tree replaces the
// preview iframe, so the author's page reloads from scratch under the reader.
test("the echo of a comment write leaves an html preview's iframe in place", async () => {
  await boot(
    await renderHtmlPad("HP", "<body><p>real text here</p></body>", {
      comments: [cmt({ anchor: { quote: "real text", prefix: "", suffix: "" } })],
    }),
  );
  try {
    const before = document.querySelector("iframe.htmlframe");
    expect(before).not.toBeNull();
    const w = globalThis as any;
    const echo = JSON.parse(document.getElementById("data")!.textContent!);
    echo.pads[0].files[0].commentsExport = [{ id: "z", file: "page.html", comment: "re-resolved", quote: "q", matched: true }];
    w.__scratchReload(echo, true);
    expect(document.querySelector("iframe.htmlframe")).toBe(before);
  } finally {
    await teardown();
  }
});

/** Render a page for a pad holding one standalone .html file (previewed as its own page). */
async function renderHtmlPad(name: string, source: string, entry: object = {}): Promise<string> {
  const dir = join(root, name.toLowerCase());
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "page.html"), source, "utf8");
  const m = newManifest(name);
  m.files.push({ path: "page.html", ...entry });
  await writeManifest(dir, m);
  return renderHtml(await buildView([{ dir, manifest: await readManifest(dir) } as Pad]), name);
}

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
    await teardown();
  }
});

// The standalone .html preview marks comments INSIDE its sandboxed frame, so that
// code never runs in the host document and the boot() harness above cannot reach
// it (happy-dom does not execute iframe srcdoc). Evaluate the injected frame
// script in a document of its own — which is precisely what the frame is — and
// drive it over the postMessage contract the host uses.
async function frameScript(): Promise<string> {
  const html = await renderHtmlPad("H", "<body><p>x</p></body>");
  const from = html.indexOf("const CMT_MATCH_SRC =");
  const to = html.indexOf("const CMT_FRAME_SCRIPT =", from);
  const block = html.slice(from, html.indexOf("\n", to));
  return new Function(block + "; return CMT_FRAME_BODY;")() as string;
}

/** Run the frame script against author markup; returns the posted messages. */
function runFrame(body: string, markup: string) {
  const posts: any[] = [];
  document.body.innerHTML = markup;
  new Function("parent", body)({ postMessage: (m: any) => posts.push(m) });
  return posts;
}

/** Drive the frame script against author markup in a DOM of its own.
 * frameScript() renders a real pad off disk, so it must run BEFORE the global
 * document is registered — hence the helper rather than a plain beforeEach. */
async function inFrame(markup: string, run: (posts: any[]) => void) {
  const body = await frameScript();
  GlobalRegistrator.register();
  try {
    run(runFrame(body, markup));
  } finally {
    await GlobalRegistrator.unregister();
  }
}

const anchor = (quote: string, prefix = "", suffix = ""): Comment =>
  cmt({ id: "c-" + quote.length, body: "why " + quote, anchor: { quote, prefix, suffix } });

function pushComments(comments: Comment[]) {
  window.dispatchEvent(new MessageEvent("message", { data: { __scratchCmt: 1, comments } }));
}

test("frame script marks a comment in the author's own document", () =>
  inFrame("<p>The <b>token</b> rotates hourly.</p>", (posts) => {
    // Announces itself so the host knows to push the current file's comments.
    expect(posts.some((p) => p.__scratchCmtReady === 1)).toBe(true);
    pushComments([anchor("token rotates hourly")]);
    const marks = document.querySelectorAll(".cmt-hl");
    expect(marks.length).toBeGreaterThan(0);
    // The body rides along as a tooltip: the frame has no room for note pills and
    // no access to the host's popover.
    expect(marks[0]!.getAttribute("title")).toBe("why token rotates hourly");
    // Marking spans the <b>, so the quote is reassembled across elements.
    expect(document.body.textContent).toContain("The token rotates hourly.");
    const miss = posts.filter((p) => p.__scratchCmtMiss === 1).pop();
    expect(miss.ids).toEqual([]);
  }));

test("frame script reports unfindable quotes to the host instead of dropping them", () =>
  inFrame("<p>only this text exists</p>", (posts) => {
    pushComments([anchor("nothing like this"), anchor("only this text exists")]);
    const miss = posts.filter((p) => p.__scratchCmtMiss === 1).pop();
    expect(miss.ids).toEqual(["c-17"]); // the orphan, and only it
    expect(document.querySelectorAll(".cmt-hl").length).toBe(1);
  }));

test("a second push re-marks from scratch rather than nesting spans", () =>
  inFrame("<p>alpha beta gamma</p>", (posts) => {
    pushComments([anchor("beta")]);
    pushComments([anchor("beta")]);
    expect(document.querySelectorAll(".cmt-hl").length).toBe(1);
    // Text is intact after the unwrap/rewrap cycle (no lost or duplicated chars).
    expect(document.body.textContent).toBe("alpha beta gamma");
  }));

test("clicking a mark asks the host to open the popover for that comment", () =>
  inFrame("<p>alpha beta gamma</p>", (posts) => {
    pushComments([anchor("beta")]);
    (document.querySelector(".cmt-hl") as any).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const click = posts.filter((p) => p.__scratchCmtClick === 1).pop();
    expect(click.cid).toBe("c-4");
  }));

// buildHtmlIndex blanks script/style, so matching them here would resolve a quote
// to text the CLI can never see — reported as found, but invisible and unreachable.
test("script and style source is not matchable in the frame", () =>
  inFrame('<script>var s="secret phrase";</script><style>.a{content:"styled bit"}</style><p>real text</p>', (posts) => {
    pushComments([anchor("secret phrase"), anchor("styled bit")]);
    expect(document.querySelectorAll(".cmt-hl").length).toBe(0);
    const miss = posts.filter((p) => p.__scratchCmtMiss === 1).pop();
    expect(miss.ids.length).toBe(2);
  }));

// An emptied list is how the host says "drop your marks" — used by clear-all and by
// hiding comments, neither of which the frame's own CSS can be told about.
test("an empty comment list clears the frame's marks", () =>
  inFrame("<p>alpha beta gamma</p>", (posts) => {
    pushComments([anchor("beta")]);
    expect(document.querySelectorAll(".cmt-hl").length).toBe(1);
    pushComments([]);
    expect(document.querySelectorAll(".cmt-hl").length).toBe(0);
    expect(document.body.textContent).toBe("alpha beta gamma");
  }));

test("clicking off any mark reports the host's dismiss gesture", () =>
  inFrame("<p>alpha beta gamma</p>", (posts) => {
    pushComments([anchor("beta")]);
    (document.querySelector("p") as any).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(posts.some((p) => p.__scratchCmtBlur === 1)).toBe(true);
  }));

// The host summary list can't scroll to a mark it cannot see, so it names the id.
test("a goto request reveals the mark and reports its landed rect", () =>
  inFrame("<p>alpha beta gamma</p>", (posts) => {
    pushComments([anchor("beta")]);
    const before = posts.length;
    window.dispatchEvent(Object.assign(new Event("message"), { data: { __scratchCmtGoto: 1, cid: "c-4" } }));
    const back = posts.slice(before).filter((p) => p.__scratchCmtClick === 1).pop();
    expect(back.cid).toBe("c-4");
    // The reveal's own scroll must not dismiss the popover it just asked for.
    window.dispatchEvent(new Event("scroll"));
    expect(posts.some((p) => p.__scratchCmtScroll === 1)).toBe(false);
  }));

// The frame has a fixed height, so it scrolls internally — previewEl's scroll
// handler (which dismisses the host's fixed-position popover) never fires.
test("scrolling inside the frame reports up so the host can dismiss its popover", () =>
  inFrame("<p>alpha beta gamma</p>", (posts) => {
    window.dispatchEvent(new Event("scroll"));
    expect(posts.some((p) => p.__scratchCmtScroll === 1)).toBe(true);
  }));
