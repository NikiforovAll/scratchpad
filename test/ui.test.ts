// UI rendering tests: buildView scans all files + merges manifest metadata;
// renderHtml embeds a self-contained page. No window is launched here.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
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
    expect(html.length).toBeLessThan(150_000); // bundles no longer inlined
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
    expect(html.length).toBeLessThan(150_000); // mermaid bundle NOT inlined
  });

  test("defaults to system mode + ember and ships the settings UI", async () => {
    const pad = await seedPad();
    const html = await renderHtml(await buildView([pad]), "Notes");
    // system mode = no data-theme attr (dark-first until the client resolves the OS)
    expect(html).toContain('<html lang="en" data-color-theme="ember" data-grid="dots">');
    expect(html).toContain('id="settings"'); // settings island
    expect(html).toContain('"themeMode":"system"');
    expect(html).toContain('id="settingsBtn"');
    expect(html).toContain('id="settingsModal"');
    expect(html).toContain('data-theme-id="gruvbox"'); // theme cards from the registry
  });

  test("bakes persisted settings into <html> attrs + the settings island", async () => {
    const pad = await seedPad();
    const html = await renderHtml(await buildView([pad]), "Notes", {
      themeMode: "light",
      colorTheme: "gruvbox",
    });
    expect(html).toContain('<html lang="en" data-color-theme="gruvbox" data-grid="dots" data-theme="light">');
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
    expect(wide).toContain('<html lang="en" data-color-theme="ember" data-grid="dots" data-wide>');
    expect(wide).toContain('"wideMode":true');
    const plain = await renderHtml(view, "Notes");
    expect(plain).toContain('<html lang="en" data-color-theme="ember" data-grid="dots">'); // no data-wide by default
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
    expect(zoomed).toContain('<html lang="en" data-color-theme="ember" data-grid="dots" style="zoom: 1.25">');
    expect(zoomed).toContain('"zoom":1.25');
    const plain = await renderHtml(view, "Notes");
    expect(plain).toContain('<html lang="en" data-color-theme="ember" data-grid="dots">'); // no style attr
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
