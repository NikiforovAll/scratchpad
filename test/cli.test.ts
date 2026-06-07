// Full CLI-loop tests (v1 success criterion #1): new → add → ls → show → rm
// over a real folder+manifest under a temp root, plus unit coverage for
// slugify, manifest validation, and discovery.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.ts";
import { slugify } from "../src/discovery.ts";
import { parseManifest, MANIFEST_NAME } from "../src/manifest.ts";
import type { IO } from "../src/commands.ts";

let root: string;
let log: string[];
let errs: string[];
const io: IO = { out: (s) => log.push(s), err: (s) => errs.push(s) };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "scratch-test-"));
  log = [];
  errs = [];
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const all = () => log.join("\n");
const allErr = () => errs.join("\n");

describe("slugify", () => {
  test("lowercases, replaces punct, trims repeats", () => {
    expect(slugify("Auth Refactor!")).toBe("auth-refactor");
    expect(slugify("  Hello   World  ")).toBe("hello-world");
    expect(slugify("a//b__c")).toBe("a-b-c");
    expect(slugify("!!!")).toBe("pad");
  });
});

describe("parseManifest", () => {
  test("rejects non-object and missing name", () => {
    expect(() => parseManifest(null, "x")).toThrow();
    expect(() => parseManifest({}, "x")).toThrow();
  });
  test("tolerates unknown keys and bad file entries types", () => {
    const m = parseManifest(
      { name: "p", future: 1, files: [{ path: "a.md", type: "bogus", extra: 9 }] },
      "x",
    );
    expect(m.name).toBe("p");
    expect(m.files[0]!.path).toBe("a.md");
    expect(m.files[0]!.type).toBeUndefined(); // invalid type dropped
  });
});

describe("new", () => {
  test("requires name and --dir", async () => {
    expect(await run(["new"], io)).toBe(2);
    expect(await run(["new", "My Pad"], io)).toBe(2);
    expect(allErr()).toContain("--dir");
  });

  test("creates folder + manifest and prints onboarding", async () => {
    const code = await run(["new", "Auth Refactor", "--dir", root, "--id", "sess123"], io);
    expect(code).toBe(0);
    const padDir = join(root, "auth-refactor");
    expect(existsSync(join(padDir, MANIFEST_NAME))).toBe(true);
    const m = JSON.parse(await readFile(join(padDir, MANIFEST_NAME), "utf8"));
    expect(m.version).toBe(1);
    expect(m.name).toBe("Auth Refactor");
    expect(m.id).toBe("sess123");
    expect(m.files).toEqual([]);
    expect(all()).toContain("How to use this scratchpad");
  });

  test("refuses same-parent collision unless --force", async () => {
    await run(["new", "Dup", "--dir", root], io);
    log = []; errs = [];
    expect(await run(["new", "Dup", "--dir", root], io)).toBe(1);
    expect(allErr()).toContain("already exists");
    expect(await run(["new", "Dup", "--dir", root, "--force"], io)).toBe(0);
  });

  test("same name in different dirs is fine (path = identity)", async () => {
    const a = join(root, "a");
    const b = join(root, "b");
    await mkdir(a, { recursive: true });
    await mkdir(b, { recursive: true });
    expect(await run(["new", "Same", "--dir", a], io)).toBe(0);
    expect(await run(["new", "Same", "--dir", b], io)).toBe(0);
    expect(existsSync(join(a, "same", MANIFEST_NAME))).toBe(true);
    expect(existsSync(join(b, "same", MANIFEST_NAME))).toBe(true);
  });
});

describe("full loop: add / ls / show / rm", () => {
  async function seed() {
    await run(["new", "Notes", "--dir", root], io);
    const padDir = join(root, "notes");
    await writeFile(join(padDir, "a.md"), "# Hello\n\nbody", "utf8");
    return padDir;
  }

  test("add registers file with metadata", async () => {
    const padDir = await seed();
    log = []; errs = [];
    const code = await run(
      ["add", "Notes", "a.md", "--dir", root, "--title", "A note", "--desc", "why", "--tag", "x,y", "--type", "note"],
      io,
    );
    expect(code).toBe(0);
    const m = JSON.parse(await readFile(join(padDir, MANIFEST_NAME), "utf8"));
    expect(m.files).toHaveLength(1);
    expect(m.files[0]).toMatchObject({ path: "a.md", title: "A note", description: "why", tags: ["x", "y"], type: "note" });
  });

  test("add rejects invalid type", async () => {
    await seed();
    log = []; errs = [];
    expect(await run(["add", "Notes", "a.md", "--dir", root, "--type", "bogus"], io)).toBe(2);
    expect(allErr()).toContain("invalid --type");
  });

  test("add to existing path updates the entry", async () => {
    const padDir = await seed();
    await run(["add", "Notes", "a.md", "--dir", root, "--title", "first"], io);
    log = []; errs = [];
    await run(["add", "Notes", "a.md", "--dir", root, "--title", "second"], io);
    const m = JSON.parse(await readFile(join(padDir, MANIFEST_NAME), "utf8"));
    expect(m.files).toHaveLength(1);
    expect(m.files[0].title).toBe("second");
    expect(all()).toContain("updated");
  });

  test("ls with no pad lists pads under root", async () => {
    await seed();
    log = []; errs = [];
    expect(await run(["ls", "--dir", root], io)).toBe(0);
    expect(all()).toContain("Notes");
    expect(all()).toContain("PADS under");
  });

  test("ls <pad> lists registered files", async () => {
    await seed();
    await run(["add", "Notes", "a.md", "--dir", root, "--title", "A note", "--tag", "x"], io);
    log = []; errs = [];
    expect(await run(["ls", "Notes", "--dir", root], io)).toBe(0);
    expect(all()).toContain("a.md");
    expect(all()).toContain("A note");
    expect(all()).toContain("#x");
  });

  test("show <pad> prints manifest; show <pad> <file> prints content", async () => {
    await seed();
    await run(["add", "Notes", "a.md", "--dir", root, "--title", "A note"], io);
    log = []; errs = [];
    expect(await run(["show", "Notes", "--dir", root], io)).toBe(0);
    expect(all()).toContain('"name": "Notes"');
    log = []; errs = [];
    expect(await run(["show", "Notes", "a.md", "--dir", root], io)).toBe(0);
    expect(all()).toContain("# Hello");
    expect(all()).toContain("A note");
  });

  test("rm <pad> <file> unregisters but leaves file on disk", async () => {
    const padDir = await seed();
    await run(["add", "Notes", "a.md", "--dir", root], io);
    log = []; errs = [];
    expect(await run(["rm", "Notes", "a.md", "--dir", root], io)).toBe(0);
    const m = JSON.parse(await readFile(join(padDir, MANIFEST_NAME), "utf8"));
    expect(m.files).toHaveLength(0);
    expect(existsSync(join(padDir, "a.md"))).toBe(true); // file untouched
  });

  test("rm <pad> needs --force and then deletes the dir", async () => {
    const padDir = await seed();
    log = []; errs = [];
    expect(await run(["rm", "Notes", "--dir", root], io)).toBe(1);
    expect(allErr()).toContain("--force");
    expect(existsSync(padDir)).toBe(true);
    expect(await run(["rm", "Notes", "--dir", root, "--force"], io)).toBe(0);
    expect(existsSync(padDir)).toBe(false);
  });
});

describe("export", () => {
  async function seed() {
    await run(["new", "Notes", "--dir", root], io);
    const padDir = join(root, "notes");
    await writeFile(join(padDir, "a.md"), "# Hi\n\n```js\nconst x=1;\n```\n", "utf8");
    await run(["add", "Notes", "a.md", "--dir", root, "--title", "A"], io);
    return padDir;
  }

  test("writes an html file with content embedded + deps via CDN", async () => {
    await seed();
    log = []; errs = [];
    const out = join(root, "export.html");
    const code = await run(["export", "Notes", "--dir", root, "-o", out], io);
    expect(code).toBe(0);
    expect(existsSync(out)).toBe(true);
    const html = await readFile(out, "utf8");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("# Hi"); // file content embedded
    // hljs needed (code present) → loaded from CDN, not inlined.
    expect(html).toMatch(/<script src="https:\/\/cdnjs\.cloudflare\.com[^"]+highlight/);
    expect(all()).toContain("exported");
  });

  test("defaults output filename from pad name", async () => {
    await seed();
    log = []; errs = [];
    const prevCwd = process.cwd();
    process.chdir(root);
    try {
      expect(await run(["export", "Notes", "--dir", root], io)).toBe(0);
      expect(existsSync(join(root, "notes.html"))).toBe(true);
    } finally {
      process.chdir(prevCwd);
    }
  });

  test("missing pad exits 1", async () => {
    expect(await run(["export", "ghost", "--dir", root], io)).toBe(1);
  });
});

describe("errors", () => {
  test("unknown command exits 2", async () => {
    expect(await run(["frobnicate"], io)).toBe(2);
    expect(allErr()).toContain("unknown command");
  });
  test("ops on missing pad exit 1", async () => {
    expect(await run(["ls", "ghost", "--dir", root], io)).toBe(1);
    expect(await run(["show", "ghost", "--dir", root], io)).toBe(1);
    expect(await run(["add", "ghost", "f.md", "--dir", root], io)).toBe(1);
  });
});
