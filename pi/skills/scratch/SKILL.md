---
name: scratch
description: Organize knowledge from an agent session into a scratchpad — a folder of files plus a scratchpad.json manifest. Use when a task generates notes, snippets, command output, diagrams, or artifacts worth keeping together for a session/activity.
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
             scratch comments "<name>"   # inline comments left in the viewer
             # add --json to `ls`/`show <file>`/`comments` for machine-readable output (agents)

5. BROWSE:   scratch ui "<name>"  # see viewer note — launch backgrounded
```

To extend an existing pad later, skip step 1 — `ls` to find it, write, `add`.

## Scripting (`--json`)

`ls` and `show <pad> <file>` accept `--json` for parseable output (paths are relative,
forward-slashed — never absolute, safe across shells/platforms):

- `scratch ls --json` → `{ root, pads: [{ name, rel, files }] }`
- `scratch ls "<name>" --json` → `{ name, id, rel, files: [<entry>] }`
- `scratch show "<name>" <file> --json` → `{ metadata, content }` (`metadata` null if unregistered)
- `scratch comments "<name>" [<file>] --json` → `{ pad, comments: [...] }` (see below)

Errors stay as text on stderr; stdout carries only the JSON, so pipe to `jq` freely.

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
renders markdown/code/`mermaid`, TeX math, embeds HTML diagrams (below),
raw↔rendered toggle, auto light/dark.

## Math notation (TeX)

Markdown docs may use TeX/LaTeX math — inline `$…$` and display `$$…$$` — rendered
by KaTeX in the viewer. Reach for it when a note needs a real formula instead of
prose or ASCII (e.g. `$$\text{tokens} = \operatorname{round}(W/28) \times
\operatorname{round}(H/28) + 2$$`). No setup needed; just write the math in the doc.

## Footnotes / citations

Markdown footnotes are supported — an inline `[^id]` reference plus a `[^id]: …`
definition (Pandoc/GFM style). The viewer numbers each reference and renders a
linked definitions list at the bottom. Use it for sources/citations in research
notes (definitions render inline markdown, so links inside them work).

## Embedding HTML diagrams

For anything markdown + mermaid can't express — a UI sketch, a custom chart, an
interactive explainer — write a standalone `.html` file in the pad and embed it
from a markdown doc with image syntax:

```md
![Cache layout](diagram.html)
```

The viewer renders `diagram.html` **live** in a sandboxed iframe right where the
embed sits. The `.html` is just a loose file next to the doc — resolved by its
relative path, **not** something you `scratch add`. Keep the markdown as prose;
let the diagram be its own file. The embed is self-contained (baked into the
page), so it survives `scratch export` and offline viewing.

Write the file as a complete standalone HTML document (it then also opens in a
plain browser). Scripts run isolated — no access to the viewer page. Every embed
gets a built-in kit baked in (theme-aware CSS variables, pre-styled controls, SVG
utility classes + an `#arrow` marker) so diagrams stay consistent and match the
viewer's light/dark theme without hand-rolled CSS.

Before authoring one, always read `references/HTML_DESIGN_GUIDE.md` for the kit
reference and the styling/structure contract.

## Reading viewer feedback (`scratch comments`)

Reviewers attach inline comments to rendered text in the viewer.
`scratch comments "<name>"` reads them back (`--file <path|glob|substring>` to
narrow files; `--json` for agents)
so you can act without opening the UI: each item gives the note, the quoted text,
and the enclosing markdown `context` block to edit. `matched: false` = the quoted
text was edited away (orphaned); reconcile manually.

## Cleanup

- `scratch rm "<name>" <file>` — unregister (file on disk is left untouched).
- `scratch rm "<name>" --force` — delete the whole pad directory.

Pads persist until removed — nothing is auto-deleted.
