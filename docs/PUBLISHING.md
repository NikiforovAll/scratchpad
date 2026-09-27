# Publishing

This repo ships **two npm packages**, released independently:

- **`@nikiforovall/scratchpad`** — the `scratch` CLI (repo root). Installed under the user's Bun (`bun add -g @nikiforovall/scratchpad`). Source-only (`src/` + `README` + `LICENSE`); `glimpseui` is a pinned runtime dependency. Tag: `vX.Y.Z`.
- **`@nikiforovall/pi-scratchpad`** — the [pi](https://pi.dev) package (`pi/`). Skills + a `/scratch ui|export|stop` extension that drives the installed CLI. Source-only (`extensions/` + `skills/` + `README` + `LICENSE`). Tag: `pi-scratchpad-vX.Y.Z`.

Both publish from GitHub Actions (see below). The CLI's root `files` allowlist (`src`, `README.md`, `LICENSE`) keeps `pi/` out of the CLI tarball, so the two never overlap.

## Native viewer

Under **Bun**, glimpseui's `postinstall` never runs (Bun blocks lifecycle scripts for untrusted deps, and a *transitive* dep can't be trusted from our `package.json`), so the WebView2 host isn't built at install time — and we do **not** build it automatically. `scratch ui` opens the native window by default; if the host is missing it prints a one-time instruction and falls back to the browser. The user builds it on demand with **`scratch ui --install-native`** (needs the **.NET 8 SDK** + WebView2 runtime). `scratch ui --browser` forces the browser viewer, which always works.

## Release

Run the `release` skill (`.claude/skills/release/`). It bumps the version, pushes a tag and creates the GitHub release. The tag push starts `.github/workflows/release.yml`, the only publisher:

1. It checks that the tag matches the package's `package.json`. A `vX.Y.Z` tag releases the CLI; a `pi-scratchpad-vX.Y.Z` tag releases the pi package.
2. It runs the gate: `bun test` for the CLI, a transpile check of `pi/extensions/scratch.ts` for the pi package.
3. It packs with `bun pm pack` and publishes the tarball with `npm publish --provenance` through npm trusted publishing (OIDC, environment `release`, no token). `npm publish` from the folder drops the `.ts` bin as invalid, which leaves no `scratch` command; the bun tarball keeps it, and the workflow fails if the bin is missing.
4. A stable CLI release then deploys the docs (`pages.yml`). Run `pages.yml` by hand to deploy docs without a release.

A version with `-` (for example `0.31.0-rc.1`) goes to the `rc` dist-tag and skips the docs deploy. Install it with `bun add -g @nikiforovall/scratchpad@rc`.

To publish again after a failed run, fix the cause and run `gh workflow run release.yml --ref <tag>`. The publish step skips a version that is already on npm.

Each package has a trusted publisher on npmjs.com (package → Settings → Trusted Publisher): owner `NikiforovAll`, repository `scratchpad`, workflow `release.yml`, environment `release`.

## Version pinning

`glimpseui` is pinned to an exact version (not `^`) because `launch.ts` relies on its internal host-resolution + `GLIMPSE_BINARY_PATH` override. Bump deliberately and re-test the native path after any glimpseui upgrade.

## Standalone binary (optional, not released)

`bun run build` compiles `dist/scratch.exe` and stages a prebuilt host in `dist/glimpse/` (so the native window works with only the .NET **Desktop Runtime**, no SDK). This is for local/turnkey use — it is **not** part of the release flow. `dist/` is gitignored; build fresh if you need it.
