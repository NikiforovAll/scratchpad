# CLI Reference

Every `scratch` command and its flags. A pad is referenced by **name** (resolved within a scanned root) or by an explicit **path**. Root = `--dir`, else `$SCRATCH_DIR`, else the current directory.

## `scratch new`

```bash
scratch new "<name>" --dir <parent> [--id <id>] [--force]
```

Create `<parent>/<slug>/` + manifest and print an onboarding prompt.

| Flag | Meaning |
|------|---------|
| `--dir <parent>` | **Required** — placement is always deliberate (no assumed location). |
| `--id <id>` | Associate the pad with a session/id. |
| `--force` | Overwrite an existing slug under the same parent. |

## `scratch add`

```bash
scratch add <pad> <file> [--title ..] [--desc ..] [--tag a,b] [--type note] [--group ..] [--link [--as <label>]]
```

Register an already-present file into the manifest with metadata.

| Flag | Meaning |
|------|---------|
| `--title` | Human label (defaults to path). |
| `--desc` | Why the file exists / what it captures. |
| `--tag a,b` | Comma-separated tags. |
| `--type` | `note` \| `snippet` \| `output` \| `artifact` \| `reference` (default `note`). |
| `--group <name>` | List files sharing a group together under a viewer header. |
| `--link` | Link an **external** file (outside the pad) by reference; content stays put. |
| `--as <label>` | With `--link`: the in-pad label (default: basename). |

## `scratch ls`

```bash
scratch ls [<pad>] [--dir <root>] [--json]
```

No `<pad>`: list pads under root. With `<pad>`: list its registered files. `--json` emits a machine-readable listing.

## `scratch show`

```bash
scratch show <pad> [<file>] [--dir <root>] [--json]
```

No `<file>`: print the manifest. With `<file>`: print metadata + content.

## `scratch comments`

```bash
scratch comments <pad> [<file>] [--dir <root>] [--json]
```

Read the inline comments left in the [viewer](/viewer#inline-comments) back out — the human-review → agent feedback loop. Each comment prints with its quote, `file:line`, nearest section heading, and surrounding context, so an agent can act on it without re-reading the pad.

| Flag | Meaning |
|------|---------|
| `<file>` | Filter: exact path, glob (`*.md`), or case-insensitive substring. |
| `--json` | Agent-friendly output (same shape the viewer's copy-comments shortcut produces). |

Comments whose quoted text can no longer be found are reported as **orphaned**, never dropped.

## `scratch rm`

```bash
scratch rm <pad> [<file>] [--dir <root>] [--force]
```

With `<file>`: unregister (file left on disk). Without: delete the pad (requires `--force`).

## `scratch ui`

```bash
scratch ui [<pad>] [--dir <root>] [--all] [--browser] [--install-native]
```

Read-only viewer: glimpse native window by default, browser fallback.

| Flag | Meaning |
|------|---------|
| `--all` | Open every pad under the root, tabbed. |
| `--browser` | Force the browser viewer (always works). |
| `--install-native` | Build the native host on demand (needs .NET 8 SDK). |

See [Viewer](/viewer) for details.

## `scratch export`

```bash
scratch export [<pad>] [--dir <root>] [--all] [-o <file>] [--offline] [--theme <id>] [--mode <m>]
```

Write the viewer to a single HTML file (file contents embedded; highlight.js / mermaid load from a pinned CDN), openable in any browser. Default out: `<pad-name>.html`.

| Flag | Meaning |
|------|---------|
| `--all` | Merge every pad under the root into one file. |
| `--offline` | Inline highlight.js / mermaid / KaTeX so the page needs no network. |
| `--theme <id>` | Color theme for the exported page (see below). |
| `--mode <m>` | `dark`, `light`, or `system`. |

### Appearance

By default an export inherits the appearance from your own config (see [Viewer](/viewer)), and the reader's remembered choice then wins — every exported page has a settings panel, and all `file://` pages share one browser origin, so a theme picked in any export follows the reader into the next one.

`--theme` and `--mode` override the config **and pin that axis**: the exported page ignores the reader's stored preference for it, so a published page looks the same for everyone. Only the axis you pass is pinned, and pinning governs the boot value — the in-page picker still works, it just does not survive a reload.

```bash
scratch export notes --theme monokai --mode light -o public/notes.html
```

Theme ids: `ember` (default), `gruvbox`, `catppuccin`, `tokyo-night`, `solarized`, `dracula`, `nord`, `rose-pine`, `everforest`, `kanagawa`, `one-dark`, `night-owl`, `monokai`, `github`, `ayu`, `vitesse`, `synthwave`. Each has a dark and a light variant, selected by `--mode`. Passing an unknown id prints the full list.
