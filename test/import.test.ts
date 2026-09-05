// scratch import: export → import round-trip over a real temp root.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.ts";
import { readManifest } from "../src/manifest.ts";
import { extractPads, planPad } from "../src/import.ts";
import type { IO } from "../src/commands.ts";

let root: string;
let log: string[];
let errs: string[];
const io: IO = { out: (s) => log.push(s), err: (s) => errs.push(s) };
const all = () => log.join("\n");
const allErr = () => errs.join("\n");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "scratch-import-"));
  log = [];
  errs = [];
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function seedAndExport(): Promise<string> {
  await run(["new", "Notes", "--dir", root], io);
  const padDir = join(root, "notes");
  await mkdir(join(padDir, "sub"), { recursive: true });
  await writeFile(join(padDir, "a.md"), "# Hi <b>\n\n- [ ] task\n", "utf8");
  await writeFile(join(padDir, "sub", "b.ts"), "export const x = `1`;\n", "utf8");
  await writeFile(join(padDir, "pic.png"), PNG_1PX);
  await writeFile(join(padDir, "blob.bin"), Buffer.from([0, 1, 2, 255, 254]));
  await run(["add", "Notes", "a.md", "--dir", root, "--title", "A", "--desc", "why", "--tag", "x,y", "--group", "Docs"], io);
  await run(["add", "Notes", "sub/b.ts", "--dir", root, "--type", "snippet"], io);
  await run(["add", "Notes", "pic.png", "--dir", root], io);
  await run(["add", "Notes", "blob.bin", "--dir", root], io);
  const out = join(root, "notes.html");
  expect(await run(["export", "Notes", "--dir", root, "-o", out], io)).toBe(0);
  log = [];
  errs = [];
  return out;
}

describe("import", () => {
  test("round-trips files and manifest metadata", async () => {
    const html = await seedAndExport();
    const dest = join(root, "restored");
    expect(await run(["import", html, "-o", dest], io)).toBe(0);
    expect(await readFile(join(dest, "a.md"), "utf8")).toBe("# Hi <b>\n\n- [ ] task\n");
    expect(await readFile(join(dest, "sub", "b.ts"), "utf8")).toBe("export const x = `1`;\n");
    expect(Buffer.from(await readFile(join(dest, "pic.png"))).equals(PNG_1PX)).toBe(true);
    expect(existsSync(join(dest, "blob.bin"))).toBe(false);

    const m = await readManifest(dest);
    expect(m.name).toBe("Notes");
    const a = m.files.find((f) => f.path === "a.md")!;
    expect(a.title).toBe("A");
    expect(a.description).toBe("why");
    expect(a.tags).toEqual(["x", "y"]);
    expect(a.group).toBe("Docs");
    expect(m.files.find((f) => f.path === "sub/b.ts")!.type).toBe("snippet");
    expect(m.files.map((f) => f.path)).toContain("blob.bin");
    expect(all()).toContain("imported");
    expect(all()).toMatch(/skip\s+: blob\.bin/);
  });

  test("--dry-run writes nothing but reports the plan", async () => {
    const html = await seedAndExport();
    const dest = join(root, "restored");
    expect(await run(["import", html, "-o", dest, "--dry-run"], io)).toBe(0);
    expect(existsSync(dest)).toBe(false);
    expect(all()).toContain("would import");
    expect(all()).toMatch(/write\s+: a\.md/);
    expect(all()).toMatch(/write\s+: sub\/b\.ts/);
    expect(all()).toMatch(/skip\s+: blob\.bin/);
    expect(all()).toContain("--dry-run");
  });

  test("refuses a non-empty target without --force", async () => {
    const html = await seedAndExport();
    const dest = join(root, "busy");
    await mkdir(dest);
    await writeFile(join(dest, "keep.txt"), "x");
    expect(await run(["import", html, "-o", dest], io)).toBe(1);
    expect(allErr()).toContain("--force");
    expect(existsSync(join(dest, "a.md"))).toBe(false);
    errs = [];
    expect(await run(["import", html, "-o", dest, "--force"], io)).toBe(0);
    expect(existsSync(join(dest, "a.md"))).toBe(true);
    expect(existsSync(join(dest, "keep.txt"))).toBe(true);
  });

  test("multi-pad export needs --all and lands each pad in <out>/<slug>/", async () => {
    await run(["new", "Alpha", "--dir", root], io);
    await run(["new", "Beta_Pad", "--dir", root], io);
    await writeFile(join(root, "alpha", "a.md"), "a", "utf8");
    await writeFile(join(root, "beta-pad", "b.md"), "b", "utf8");
    await run(["add", "Alpha", "a.md", "--dir", root], io);
    await run(["add", "Beta_Pad", "b.md", "--dir", root], io);
    const html = join(root, "all.html");
    expect(await run(["export", "--all", "--dir", root, "-o", html], io)).toBe(0);
    log = []; errs = [];
    const dest = join(root, "restored");
    expect(await run(["import", html, "-o", dest], io)).toBe(1);
    expect(allErr()).toContain("--all");
    expect(await run(["import", html, "-o", dest, "--all"], io)).toBe(0);
    expect(await readFile(join(dest, "alpha", "a.md"), "utf8")).toBe("a");
    expect(await readFile(join(dest, "beta-pad", "b.md"), "utf8")).toBe("b");
    expect((await readManifest(join(dest, "beta-pad"))).name).toBe("Beta_Pad");
  });

  test("rejects a page that is not a scratch export", async () => {
    const f = join(root, "plain.html");
    await writeFile(f, "<!doctype html><p>hi</p>", "utf8");
    expect(await run(["import", f, "-o", join(root, "x")], io)).toBe(1);
    expect(allErr()).toContain("data island");
  });

  test("planPad skips unsafe paths and keeps entries for skipped content", () => {
    const plan = planPad(
      {
        name: "P",
        files: [
          { path: "../evil.md", kind: "markdown", content: "x" },
          { path: "big.md", kind: "toolarge", content: null },
          { path: "ok.md", kind: "markdown", content: "fine" },
        ],
      },
      "/tmp/p",
    );
    expect(plan.files.map((f) => !!f.file)).toEqual([false, false, true]);
    expect(plan.manifest.files.map((f) => f.path)).toEqual(["big.md", "ok.md"]);
  });

  test("restores an excalidraw scene from its source, not the rendered SVG", async () => {
    await run(["new", "Draw", "--dir", root], io);
    const scene = JSON.stringify({ type: "excalidraw", version: 2, elements: [], appState: {}, files: {} });
    await writeFile(join(root, "draw", "s.excalidraw"), scene, "utf8");
    await run(["add", "Draw", "s.excalidraw", "--dir", root], io);
    const html = join(root, "draw.html");
    expect(await run(["export", "Draw", "--dir", root, "-o", html], io)).toBe(0);
    const dest = join(root, "restored");
    expect(await run(["import", html, "-o", dest], io)).toBe(0);
    expect(await readFile(join(dest, "s.excalidraw"), "utf8")).toBe(scene);
  });

  test("drops linked entries and the default type from the manifest", () => {
    const plan = planPad(
      {
        name: "P",
        files: [
          { path: "ext.md", external: true, kind: "markdown", content: "x", type: "note" },
          { path: "a.md", kind: "markdown", content: "a", type: "note" },
          { path: "b.md", kind: "markdown", content: "b", type: "snippet" },
        ],
      },
      "/tmp/p",
    );
    expect(plan.files.find((f) => f.path === "ext.md")!.reason).toContain("linked");
    expect(plan.manifest.files).toEqual([{ path: "a.md" }, { path: "b.md", type: "snippet" }]);
  });

  test("extractPads reads the island from a rendered page", async () => {
    const html = await seedAndExport();
    const pads = extractPads(await readFile(html, "utf8"));
    expect(pads).toHaveLength(1);
    expect(pads[0]!.files.map((f) => f.path).sort()).toEqual(["a.md", "blob.bin", "pic.png", "sub/b.ts"]);
  });
});
