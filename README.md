# scratch

[![npm version](https://img.shields.io/npm/v/scratchpad.svg)](https://www.npmjs.com/package/scratchpad)
[![license](https://img.shields.io/github/license/nikiforovall/scratchpad.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-1.x-fbf0df?logo=bun&logoColor=black)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

CLI-first tool to organize **temporary agent knowledge** into *scratchpads* — a folder of files plus a `scratchpad.json` manifest — with a read-only visual viewer (native window, browser fallback).

A scratchpad is **just a folder containing `scratchpad.json`**; the folder path is its identity. There is **no central store**. `scratch` is a thin metadata layer over the filesystem: it initializes pads, prints how to use them, and registers files you create. You write/edit files with your normal tools — the CLI never authors, copies, or moves content.

![scratch viewer](https://raw.githubusercontent.com/nikiforovall/scratchpad/main/assets/demo.png)

## Why

Agents generate a lot of *temporary* knowledge per session — notes, snippets, command output, intermediate artifacts — and it has no home. It ends up scattered across the repo, buried in chat history, or lost when the context window rolls over.

A scratchpad gives that working memory a deliberate place: a folder + `scratchpad.json` manifest, kept out of your source tree, that captures **what** each file is and **why** it exists.

- **Durable, inspectable agent memory.** The agent writes files and registers them with a `--desc`/`--type`; the knowledge survives the session and stays reviewable.
- **A human can browse it.** `scratch ui` opens a read-only viewer (markdown, code highlighting, mermaid) so you can see what the agent gathered — no digging through transcripts.
- **No lock-in.** It's just files on disk. The CLI never authors or moves content; delete the folder and it's gone.

## Install

Requires [Bun](https://bun.sh) — `scratch` runs on the Bun runtime.

```bash
bun add -g scratchpad   # global install from npm (exposes `scratch`)
```

From source:

```bash
bun install
bun link             # exposes `scratch` globally (needs bun on PATH)
# — or — build a standalone binary (no bun needed to run it):
bun run build        # → dist/scratch(.exe), bundles + compiles
```

## Usage

```bash
scratch new "<name>" --dir <parent> [--id <id>] [--force]
    # create <parent>/<slug>/ + manifest, print an onboarding prompt.
    # --dir is REQUIRED — placement is always deliberate (no assumed location).

scratch add <pad> <file> [--title ..] [--desc ..] [--tag a,b] [--type note]
    # register an already-present file into the manifest with metadata.
    # --link [--as <label>]: link an EXTERNAL file (outside the pad) by reference;
    #   content stays put, --as sets its in-pad label (default: basename).

scratch ls [<pad>] [--dir <root>]
    # no <pad>: list pads under root.  with <pad>: list its registered files.

scratch show <pad> [<file>] [--dir <root>]
    # no <file>: print the manifest.  with <file>: print metadata + content.

scratch rm <pad> [<file>] [--dir <root>] [--force]
    # with <file>: unregister (file left on disk).  without: delete pad (--force).

scratch ui [<pad>] [--dir <root>] [--browser]
    # read-only viewer: glimpse native window, automatic browser fallback.

scratch export [<pad>] [--dir <root>] [-o <file>]
    # write the viewer as ONE self-contained HTML file (deps + content inlined),
    # openable in any browser offline. Default out: <pad-name>.html.
```

**Addressing.** A pad is referenced by name (resolved within a scanned root) or by an explicit path. Root = `--dir`, else `$SCRATCH_DIR`, else the current dir.

## Viewer

Read-only, 2-pane (pad/file tree + preview) in a "Lab Notebook" theme that **auto-detects** OS light/dark. Shows **all** files in the pad dir (unregistered ones dimmed). Per-file preview:

- Markdown rendered, with a **raw/rendered toggle**.
- Code **syntax-highlighted** (highlight.js).
- **Mermaid** diagrams (` ```mermaid ` fenced blocks).
- Images inline; binaries / oversized files get a notice.

Transport is [glimpse](https://github.com/HazAT/glimpse) for a native window; if its per-OS backend is unavailable (Windows needs .NET 8 SDK + WebView2), it falls back to serving the same HTML over a local server + the browser. The highlight.js / mermaid libraries load from a pinned CDN (with SRI) only when a pad actually needs them; offline they degrade gracefully (code shows unhighlighted, mermaid shows its source). Keeping the page small lets the native WebView use `NavigateToString` (correct DPI) instead of a `file://` load.

## Config

User-level viewer preferences live in a single JSON file (machine-wide, not per-pad):

```jsonc
// ~/.config/scratchpad/config.json
{
  "ui": {
    "frameless": true   // native window without OS title bar/border (page draws
                        // its own close button + drag strip). Set false for native chrome.
  }
}
```

Resolution order: `$SCRATCHPAD_CONFIG` (explicit file path) → `$XDG_CONFIG_HOME/scratchpad/config.json` → `%APPDATA%\scratchpad\config.json` (Windows) → `~/.config/scratchpad/config.json`. A missing or malformed file falls back to defaults.
