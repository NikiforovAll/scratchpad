// UI rendering tests: buildView scans all files + merges manifest metadata;
// renderHtml embeds a self-contained page. No window is launched here.

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildView, renderHtml } from "../src/ui/render.ts";
import { KIT_BG, KIT_CSS } from "../src/ui/kit.ts";
import { newManifest, writeManifest } from "../src/manifest.ts";
import { readManifest } from "../src/manifest.ts";
import type { Pad } from "../src/discovery.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "scratch-ui-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function seedPad(): Promise<Pad> {
  const dir = join(root, "notes");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "a.md"), "# Title\n\n- one\n- two\n\n`code`", "utf8");
  await writeFile(join(dir, "snippet.ts"), "export const x = 1;", "utf8");
  await writeFile(join(dir, "loose.txt"), "unregistered content", "utf8");
  const m = newManifest("Notes", "sess1");
  m.files.push({ path: "a.md", title: "A note", description: "why", tags: ["x"], type: "note" });
  m.files.push({ path: "snippet.ts", title: "Snippet", type: "snippet" });
  await writeManifest(dir, m);
  return { dir, manifest: await readManifest(dir) };
}

describe("buildView", () => {
  test("includes only registered files, classified and read", async () => {
    const pad = await seedPad();
    const [pv] = await buildView([pad]);
    expect(pv!.name).toBe("Notes");
    const byPath = Object.fromEntries(pv!.files.map((f) => [f.path, f]));
    expect(byPath["a.md"]!.kind).toBe("markdown");
    expect(byPath["a.md"]!.registered).toBe(true);
    expect(byPath["a.md"]!.content).toContain("# Title");
    expect(byPath["snippet.ts"]!.kind).toBe("code");
    // loose.txt exists on disk but is not in the manifest → not shown.
    expect(byPath["loose.txt"]).toBeUndefined();
  });

  test("orders files by scratchpad.json; unregistered files excluded", async () => {
    const dir = join(root, "ordered");
    await mkdir(dir, { recursive: true });
    for (const n of ["a.md", "b.md", "c.md", "zz.txt", "mm.txt"]) await writeFile(join(dir, n), "x", "utf8");
    const m = newManifest("Ordered");
    // Deliberate (non-alphabetical) manifest order.
    m.files.push({ path: "c.md" }, { path: "a.md" }, { path: "b.md" });
    await writeManifest(dir, m);
    const pad: Pad = { dir, manifest: await readManifest(dir) };
    const [pv] = await buildView([pad]);
    // zz.txt / mm.txt are on disk but unregistered → excluded.
    expect(pv!.files.map((f) => f.path)).toEqual(["c.md", "a.md", "b.md"]);
  });

  test("classifies registered .html as html (rendered in an iframe)", async () => {
    const dir = join(root, "site");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "page.html"), "<h1>hi</h1>", "utf8");
    const m = newManifest("Site");
    m.files.push({ path: "page.html" });
    await writeManifest(dir, m);
    const pad: Pad = { dir, manifest: await readManifest(dir) };
    const [pv] = await buildView([pad]);
    const f = pv!.files.find((f) => f.path === "page.html");
    expect(f!.kind).toBe("html");
    expect(f!.content).toBe("<h1>hi</h1>");
  });

  test("embeds resolved commentsExport for a commented text file, not for images", async () => {
    const dir = join(root, "c");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "doc.md"), "# Title\n\nThe quick brown fox.\n", "utf8");
    await writeFile(join(dir, "pic.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const m = newManifest("C");
    const comment = {
      id: "k1", body: "rephrase",
      anchor: { quote: "quick brown fox", prefix: "The ", suffix: "." },
      created: "2026-06-12T00:00:00Z", updated: "2026-06-12T00:00:00Z",
    };
    m.files.push({ path: "doc.md", comments: [comment] });
    m.files.push({ path: "pic.png", comments: [comment] }); // image content can't be located
    await writeManifest(dir, m);
    const pad: Pad = { dir, manifest: await readManifest(dir) };
    const [pv] = await buildView([pad]);
    const byPath = Object.fromEntries(pv!.files.map((f) => [f.path, f]));
    expect(byPath["doc.md"]!.commentsExport).toEqual([
      {
        id: "k1", file: "doc.md", comment: "rephrase", quote: "quick brown fox",
        matched: true, line: 3, section_heading: "Title",
        context: "The quick brown fox.", context_lines: "3-3",
      },
    ]);
    expect(byPath["pic.png"]!.commentsExport).toBeUndefined();
  });

  test("registered-but-missing file still appears", async () => {
    const dir = join(root, "p");
    await mkdir(dir, { recursive: true });
    const m = newManifest("P");
    m.files.push({ path: "ghost.md", title: "Ghost" });
    await writeManifest(dir, m);
    const pad: Pad = { dir, manifest: await readManifest(dir) };
    const [pv] = await buildView([pad]);
    const ghost = pv!.files.find((f) => f.path === "ghost.md");
    expect(ghost).toBeDefined();
    expect(ghost!.registered).toBe(true);
    expect(ghost!.content).toBeNull();
  });
});

describe("renderHtml", () => {
  test("produces a page with embedded data + theme", async () => {
    const pad = await seedPad();
    const view = await buildView([pad]);
    const html = await renderHtml(view, "Notes");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("scratch · Notes");
    expect(html).toContain("Playfair Display");
    expect(html).toContain("prefers-color-scheme: dark"); // theme auto-detected client-side
    expect(html).toContain(':root[data-theme="light"]'); // light sibling tokens present
    expect(html).toContain("application/json"); // embedded data island
    expect(html).toContain("A note");
    // One page-weight tripwire for the whole suite (a CDN page is ~210KB of mostly
    // client script). Catches an accidentally inlined asset; not a style budget.
    expect(html.length).toBeLessThan(280_000);
    // The full-window frame must size with % — a DOM test can't catch this (happy-dom
    // does no layout) and both alternatives fail in a real browser: vw/vh resolve
    // against the unzoomed window under CSS zoom, and auto on a replaced element
    // (an iframe) means its intrinsic 300x150.
    expect(html).toMatch(/\[data-focused\]\s*\{[^}]*width:\s*100%\s*!important/);
    // A kit-themed md embed's iframe element must carry a per-theme paper color: its
    // scrollbar track is transparent, so a white element background painted the scroll
    // gutter white in dark mode. Also a layout-free check — no DOM test can see it.
    expect(html).toMatch(/\.md \.htmlembed > \.htmlframe \{[^}]*background: var\(--embed-paper\)/);
    // Asserted against kit.ts rather than against literals: the point is that the two
    // agree, so a literal here would just lock in a copy of the value under test.
    expect(html).toContain(`--embed-paper: ${KIT_BG.dark}`);
    expect(html).toContain(`--embed-paper: ${KIT_BG.light}`);
    expect(html).toContain(`light-dark(${KIT_BG.light}, ${KIT_BG.dark})`);
  });

  test("links hljs via CDN (with SRI) when code present, not mermaid", async () => {
    const pad = await seedPad(); // has snippet.ts + ```ts fence, no mermaid
    const html = await renderHtml(await buildView([pad]), "Notes");
    expect(html).toContain("hljs.highlightElement"); // highlight wiring present
    expect(html).toMatch(/<script src="https:\/\/cdnjs\.cloudflare\.com[^"]+highlight[^"]+" integrity="sha384-/);
    expect(html).not.toContain("mermaid@"); // no mermaid CDN tag
    // Linked, not inlined — an inlined bundle would ride the #vendor-gz island. Asserted
    // exactly instead of via a byte budget: the budget grazed its ceiling on ordinary
    // client-script growth, and raising it was tuning a number, not testing the invariant.
    expect(html).not.toContain('id="vendor-gz"');
  });

  test("links mermaid via CDN only when a mermaid block exists", async () => {
    const dir = join(root, "diagram");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "flow.md"), "# Flow\n\n```mermaid\ngraph TD; A-->B;\n```\n", "utf8");
    const m = newManifest("Diagram");
    m.files.push({ path: "flow.md", title: "Flow", type: "note" });
    await writeManifest(dir, m);
    const pad: Pad = { dir, manifest: await readManifest(dir) };
    const html = await renderHtml(await buildView([pad]), "Diagram");
    expect(html).toMatch(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]+mermaid@[^"]+" integrity="sha384-/);
    expect(html).not.toContain('id="vendor-gz"'); // mermaid linked, not inlined
  });

  test("links KaTeX (JS + CSS, with SRI) only when a doc contains math", async () => {
    const noMath = await seedPad(); // no $…$ / $$…$$
    expect(await renderHtml(await buildView([noMath]), "Notes")).not.toContain("katex@");

    const dir = join(root, "math");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "eq.md"), "# Eq\n\n$$\\text{tokens} = W \\times H$$\n", "utf8");
    const m = newManifest("Math");
    m.files.push({ path: "eq.md", title: "Eq", type: "note" });
    await writeManifest(dir, m);
    const pad: Pad = { dir, manifest: await readManifest(dir) };
    const html = await renderHtml(await buildView([pad]), "Math");
    expect(html).toMatch(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]+katex@[^"]+" integrity="sha384-/);
    expect(html).toMatch(/<link id="katex-css"[^>]+katex@[^"]+\.css" integrity="sha384-/);
    expect(html).not.toContain('id="vendor-gz"'); // KaTeX linked, not inlined (fonts/CSS from CDN)
  });

  test("data-export marks only exports; the Save-a-copy button ships in both modes", async () => {
    const pad = await seedPad();
    const view = await buildView([pad]);
    const exported = await renderHtml(view, "Notes", undefined, { exportMode: true });
    // Anchor on the real <html> tag — the client JS also mentions "data-export".
    expect(exported).toMatch(/^<!doctype html>\n<html[^>]* data-export(?=[ =>])/);
    expect(exported).toContain('id="saveCopy"');
    expect(exported).toContain('id="saveDot"');
    const live = await renderHtml(view, "Notes");
    // Live page is not itself an export (host owns write-back)…
    expect(live).not.toMatch(/^<!doctype html>\n<html[^>]* data-export(?=[ =>])/);
    // …but it carries the same save button: Ctrl+S exports a copy to a file.
    expect(live).toContain('id="saveCopy"');
  });

  test("data-theme-pinned lists only the axes the exporter passed explicitly", async () => {
    const pad = await seedPad();
    const view = await buildView([pad]);
    const ui = { themeMode: "light" as const, colorTheme: "ayu" };
    // Anchor on the real <html> tag — the client JS also mentions the attribute name.
    const marker = (html: string) => /^<!doctype html>\n<html[^>]* data-theme-pinned="([^"]*)"/.exec(html)?.[1];
    // No flags → no marker, so the reader's localStorage still wins (today's behavior).
    expect(marker(await renderHtml(view, "Notes", ui, { exportMode: true }))).toBeUndefined();
    const both = await renderHtml(view, "Notes", ui, {
      exportMode: true,
      pinned: ["colorTheme", "themeMode"],
    });
    expect(marker(both)).toBe("colorTheme themeMode");
    expect(both).toContain('data-color-theme="ayu"');
    expect(both).toContain('data-theme="light"');
    // One axis only — the other stays reader-controlled.
    const one = await renderHtml(view, "Notes", ui, { exportMode: true, pinned: ["colorTheme"] });
    expect(marker(one)).toBe("colorTheme");
    // Pinning is an export concept: a live page never carries it (the host owns config).
    const live = await renderHtml(view, "Notes", ui, { pinned: ["colorTheme", "themeMode"] });
    expect(marker(live)).toBeUndefined();
  });

  test("defaults to system mode + ember and ships the settings UI", async () => {
    const pad = await seedPad();
    const html = await renderHtml(await buildView([pad]), "Notes");
    // system mode = no data-theme attr (dark-first until the client resolves the OS)
    expect(html).toContain('<html lang="en" data-color-theme="ember" data-grid="dots" data-export-name="notes">');
    expect(html).toContain('id="settings"'); // settings island
    expect(html).toContain('"themeMode":"system"');
    expect(html).toContain('id="settingsBtn"');
    expect(html).toContain('id="settingsModal"');
    expect(html).toContain('"starredThemes":[]'); // default: no favorites
    // Cards render client-side: settings carries the starred strip + Browse,
    // the gallery modal the full grid, and the #themes island the registry.
    expect(html).toContain('id="starredGrid"');
    expect(html).toContain('id="browseThemes"');
    expect(html).toContain('id="galleryModal"');
    expect(html).toContain('id="galleryGrid"');
    expect(html).toContain('id="themes"');
    expect(html).toContain('"id":"gruvbox"');
    expect(html).toContain('"id":"dracula"');
    // every ported theme ships its override CSS
    for (const id of ["dracula", "nord", "rose-pine", "everforest", "kanagawa", "one-dark", "night-owl", "monokai", "github", "ayu", "vitesse", "synthwave"]) {
      expect(html).toContain(`:root[data-color-theme="${id}"]`);
    }
  });

  test("bakes persisted settings into <html> attrs + the settings island", async () => {
    const pad = await seedPad();
    const html = await renderHtml(await buildView([pad]), "Notes", {
      themeMode: "light",
      colorTheme: "gruvbox",
    });
    expect(html).toContain('<html lang="en" data-color-theme="gruvbox" data-grid="dots" data-theme="light" data-export-name="notes">');
    expect(html).toContain('"themeMode":"light"');
    expect(html).toContain('"colorTheme":"gruvbox"');
    // the color theme's override CSS is present
    expect(html).toContain(':root[data-color-theme="gruvbox"]');
    expect(html).toContain(':root[data-color-theme="gruvbox"][data-theme="light"]');
  });

  test("wideMode bakes data-wide; default leaves <html> clean", async () => {
    const pad = await seedPad();
    const view = await buildView([pad]);
    const wide = await renderHtml(view, "Notes", {
      themeMode: "system",
      colorTheme: "ember",
      wideMode: true,
    });
    expect(wide).toContain('<html lang="en" data-color-theme="ember" data-grid="dots" data-wide data-export-name="notes">');
    expect(wide).toContain('"wideMode":true');
    const plain = await renderHtml(view, "Notes");
    expect(plain).toContain('<html lang="en" data-color-theme="ember" data-grid="dots" data-export-name="notes">'); // no data-wide by default
    expect(plain).toContain('"wideMode":false');
  });

  test("collapsed panes are baked into the boot markup", async () => {
    const pad = await seedPad();
    const view = await buildView([pad]);
    const collapsed = await renderHtml(view, "Notes", {
      themeMode: "system",
      colorTheme: "ember",
      sidebarCollapsed: true,
      topbarCollapsed: true,
    });
    expect(collapsed).toContain('<div class="sidebar collapsed" id="sidebar">');
    expect(collapsed).toContain('<header class="topbar collapsed" id="topbar">');
    expect(collapsed).toContain('"sidebarCollapsed":true');
    expect(collapsed).toContain('"topbarCollapsed":true');
    const plain = await renderHtml(view, "Notes");
    expect(plain).toContain('<div class="sidebar" id="sidebar">');
    expect(plain).toContain('<header class="topbar" id="topbar">');
    expect(plain).toContain('"sidebarCollapsed":false');
    expect(plain).toContain('"topbarCollapsed":false');
  });

  test("zoom ≠ 1 is baked as an inline style; default 1 leaves <html> clean", async () => {
    const pad = await seedPad();
    const view = await buildView([pad]);
    const zoomed = await renderHtml(view, "Notes", {
      themeMode: "system",
      colorTheme: "ember",
      zoom: 1.25,
    });
    expect(zoomed).toContain('<html lang="en" data-color-theme="ember" data-grid="dots" data-export-name="notes" style="zoom: 1.25">');
    expect(zoomed).toContain('"zoom":1.25');
    const plain = await renderHtml(view, "Notes");
    expect(plain).toContain('<html lang="en" data-color-theme="ember" data-grid="dots" data-export-name="notes">'); // no style attr
    expect(plain).toContain('"zoom":1');
  });

  test("escapes </script> in embedded data", async () => {
    const dir = join(root, "x");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "evil.md"), "</script><script>alert(1)</script>", "utf8");
    const m = newManifest("X");
    m.files.push({ path: "evil.md", title: "evil" });
    await writeManifest(dir, m);
    const pad: Pad = { dir, manifest: await readManifest(dir) };
    const html = await renderHtml(await buildView([pad]), "X");
    // the data island must not contain a raw closing script tag
    const island = html.split('type="application/json">')[1]!.split("</script>")[0]!;
    expect(island).not.toContain("</script");
    expect(island).toContain("\\u003c/script");
  });
});

describe("renderHtml --offline", () => {
  // The offline path inlines the gitignored build cache (src/ui/vendor/bundle.ts).
  // Populate it once if absent (same step `bun run build` runs) so the suite is
  // self-sufficient; needs network only on a cold cache.
  beforeAll(async () => {
    if (existsSync(join(import.meta.dir, "..", "src", "ui", "vendor", "bundle.ts"))) return;
    const p = Bun.spawn(["bun", "scripts/fetch-vendor.ts"], { cwd: join(import.meta.dir, ".."), stdout: "ignore", stderr: "inherit" });
    if ((await p.exited) !== 0) throw new Error("fetch-vendor failed — cannot run offline tests");
  });

  // A pad with code + a mermaid block + math — exercises all three vendor libs.
  async function seedRichPad(): Promise<Pad> {
    const dir = join(root, "rich");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "doc.md"), "# Rich\n\n```mermaid\ngraph TD; A-->B;\n```\n\n$$E=mc^2$$\n\n```ts\nconst x=1;\n```\n", "utf8");
    const m = newManifest("Rich");
    m.files.push({ path: "doc.md", title: "Doc", type: "note" });
    await writeManifest(dir, m);
    return { dir, manifest: await readManifest(dir) };
  }

  test("inlines all vendor libs (gzip island + bootstrap), no CDN references", async () => {
    const html = await renderHtml(await buildView([await seedRichPad()]), "Rich", undefined, {
      exportMode: true,
      offline: true,
    });
    expect(html).not.toContain("cdnjs.cloudflare.com");
    expect(html).not.toContain("cdn.jsdelivr.net");
    expect(html).not.toContain("integrity="); // no SRI'd CDN tags
    // JS libs ride as a gzip+base64 island the in-page bootstrap decompresses.
    expect(html).toContain('id="vendor-gz"');
    expect(html).toContain("DecompressionStream");
    expect(html).not.toContain("Highlight.js"); // hljs is gzipped, not literal anymore
    // Compressed: well under the raw ~4MB (mermaid 3.3MB→~1.2MB), still multi-MB.
    expect(html.length).toBeGreaterThan(1_000_000);
    expect(html.length).toBeLessThan(2_500_000);
  });

  test("the gzip island carries exactly the needed libs", async () => {
    const html = await renderHtml(await buildView([await seedRichPad()]), "Rich", undefined, {
      exportMode: true,
      offline: true,
    });
    const island = html.split('id="vendor-gz" type="application/json">')[1]!.split("</script>")[0]!;
    const keys = Object.keys(JSON.parse(island)).sort();
    expect(keys).toEqual(["hljs", "katex", "mermaid"]);
  });

  test("KaTeX fonts are inlined as data: URIs, no relative font refs", async () => {
    const html = await renderHtml(await buildView([await seedRichPad()]), "Rich", undefined, {
      exportMode: true,
      offline: true,
    });
    expect(html).toContain("data:font/woff2;base64,");
    expect(html).not.toContain("url(fonts/"); // relative refs rewritten away
  });

  test("a no-mermaid pad omits the multi-MB mermaid bundle", async () => {
    const pad = await seedPad(); // code only, no mermaid, no math
    const html = await renderHtml(await buildView([pad]), "Notes", undefined, { exportMode: true, offline: true });
    expect(html).not.toContain("cdnjs.cloudflare.com");
    const island = JSON.parse(html.split('id="vendor-gz" type="application/json">')[1]!.split("</script>")[0]!);
    expect(island.hljs).toBeString(); // hljs IS inlined (code present)
    expect(island.mermaid).toBeUndefined(); // mermaid (3.3MB) NOT pulled in
    expect(html.length).toBeLessThan(500_000);
  });

  test("non-offline export still emits CDN tags (unchanged default)", async () => {
    const html = await renderHtml(await buildView([await seedRichPad()]), "Rich", undefined, { exportMode: true });
    expect(html).toMatch(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]+mermaid@[^"]+" integrity="sha384-/);
  });
});

// Comments in a standalone .html preview run INSIDE the sandboxed frame — the host
// page cannot reach across an opaque origin. These assert the frame gets what it
// needs, and that the matcher exists as one source shared by both documents.
describe("in-frame comment plumbing", () => {
  async function page(): Promise<string> {
    const dir = join(root, "pad");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "guide.html"), "<body><p>hello</p></body>", "utf8");
    const m = newManifest("Pad", "s");
    m.files.push({ path: "guide.html" });
    await writeManifest(dir, m);
    const view = await buildView([{ dir, manifest: await readManifest(dir) } as Pad]);
    return renderHtml(view, "Pad");
  }

  // A wheel over an embed must be able to carry on scrolling the article behind it,
  // and overscroll-behavior:contain in either frame's CSS is what used to stop it —
  // the frames are the only place the property was ever set.
  test("no frame CSS contains the wheel out of the embed", async () => {
    expect(await page()).not.toContain("overscroll-behavior");
    expect(KIT_CSS).not.toContain("overscroll-behavior");
  });

  test("the matcher is defined once and shipped to the frame as source", async () => {
    const html = await page();
    // Once as a real declaration for the host page...
    expect(html.match(/^function cmtFindAnchor\(container, anchor\) \{$/gm)).toHaveLength(1);
    // ...and once as a string the frame script evaluates, so they cannot drift.
    expect(html).toContain("const CMT_MATCH_SRC =");
    expect(html).toContain("function cmtAnchorFromRange");
  });

  test("the standalone preview frame is handed the comment script", async () => {
    const html = await page();
    expect(html).toContain("KEY_RELAY_SCRIPT + CMT_FRAME_SCRIPT");
    expect(html).toContain("__scratchSel");
    expect(html).toContain("__scratchCmtClick");
    expect(html).toContain("__scratchCmtReady");
  });

  test("no literal closing script tag is emitted anywhere in the page", async () => {
    // The frame script lives inside the host's own script element; a literal
    // closing tag in it would end that element early and break the whole page.
    const html = await page();
    const body = html.slice(html.indexOf("let DATA"));
    expect(body.slice(0, body.indexOf("</scr" + "ipt>"))).toContain("CMT_FRAME_SCRIPT");
  });
});
