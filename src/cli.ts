#!/usr/bin/env bun
// scratch — CLI-first tool for organizing temporary agent knowledge into
// scratchpads (a folder + scratchpad.json manifest). Thin layer over the FS.

import { parseArgs } from "node:util";
import pkg from "../package.json" with { type: "json" };
import { cmdAdd, cmdExport, cmdLs, cmdNew, cmdRm, cmdShow, cmdUi, defaultIO, type IO } from "./commands.ts";

const HELP = `scratch — organize temporary agent knowledge into scratchpads (folder + manifest)

USAGE
  scratch new <name> --dir <parent> [--id <id>] [--force]
      Create <parent>/<slug>/ + manifest, then print an onboarding prompt.
      --dir is REQUIRED — placement is always deliberate (no assumed location).

  scratch add <pad> <file> [--title ..] [--desc ..] [--tag a,b] [--type note] [--group ..]
      Register an already-present file into the pad's manifest with metadata.
      --group <name> places the file under a named group header in the viewer.
      The CLI never copies/moves/authors content — you write the file, it tracks it.
      --link <file> [--as <label>]
          Link an EXTERNAL file (outside the pad) by reference. Its content stays
          where it is; --as sets the label shown in the pad (default: basename).

  scratch ls [<pad>] [--dir <root>]
      No <pad>: list pads found under root.  With <pad>: list its registered files.

  scratch show <pad> [<file>] [--dir <root>]
      No <file>: print the manifest.  With <file>: print metadata + file content.

  scratch rm <pad> [<file>] [--dir <root>] [--force]
      With <file>: unregister it (file on disk untouched).
      Without <file>: delete the whole pad dir (requires --force).

  scratch ui [<pad>] [--dir <root>] [--all] [--browser]
      Open the read-only visual viewer — glimpse native window, with an automatic
      browser+local-server fallback. --browser forces the browser path.
      With multiple pads under root, name one or pass --all to view them together.

  scratch export [<pad>] [--dir <root>] [--all] [-o <file>]
      Write the viewer to a single HTML file (file contents embedded; hljs/mermaid
      load from CDN), openable in any browser. Default out: <pad-name>.html.
      With multiple pads under root, name one or pass --all to merge them.

ADDRESSING
  A pad is a folder containing scratchpad.json; its path is its identity.
  Pads are referenced by name (resolved within the root) or by an explicit path.
  Root = --dir, else $SCRATCH_DIR, else current directory.

  -h, --help        Show this help.
  -v, --version     Show version.`;

const FLAG_SPEC = {
  dir: { type: "string" as const },
  id: { type: "string" as const },
  title: { type: "string" as const },
  desc: { type: "string" as const },
  tag: { type: "string" as const },
  type: { type: "string" as const },
  group: { type: "string" as const },
  link: { type: "boolean" as const },
  as: { type: "string" as const },
  force: { type: "boolean" as const },
  all: { type: "boolean" as const },
  browser: { type: "boolean" as const },
  out: { type: "string" as const, short: "o" },
  help: { type: "boolean" as const, short: "h" },
  version: { type: "boolean" as const, short: "v" },
};

export async function run(argv: string[], io: IO = defaultIO): Promise<number> {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof FLAG_SPEC; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: argv, options: FLAG_SPEC, allowPositionals: true, strict: true });
  } catch (e) {
    io.err(`error: ${(e as Error).message}`);
    return 2;
  }
  const { values: v, positionals } = parsed;

  if (v.version) {
    io.out(`scratch ${pkg.version}`);
    return 0;
  }
  const [cmd, ...rest] = positionals;
  if (!cmd || v.help) {
    io.out(HELP);
    return cmd ? 0 : v.help ? 0 : 0;
  }

  switch (cmd) {
    case "new":
      return cmdNew({ name: rest[0], dir: v.dir, id: v.id, force: v.force }, io);
    case "add":
      return cmdAdd(
        { pad: rest[0], file: rest[1], dir: v.dir, title: v.title, desc: v.desc, tag: v.tag, type: v.type, group: v.group, link: v.link, as: v.as },
        io,
      );
    case "ls":
      return cmdLs({ pad: rest[0], dir: v.dir }, io);
    case "show":
      return cmdShow({ pad: rest[0], file: rest[1], dir: v.dir }, io);
    case "rm":
      return cmdRm({ pad: rest[0], file: rest[1], dir: v.dir, force: v.force }, io);
    case "ui":
      return cmdUi({ pad: rest[0], dir: v.dir, all: v.all, browser: v.browser }, io);
    case "export":
      return cmdExport({ pad: rest[0], dir: v.dir, all: v.all, out: v.out }, io);
    default:
      io.err(`error: unknown command "${cmd}". run \`scratch --help\`.`);
      return 2;
  }
}

if (import.meta.main) {
  // Top-level await (not fire-and-forget .then): in a `bun build --compile`
  // standalone, top-level evaluation finishing lets Bun exit BEFORE the async
  // chain reaches Bun.serve / the glimpse host — so `ui` died silently. Awaiting
  // keeps the entry module pending while the long-running viewer holds the loop.
  process.exitCode = await run(process.argv.slice(2));
}
