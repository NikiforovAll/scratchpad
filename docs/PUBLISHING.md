# Publishing

This repo ships **two npm packages**, released independently:

- **`@nikiforovall/scratchpad`** — the `scratch` CLI (repo root). Installed under the user's Bun (`bun add -g @nikiforovall/scratchpad`). Source-only (`src/` + `README` + `LICENSE`); `glimpseui` is a pinned runtime dependency. Tag: `vX.Y.Z`.
- **`@nikiforovall/pi-scratchpad`** — the [pi](https://pi.dev) package (`pi/`). Skills + a `/scratch ui|export|stop` extension that drives the installed CLI. Source-only (`extensions/` + `skills/` + `README` + `LICENSE`). Tag: `pi-scratchpad-vX.Y.Z`.

Both publish with `bun publish` (see below). The CLI's root `files` allowlist (`src`, `README.md`, `LICENSE`) keeps `pi/` out of the CLI tarball, so the two never overlap.

## Native viewer

Under **Bun**, glimpseui's `postinstall` never runs (Bun blocks lifecycle scripts for untrusted deps, and a *transitive* dep can't be trusted from our `package.json`), so the WebView2 host isn't built at install time — and we do **not** build it automatically. `scratch ui` opens the native window by default; if the host is missing it prints a one-time instruction and falls back to the browser. The user builds it on demand with **`scratch ui --install-native`** (needs the **.NET 8 SDK** + WebView2 runtime). `scratch ui --browser` forces the browser viewer, which always works.

## Release steps — CLI (`@nikiforovall/scratchpad`)

From the repo root:

```sh
bun test                 # prepublishOnly also runs this as a gate
# bump "version" in package.json (semver), commit, push
git push
# publish with bun — NOT npm (npm strips the .ts bin, leaving no `scratch`
# command). On Windows bun ignores ~/.npmrc, so the token must be passed inline;
# web 2FA is approved in the browser when prompted.
NPM_CONFIG_TOKEN=$(grep _authToken ~/.npmrc | sed 's/.*=//') bun publish --access public
git tag v$(node -p "require('./package.json').version") && git push --tags
```

## Release steps — pi package (`@nikiforovall/pi-scratchpad`)

From `pi/`. No build/prepublish step — pi runs the `.ts` extension directly; do a quick transpile-check as the gate. `publishConfig.access: public` is set, so no `--access` flag is needed.

```sh
bun build pi/extensions/scratch.ts --target=node --outfile=/tmp/c.js   # transpile gate (from root)
# bump "version" in pi/package.json (semver), commit, push
git push
cd pi
NPM_CONFIG_TOKEN=$(grep _authToken ~/.npmrc | sed 's/.*=//') bun publish
cd ..
git tag pi-scratchpad-v$(node -p "require('./pi/package.json').version") && git push --tags
```

Always push the tag — the npm publish alone is not the release. Tags are **prefixed per package** (`vX.Y.Z` vs `pi-scratchpad-vX.Y.Z`) so the two packages don't collide in one repo.

## Version pinning

`glimpseui` is pinned to an exact version (not `^`) because `launch.ts` relies on its internal host-resolution + `GLIMPSE_BINARY_PATH` override. Bump deliberately and re-test the native path after any glimpseui upgrade.

## Standalone binary (optional, not released)

`bun run build` compiles `dist/scratch.exe` and stages a prebuilt host in `dist/glimpse/` (so the native window works with only the .NET **Desktop Runtime**, no SDK). This is for local/turnkey use — it is **not** part of the release flow. `dist/` is gitignored; build fresh if you need it.
