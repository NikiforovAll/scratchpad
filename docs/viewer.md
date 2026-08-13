# Viewer

`scratch ui` opens a **read-only** view of a pad — so a human can see what the agent gathered without digging through transcripts.

Try it live on the [demo page](/demo).

## Layout & rendering

A 2-pane view (pad/file tree + preview) that **auto-detects** OS light/dark. It shows **all** files in the pad dir (unregistered ones dimmed; `hidden` entries revealed with `h`), and files sharing a `--group` are listed together under a header. Per-file preview:

- **Markdown** rendered (GFM tables, footnotes, alerts like `> [!TIP]`), with a **raw/rendered toggle** (`v`) and a table of contents (`o`).
- **Code** syntax-highlighted (highlight.js).
- **Mermaid** diagrams (` ```mermaid ` fenced blocks).
- **Math** via KaTeX (`$...$` / `$$...$$`).
- **HTML** files embedded, expandable to full window (`f`).
- **Images** inline; binaries / oversized files get a notice.

Vendor libs are added to the page only if a file actually needs them.

### Task checkboxes — the one write

The viewer is read-only with **one deliberate exception**: clicking a rendered GFM task checkbox flips that single `[ ]`/`[x]` marker in the source file. It is line-addressed and verified before writing — handy for agent-authored plans you review by hand.

## Inline comments

Select text in a rendered file and attach a **comment** to it. Comments are quote-anchored: they survive edits as long as the quote can be re-found, and show as *orphaned* (never silently dropped) otherwise.

- In `scratch ui`, comments write back to the pad's `scratchpad.json`.
- In a static export, the saved page file is the store — `Ctrl+S` saves a copy with your comments inside.

The agent reads them back with [`scratch comments`](/cli-reference#scratch-comments):

```bash
scratch comments <pad> --json    # quote, file:line, section heading, context
```

Toggle visibility with `c`; `Ctrl+Alt+C` copies a file's comments as JSON.

## Themes & settings

17 color themes (`ember` default — full list in the [CLI reference](/cli-reference#appearance)), each with a dark and a light variant, plus a dark/light/**system** mode toggle. Settings — theme, zoom, wide mode, sidebar/top-bar state — **persist across launches** via the config file below.

Press `?` in the viewer for the full keyboard shortcut list (navigation, vim-style scrolling, zoom, toggles).

## Native window vs. browser

Transport is [glimpse](https://github.com/HazAT/glimpse) for a native window. If its per-OS backend is unavailable, it falls back to serving the same HTML over a local server + the browser.

```bash
scratch ui "<name>"                   # native window by default
scratch ui "<name>" --browser         # force the browser viewer (always works)
scratch ui "<name>" --install-native  # build the native host on demand
scratch ui --all                      # every pad under the root, tabbed
```

On **Windows** the native host needs the **.NET 8 SDK** + the WebView2 runtime. Under Bun, the host isn't built at install time, so `scratch ui` prints a one-time instruction and falls back to the browser until you run `--install-native`.

::: tip
The viewer is **long-running** — it keeps a local server alive until you close it. When driving it from an agent, launch it backgrounded so the session keeps moving, then report the URL. Live viewers auto-reload when pad files change (`r` forces it).
:::

## Export to a single HTML file

`scratch export` writes the viewer to one self-contained HTML file — openable in any browser, no server.

```bash
scratch export "<name>"            # → <pad-name>.html
scratch export "<name>" -o out.html
scratch export "<name>" --offline  # inline the libs; no network needed
scratch export "<name>" --theme monokai --mode light
scratch export --all -o all.html   # merge every pad under the root
```

File contents are embedded; highlight.js / mermaid / KaTeX load from a pinned CDN (`--offline` inlines them instead).

An export inherits its appearance from the config below, and the reader's own remembered choice then overrides it. For a page you publish, pin it with `--theme` / `--mode` — see the [CLI reference](/cli-reference#appearance).

## Config

User-level viewer preferences live in a single JSON file (machine-wide, not per-pad):

```jsonc
// ~/.config/scratchpad/config.json
{
  "ui": {
    "frameless": true,      // native window without OS title bar/border (page draws
                            // its own close button + drag strip). false = native chrome.
    "themeMode": "system",  // dark | light | system
    "colorTheme": "ember",  // any theme id
    "zoom": 1
    // ...every viewer setting round-trips here
  }
}
```

The config file is resolved from (in order): `SCRATCHPAD_CONFIG` env var → `$XDG_CONFIG_HOME/scratchpad/config.json` → `~/.config/scratchpad/config.json` — the same path on every platform, deliberately **not** `%APPDATA%` (that would make the path depend on the launching shell's environment).
