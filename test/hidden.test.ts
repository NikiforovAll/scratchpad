// Hide-file write-back: the viewer→manifest handler (persistFileHidden) that
// sets a file entry's `hidden` flag. The viewer-side removal is covered in
// ui-dom.test.ts; the render-time filtering of hidden entries lives elsewhere.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IO } from "../src/commands.ts";
import type { Pad } from "../src/discovery.ts";
import { newManifest, readManifest, writeManifest } from "../src/manifest.ts";
import { persistFileHidden } from "../src/ui/launch.ts";

let root: string;
const io: IO = { out: () => {}, err: () => {} };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "scratch-hide-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function makePad(): Promise<Pad> {
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "a.md"), "# A\n", "utf8");
  await writeFile(join(dir, "b.md"), "# B\n", "utf8");
  const m = newManifest("P");
  m.files.push({ path: "a.md", title: "A", type: "note" });
  m.files.push({ path: "b.md", title: "B", type: "note" });
  await writeManifest(dir, m);
  return { dir, manifest: await readManifest(dir) };
}

const hiddenOf = async (pad: Pad, path: string) =>
  (await readManifest(pad.dir)).files.find((f) => f.path === path)?.hidden;

test("sets hidden=true on the targeted entry, leaving siblings untouched", async () => {
  const pad = await makePad();
  await persistFileHidden([pad], { padDir: pad.dir, filePath: "a.md" }, io);
  expect(await hiddenOf(pad, "a.md")).toBe(true);
  expect(await hiddenOf(pad, "b.md")).toBeUndefined();
});

test("is idempotent — hiding an already-hidden file stays hidden", async () => {
  const pad = await makePad();
  await persistFileHidden([pad], { padDir: pad.dir, filePath: "a.md" }, io);
  await persistFileHidden([pad], { padDir: pad.dir, filePath: "a.md" }, io);
  expect(await hiddenOf(pad, "a.md")).toBe(true);
});

test("hidden:false clears the flag (Ctrl+Alt+H toggle on a revealed file)", async () => {
  const pad = await makePad();
  await persistFileHidden([pad], { padDir: pad.dir, filePath: "a.md" }, io);
  expect(await hiddenOf(pad, "a.md")).toBe(true);
  await persistFileHidden([pad], { padDir: pad.dir, filePath: "a.md", hidden: false }, io);
  expect(await hiddenOf(pad, "a.md")).toBeUndefined();
  // anything other than an explicit false still means hide
  await persistFileHidden([pad], { padDir: pad.dir, filePath: "a.md", hidden: "no" }, io);
  expect(await hiddenOf(pad, "a.md")).toBe(true);
});

test("ignores unknown pads, files, and junk payloads", async () => {
  const pad = await makePad();
  await persistFileHidden([pad], null, io);
  await persistFileHidden([pad], "junk", io);
  await persistFileHidden([pad], { padDir: "elsewhere", filePath: "a.md" }, io);
  await persistFileHidden([pad], { padDir: pad.dir, filePath: "nope.md" }, io);
  await persistFileHidden([pad], { padDir: pad.dir }, io);
  expect(await hiddenOf(pad, "a.md")).toBeUndefined();
  expect(await hiddenOf(pad, "b.md")).toBeUndefined();
});
