# Viewer

`scratch ui` opens a **read-only** view of a pad — so a human can see what the agent gathered without digging through transcripts.

## Layout

A 2-pane view (pad/file tree + preview) in a "Lab Notebook" theme that **auto-detects** OS light/dark. It shows **all** files in the pad dir (unregistered ones dimmed). Per-file preview:

- **Markdown** rendered, with a **raw/rendered toggle**.
- **Code** syntax-highlighted (highlight.js).
- **Mermaid** diagrams (` ```mermaid ` fenced blocks).
- **Images** inline; binaries / oversized files get a notice.

## Native window vs. browser

Transport is [glimpse](https://github.com/HazAT/glimpse) for a native window. If its per-OS backend is unavailable, it falls back to serving the same HTML over a local server + the browser.

```bash
scratch ui "<name>"                   # native window by default
scratch ui "<name>" --browser         # force the browser viewer (always works)
scratch ui "<name>" --install-native  # build the native host on demand
```

On **Windows** the native host needs the **.NET 8 SDK** + the WebView2 runtime. Under Bun, the host isn't built at install time, so `scratch ui` prints a one-time instruction and falls back to the browser until you run `--install-native`.

::: tip
The viewer is **long-running** — it keeps a local server alive until you close it. When driving it from an agent, launch it backgrounded so the session keeps moving, then report the URL.
:::

## Export to a single HTML file

`scratch export` writes the viewer to one self-contained HTML file — openable in any browser, no server.

```bash
scratch export "<name>"            # → <pad-name>.html
scratch export "<name>" -o out.html
```

File contents are embedded; highlight.js / mermaid load from a pinned CDN.

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

The config file is resolved from (in order): `SCRATCHPAD_CONFIG` env var → `XDG_CONFIG_HOME` → `%APPDATA%` (Windows) → `~/.config`.
