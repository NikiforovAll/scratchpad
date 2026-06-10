# User Guide

A **scratchpad** is a folder with a `scratchpad.json` manifest; the folder path *is* its identity (no central store). The CLI never authors, copies, or moves content — you write files with your normal tools, then **register** them for metadata + preview. Use it for session knowledge worth keeping together, not for the project's real source files.

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

## The loop

```bash
# 1. CREATE (default parent _scratchpads; create it if absent):
scratch new "<name>" --dir _scratchpads [--id <session-id>]
#   → creates <parent>/<slug>/ + scratchpad.json.

# 2. WRITE files into the pad dir with your normal tools (e.g. <slug>/notes.md).

# 3. REGISTER each file to track:
scratch add "<name>" <file> --title "..." --desc "why it exists" --type note --tag a,b

# 4. INSPECT:
scratch ls            # pads under root
scratch ls "<name>"   # files in a pad
scratch show "<name>" <file>

# 5. BROWSE:
scratch ui "<name>"   # open the read-only viewer
```

To extend an existing pad later, skip step 1 — `ls` to find it, write, then `add`.

## Choosing a location (`--dir`)

`--dir` is **required** on `new` — placement is always deliberate, there is no assumed location. Default to `_scratchpads` at the repo root unless you name another parent (e.g. `--dir _plans` to co-locate with planning work).

The same name under two parents = two distinct pads. An existing slug in one parent makes `new` refuse without `--force`.

## Registering files (`scratch add`)

Write the file first, then `add`. Re-running `add` on the same path **updates** its metadata. `add` *warns* (doesn't fail) if the file is missing or outside the pad dir.

| Field | Meaning |
|-------|---------|
| `--desc` | **Why this file exists** / what it captures. The most valuable field. |
| `--title` | Human label (defaults to path). |
| `--tag a,b,c` | Comma-separated tags. |
| `--type` | `note` \| `snippet` \| `output` \| `artifact` \| `reference` (default `note`). |
| `--group <name>` | List files sharing a group together under a viewer header. |
| `--link [--as <label>]` | Link an **external** file (outside the pad) by reference; content stays put, `--as` sets its in-pad label (default: basename). |

## Addressing & roots

Pads resolve by **name** (within a scanned root) or by an explicit **path**. Root order:

```
--dir <root>   →   $SCRATCH_DIR   →   current directory
```

`ls` / `ui` with no pad scan the root for all pads.

## Cleanup

```bash
scratch rm "<name>" <file>      # unregister (file on disk is left untouched)
scratch rm "<name>" --force     # delete the whole pad directory
```

Pads persist until removed — nothing is auto-deleted.

See the [CLI Reference](/cli-reference) for every command and flag.
