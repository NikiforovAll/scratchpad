---
name: scratch
description: Organize temporary knowledge from an agent session into a scratchpad — a folder of files plus a scratchpad.json manifest. Use when a task generates notes, snippets, command output, diagrams, or artifacts worth keeping together for a session/activity.
---

# scratch — session scratchpads

A **scratchpad** is a folder with a `scratchpad.json` manifest; the folder path
*is* its identity (no central store). The CLI never authors, copies, or moves
content — you write files with your normal tools, then **register** them for
metadata + preview. Use it for session knowledge worth keeping together, not for
the project's real source files.

`scratch` is on your PATH — run it directly. The skill's base dir is not where
the CLI lives; don't look there for an entrypoint to invoke.

## The loop

```
1. CREATE (default parent _scratchpads; create it if absent):
     scratch new "<name>" --dir _scratchpads [--id <session-id>]
   → creates <parent>/<slug>/ + scratchpad.json.

2. WRITE files into the pad dir with your normal tools (e.g. <slug>/notes.md).

3. REGISTER each file to track (group multi-doc pads with --group):
     scratch add "<name>" <file> --title "..." --desc "why it exists" \
       --type note --tag a,b --group "Findings"

4. INSPECT:  scratch ls           # pads under root
             scratch ls "<name>"  # files in a pad
             scratch show "<name>" <file>

5. BROWSE:   scratch ui "<name>"  # see viewer note — launch backgrounded
```

To extend an existing pad later, skip step 1 — `ls` to find it, write, `add`.

## Choosing a location (`--dir`)

Default to `_scratchpads` at the repo root unless the user names another parent
(e.g. `--dir _plans` to co-locate with planning work). The same name under two
parents = two distinct pads; an existing slug in one parent makes `new` refuse
without `--force`.

## Registering files (`scratch add`)

- `--desc` — **why this file exists** / what it captures. The most valuable field.
- `--title` — human label (defaults to path); `--tag a,b,c` — comma-separated.
- `--type` — `note | snippet | output | artifact | reference` (default `note`).
- `--group` — group header in the viewer; files sharing a name list together.
  Always set it once a pad holds more than ~3 files — it's the only structure the
  viewer shows. To set/change a group on existing entries, edit the `group` field
  in `scratchpad.json` in place — that's cheaper than re-running `add` per file and
  preserves the other metadata.

Write the file first, then `add`. Re-running `add` on the same path updates its
metadata. `add` warns (doesn't fail) if the file is missing or outside the pad dir.

## Addressing & roots

Pads resolve by **name** (within a scanned root) or by **path**. Root order:
`--dir <root>` → `$SCRATCH_DIR` → current directory. `ls`/`ui` with no pad scan
the root for all pads.

## The viewer (`scratch ui`)

Read-only and **blocking** — keeps a local server alive until Ctrl+C. Always
launch it **backgrounded** (don't await it) so the session keeps moving, then
report the URL. Native glimpse window with automatic browser+server fallback
(`--browser` forces it); shows all files in the pad (unregistered ones dimmed),
renders markdown/code/`mermaid`, raw↔rendered toggle, auto light/dark.

## Cleanup

- `scratch rm "<name>" <file>` — unregister (file on disk is left untouched).
- `scratch rm "<name>" --force` — delete the whole pad directory.

Pads persist until removed — "temporary" knowledge is not auto-deleted.
