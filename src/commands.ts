// CLI command implementations. Each returns an exit code; all human-facing
// output goes through the writer passed in (testable, no direct console coupling).

import { existsSync } from "node:fs";
import { mkdir, readdir, rm as fsRm } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { findPads, resolvePad, resolveRoot, slugify } from "./discovery.ts";
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

/** scratch new <name> --dir <parent> [--id] [--force] */
export async function cmdNew(
  args: { name?: string; dir?: string; id?: string; force?: boolean },
  io: IO,
): Promise<number> {
  if (!args.name) {
    io.err("error: `new` requires a <name>.\n  usage: scratch new <name> --dir <parent> [--id <id>]");
    return 2;
  }
  if (!args.dir) {
    io.err(
      "error: `new` requires an explicit --dir <parent>. Placement is always deliberate;\n" +
        "       there is no assumed location. e.g. scratch new \"" +
        args.name +
        '" --dir _plans',
    );
    return 2;
  }
  const parent = resolve(args.dir);
  const slug = slugify(args.name);
  const padDir = join(parent, slug);

  if (await hasManifest(padDir)) {
    if (!args.force) {
      io.err(
        `error: a scratchpad already exists at ${padDir}\n       use --force to adopt/overwrite its manifest.`,
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
  io.out(`✓ scratchpad "${name}" ready`);
  io.out("");
  io.out(`  pad dir   : ${padDir}`);
  io.out(`  manifest  : ${manifestPath(padDir)}`);
  io.out("");
  io.out("How to use this scratchpad:");
  io.out(`  1. Write files directly into the pad dir using your normal tools.`);
  io.out(`  2. Register each file so it gets metadata + shows in the viewer:`);
  io.out(`       scratch add "${name}" <file> --title "..." --desc "why it exists" --type note --tag a,b`);
  io.out(`       --type ∈ {note, snippet, output, artifact, reference} (default note); --desc is the most useful field.`);
  io.out(`  3. Inspect:  scratch ls "${name}"   ·   scratch show "${name}" <file>`);
  io.out(`  4. Browse :  scratch ui "${name}"   (markdown, code highlight, mermaid; read-only)`);
  io.out("");
  io.out("The CLI never authors or moves content — you own the files; it tracks metadata.");
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
    link?: boolean;
    as?: string;
  },
  io: IO,
): Promise<number> {
  if (!args.pad || !args.file) {
    io.err("error: usage: scratch add <pad> <file> [--title .. --desc .. --tag a,b --type note] [--link [--as <label>]]");
    return 2;
  }
  const root = resolveRoot(args.dir);
  const pad = await resolvePad(args.pad, root);
  if (!pad) {
    io.err(`error: no scratchpad "${args.pad}" found under ${root}`);
    return 1;
  }
  if (args.type && !isFileType(args.type)) {
    io.err(`error: invalid --type "${args.type}". one of: note snippet output artifact reference`);
    return 2;
  }

  const m = pad.manifest;
  // In-pad files are relative to the pad dir (you write them there); a --link
  // target is an external path, so a relative one is resolved against the cwd.
  const abs = isAbsolute(args.file)
    ? resolve(args.file)
    : resolve(args.link ? process.cwd() : pad.dir, args.file);
  let rel = relative(pad.dir, abs).split("\\").join("/");
  const inside = !(rel.startsWith("..") || isAbsolute(rel));

  // --link (or any out-of-pad target): register the file by REFERENCE. Its
  // content stays put; `path` is just a label inside the pad and `src` points at
  // the real location (relative to the pad when possible, else absolute — both
  // portable forms the reader resolves later).
  const entry: FileEntry = { path: rel };
  if (args.link || !inside) {
    if (!args.link) {
      io.err(`note: ${abs} is outside the pad; linking by reference (same as --link).`);
    }
    const label = (args.as ?? basename(abs)).split("\\").join("/").replace(/^\/+/, "");
    let src = relative(pad.dir, abs).split("\\").join("/");
    if (!src || isAbsolute(src)) src = abs.split("\\").join("/");
    entry.path = label;
    entry.src = src;
    rel = label;
  } else if (args.as) {
    io.err("note: --as is only meaningful with --link; ignoring for an in-pad file.");
  }

  if (!existsSync(abs)) {
    io.err(`warning: ${abs} does not exist yet — registering anyway (write it before viewing).`);
  }

  if (args.title) entry.title = args.title;
  if (args.desc) entry.description = args.desc;
  if (args.tag) entry.tags = args.tag.split(",").map((t) => t.trim()).filter(Boolean);
  entry.type = (args.type as FileType) ?? DEFAULT_TYPE;

  const idx = m.files.findIndex((f) => f.path === rel);
  const linked = entry.src ? ` → ${entry.src}` : "";
  if (idx >= 0) {
    m.files[idx] = { ...m.files[idx], ...entry };
    io.out(`✓ updated "${rel}"${linked} in ${m.name}`);
  } else {
    m.files.push(entry);
    io.out(`✓ ${entry.src ? "linked" : "registered"} "${rel}"${linked} in ${m.name}`);
  }
  await writeManifest(pad.dir, m);
  return 0;
}

/** scratch ls [<pad>] [--dir <root>] */
export async function cmdLs(args: { pad?: string; dir?: string }, io: IO): Promise<number> {
  const root = resolveRoot(args.dir);
  if (!args.pad) {
    const pads = await findPads(root);
    if (pads.length === 0) {
      io.out(`no scratchpads found under ${root}`);
      io.out(`create one:  scratch new <name> --dir <parent>`);
      return 0;
    }
    io.out(`PADS under ${root}`);
    for (const p of pads) {
      const rel = relative(root, p.dir).split("\\").join("/") || ".";
      io.out(`  ${p.manifest.name}  (${p.manifest.files.length} files)  ${rel}`);
    }
    return 0;
  }
  const pad = await resolvePad(args.pad, root);
  if (!pad) {
    io.err(`error: no scratchpad "${args.pad}" found under ${root}`);
    return 1;
  }
  const m = pad.manifest;
  io.out(`${m.name}  ${m.id ? "(" + m.id + ")  " : ""}— ${m.files.length} registered file(s)`);
  io.out(`  dir: ${pad.dir}`);
  if (m.files.length === 0) {
    io.out("  (no files registered yet)");
  }
  for (const f of m.files) {
    const meta = [f.type ?? DEFAULT_TYPE, ...(f.tags ?? []).map((t) => "#" + t)].join(" ");
    const link = f.src ? `  → ${f.src}` : "";
    io.out(`  ${f.path}${f.title ? "  — " + f.title : ""}  [${meta}]${link}`);
  }
  return 0;
}

/** scratch show <pad> [<file>] [--dir <root>] */
export async function cmdShow(
  args: { pad?: string; file?: string; dir?: string },
  io: IO,
): Promise<number> {
  if (!args.pad) {
    io.err("error: usage: scratch show <pad> [<file>]");
    return 2;
  }
  const root = resolveRoot(args.dir);
  const pad = await resolvePad(args.pad, root);
  if (!pad) {
    io.err(`error: no scratchpad "${args.pad}" found under ${root}`);
    return 1;
  }
  const m = pad.manifest;
  if (!args.file) {
    io.out(JSON.stringify(m, null, 2));
    return 0;
  }
  const entry = m.files.find((f) => f.path === args.file || f.path === args.file?.split("\\").join("/"));
  // A linked entry's content lives at `src` (outside the pad); otherwise it's at path under the pad dir.
  const abs = entry?.src
    ? (isAbsolute(entry.src) ? entry.src : resolve(pad.dir, entry.src))
    : isAbsolute(args.file)
      ? args.file
      : join(pad.dir, args.file);
  if (entry) {
    io.out(`# ${entry.title ?? entry.path}`);
    io.out(`path: ${entry.path}  ·  type: ${entry.type ?? DEFAULT_TYPE}${entry.src ? "  ·  linked → " + entry.src : ""}`);
    if (entry.tags?.length) io.out(`tags: ${entry.tags.map((t) => "#" + t).join(" ")}`);
    if (entry.description) io.out(`desc: ${entry.description}`);
    io.out("");
  }
  if (!existsSync(abs)) {
    io.err(`error: file not found on disk: ${abs}`);
    return 1;
  }
  io.out(await Bun.file(abs).text());
  return 0;
}

/** scratch rm <pad> [<file>] [--dir <root>] [--force] */
export async function cmdRm(
  args: { pad?: string; file?: string; dir?: string; force?: boolean },
  io: IO,
): Promise<number> {
  if (!args.pad) {
    io.err("error: usage: scratch rm <pad> [<file>] [--force]");
    return 2;
  }
  const root = resolveRoot(args.dir);
  const pad = await resolvePad(args.pad, root);
  if (!pad) {
    io.err(`error: no scratchpad "${args.pad}" found under ${root}`);
    return 1;
  }
  const m = pad.manifest;

  if (args.file) {
    const rel = args.file.split("\\").join("/");
    const idx = m.files.findIndex((f) => f.path === rel || f.path === args.file);
    if (idx < 0) {
      io.err(`error: "${args.file}" is not registered in ${m.name}`);
      return 1;
    }
    m.files.splice(idx, 1);
    await writeManifest(pad.dir, m);
    io.out(`✓ unregistered "${rel}" from ${m.name} (file on disk left untouched)`);
    return 0;
  }

  // Removing a whole pad deletes the directory — guard behind --force.
  if (!args.force) {
    io.err(
      `error: removing pad "${m.name}" will delete ${pad.dir} and all its files.\n       re-run with --force to confirm.`,
    );
    return 1;
  }
  await fsRm(pad.dir, { recursive: true, force: true });
  io.out(`✓ removed scratchpad "${m.name}" (${pad.dir})`);
  return 0;
}

/** scratch ui [<pad>] [--dir <root>] [--browser] — read-only visual viewer. */
export async function cmdUi(
  args: { pad?: string; dir?: string; browser?: boolean },
  io: IO,
): Promise<number> {
  const { launchViewer } = await import("./ui/launch.ts");
  const { loadConfig } = await import("./config.ts");
  const cfg = await loadConfig();
  const root = resolveRoot(args.dir);
  if (args.pad) {
    const pad = await resolvePad(args.pad, root);
    if (!pad) {
      io.err(`error: no scratchpad "${args.pad}" found under ${root}`);
      return 1;
    }
    return launchViewer([pad], pad.manifest.name, io, {
      title: `scratch · ${pad.manifest.name}`,
      forceBrowser: args.browser,
      frameless: cfg.ui.frameless,
    });
  }
  const pads = await findPads(root);
  if (pads.length === 0) {
    io.err(`error: no scratchpads found under ${root}`);
    io.err(`create one:  scratch new <name> --dir <parent>`);
    return 1;
  }
  return launchViewer(pads, root, io, {
    title: `scratch · ${root}`,
    forceBrowser: args.browser,
    frameless: cfg.ui.frameless,
  });
}

/** scratch export [<pad>] [--dir <root>] [-o/--out <file>] — write self-contained HTML. */
export async function cmdExport(
  args: { pad?: string; dir?: string; out?: string },
  io: IO,
): Promise<number> {
  const { buildView, renderHtml } = await import("./ui/render.ts");
  const root = resolveRoot(args.dir);

  let pads: Awaited<ReturnType<typeof findPads>>;
  let label: string;
  let defaultName: string;
  if (args.pad) {
    const pad = await resolvePad(args.pad, root);
    if (!pad) {
      io.err(`error: no scratchpad "${args.pad}" found under ${root}`);
      return 1;
    }
    pads = [pad];
    label = pad.manifest.name;
    defaultName = slugify(pad.manifest.name);
  } else {
    pads = await findPads(root);
    if (pads.length === 0) {
      io.err(`error: no scratchpads found under ${root}`);
      io.err(`create one:  scratch new <name> --dir <parent>`);
      return 1;
    }
    label = root;
    defaultName = slugify(basename(root)) || "scratchpads";
  }

  // INLINE vendoring → fully offline, opens in any browser with no network.
  const view = await buildView(pads);
  const html = await renderHtml(view, label, { vendoring: "inline" });
  const outPath = resolve(args.out ?? `${defaultName}.html`);
  await Bun.write(outPath, html);
  io.out(`✓ exported ${label} → ${outPath}`);
  io.out(`  self-contained (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB); open it in any browser.`);
  return 0;
}
