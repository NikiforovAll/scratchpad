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
scratch ls [<pad>] [--dir <root>]
```

No `<pad>`: list pads under root. With `<pad>`: list its registered files.

## `scratch show`

```bash
scratch show <pad> [<file>] [--dir <root>]
```

No `<file>`: print the manifest. With `<file>`: print metadata + content.

## `scratch rm`

```bash
scratch rm <pad> [<file>] [--dir <root>] [--force]
```

With `<file>`: unregister (file left on disk). Without: delete the pad (requires `--force`).

## `scratch ui`

```bash
scratch ui [<pad>] [--dir <root>] [--browser] [--install-native]
```

Read-only viewer: glimpse native window by default, browser fallback.

| Flag | Meaning |
|------|---------|
| `--browser` | Force the browser viewer (always works). |
| `--install-native` | Build the native host on demand (needs .NET 8 SDK). |

See [Viewer](/viewer) for details.

## `scratch export`

```bash
scratch export [<pad>] [--dir <root>] [-o <file>]
```

Write the viewer to a single HTML file (file contents embedded; highlight.js / mermaid load from a pinned CDN), openable in any browser. Default out: `<pad-name>.html`.
