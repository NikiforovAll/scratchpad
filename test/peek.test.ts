// Following a link to a file no manifest lists: resolvePeek (live viewer, reads
// on click) and buildView's `linked` embedding (exports, resolved up front).
// Neither touches a manifest — the target stays unregistered.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Pad } from "../src/discovery.ts";
import { newManifest, readManifest, writeManifest } from "../src/manifest.ts";
import { resolvePeek } from "../src/ui/launch.ts";
import { buildView, hrefToAbs } from "../src/ui/render.ts";

let root: string;
const posix = (p: string) => p.replace(/\\/g, "/");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "scratch-peek-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// pad/plan.md (registered) links to: pad/loose.md (unregistered, in pad),
// ../outside.md (sibling dir), an absolute path, a file:// URL, a missing file,
// a directory and a registered file. sub/deep.md is registered via a nested path.
async function makePad(): Promise<Pad> {
  const dir = join(root, "pad");
  await mkdir(join(dir, "sub"), { recursive: true });
  await mkdir(join(root, "elsewhere"), { recursive: true });
  const absTarget = join(root, "elsewhere", "abs.md");
  await writeFile(absTarget, "# abs\n", "utf8");
  await writeFile(join(root, "outside.md"), "# outside\n[back](pad/plan.md)\n", "utf8");
  await writeFile(join(dir, "loose.md"), "# loose\n", "utf8");
  await writeFile(join(dir, "sub", "deep.md"), "# deep\n[up](../loose.md)\n", "utf8");
  await writeFile(join(dir, "loose.py"), "print(1)\n", "utf8");
  await writeFile(
    join(dir, "plan.md"),
    [
      "# plan",
      "[loose](loose.md)",
      "[outside](../outside.md)",
      `[abs](${posix(absTarget)})`,
      `[url](${pathToFileURL(join(root, "elsewhere", "abs.md")).href})`,
      "[missing](nope.md)",
      "[dir](sub)",
      "[deep](sub/deep.md#up)",
      '[code](loose.py "a title")',
      "![img](pic.png)",
      "[web](https://example.com/x.md)",
    ].join("\n") + "\n",
    "utf8",
  );
  const m = newManifest("P");
  m.files.push({ path: "plan.md", type: "note" });
  m.files.push({ path: "sub/deep.md", type: "note" });
  await writeManifest(dir, m);
  return { dir, manifest: await readManifest(dir) };
}

const from = (pad: Pad, rel: string) => join(pad.dir, rel);

test("hrefToAbs resolves against the linking doc and rejects non-file schemes", () => {
  const doc = join(root, "a", "doc.md");
  expect(hrefToAbs(doc, "x.md#h")).toBe(join(root, "a", "x.md"));
  expect(hrefToAbs(doc, "../y.md")).toBe(join(root, "y.md"));
  expect(hrefToAbs(doc, "<sp%20ace.md>")).toBe(join(root, "a", "sp ace.md"));
  expect(hrefToAbs(doc, pathToFileURL(join(root, "z.md")).href)).toBe(join(root, "z.md"));
  expect(hrefToAbs(doc, "https://example.com/x.md")).toBeNull();
  expect(hrefToAbs(doc, "mailto:a@b.c")).toBeNull();
  expect(hrefToAbs(doc, "#only-a-fragment")).toBeNull();
});

test("resolvePeek reads an unregistered file inside the pad", async () => {
  const pad = await makePad();
  const v = await resolvePeek({ fromAbs: from(pad, "plan.md"), href: "loose.md" });
  expect(v?.content).toBe("# loose\n");
  expect(v?.kind).toBe("markdown");
  expect(v?.registered).toBe(false);
  expect(v?.external).toBe(true);
  expect(v?.path).toBe("loose.md");
  expect(v?.title).toBe("loose.md");
  expect(posix(v!.abs)).toBe(posix(join(pad.dir, "loose.md")));
});

test("resolvePeek follows relative links outside the pad and absolute/file:// hrefs", async () => {
  const pad = await makePad();
  const out = await resolvePeek({ fromAbs: from(pad, "plan.md"), href: "../outside.md#x" });
  expect(out?.content).toStartWith("# outside");
  const abs = join(root, "elsewhere", "abs.md");
  expect((await resolvePeek({ fromAbs: from(pad, "plan.md"), href: posix(abs) }))?.content).toBe("# abs\n");
  expect((await resolvePeek({ fromAbs: from(pad, "plan.md"), href: pathToFileURL(abs).href }))?.content).toBe("# abs\n");
});

test("resolvePeek resolves relative to the linking doc, registered or peeked alike", async () => {
  const pad = await makePad();
  const fromDeep = await resolvePeek({ fromAbs: from(pad, "sub/deep.md"), href: "../loose.md" });
  expect(fromDeep?.content).toBe("# loose\n");
  const fromOutside = await resolvePeek({ fromAbs: join(root, "outside.md"), href: "pad/plan.md" });
  expect(fromOutside?.content).toStartWith("# plan");
});

test("resolvePeek returns null for missing files, directories and bad payloads", async () => {
  const pad = await makePad();
  expect(await resolvePeek({ fromAbs: from(pad, "plan.md"), href: "nope.md" })).toBeNull();
  expect(await resolvePeek({ fromAbs: from(pad, "plan.md"), href: "sub" })).toBeNull();
  expect(await resolvePeek({ fromAbs: from(pad, "plan.md"), href: "" })).toBeNull();
  expect(await resolvePeek(null)).toBeNull();
  expect(await resolvePeek({ fromAbs: 1, href: "loose.md" })).toBeNull();
});

test("buildView embeds linked unregistered files only when asked, one level deep", async () => {
  const pad = await makePad();
  const [plain] = await buildView([pad]);
  expect(plain!.linked).toBeUndefined();
  expect(plain!.linkKeys).toBeUndefined();

  const [pv] = await buildView([pad], undefined, { linked: true });
  const keys = Object.keys(pv!.linked!).sort();
  const abs = posix(join(root, "elsewhere", "abs.md"));
  expect(keys).toEqual(
    [join(pad.dir, "loose.md"), join(pad.dir, "loose.py"), join(root, "outside.md")].map(posix).concat(abs).sort(),
  );
  // Registered targets stay out of `linked`; the sidebar list is untouched.
  expect(pv!.files.map((f) => f.path)).toEqual(["plan.md", "sub/deep.md"]);
  const loose = pv!.linked![posix(join(pad.dir, "loose.md"))]!;
  expect(loose.registered).toBe(false);
  expect(loose.path).toBe("loose.md");
  expect(loose.content).toBe("# loose\n");
  expect(pv!.linked![posix(join(pad.dir, "loose.py"))]!.kind).toBe("code");
  // linkKeys maps each link as written (title dropped, fragment kept off) to its
  // embedded target; two hrefs to one file share the entry, dead links have none.
  const lk = pv!.linkKeys!;
  expect(lk["plan.md::loose.md"]).toBe(posix(join(pad.dir, "loose.md")));
  expect(lk["plan.md::loose.py"]).toBe(posix(join(pad.dir, "loose.py")));
  expect(lk["plan.md::../outside.md"]).toBe(posix(join(root, "outside.md")));
  expect(lk["plan.md::" + abs]).toBe(abs);
  expect(lk["plan.md::" + pathToFileURL(join(root, "elsewhere", "abs.md")).href]).toBe(abs);
  expect(lk["plan.md::nope.md"]).toBeUndefined();
  expect(lk["plan.md::sub"]).toBeUndefined();
  expect(lk["plan.md::sub/deep.md"]).toBeUndefined();
  expect(Object.keys(lk).some((k) => k.startsWith("sub/deep.md::"))).toBe(true);
  // outside.md links back to pad/plan.md (registered) — nothing further is pulled in.
  expect(keys.some((k) => k.endsWith("/pic.png"))).toBe(false);
});
