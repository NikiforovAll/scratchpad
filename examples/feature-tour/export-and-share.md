# Export & share

`scratch export` writes the whole viewer to **one self-contained HTML file** — file contents embedded, openable in any browser, no server. This demo page was made exactly this way:

```bash
scratch export feature-tour -o demo-pad.html
```

## Flags

```bash
scratch export feature-tour                    # → feature-tour.html
scratch export feature-tour --offline          # inline vendor libs — no network at all
scratch export feature-tour --theme nord --mode dark   # pin appearance for readers
scratch export --all -o everything.html        # merge every pad under the root
```

Without `--theme`/`--mode` the export follows your config, and the reader's own remembered choice still wins.

## Native window vs browser

`scratch ui` prefers a **native window** (glimpse / WebView2); if the per-OS backend is unavailable it serves the same HTML to your browser instead. Same page either way — `render.ts` builds one HTML string, all transports render it identically.

```bash
scratch ui feature-tour                   # native window by default
scratch ui feature-tour --browser         # force the browser
scratch ui feature-tour --install-native  # build the native host (needs .NET 8 SDK)
scratch ui --all                          # every pad under the root, tabbed
```
