# scratch

CLI-first tool to organize **temporary agent knowledge** into *scratchpads* — a
folder of files plus a `scratchpad.json` manifest — with a read-only visual
viewer (native window, browser fallback).

A scratchpad is **just a folder containing `scratchpad.json`**; the folder path
is its identity. There is **no central store**. `scratch` is a thin metadata
layer over the filesystem: it initializes pads, prints how to use them, and
registers files you create. You write/edit files with your normal tools — the
CLI never authors, copies, or moves content.

## Install

Requires [Bun](https://bun.sh).

```bash
bun install
bun link            # exposes `scratch` globally (needs bun on PATH)
# — or — build a standalone binary (no bun needed to run it):
bun run build       # → dist/scratch(.exe), bundles + compiles
```

## Usage

```bash
scratch new "<name>" --dir <parent> [--id <id>] [--force]
    # create <parent>/<slug>/ + manifest, print an onboarding prompt.
    # --dir is REQUIRED — placement is always deliberate (no assumed location).

scratch add <pad> <file> [--title ..] [--desc ..] [--tag a,b] [--type note]
    # register an already-present file into the manifest with metadata.

scratch ls [<pad>] [--dir <root>]
    # no <pad>: list pads under root.  with <pad>: list its registered files.

scratch show <pad> [<file>] [--dir <root>]
    # no <file>: print the manifest.  with <file>: print metadata + content.

scratch rm <pad> [<file>] [--dir <root>] [--force]
    # with <file>: unregister (file left on disk).  without: delete pad (--force).

scratch ui [<pad>] [--dir <root>] [--browser]
    # read-only viewer: glimpse native window, automatic browser fallback.
```

**Addressing.** A pad is referenced by name (resolved within a scanned root) or
by an explicit path. Root = `--dir`, else `$SCRATCH_DIR`, else the current dir.

**Manifest** (`scratchpad.json`, schema v1): `version, name, id?, created,
updated, files[]`; each file entry: `path` (relative to the pad), `title?`,
`description?`, `tags?`, `type` ∈ `note|snippet|output|artifact|reference`.
Unknown keys are tolerated on read (forward-compatible).

## Viewer

Read-only, 2-pane (pad/file tree + preview) in a "Lab Notebook" theme that
**auto-detects** OS light/dark. Shows **all** files in the pad dir (unregistered
ones dimmed). Per-file preview:

- Markdown rendered, with a **raw/rendered toggle**.
- Code **syntax-highlighted** (highlight.js).
- **Mermaid** diagrams (` ```mermaid ` fenced blocks).
- Images inline; binaries / oversized files get a notice.

Transport is [glimpse](https://github.com/HazAT/glimpse) for a native window;
if its per-OS backend is unavailable (Windows needs .NET 8 SDK + WebView2), it
falls back to serving the same HTML over a local server + the browser. The
highlight.js / mermaid libraries are vendored as offline bundles and inlined
into the page only when a pad actually needs them, so the viewer works with no
network — including inside the native WebView.

## Agent skill

`skills/scratch/SKILL.md` teaches an agent the loop: create a pad at a
deliberate `--dir`, write files, register them with good `--desc`/`--type`,
then `scratch ui` for the human.

## Develop

```bash
bun test                 # full suite (CLI loop + UI render + headless-DOM)
bun run build:vendor     # rebuild src/ui/vendor/*.bundle.js from node_modules
```
