// UI rendering tests: buildView scans all files + merges manifest metadata;
// renderHtml embeds a self-contained page. No window is launched here.

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildView, renderHtml } from "../src/ui/render.ts";
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
  });

  test("links hljs via CDN (with SRI) when code present, not mermaid", async () => {
    const pad = await seedPad(); // has snippet.ts + ```ts fence, no mermaid
    const html = await renderHtml(await buildView([pad]), "Notes");
    expect(html).toContain("hljs.highlightElement"); // highlight wiring present
    expect(html).toMatch(/<script src="https:\/\/cdnjs\.cloudflare\.com[^"]+highlight[^"]+" integrity="sha384-/);
    expect(html).not.toContain("mermaid@"); // no mermaid CDN tag
    expect(html.length).toBeLessThan(200_000); // bundles no longer inlined (inlined hljs alone is >1MB)
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
    expect(html.length).toBeLessThan(200_000); // mermaid bundle NOT inlined (inlined mermaid is >2MB)
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
    expect(html.length).toBeLessThan(200_000); // KaTeX NOT inlined (fonts/CSS load from CDN)
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
