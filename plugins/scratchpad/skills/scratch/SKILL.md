---
name: scratch
description: Organize temporary knowledge from an agent session into a scratchpad — a folder of files plus a scratchpad.json manifest. Use when a task generates notes, snippets, command output, diagrams, or artifacts worth keeping together for a session/activity. The CLI is a thin metadata layer over the filesystem: you write files with your normal tools, then register them.
---

# scratch — session scratchpads

A **scratchpad** is just a folder containing a `scratchpad.json` manifest. The
folder path is its identity — there is **no central store**. `scratch` is a thin
layer over the filesystem: it initializes a pad, prints how to use it, and
**registers** files you create (with metadata). You write/edit files directly
with your normal tools; the CLI never authors, copies, or moves content.

## When to use

- A task is producing knowledge worth keeping together: design notes, repro
  steps, command output, a diagram, a snippet, a reference dump.
- You want the human to later **browse** it visually (`scratch ui`).
- You need a scoped place for "temporary but not throwaway" session artifacts.

Don't use it for the project's real source files — only for the session's
scratch knowledge.

## The loop

```
1. CREATE a pad at a deliberate location (--dir is REQUIRED):
     scratch new "<name>" --dir <parent> [--id <session-id>]
   → creates <parent>/<slug>/ + scratchpad.json, prints an onboarding prompt.

2. WRITE files into the pad dir using your normal tools (Write/Edit/etc.).
     e.g. <parent>/<slug>/notes.md

3. REGISTER each file you want tracked + previewable:
     scratch add "<name>" <file> --title "..." --desc "why it exists" \
       --type note --tag a,b

4. INSPECT:
     scratch ls                 # pads under the root (cwd / $SCRATCH_DIR / --dir)
     scratch ls "<name>"        # files in a pad
     scratch show "<name>" <file>

5. BROWSE (for the human):
     scratch ui "<name>"        # native window; auto browser fallback
```

## Choosing a location (`--dir`)

`new` refuses to guess — pick a parent deliberately and pass `--dir`:

- Co-located with planning work: `--dir _plans` (a scratchpad and a planning
  task folder are the same kind of artifact).
- A session bucket: `--dir _scratchpads` (create it first if you want it).
- Anywhere that makes sense for the task. The path *is* the identity.

The same name in two different parents is fine (two distinct pads). Within one
parent, an existing slug means an existing pad — `new` refuses unless `--force`.

## Registering files well

`scratch add` records metadata; good metadata makes the viewer useful:

- `--title` — a human label (defaults to the path).
- `--desc` — **why this file exists** / what it captures. The most valuable field.
- `--type` — one of `note | snippet | output | artifact | reference` (default `note`).
- `--tag a,b,c` — comma-separated tags.

Write the file first, then `add` it. Re-running `add` on the same path updates
its metadata. `add` warns (doesn't fail) if the file isn't there yet or sits
outside the pad dir.

## Addressing & roots

Commands resolve a pad by **name** (within a scanned root) or by **path**.
The root is, in order: `--dir <root>` → `$SCRATCH_DIR` → current directory.
`ls`/`ui` with no pad scan the root for all pads.

## The viewer (`scratch ui`)

Read-only. Opens a glimpse native window, with an automatic browser+local-server
fallback (use `--browser` to force it). It shows **all** files in the pad dir
(unregistered ones dimmed), renders markdown, highlights code, renders
` ```mermaid ` diagrams, supports a raw/rendered toggle, and auto-detects the
OS light/dark theme.

## Cleanup

- `scratch rm "<name>" <file>` — unregister a file (the file on disk is left
  untouched).
- `scratch rm "<name>" --force` — delete the whole pad directory.

Pads are kept until you remove them — "temporary" knowledge is not auto-deleted.

## Example

```bash
scratch new "auth refactor" --dir _plans --id "$SESSION_ID"
# ... write _plans/auth-refactor/notes.md and flow.md with your tools ...
scratch add "auth refactor" notes.md --title "Auth flow notes" \
  --desc "why token refresh races" --type note --tag bug,auth
scratch add "auth refactor" flow.md  --title "Token flow diagram" --type artifact
scratch ls "auth refactor"
scratch ui "auth refactor"
```
