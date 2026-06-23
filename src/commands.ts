// CLI command implementations. Each returns an exit code; all human-facing
// output goes through the writer passed in (testable, no direct console coupling).

import { existsSync } from "node:fs";
import { mkdir, readdir, rm as fsRm } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { bold, cyan, dim, fail, note, ok, warn } from "./colors.ts";
import { exportFileSlug, findPads, resolvePad, resolveRoot, slugify, validateName, type Pad } from "./discovery.ts";
import {
  DEFAULT_TYPE,
  hasManifest,
  isFileType,
  manifestPath,
  newManifest,
  readManifest,
  writeManifest,
  type FileEntry,
  type FileType,
} from "./manifest.ts";

export interface IO {
  out: (s: string) => void;
  err: (s: string) => void;
}

export const defaultIO: IO = {
  out: (s) => process.stdout.write(s + "\n"),
  err: (s) => process.stderr.write(s + "\n"),
};

/** Forward-slash a path — portable + safe across Git Bash, where backslashes and
 * drive letters get mangled. */
const toPosix = (p: string) => p.split("\\").join("/");

/** Emit a value as pretty JSON on one logical write (the shape `show <pad>` uses). */
const emitJson = (io: IO, value: unknown) => io.out(JSON.stringify(value, null, 2));

/** scratch new <name> --dir <parent> [--id] [--force] */
export async function cmdNew(
  args: { name?: string; dir?: string; id?: string; force?: boolean },
  io: IO,
): Promise<number> {
  if (!args.name) {
    fail(io, "`new` requires a <name>.\n  usage: scratch new <name> --dir <parent> [--id <id>]");
    return 2;
  }
  const nameErr = validateName(args.name);
  if (nameErr) {
    fail(io, nameErr);
    return 2;
  }
  if (!args.dir) {
    fail(
      io,
      "`new` requires an explicit --dir <parent>. Placement is always deliberate;\n" +
        `       there is no assumed location. e.g. scratch new ${slugify(args.name)} --dir _plans`,
    );
    return 2;
  }
  const parent = resolve(args.dir);
  const slug = slugify(args.name);
  const padDir = join(parent, slug);

  if (await hasManifest(padDir)) {
    if (!args.force) {
      fail(
        io,
        `a scratchpad already exists at ${padDir}\n       use --force to adopt/overwrite its manifest.`,
      );
      return 1;
    }
  }
  await mkdir(padDir, { recursive: true });
  const m = newManifest(args.name, args.id);
  await writeManifest(padDir, m);
  printOnboarding(padDir, m.name, io);
  return 0;
}

function printOnboarding(padDir: string, name: string, io: IO): void {
  ok(io, `scratchpad "${bold(name)}" ready`);
  io.out("");
  io.out(`  ${dim("pad dir   :")} ${padDir}`);
  io.out(`  ${dim("manifest  :")} ${manifestPath(padDir)}`);
  io.out("");
  io.out(bold("How to use this scratchpad:"));
  io.out(`  1. Write files directly into the pad dir using your normal tools.`);
  io.out(`  2. Register each file so it gets metadata + shows in the viewer:`);
  io.out(cyan(`       scratch add "${name}" <file> --title "..." --desc "why it exists" --type note --tag a,b`));
  io.out(dim(`       --type ∈ {note, snippet, output, artifact, reference} (default note); --desc is the most useful field.`));
  io.out(`  3. Inspect:  ${cyan(`scratch ls "${name}"`)}   ·   ${cyan(`scratch show "${name}" <file>`)}`);
  io.out(`  4. Browse :  ${cyan(`scratch ui "${name}"`)}   ${dim("(markdown, code highlight, mermaid; read-only)")}`);
  io.out("");
  io.out(dim("The CLI never authors or moves content — you own the files; it tracks metadata."));
}

/** scratch add <pad> <file> [--title --desc --tag --type] */
export async function cmdAdd(
  args: {
    pad?: string;
    file?: string;
    dir?: string;
    title?: string;
    desc?: string;
    tag?: string;
    type?: string;
    group?: string;
    link?: boolean;
    as?: string;
  },
  io: IO,
): Promise<number> {
  if (!args.pad || !args.file) {
    fail(io, "usage: scratch add <pad> <file> [--title .. --desc .. --tag a,b --type note --group ..] [--link [--as <label>]]");
    return 2;
  }
  const root = resolveRoot(args.dir);
  const pad = await resolvePad(args.pad, root);
  if (!pad) {
    fail(io, `no scratchpad "${args.pad}" found under ${root}`);
    return 1;
  }
  if (args.type && !isFileType(args.type)) {
    fail(io, `invalid --type "${args.type}". one of: note snippet output artifact reference`);
    return 2;
  }

  const m = pad.manifest;
  // In-pad files are relative to the pad dir (you write them there); a --link
  // target is an external path, so a relative one is resolved against the cwd.
  let abs: string;
  if (isAbsolute(args.file)) {
    abs = resolve(args.file);
  } else if (args.link) {
    abs = resolve(process.cwd(), args.file);
  } else {
    // In-pad files are pad-relative by contract, but callers often pass a
    // cwd/repo-root-relative path that already points inside the pad (e.g.
    // "_plans/foo/bar.md" from the repo root) — resolving that against pad.dir
    // doubles the prefix. Keep pad-relative as the contract; fall back to
    // cwd-relative only when the pad-relative path doesn't exist.
    const fromPad = resolve(pad.dir, args.file);
    const fromCwd = resolve(process.cwd(), args.file);
    abs = !existsSync(fromPad) && existsSync(fromCwd) ? fromCwd : fromPad;
  }
  let rel = toPosix(relative(pad.dir, abs));
  const inside = !(rel.startsWith("..") || isAbsolute(rel));

  // --link (or any out-of-pad target): register the file by REFERENCE. Its
  // content stays put; `path` is just a label inside the pad and `src` points at
  // the real location (relative to the pad when possible, else absolute — both
  // portable forms the reader resolves later).
  const entry: FileEntry = { path: rel };
  if (args.link || !inside) {
    if (!args.link) {
      note(io, `${abs} is outside the pad; linking by reference (same as --link).`);
    }
    const label = toPosix(args.as ?? basename(abs)).replace(/^\/+/, "");
    let src = toPosix(relative(pad.dir, abs));
    if (!src || isAbsolute(src)) src = toPosix(abs);
    entry.path = label;
    entry.src = src;
    rel = label;
  } else if (args.as) {
    note(io, "--as is only meaningful with --link; ignoring for an in-pad file.");
  }

  if (!existsSync(abs)) {
    warn(io, `${abs} does not exist yet — registering anyway (write it before viewing).`);
  }

  if (args.title) entry.title = args.title;
  if (args.desc) entry.description = args.desc;
  if (args.tag) entry.tags = args.tag.split(",").map((t) => t.trim()).filter(Boolean);
  if (args.group) entry.group = args.group.trim();
  entry.type = (args.type as FileType) ?? DEFAULT_TYPE;

  const idx = m.files.findIndex((f) => f.path === rel);
  const linked = entry.src ? dim(` → ${entry.src}`) : "";
  if (idx >= 0) {
    m.files[idx] = { ...m.files[idx], ...entry };
    ok(io, `updated "${bold(rel)}"${linked} in ${m.name}`);
  } else {
    m.files.push(entry);
    ok(io, `${entry.src ? "linked" : "registered"} "${bold(rel)}"${linked} in ${m.name}`);
  }
  await writeManifest(pad.dir, m);
  return 0;
}

/** scratch ls [<pad>] [--dir <root>] [--json] */
export async function cmdLs(args: { pad?: string; dir?: string; json?: boolean }, io: IO): Promise<number> {
  const root = resolveRoot(args.dir);
  // Relative to root — portable, never absolute (consumed by the fzf wrapper
  // through Git Bash, where backslashes/drive letters get mangled).
  const relOf = (dir: string) => toPosix(relative(root, dir)) || ".";
  if (!args.pad) {
    const pads = await findPads(root);
    if (args.json) {
      emitJson(io, {
        root: toPosix(root),
        pads: pads.map((p) => ({ name: p.manifest.name, rel: relOf(p.dir), files: p.manifest.files.length, created: p.manifest.created, updated: p.manifest.updated })),
      });
      return 0;
    }
    if (pads.length === 0) {
      io.out(`no scratchpads found under ${root}`);
      io.out(`create one:  ${cyan("scratch new <name> --dir <parent>")}`);
      return 0;
    }
    io.out(`${bold("PADS")} under ${root}`);
    for (const p of pads) {
      io.out(`  ${bold(p.manifest.name)}  ${dim(`(${p.manifest.files.length} files)`)}  ${cyan(relOf(p.dir))}  ${dim(`· updated ${p.manifest.updated}`)}`);
    }
    return 0;
  }
  const pad = await resolvePad(args.pad, root);
  if (!pad) {
    fail(io, `no scratchpad "${args.pad}" found under ${root}`);
    return 1;
  }
  const m = pad.manifest;
  if (args.json) {
    emitJson(io, { name: m.name, id: m.id, rel: relOf(pad.dir), created: m.created, updated: m.updated, files: m.files });
    return 0;
  }
  io.out(`${bold(m.name)}  ${m.id ? dim("(" + m.id + ")") + "  " : ""}— ${m.files.length} registered file(s)`);
  io.out(dim(`  dir: ${pad.dir}`));
  io.out(dim(`  created: ${m.created}  ·  updated: ${m.updated}`));
  if (m.files.length === 0) {
    io.out("  (no files registered yet)");
  }
  // Group by the `group` field under uppercased headers, mirroring the viewer's
  // sidebar: the Map preserves first-appearance order of both groups and files
  // within each; ungrouped files share the '' key, shown under a "FILES" header.
  const groups = new Map<string, typeof m.files>();
  for (const f of m.files) {
    const g = f.group ?? "";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(f);
  }
  for (const [g, files] of groups) {
    io.out("");
    io.out(`  ${bold((g || "FILES").toUpperCase())}`);
    for (const f of files) {
      const meta = [f.type ?? DEFAULT_TYPE, ...(f.tags ?? []).map((t) => "#" + t)].join(" ");
      const link = f.src ? cyan(`  → ${f.src}`) : "";
      io.out(`    ${f.path}${f.title ? dim("  — " + f.title) : ""}  ${dim(`[${meta}]`)}${link}`);
    }
  }
  return 0;
}

/** scratch show <pad> [<file>] [--dir <root>] */
export async function cmdShow(
  args: { pad?: string; file?: string; dir?: string; json?: boolean },
  io: IO,
): Promise<number> {
  if (!args.pad) {
    fail(io, "usage: scratch show <pad> [<file>]");
    return 2;
  }
  const root = resolveRoot(args.dir);
  const pad = await resolvePad(args.pad, root);
  if (!pad) {
    fail(io, `no scratchpad "${args.pad}" found under ${root}`);
    return 1;
  }
  const m = pad.manifest;
  if (!args.file) {
    emitJson(io, m);
    return 0;
  }
  const wanted = toPosix(args.file);
  const entry = m.files.find((f) => f.path === args.file || f.path === wanted);
  // A linked entry's content lives at `src` (outside the pad); otherwise it's at path under the pad dir.
  const abs = entry?.src
    ? (isAbsolute(entry.src) ? entry.src : resolve(pad.dir, entry.src))
    : isAbsolute(args.file)
      ? args.file
      : join(pad.dir, args.file);
  if (!existsSync(abs)) {
    fail(io, `file not found on disk: ${abs}`);
    return 1;
  }
  const content = await Bun.file(abs).text();
  if (args.json) {
    emitJson(io, { metadata: entry ?? null, content });
    return 0;
  }
  if (entry) {
    io.out(bold(`# ${entry.title ?? entry.path}`));
    io.out(dim(`path: ${entry.path}  ·  type: ${entry.type ?? DEFAULT_TYPE}${entry.group ? "  ·  group: " + entry.group : ""}${entry.src ? "  ·  linked → " + entry.src : ""}`));
    if (entry.tags?.length) io.out(dim(`tags: ${entry.tags.map((t) => "#" + t).join(" ")}`));
    if (entry.description) io.out(dim(`desc: ${entry.description}`));
    io.out("");
  }
  io.out(content);
  return 0;
}

/** scratch comments <pad> [<file>] [--dir <root>] [--json] — read inline comments
 * with the markdown section each one anchors to, so an agent can act on them. */
export async function cmdComments(
  args: { pad?: string; file?: string; dir?: string; json?: boolean },
  io: IO,
): Promise<number> {
  if (!args.pad) {
    fail(io, "usage: scratch comments <pad> [<file>] [--json]");
    return 2;
  }
  const { buildIndex, locateComment } = await import("./comments.ts");
  const root = resolveRoot(args.dir);
  const pad = await resolvePad(args.pad, root);
  if (!pad) {
    fail(io, `no scratchpad "${args.pad}" found under ${root}`);
    return 1;
  }
  const m = pad.manifest;
  // Optional file filter: exact path, glob (`*.md`, `**/x`), or case-insensitive
  // substring — whichever the arg looks like. Absent = every commented file.
  const filter = args.file ? toPosix(args.file) : null;
  const matches = (path: string) => {
    if (!filter) return true;
    if (path === filter) return true;
    if (/[*?[\]{}]/.test(filter)) return new Bun.Glob(filter).match(path);
    return path.toLowerCase().includes(filter.toLowerCase());
  };
  // Files carrying comments (optionally narrowed by the filter), in manifest order.
  const entries = m.files.filter((f) => f.comments?.length && matches(f.path));

  // Resolve content the same way `show` does (linked files live at `src`), locate
  // each comment's quote in the source, and flatten into one agent-friendly list:
  // each item is self-contained (file + what the human said + the editable block).
  type Item = {
    id: string;
    file: string;
    comment: string;
    quote: string;
    matched: boolean;
    line: number | null;
    section_heading: string | null;
    context: string | null;
    context_lines: string | null;
  };
  const items: Item[] = [];
  for (const f of entries) {
    const abs = f.src ? (isAbsolute(f.src) ? f.src : resolve(pad.dir, f.src)) : join(pad.dir, f.path);
    const source = existsSync(abs) ? await Bun.file(abs).text() : "";
    const index = buildIndex(source); // parse the file once, reuse for all its comments
    for (const c of f.comments ?? []) {
      const r = locateComment(index, c);
      items.push({
        id: c.id,
        file: f.path,
        comment: c.body,
        quote: c.anchor.quote.replace(/\s+/g, " ").trim(),
        matched: r.matched,
        line: r.line,
        section_heading: r.heading,
        context: r.context,
        context_lines: r.contextLines ? `${r.contextLines[0]}-${r.contextLines[1]}` : null,
      });
    }
  }

  if (args.json) {
    emitJson(io, { pad: m.name, comments: items });
    return 0;
  }

  if (items.length === 0) {
    io.out(filter ? `no comments matching "${filter}" in ${m.name}` : `no comments in ${m.name}`);
    return 0;
  }
  io.out(`${bold("COMMENTS")} in ${bold(m.name)} ${dim(`(${items.length})`)}`);
  let lastFile = "";
  for (const it of items) {
    if (it.file !== lastFile) {
      io.out("");
      io.out(bold(it.file));
      lastFile = it.file;
    }
    const where = it.matched
      ? `${it.file}:${it.line}${it.section_heading ? " · § " + it.section_heading : ""}`
      : "orphaned — quote not found in source";
    io.out("");
    io.out(`  ${cyan("▸")} ${it.comment}`);
    io.out(`    ${dim(`@ "${it.quote.length > 70 ? it.quote.slice(0, 70) + "…" : it.quote}"  [${where}]`)}`);
    if (it.context) {
      io.out(dim(`    ─ context L${it.context_lines} ─`));
      for (const ln of it.context.split("\n")) io.out(dim(`    │ ${ln}`));
    }
  }
  return 0;
}

/** scratch rm <pad> [<file>] [--dir <root>] [--force] */
export async function cmdRm(
  args: { pad?: string; file?: string; dir?: string; force?: boolean },
  io: IO,
): Promise<number> {
  if (!args.pad) {
    fail(io, "usage: scratch rm <pad> [<file>] [--force]");
    return 2;
  }
  const root = resolveRoot(args.dir);
  const pad = await resolvePad(args.pad, root);
  if (!pad) {
    fail(io, `no scratchpad "${args.pad}" found under ${root}`);
    return 1;
  }
  const m = pad.manifest;

  if (args.file) {
    const rel = toPosix(args.file);
    const idx = m.files.findIndex((f) => f.path === rel || f.path === args.file);
    if (idx < 0) {
      fail(io, `"${args.file}" is not registered in ${m.name}`);
      return 1;
    }
    m.files.splice(idx, 1);
    await writeManifest(pad.dir, m);
    ok(io, `unregistered "${bold(rel)}" from ${m.name} ${dim("(file on disk left untouched)")}`);
    return 0;
  }

  // Removing a whole pad deletes the directory — guard behind --force.
  if (!args.force) {
    fail(
      io,
      `removing pad "${m.name}" will delete ${pad.dir} and all its files.\n       re-run with --force to confirm.`,
    );
    return 1;
  }
  await fsRm(pad.dir, { recursive: true, force: true });
  ok(io, `removed scratchpad "${bold(m.name)}" ${dim(`(${pad.dir})`)}`);
  return 0;
}

/** Resolve which pad(s) a viewer command targets. Returns null after emitting an
 * error (the caller returns 1). A single pad is auto-selected; when several pads
 * exist and none is named, the user must pick one — or pass --all to merge them
 * into one combined view. */
async function selectPads(
  args: { pad?: string; all?: boolean; dir?: string },
  root: string,
  io: IO,
  verb: string,
): Promise<{ pads: Pad[]; label: string; defaultName: string } | null> {
  if (args.pad) {
    const pad = await resolvePad(args.pad, root);
    if (!pad) {
      fail(io, `no scratchpad "${args.pad}" found under ${root}`);
      return null;
    }
    return { pads: [pad], label: pad.manifest.name, defaultName: exportFileSlug(pad.manifest.name, root) };
  }
  const pads = await findPads(root);
  if (pads.length === 0) {
    fail(io, `no scratchpads found under ${root}`);
    io.err(`create one:  ${cyan("scratch new <name> --dir <parent>")}`);
    return null;
  }
  if (pads.length === 1) {
    const pad = pads[0]!;
    return { pads: [pad], label: pad.manifest.name, defaultName: exportFileSlug(pad.manifest.name, root) };
  }
  if (!args.all) {
    fail(io, `${pads.length} scratchpads found under ${root}; name one, or pass --all to view them together:`);
    for (const p of pads) {
      const rel = toPosix(relative(root, p.dir)) || ".";
      const name = /\s/.test(p.manifest.name) ? `'${p.manifest.name}'` : p.manifest.name;
      io.err(`  ${cyan(`scratch ${verb} ${name}`)}    ${dim(`(${rel})`)}`);
    }
    return null;
  }
  return { pads, label: root, defaultName: exportFileSlug(null, root) };
}

/** scratch ui [<pad>] [--dir <root>] [--all] [--browser] [--install-native] — read-only visual viewer. */
export async function cmdUi(
  args: { pad?: string; dir?: string; all?: boolean; browser?: boolean; installNative?: boolean },
  io: IO,
): Promise<number> {
  const { launchViewer } = await import("./ui/launch.ts");
  const { loadConfig } = await import("./config.ts");
  const cfg = await loadConfig();
  const root = resolveRoot(args.dir);
  const sel = await selectPads(args, root, io, "ui");
  if (!sel) return 1;
  return launchViewer(sel.pads, sel.label, io, {
    title: `scratch · ${sel.label}`,
    forceBrowser: args.browser,
    installNative: args.installNative,
    frameless: cfg.ui.frameless,
  });
}

/** scratch export [<pad>] [--dir <root>] [--all] [-o/--out <file>] [--offline] — write self-contained HTML. */
export async function cmdExport(
  args: { pad?: string; dir?: string; all?: boolean; out?: string; offline?: boolean },
  io: IO,
): Promise<number> {
  const { buildView, renderHtml } = await import("./ui/render.ts");
  const { loadConfig } = await import("./config.ts");
  const root = resolveRoot(args.dir);
  const sel = await selectPads(args, root, io, "export");
  if (!sel) return 1;

  // File contents are embedded. Online (default): hljs/mermaid/katex load from the
  // pinned CDN (needs network, degrades gracefully). --offline: those libs are
  // inlined from the build cache so the page needs NO network (air-gapped sandbox).
  // The exporter's saved theme is baked in; the exported file's own settings panel
  // falls back to localStorage (no host listening to write config).
  const view = await buildView(sel.pads);
  const cfg = await loadConfig();
  let html: string;
  try {
    html = await renderHtml(view, sel.label, cfg.ui, { exportMode: true, offline: args.offline });
  } catch (e) {
    if (args.offline) {
      fail(io, "offline export needs the vendor cache — run `bun run vendor` first.");
      return 1;
    }
    throw e;
  }
  const outPath = resolve(args.out ?? `${sel.defaultName}.html`);
  await Bun.write(outPath, html);
  ok(io, `exported ${bold(sel.label)} → ${cyan(outPath)}`);
  const via = args.offline ? "fully self-contained, no network" : "hljs/mermaid via CDN";
  io.out(dim(`  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB; open it in any browser (${via}).`));
  io.out(dim(`  comments added in the page persist via its Save-a-copy button.`));
  return 0;
}
