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
    // metadata strip
    expect(preview.querySelector(".pmeta")?.textContent).toContain("#t");
    // tree built with the file row
    expect(document.querySelector(".frow")?.textContent).toContain("Doc");
  } finally {
    await teardown();
  }
});

test("clicking a rendered mermaid SVG opens the diagram lightbox; Esc closes it", async () => {
  const html = await renderPad();
  await boot(html);
  try {
    const md = document.querySelector(".mermaid")!;
    // Stand in for mermaid's rendered output (the stub doesn't emit real SVG).
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.style.maxWidth = "320px";
    md.appendChild(svg);

    const modal = document.getElementById("diagramModal")!;
    expect(modal.style.display).toBe("none");
    svg.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(modal.style.display).toBe("flex");
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
    expect(refs[0].querySelector("a")?.getAttribute("href")).toBe("#fn-arxiv");
    expect(refs[0].textContent).toBe("1");
    expect(refs[2].textContent).toBe("1"); // reused arxiv keeps #1
    expect(refs[1].textContent).toBe("2"); // blog is #2
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

test("![](file.html) transcludes a local html file as a sandboxed iframe; missing/remote refs don't", async () => {
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "diagram.html"), "<!doctype html><b id=x>hi</b>", "utf8");
  await writeFile(
    join(dir, "doc.md"),
    "# D\n\n![Cache](diagram.html)\n\n![Gone](missing.html)\n\n![Remote](https://e.com/x.html)\n",
    "utf8",
  );
  const m = newManifest("P");
  m.files.push({ path: "doc.md", title: "D", type: "note" });
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
