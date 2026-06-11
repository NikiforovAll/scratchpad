## What this is

`scratch` is a CLI-first tool that organizes agent knowledge into **scratchpads**: a folder + a `scratchpad.json` manifest, with a read-only visual viewer. Runs on the **Bun** runtime.

Core invariant (do not violate): **the CLI never authors, copies, or moves file content.** It only creates pad dirs, writes manifests, and tracks metadata. The user/agent writes files with their normal tools; `scratch add` just registers them. A pad is *just a folder containing `scratchpad.json`* — the folder path is its identity. There is **no central store/index**.

## Commands

```bash
bun test                      # run the suite (bun's built-in test runner)
bun test test/cli.test.ts     # single file
bun test --test-name-pattern "slugify"   # single test by name
bun run scratch -- <args>     # run the CLI in dev (e.g. bun run scratch -- ls)
bun run build                 # compile standalone → dist/scratch(.exe) + stage native host
bun link                      # expose `scratch` globally from source
bun run docs:dev              # vitepress docs (docs/)
```

No separate lint/typecheck step is wired at the root; `tsc` runs via `pi/` only (`bun --cwd pi run typecheck`). Tests are the gate (`prepublishOnly: bun test`).

## Monorepo layout

Two independently-published npm packages plus a Claude Code plugin, all in one repo:

- **root** (`@nikiforovall/scratchpad`) — the CLI. Entry `src/cli.ts`, bin name `scratch`.
- **`pi/`** (`@nikiforovall/pi-scratchpad`) — pi coding-agent package: skills + `/scratch ui|export|stop` commands. Drives the same `scratch` CLI (does not reimplement it).
- **`plugins/scratchpad/`** — Claude Code plugin (skills); `.claude-plugin/` makes this repo a plugin marketplace.

Release flow is per-package and documented in user memory (see `MEMORY.md`): bump → commit → push → publish → tag. Tags are prefixed: CLI `vX.Y.Z`, pi pkg `pi-scratchpad-vX.Y.Z`.

## Architecture

CLI is a thin layer over the filesystem. Data flows: `cli.ts` (parseArgs dispatch) → `commands.ts` (one fn per command, each returns an exit code) → `discovery.ts` + `manifest.ts`.

- **`manifest.ts`** — `scratchpad.json` schema (version 1) types + read/write/validate. Unknown keys tolerated on read (forward-compatible). `FileEntry.src` marks a *linked* external file: content lives at `src`, `path` is just its in-pad label.
- **`discovery.ts`** — pad discovery + name/slug/path resolution. `findPads` scans a root for manifests (recursive, doesn't descend into a found pad or `IGNORE_DIRS`). Root resolution: `--dir` → `$SCRATCH_DIR` → cwd.
- **`commands.ts`** — all command impls. Output goes through an injected `IO` writer (testable, no direct `console`). Paths emitted to users are run through `toPosix` — **always emit forward-slash paths**; this repo is developed on Windows/Git Bash where backslashes + drive letters get mangled (especially by the fzf/JSON consumers).
- **`config.ts`** — machine-wide viewer prefs at `~/.config/scratchpad/config.json` (NOT `%APPDATA%` — see the comment; the path must not depend on inherited env). Load merges over defaults; malformed file is non-fatal. `saveConfig` sanitizes the patch field-by-field and preserves unknown keys.

### Viewer (`src/ui/`)

The viewer is **read-only** and self-contained: `render.ts` does all file I/O and embeds pad data + file contents into one HTML string, so the native window and browser fallback render identically with no round-trips.

- **`render.ts`** — builds the page. highlight.js/mermaid load from a **pinned CDN** (URL + SRI), added *conditionally* (hljs only if code present, mermaid only if a ```` ```mermaid ```` block exists). When bumping a pinned version, recompute the SRI from the exact CDN bytes. CDN vendoring (not inlining) is deliberate — inlined libs caused a Windows WebView2 blink.
- **`launch.ts`** — opens the viewer. Default = glimpse's native WebView2 host; falls back to serving the same HTML over a local server + browser if native is unavailable. Lots of hard-won Windows specifics live here (see comments before touching): `NAV_LIMIT` setHTML cap with file:// fallback, present-once guard against reload loops, graceful Ctrl+C teardown to avoid Chromium stderr spam, `GLIMPSE_BINARY_PATH` for the compiled binary's staged host.
- **`reload.ts`** — on-demand reload shared by both transports. Re-reads manifests from disk; emits an in-place data patch unless a *new* vendor CDN tag became necessary (then a full page reload).
- Settings written from the viewer page flow back via WebView2 `postMessage` or `POST /settings` → `saveConfig`. Every UI setting must round-trip through `config.ts` and persist across launches.

## Testing notes

`bunfig.toml` preloads `test/setup.ts`, which forces `NO_COLOR=1` so CLI string assertions are deterministic on a TTY or piped. `src/colors.ts` decides styling per-call (not at import), so color is controllable per test. UI DOM tests use `@happy-dom/global-registrator`.
