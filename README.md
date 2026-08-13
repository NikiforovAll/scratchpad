# scratch

[![npm version](https://img.shields.io/npm/v/@nikiforovall/scratchpad.svg)](https://www.npmjs.com/package/@nikiforovall/scratchpad)
[![npm downloads](https://img.shields.io/npm/dm/@nikiforovall/scratchpad.svg)](https://www.npmjs.com/package/@nikiforovall/scratchpad)
[![license](https://img.shields.io/github/license/nikiforovall/scratchpad.svg)](LICENSE)
[![docs](https://img.shields.io/badge/docs-nikiforovall.blog%2Fscratchpad-e86f33.svg)](https://nikiforovall.blog/scratchpad/)

CLI-first tool to organize **agent knowledge** into *scratchpads* — a folder of files plus a `scratchpad.json` manifest — with a read-only visual viewer (native window, browser fallback).

📖 **[Documentation →](https://nikiforovall.blog/scratchpad/)** · 🔭 **[Live demo →](https://nikiforovall.blog/scratchpad/demo)** — a feature-tour pad where every file demonstrates one feature.

A scratchpad is **just a folder containing `scratchpad.json`**; the folder path is its identity. There is **no central store**. `scratch` is a thin metadata layer over the filesystem: it initializes pads, prints how to use them, and registers files you create. You write/edit files with your normal tools — the CLI never authors, copies, or moves content.

## Why

Agents generate a lot of knowledge per session — notes, snippets, command output, intermediate artifacts — and it has no home. It ends up scattered across the repo, buried in chat history, or lost when the context window rolls over.

A scratchpad gives that working memory a deliberate place: a folder + `scratchpad.json` manifest, kept out of your source tree, that captures **what** each file is and **why** it exists.

- **Durable, inspectable agent memory.** The agent writes files and registers them with a `--desc`/`--type`; the knowledge survives the session and stays reviewable.
- **A human can browse it.** `scratch ui` opens a read-only viewer (markdown, code highlighting, mermaid, math) so you can see what the agent gathered — no digging through transcripts.
- **A feedback loop.** Leave quote-anchored inline comments in the viewer; the agent reads them back with `scratch comments --json` and picks up where you left off.
- **No lock-in.** It's just files on disk. The CLI never authors or moves content; delete the folder and it's gone.

## Install

Requires [Bun](https://bun.sh) — `scratch` runs on the Bun runtime.

```bash
bun add -g @nikiforovall/scratchpad   # global install from npm (exposes `scratch`)
```

From source:

```bash
bun install
bun link             # exposes `scratch` globally (needs bun on PATH)
# — or — build a standalone binary (no bun needed to run it):
bun run build        # → dist/scratch(.exe), bundles + compiles
```

### Claude Code plugin

This repo doubles as a Claude Code plugin marketplace. It ships the `scratch` skill so the agent knows when and how to drive the CLI (the CLI itself still comes from the install above):

```
/plugin marketplace add NikiforovAll/scratchpad
/plugin install scratchpad@scratchpad
```

### pi package

For the [pi coding agent](https://pi.dev), the [`@nikiforovall/pi-scratchpad`](pi/) package ships the same skills plus `/scratch ui | export | stop` commands for the viewer (the `scratch` CLI still comes from the install above):

```
pi install npm:@nikiforovall/pi-scratchpad
```

## Usage

```bash
scratch new "<name>" --dir <parent> [--id <id>] [--force]
    # create <parent>/<slug>/ + manifest, print an onboarding prompt.
    # --dir is REQUIRED — placement is always deliberate (no assumed location).

scratch add <pad> <file> [--title ..] [--desc ..] [--tag a,b] [--type note] [--group ..]
    # register an already-present file into the manifest with metadata.
    # --group <name>: list files sharing a group together under a viewer header.
    # --link [--as <label>]: link an EXTERNAL file (outside the pad) by reference;
    #   content stays put, --as sets its in-pad label (default: basename).

scratch ls [<pad>] [--dir <root>]
    # no <pad>: list pads under root.  with <pad>: list its registered files.

scratch show <pad> [<file>] [--dir <root>]
    # no <file>: print the manifest.  with <file>: print metadata + content.

scratch comments <pad> [<file>] [--dir <root>] [--json]
    # read inline comments left in the viewer back out — quote, file:line,
    # section heading, and context. <file> filters by path, glob, or substring.

scratch rm <pad> [<file>] [--dir <root>] [--force]
    # with <file>: unregister (file left on disk).  without: delete pad (--force).

scratch ui [<pad>] [--dir <root>] [--browser] [--install-native]
    # read-only viewer: glimpse native window by default, browser fallback.
    # --install-native builds the native host on demand (needs .NET 8 SDK).

scratch export [<pad>] [--dir <root>] [--all] [-o <file>] [--offline]
               [--theme <id>] [--mode dark|light|system]
    # write the viewer to a single HTML file (file contents embedded; highlight.js
    # / mermaid load from a pinned CDN), openable in any browser. Default out: <pad-name>.html.
    # --offline inlines those libs so the page needs no network.
    # --theme/--mode pin the exported page's appearance for every reader; without
    # them it follows your config and the reader's own choice still wins.
```

**Addressing.** A pad is referenced by name (resolved within a scanned root) or by an explicit path. Root = `--dir`, else `$SCRATCH_DIR`, else the current dir.

## Viewer

Read-only, 2-pane (pad/file tree + preview), **auto-detects** OS light/dark, 17 color themes, keyboard-driven (`?` for shortcuts), settings persist across launches. Shows **all** files in the pad dir (unregistered ones dimmed). Per-file preview:

- Markdown rendered (GFM tables, footnotes, **alerts** like `> [!TIP]`), with a **raw/rendered toggle** and a table of contents.
- Code **syntax-highlighted** (highlight.js); **math** via KaTeX.
- **Mermaid** diagrams (` ```mermaid ` fenced blocks).
- Images inline, HTML embedded; binaries / oversized files get a notice.
- **Inline comments** — select text, attach a note; quote-anchored, read back via `scratch comments`.
- GFM **task checkboxes** are clickable and persist to the source file — the viewer's one deliberate write.

Transport is [glimpse](https://github.com/HazAT/glimpse) for a native window; if its per-OS backend is unavailable (Windows needs .NET 8 SDK + WebView2), it falls back to serving the same HTML over a local server + the browser.
