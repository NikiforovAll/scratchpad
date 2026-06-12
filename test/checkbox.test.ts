// Clickable task checkboxes: the viewer→file writeback handler
// (persistFileCheckbox) — the one place the CLI writes file CONTENT. The
// viewer-side toggle behavior is covered in ui-dom.test.ts.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IO } from "../src/commands.ts";
import type { Pad } from "../src/discovery.ts";
import { newManifest, readManifest, writeManifest } from "../src/manifest.ts";
import { persistFileCheckbox } from "../src/ui/launch.ts";

let root: string;
const io: IO = { out: () => {}, err: () => {} };

const DOC = "# Todos\n\n- [ ] one\n- [x] two\n- not a task\n";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "scratch-chk-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function makePad(content = DOC, file = "todo.md"): Promise<Pad> {
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, file), content, "utf8");
  const m = newManifest("P");
  m.files.push({ path: file, title: "Todo", type: "note" });
  await writeManifest(dir, m);
  return { dir, manifest: await readManifest(dir) };
}

const read = (pad: Pad, file = "todo.md") => readFile(join(pad.dir, file), "utf8");

test("checks an unchecked box on the given source line", async () => {
  const pad = await makePad();
  await persistFileCheckbox([pad], { padDir: pad.dir, filePath: "todo.md", line: 2, checked: true }, io);
  expect(await read(pad)).toBe("# Todos\n\n- [x] one\n- [x] two\n- not a task\n");
});

test("unchecks a checked box", async () => {
  const pad = await makePad();
  await persistFileCheckbox([pad], { padDir: pad.dir, filePath: "todo.md", line: 3, checked: false }, io);
  expect(await read(pad)).toBe("# Todos\n\n- [ ] one\n- [ ] two\n- not a task\n");
});

test("preserves CRLF line endings", async () => {
  const pad = await makePad("- [ ] a\r\n- [ ] b\r\n");
  await persistFileCheckbox([pad], { padDir: pad.dir, filePath: "todo.md", line: 1, checked: true }, io);
  expect(await read(pad)).toBe("- [ ] a\r\n- [x] b\r\n");
});

test("skips a line that is not a task marker (drifted) rather than corrupting it", async () => {
  const pad = await makePad();
  const before = await read(pad);
  await persistFileCheckbox([pad], { padDir: pad.dir, filePath: "todo.md", line: 4, checked: true }, io);
  expect(await read(pad)).toBe(before);
});

test("ignores unknown pads, files, and junk payloads", async () => {
  const pad = await makePad();
  const before = await read(pad);
  await persistFileCheckbox([pad], null, io);
  await persistFileCheckbox([pad], "junk", io);
  await persistFileCheckbox([pad], { padDir: "elsewhere", filePath: "todo.md", line: 2, checked: true }, io);
  await persistFileCheckbox([pad], { padDir: pad.dir, filePath: "nope.md", line: 2, checked: true }, io);
  // Non-integer / out-of-range / wrong-typed line or checked are rejected.
  await persistFileCheckbox([pad], { padDir: pad.dir, filePath: "todo.md", line: 1.5, checked: true }, io);
  await persistFileCheckbox([pad], { padDir: pad.dir, filePath: "todo.md", line: -1, checked: true }, io);
  await persistFileCheckbox([pad], { padDir: pad.dir, filePath: "todo.md", line: 2, checked: "yes" }, io);
  await persistFileCheckbox([pad], { padDir: pad.dir, filePath: "todo.md", line: 999, checked: true }, io);
  expect(await read(pad)).toBe(before);
});

test("toggling an already-correct state is idempotent", async () => {
  const pad = await makePad();
  // line 3 is already "[x]"; checking it again leaves it "[x]".
  await persistFileCheckbox([pad], { padDir: pad.dir, filePath: "todo.md", line: 3, checked: true }, io);
  expect(await read(pad)).toBe(DOC);
});
