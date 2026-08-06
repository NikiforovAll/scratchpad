// Session reveal of hidden files: buildView's RevealState filtering, the
// Reloader's reveal/conceal/setRevealAll state, and applyReveal's payload
// validation. Reveals never touch the manifest — the flag on disk stays put.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pad } from "../src/discovery.ts";
import { newManifest, readManifest, writeManifest } from "../src/manifest.ts";
import { applyReveal } from "../src/ui/launch.ts";
import { createReloader } from "../src/ui/reload.ts";
import { buildView } from "../src/ui/render.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "scratch-reveal-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// Two visible files + two hidden ones, mirroring a real pad.
async function makePad(): Promise<Pad> {
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  for (const name of ["a.md", "b.md", "h1.md", "h2.md"]) {
    await writeFile(join(dir, name), `# ${name}\n`, "utf8");
  }
  const m = newManifest("P");
  m.files.push({ path: "a.md", type: "note" });
  m.files.push({ path: "b.md", type: "note" });
  m.files.push({ path: "h1.md", type: "note", hidden: true });
  m.files.push({ path: "h2.md", type: "note", hidden: true });
  await writeManifest(dir, m);
  return { dir, manifest: await readManifest(dir) };
}

const paths = (files: { path: string }[]) => files.map((f) => f.path);

test("buildView drops hidden entries and lists them in hiddenPaths", async () => {
  const pad = await makePad();
  const [pv] = await buildView([pad]);
  expect(paths(pv!.files)).toEqual(["a.md", "b.md"]);
  expect(pv!.hiddenPaths).toEqual(["h1.md", "h2.md"]);
});

test("a revealed file is included (flagged hidden) and leaves hiddenPaths", async () => {
  const pad = await makePad();
  const key = pad.dir + String.fromCharCode(0) + "h1.md"; // NUL-joined, see RevealState
  const [pv] = await buildView([pad], { revealed: new Set([key]), revealAll: false });
  expect(paths(pv!.files)).toEqual(["a.md", "b.md", "h1.md"]);
  expect(pv!.files.find((f) => f.path === "h1.md")?.hidden).toBe(true);
  expect(pv!.files.find((f) => f.path === "a.md")?.hidden).toBeUndefined();
  expect(pv!.hiddenPaths).toEqual(["h2.md"]);
});

test("revealAll includes every hidden entry and empties hiddenPaths", async () => {
  const pad = await makePad();
  const [pv] = await buildView([pad], { revealed: new Set(), revealAll: true });
  expect(paths(pv!.files)).toEqual(["a.md", "b.md", "h1.md", "h2.md"]);
  expect(pv!.hiddenPaths).toBeUndefined();
});

test("reloader reveal/conceal round-trips through rebuild without touching the manifest", async () => {
  const pad = await makePad();
  const reloader = createReloader([pad], "Notes");

  expect((await reloader.rebuild()).payloadJson).not.toContain("# h1.md");

  reloader.reveal(pad.dir, "h1.md");
  const revealed = (await reloader.rebuild()).payloadJson;
  expect(revealed).toContain("# h1.md");
  expect(revealed).not.toContain("# h2.md");

  reloader.conceal(pad.dir, "h1.md");
  expect((await reloader.rebuild()).payloadJson).not.toContain("# h1.md");

  // The manifest on disk still marks both hidden — reveals are session-only.
  const m = await readManifest(pad.dir);
  expect(m.files.find((f) => f.path === "h1.md")?.hidden).toBe(true);
});

test("setRevealAll(true) shows everything; (false) hides again", async () => {
  const pad = await makePad();
  const reloader = createReloader([pad], "Notes");
  reloader.setRevealAll(true);
  const all = (await reloader.rebuild()).payloadJson;
  expect(all).toContain("# h1.md");
  expect(all).toContain("# h2.md");
  reloader.setRevealAll(false);
  expect((await reloader.rebuild()).payloadJson).not.toContain("# h1.md");
});

test("applyReveal validates payloads and routes them to the reloader", async () => {
  const pad = await makePad();
  const reloader = createReloader([pad], "Notes");

  expect(applyReveal(reloader, null)).toBe(false);
  expect(applyReveal(reloader, "junk")).toBe(false);
  expect(applyReveal(reloader, { padDir: pad.dir })).toBe(false);
  expect(applyReveal(reloader, { all: "yes" })).toBe(false);

  expect(applyReveal(reloader, { padDir: pad.dir, filePath: "h2.md" })).toBe(true);
  const single = (await reloader.rebuild()).payloadJson;
  expect(single).toContain("# h2.md");
  expect(single).not.toContain("# h1.md");

  // conceal is applied but reports "no patch needed" — the page splices locally
  expect(applyReveal(reloader, { padDir: pad.dir, filePath: "h2.md", conceal: true })).toBe(false);
  expect((await reloader.rebuild()).payloadJson).not.toContain("# h2.md");

  expect(applyReveal(reloader, { all: true })).toBe(true);
  expect((await reloader.rebuild()).payloadJson).toContain("# h1.md");
  expect(applyReveal(reloader, { all: false })).toBe(true);
  expect((await reloader.rebuild()).payloadJson).not.toContain("# h1.md");
});
