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
  test("includes registered + unregistered files, classified and read", async () => {
    const pad = await seedPad();
    const [pv] = await buildView([pad]);
    expect(pv!.name).toBe("Notes");
    const byPath = Object.fromEntries(pv!.files.map((f) => [f.path, f]));
    expect(byPath["a.md"]!.kind).toBe("markdown");
    expect(byPath["a.md"]!.registered).toBe(true);
    expect(byPath["a.md"]!.content).toContain("# Title");
    expect(byPath["snippet.ts"]!.kind).toBe("code");
    expect(byPath["loose.txt"]!.registered).toBe(false); // present but not in manifest
    expect(byPath["loose.txt"]!.content).toBe("unregistered content");
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
  test("produces a self-contained page with embedded data + theme", async () => {
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
    // offline-safe: no external resource loads (string literals inside inlined
    // vendor bundles are fine; what matters is nothing is FETCHED). An <a href>
    // (e.g. the GitHub link) is a user-action link, not a load, so it's allowed.
    expect(html).not.toMatch(/<script[^>]+\bsrc=/i);
    expect(html).not.toMatch(/<link[^>]+\bhref=/i);
    expect(html).not.toMatch(/\bsrc=["']https?:/i);
  });

  test("inlines hljs when code present, but not mermaid", async () => {
    const pad = await seedPad(); // has snippet.ts + ```ts fence, no mermaid
    const html = await renderHtml(await buildView([pad]), "Notes");
    expect(html).toContain("hljs.highlightElement"); // highlight wiring present
    expect(html.length).toBeGreaterThan(150_000); // hljs (161KB) inlined
    expect(html.length).toBeLessThan(1_000_000); // mermaid (3MB) NOT inlined
  });

  test("inlines mermaid bundle only when a mermaid block exists", async () => {
    const dir = join(root, "diagram");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "flow.md"), "# Flow\n\n```mermaid\ngraph TD; A-->B;\n```\n", "utf8");
    const m = newManifest("Diagram");
    m.files.push({ path: "flow.md", title: "Flow", type: "note" });
    await writeManifest(dir, m);
    const pad: Pad = { dir, manifest: await readManifest(dir) };
    const html = await renderHtml(await buildView([pad]), "Diagram");
    expect(html.length).toBeGreaterThan(2_000_000); // mermaid bundle inlined
    expect(html).toContain("mermaid");
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
