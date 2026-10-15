// Pad sets: the `related` manifest field, resolvePadSet (one level, each pad
// once, inbound links, missing refs), links across pads (xrefs), and the CLI
// surfaces that use a set — ui/export selection and comments --related.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.ts";
import type { IO } from "../src/commands.ts";
import { resolvePad, resolvePadSet, type Pad } from "../src/discovery.ts";
import { type Comment, type Manifest, newManifest, parseManifest, readManifest, writeManifest } from "../src/manifest.ts";
import { buildView } from "../src/ui/render.ts";

let root: string;
let log: string[];
let errs: string[];
const io: IO = { out: (s) => log.push(s), err: (s) => errs.push(s) };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "scratch-set-"));
  log = [];
  errs = [];
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const comment = (id: string, quote: string, body: string): Comment => ({
  id,
  body,
  anchor: { quote, prefix: "", suffix: "" },
  created: "2026-10-14T00:00:00Z",
  updated: "2026-10-14T00:00:00Z",
});

async function makePad(
  name: string,
  files: Record<string, string>,
  opts: { related?: unknown[]; comments?: Record<string, Comment[]>; under?: string } = {},
): Promise<string> {
  const dir = join(opts.under ?? root, name);
  await mkdir(dir, { recursive: true });
  const m = newManifest(name);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), content, "utf8");
    m.files.push({ path, type: "note", ...(opts.comments?.[path] ? { comments: opts.comments[path] } : {}) });
  }
  if (opts.related) m.related = opts.related as Manifest["related"];
  await writeManifest(dir, m);
  return dir;
}

const load = async (dir: string): Promise<Pad> => ({ dir, manifest: await readManifest(dir) });
const names = (pads: Pad[]) => pads.map((p) => p.manifest.name);

test("parseManifest keeps related entries in the author's form and drops bad ones", () => {
  const m = parseManifest(
    { name: "p", related: ["a", " ", { pad: "b", rel: "feeds" }, { pad: "c", rel: "" }, { rel: "x" }, 7] },
    "x",
  );
  expect(m.related).toEqual(["a", { pad: "b", rel: "feeds" }, { pad: "c" }]);
  expect(parseManifest({ name: "p", related: [] }, "x").related).toBeUndefined();
});

test("a CLI write keeps related as written", async () => {
  const dir = await makePad("api", { "a.md": "# a\n" }, { related: ["sdk", { pad: "../x", rel: "feeds" }] });
  await writeFile(join(dir, "b.md"), "# b\n", "utf8");
  expect(await run(["add", "api", "b.md", "--dir", root], io)).toBe(0);
  const raw = JSON.parse(await readFile(join(dir, "scratchpad.json"), "utf8"));
  expect(raw.related).toEqual(["sdk", { pad: "../x", rel: "feeds" }]);
});

test("resolvePadSet: the opened pad first, then the pads it lists, with roles", async () => {
  const api = await makePad("api-design", { "a.md": "# a\n" }, { related: [{ pad: "client-sdk", rel: "feeds" }] });
  await makePad("client-sdk", { "b.md": "# b\n" });
  await makePad("unrelated", { "c.md": "# c\n" });
  const set = await resolvePadSet(await load(api), root);
  expect(names(set)).toEqual(["api-design", "client-sdk"]);
  expect(set[0]!.set).toEqual({ primary: true });
  expect(set[1]!.set).toEqual({ direction: "out", rel: "feeds" });
});

test("resolvePadSet: opening the pad that is listed brings in the pad that lists it", async () => {
  await makePad("api-design", { "a.md": "# a\n" }, { related: [{ pad: "client-sdk", rel: "feeds" }] });
  const sdk = await makePad("client-sdk", { "b.md": "# b\n" });
  await makePad("unrelated", { "c.md": "# c\n" });
  const set = await resolvePadSet(await load(sdk), root);
  expect(names(set)).toEqual(["client-sdk", "api-design"]);
  expect(set[1]!.set).toEqual({ direction: "in", rel: "feeds" });
});

test("resolvePadSet: a cycle A↔B lists each pad once", async () => {
  const a = await makePad("a", { "a.md": "# a\n" }, { related: ["b"] });
  await makePad("b", { "b.md": "# b\n" }, { related: ["a"] });
  expect(names(await resolvePadSet(await load(a), root))).toEqual(["a", "b"]);
});

test("resolvePadSet follows one level only", async () => {
  const a = await makePad("a", { "a.md": "# a\n" }, { related: ["b"] });
  await makePad("b", { "b.md": "# b\n" }, { related: ["c"] });
  await makePad("c", { "c.md": "# c\n" });
  expect(names(await resolvePadSet(await load(a), root))).toEqual(["a", "b"]);
});

test("resolvePadSet warns on a ref that does not resolve and keeps the rest", async () => {
  const a = await makePad("a", { "a.md": "# a\n" }, { related: ["ghost", "b"] });
  await makePad("b", { "b.md": "# b\n" });
  const warnings: string[] = [];
  const set = await resolvePadSet(await load(a), root, (m) => warnings.push(m));
  expect(names(set)).toEqual(["a", "b"]);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain('"ghost"');
});

test("resolvePadSet resolves a relative path from the pad's dir, and a pad with no relations stays alone", async () => {
  const a = await makePad("a", { "a.md": "# a\n" }, { related: ["../nested/b"] });
  await makePad("b", { "b.md": "# b\n" }, { under: join(root, "nested") });
  expect(names(await resolvePadSet(await load(a), join(root, "elsewhere")))).toEqual(["a", "b"]);
  const lone = await makePad("lone", { "l.md": "# l\n" });
  const set = await resolvePadSet(await load(lone), root);
  expect(names(set)).toEqual(["lone"]);
  expect(set[0]!.set).toBeUndefined();
});

test("buildView maps links to files of another pad in the set (xrefs)", async () => {
  const api = await makePad(
    "api-design",
    { "sources/notes.md": "# Auth\n", "plan.md": "# plan\n" },
    { related: ["client-sdk"] },
  );
  await makePad("client-sdk", {
    "scope.md": "[Auth](../api-design/sources/notes.md#auth) [plan](../api-design/plan.md) [missing](../api-design/nope.md)\n",
  });
  const view = await buildView(await resolvePadSet(await load(api), root));
  const sdk = view.find((p) => p.name === "client-sdk")!;
  expect(sdk.xrefs).toEqual({
    "scope.md::../api-design/sources/notes.md": { dir: api, path: "sources/notes.md" },
    "scope.md::../api-design/plan.md": { dir: api, path: "plan.md" },
  });
  expect(view.find((p) => p.name === "api-design")!.xrefs).toBeUndefined();
  expect(view[0]!.set).toEqual({ primary: true });
});

test("buildView makes no xrefs for a single pad", async () => {
  const a = await makePad("a", { "x.md": "[b](../b/y.md)\n" });
  await makePad("b", { "y.md": "# y\n" });
  const [pv] = await buildView([await load(a)]);
  expect(pv!.xrefs).toBeUndefined();
});

test("export of a pad with related embeds the whole set", async () => {
  await makePad("api-design", { "a.md": "# API only\n" }, { related: ["client-sdk"] });
  await makePad("client-sdk", { "b.md": "# SDK only\n" });
  await makePad("unrelated", { "c.md": "# NOT IN SET\n" });
  const out = join(root, "out.html");
  expect(await run(["export", "api-design", "--dir", root, "-o", out], io)).toBe(0);
  const html = await readFile(out, "utf8");
  expect(html).toContain("API only");
  expect(html).toContain("SDK only");
  expect(html).not.toContain("NOT IN SET");
  expect(log.join("\n")).toContain("api-design, client-sdk");
});

test("export warns on a missing related pad but still succeeds", async () => {
  await makePad("a", { "a.md": "# a\n" }, { related: ["ghost"] });
  expect(await run(["export", "a", "--dir", root, "-o", join(root, "o.html")], io)).toBe(0);
  expect(errs.join("\n")).toContain('related pad "ghost"');
});

async function commentedSet() {
  await makePad(
    "api-design",
    { "plan.md": "# Plan\n\nRate limit rule.\n" },
    { related: ["client-sdk"], comments: { "plan.md": [comment("c1", "Rate limit rule.", "who enters them?")] } },
  );
  await makePad(
    "client-sdk",
    { "scope.md": "# Scope\n\nToken refresh.\n" },
    { comments: { "scope.md": [comment("c2", "Token refresh.", "needs a retry rule")] } },
  );
}

test("comments without --related stay on the one pad", async () => {
  await commentedSet();
  expect(await run(["comments", "api-design", "--dir", root, "--json"], io)).toBe(0);
  const out = JSON.parse(log.join("\n"));
  expect(out.pads).toBeUndefined();
  expect(out.comments.map((c: any) => c.id)).toEqual(["c1"]);
  expect(out.comments[0].pad).toBeUndefined();
});

test("comments --related lists every pad in the set, each tagged with its pad", async () => {
  await commentedSet();
  expect(await run(["comments", "client-sdk", "--related", "--dir", root, "--json"], io)).toBe(0);
  const out = JSON.parse(log.join("\n"));
  expect(out.pad).toBe("client-sdk");
  expect(out.pads).toEqual(["client-sdk", "api-design"]);
  expect(out.comments.map((c: any) => [c.pad, c.id, c.file])).toEqual([
    ["client-sdk", "c2", "scope.md"],
    ["api-design", "c1", "plan.md"],
  ]);
  log = [];
  expect(await run(["comments", "api-design", "--related", "--dir", root], io)).toBe(0);
  const text = log.join("\n");
  expect(text).toContain("api-design, client-sdk");
  expect(text).toContain("api-design/plan.md");
  expect(text).toContain("client-sdk/scope.md");
});

test("comments --related --rm deletes in the pad that holds the comment", async () => {
  await commentedSet();
  expect(await run(["comments", "api-design", "--related", "--rm", "c2", "--dir", root], io)).toBe(0);
  const sdk = await resolvePad("client-sdk", root);
  const api = await resolvePad("api-design", root);
  expect(sdk!.manifest.files[0]!.comments).toBeUndefined();
  expect(api!.manifest.files[0]!.comments?.map((c) => c.id)).toEqual(["c1"]);
});
