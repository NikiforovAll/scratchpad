// Inline comments: manifest schema (parse/sanitize round-trip) and the
// viewer→manifest writeback handler (persistFileComments). The viewer-side
// behavior (highlighting, popovers, toggle) is covered in ui-dom.test.ts.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IO } from "../src/commands.ts";
import type { Pad } from "../src/discovery.ts";
import {
  type Comment,
  newManifest,
  parseManifest,
  readManifest,
  sanitizeComments,
  writeManifest,
} from "../src/manifest.ts";
import { persistFileComments } from "../src/ui/launch.ts";

let root: string;
const io: IO = { out: () => {}, err: () => {} };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "scratch-cmt-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function comment(over: Partial<Comment> = {}): Comment {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    body: "a margin note",
    anchor: { quote: "bold", prefix: "Text ", suffix: "." },
    created: "2026-06-11T10:00:00Z",
    updated: "2026-06-11T10:00:00Z",
    ...over,
  };
}

test("sanitizeComments keeps valid entries and drops malformed ones", () => {
  const valid = comment();
  const out = sanitizeComments([
    valid,
    null,
    "junk",
    { id: "", body: "no id", anchor: { quote: "q" } },
    { id: "x", anchor: { quote: "q" } }, // missing body
    { id: "x", body: "b" }, // missing anchor
    { id: "x", body: "b", anchor: { quote: "" } }, // empty quote
  ]);
  expect(out).toEqual([valid]);
});

test("sanitizeComments defaults missing prefix/suffix/dates", () => {
  const out = sanitizeComments([{ id: "x", body: "b", anchor: { quote: "q" } }]);
  expect(out).toHaveLength(1);
  expect(out[0]!.anchor).toEqual({ quote: "q", prefix: "", suffix: "" });
  expect(out[0]!.created).toMatch(/^\d{4}-/);
  expect(out[0]!.updated).toMatch(/^\d{4}-/);
});

test("parseManifest keeps valid comments and drops malformed entries", () => {
  const m = parseManifest(
    {
      name: "P",
      files: [
        { path: "doc.md", comments: [comment(), { id: "bad" }] },
        { path: "other.md" },
      ],
    },
    "test",
  );
  expect(m.files[0]!.comments).toEqual([comment()]);
  expect(m.files[1]!.comments).toBeUndefined();
});

test("comments round-trip through writeManifest/readManifest", async () => {
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  const m = newManifest("P");
  m.files.push({ path: "doc.md", comments: [comment()] });
  await writeManifest(dir, m);
  const back = await readManifest(dir);
  expect(back.files[0]!.comments).toEqual([comment()]);
});

test("old manifests without comments load unchanged", () => {
  const m = parseManifest({ name: "P", files: [{ path: "doc.md" }] }, "test");
  expect(m.files[0]!.comments).toBeUndefined();
});

async function makePad(): Promise<Pad> {
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "doc.md"), "# H\n\nText **bold**.\n", "utf8");
  const m = newManifest("P");
  m.files.push({ path: "doc.md", title: "Doc", type: "note" });
  await writeManifest(dir, m);
  return { dir, manifest: await readManifest(dir) };
}

test("persistFileComments writes the comment array into the right FileEntry", async () => {
  const pad = await makePad();
  await persistFileComments(
    [pad],
    { padDir: pad.dir, filePath: "doc.md", comments: [comment()] },
    io,
  );
  const m = await readManifest(pad.dir);
  expect(m.files[0]!.comments).toEqual([comment()]);
});

test("persistFileComments sanitizes the payload and clears on empty array", async () => {
  const pad = await makePad();
  await persistFileComments(
    [pad],
    { padDir: pad.dir, filePath: "doc.md", comments: [comment(), { id: "junk" }] },
    io,
  );
  expect((await readManifest(pad.dir)).files[0]!.comments).toEqual([comment()]);
  // Deleting the last comment removes the field entirely.
  await persistFileComments([pad], { padDir: pad.dir, filePath: "doc.md", comments: [] }, io);
  expect((await readManifest(pad.dir)).files[0]!.comments).toBeUndefined();
});

test("persistFileComments ignores unknown pads, files, and junk payloads", async () => {
  const pad = await makePad();
  const before = JSON.stringify(await readManifest(pad.dir));
  await persistFileComments([pad], null, io);
  await persistFileComments([pad], "junk", io);
  await persistFileComments([pad], { padDir: "elsewhere", filePath: "doc.md", comments: [] }, io);
  await persistFileComments([pad], { padDir: pad.dir, filePath: "nope.md", comments: [comment()] }, io);
  const after = await readManifest(pad.dir);
  expect(after.files[0]!.comments).toBeUndefined();
  // updated may have been bumped only by a successful write — assert none happened.
  expect(JSON.stringify(after)).toBe(before);
});

test("persistFileComments preserves metadata edited on disk while the viewer is open", async () => {
  const pad = await makePad();
  // Simulate a concurrent manifest edit (e.g. `scratch add` while viewing).
  const edited = await readManifest(pad.dir);
  edited.files[0]!.description = "edited meanwhile";
  await writeManifest(pad.dir, edited);
  // The launch-time Pad.manifest snapshot is stale — the handler must re-read.
  await persistFileComments(
    [pad],
    { padDir: pad.dir, filePath: "doc.md", comments: [comment()] },
    io,
  );
  const m = await readManifest(pad.dir);
  expect(m.files[0]!.description).toBe("edited meanwhile");
  expect(m.files[0]!.comments).toEqual([comment()]);
});
