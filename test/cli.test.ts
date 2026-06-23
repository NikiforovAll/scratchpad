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
    expect(await run(["new", "lonely-pad"], io)).toBe(2);
    expect(allErr()).toContain("--dir");
  });

  test("rejects names containing whitespace", async () => {
    expect(await run(["new", "My Pad", "--dir", root], io)).toBe(2);
    expect(allErr()).toContain("whitespace");
    expect(existsSync(join(root, "my-pad"))).toBe(false);
  });

  test("creates folder + manifest and prints onboarding", async () => {
    const code = await run(["new", "auth-refactor", "--dir", root, "--id", "sess123"], io);
    expect(code).toBe(0);
    const padDir = join(root, "auth-refactor");
    expect(existsSync(join(padDir, MANIFEST_NAME))).toBe(true);
    const m = JSON.parse(await readFile(join(padDir, MANIFEST_NAME), "utf8"));
    expect(m.version).toBe(1);
    expect(m.name).toBe("auth-refactor");
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

  test("add resolves a cwd-relative path that points inside the pad", async () => {
    const padDir = await seed(); // pad at <root>/notes, file a.md exists
    const prevCwd = process.cwd();
    process.chdir(root);
    try {
      log = []; errs = [];
      // Caller passes a cwd-relative path that already includes the pad prefix;
      // it must not be doubled to notes/notes/a.md.
      const code = await run(["add", "Notes", "notes/a.md", "--dir", root, "--title", "A"], io);
      expect(code).toBe(0);
      const m = JSON.parse(await readFile(join(padDir, MANIFEST_NAME), "utf8"));
      expect(m.files).toHaveLength(1);
      expect(m.files[0].path).toBe("a.md");
      expect(m.files[0].src).toBeUndefined(); // registered in-pad, not by reference
    } finally {
      process.chdir(prevCwd);
    }
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

  test("ls <pad> groups files under uppercased headers; ungrouped last", async () => {
    await seed();
    await writeFile(join(root, "notes", "b.md"), "x", "utf8");
    await run(["add", "Notes", "a.md", "--dir", root, "--group", "Findings"], io);
    await run(["add", "Notes", "b.md", "--dir", root], io); // ungrouped
    log = []; errs = [];
    expect(await run(["ls", "Notes", "--dir", root], io)).toBe(0);
    const out = all();
    expect(out).toContain("FINDINGS");
    expect(out).toContain("FILES"); // ungrouped header
    expect(out.indexOf("FINDINGS")).toBeLessThan(out.indexOf("FILES")); // named groups first
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

  test("ls --json (no pad) emits relative, forward-slashed paths", async () => {
    await seed();
    log = []; errs = [];
    expect(await run(["ls", "--dir", root, "--json"], io)).toBe(0);
    const out = JSON.parse(all());
    expect(out.root).not.toContain("\\");
    const pad = out.pads.find((p: any) => p.name === "Notes");
    expect(pad).toMatchObject({ name: "Notes", rel: "notes" });
    expect(typeof pad.files).toBe("number");
  });

  test("ls <pad> --json emits FileEntry shape under files", async () => {
    await seed();
    await run(["add", "Notes", "a.md", "--dir", root, "--title", "A note", "--tag", "x,y"], io);
    log = []; errs = [];
    expect(await run(["ls", "Notes", "--dir", root, "--json"], io)).toBe(0);
    const out = JSON.parse(all());
    expect(out.name).toBe("Notes");
    expect(out.rel.toLowerCase()).toBe("notes"); // case-insensitive FS: rel echoes query casing
    expect(out.files[0]).toMatchObject({ path: "a.md", title: "A note", tags: ["x", "y"] });
  });

  test("ls <pad> --json exposes created/updated timestamps", async () => {
    await seed();
    log = []; errs = [];
    expect(await run(["ls", "Notes", "--dir", root, "--json"], io)).toBe(0);
    const out = JSON.parse(all());
    expect(out.created).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(out.updated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("ls <pad> human output shows created/updated", async () => {
    await seed();
    log = []; errs = [];
    expect(await run(["ls", "Notes", "--dir", root], io)).toBe(0);
    expect(all()).toContain("created:");
    expect(all()).toContain("updated:");
  });

  test("CLI activity bumps updated but preserves created (manual edits don't count)", async () => {
    const padDir = await seed();
    const before = JSON.parse(await readFile(join(padDir, MANIFEST_NAME), "utf8"));
    await new Promise((r) => setTimeout(r, 1100)); // timestamps are second-resolution
    await run(["add", "Notes", "a.md", "--dir", root, "--title", "A"], io);
    const after = JSON.parse(await readFile(join(padDir, MANIFEST_NAME), "utf8"));
    expect(after.created).toBe(before.created); // creation time is stable
    expect(after.updated > before.updated).toBe(true); // activity advances it
  });

  test("show <file> --json returns {metadata, content}", async () => {
    await seed();
    await run(["add", "Notes", "a.md", "--dir", root, "--title", "A note"], io);
    log = []; errs = [];
    expect(await run(["show", "Notes", "a.md", "--dir", root, "--json"], io)).toBe(0);
    const out = JSON.parse(all());
    expect(out.metadata).toMatchObject({ path: "a.md", title: "A note" });
    expect(out.content).toContain("# Hello");
  });

  test("show <file> --json has null metadata for an unregistered file", async () => {
    await seed(); // a.md exists on disk but is never `add`ed
    log = []; errs = [];
    expect(await run(["show", "Notes", "a.md", "--dir", root, "--json"], io)).toBe(0);
    const out = JSON.parse(all());
    expect(out.metadata).toBeNull();
    expect(out.content).toContain("# Hello");
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

describe("comments", () => {
  // Seed a pad with two commented files so the filter has something to narrow.
  async function seed() {
    await run(["new", "Notes", "--dir", root], io);
    const padDir = join(root, "notes");
    const cmt = (quote: string, body: string) => ({
      id: quote, body, anchor: { quote, prefix: "", suffix: "" },
      created: "2026-06-12T00:00:00Z", updated: "2026-06-12T00:00:00Z",
    });
    await writeFile(join(padDir, "a.md"), "# A\n\nalpha line here\n", "utf8");
    await writeFile(join(padDir, "b.md"), "# B\n\nbeta line here\n", "utf8");
    const mPath = join(padDir, MANIFEST_NAME);
    const m = JSON.parse(await readFile(mPath, "utf8"));
    m.files = [
      { path: "a.md", comments: [cmt("alpha line here", "on A")] },
      { path: "b.md", comments: [cmt("beta line here", "on B")] },
    ];
    await writeFile(mPath, JSON.stringify(m), "utf8");
    return padDir;
  }

  test("no filter lists every commented file with its block context", async () => {
    await seed();
    log = []; errs = [];
    expect(await run(["comments", "Notes", "--dir", root, "--json"], io)).toBe(0);
    const out = JSON.parse(all());
    expect(out.comments.map((c: any) => c.file)).toEqual(["a.md", "b.md"]);
    const a = out.comments.find((c: any) => c.file === "a.md");
    expect(a).toMatchObject({ comment: "on A", quote: "alpha line here", matched: true, line: 3 });
    expect(a.context).toContain("alpha line here");
  });

  test("--file exact path narrows to one file", async () => {
    await seed();
    log = []; errs = [];
    expect(await run(["comments", "Notes", "--file", "b.md", "--dir", root, "--json"], io)).toBe(0);
    expect(JSON.parse(all()).comments.map((c: any) => c.file)).toEqual(["b.md"]);
  });

  test("--file glob matches by pattern", async () => {
    await seed();
    await writeFile(join(root, "notes", "c.txt"), "gamma\n", "utf8");
    const mPath = join(root, "notes", MANIFEST_NAME);
    const m = JSON.parse(await readFile(mPath, "utf8"));
    m.files.push({ path: "c.txt", comments: [{ id: "g", body: "on C", anchor: { quote: "gamma", prefix: "", suffix: "" }, created: "2026-06-12T00:00:00Z", updated: "2026-06-12T00:00:00Z" }] });
    await writeFile(mPath, JSON.stringify(m), "utf8");
    log = []; errs = [];
    expect(await run(["comments", "Notes", "--file", "*.md", "--dir", root, "--json"], io)).toBe(0);
    expect(JSON.parse(all()).comments.map((c: any) => c.file)).toEqual(["a.md", "b.md"]);
  });

  test("--file substring is case-insensitive", async () => {
    await seed();
    log = []; errs = [];
    expect(await run(["comments", "Notes", "--file", "B.MD", "--dir", root, "--json"], io)).toBe(0);
    expect(JSON.parse(all()).comments.map((c: any) => c.file)).toEqual(["b.md"]);
  });

  test("--file matching nothing reports it", async () => {
    await seed();
    log = []; errs = [];
    expect(await run(["comments", "Notes", "--file", "nope", "--dir", root], io)).toBe(0);
    expect(all()).toContain('no comments matching "nope"');
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
