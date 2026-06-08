# Publishing

`scratch` ships one way: **npm**, installed under the user's Bun (`bun add -g @nikiforovall/scratchpad`). The published package is source-only (`src/` + `README` + `LICENSE`). `glimpseui` is a pinned runtime dependency.

## Native viewer

Under **Bun**, glimpseui's `postinstall` never runs (Bun blocks lifecycle scripts for untrusted deps, and a *transitive* dep can't be trusted from our `package.json`), so the WebView2 host isn't built at install time — and we do **not** build it automatically. `scratch ui` opens the native window by default; if the host is missing it prints a one-time instruction and falls back to the browser. The user builds it on demand with **`scratch ui --install-native`** (needs the **.NET 8 SDK** + WebView2 runtime). `scratch ui --browser` forces the browser viewer, which always works.

## Release steps

```sh
bun test                 # prepublishOnly also runs this as a gate
# bump "version" in package.json (semver), commit, push
git push
# publish with bun — NOT npm. On Windows bun ignores ~/.npmrc, so the token
# must be passed inline; web 2FA is approved in the browser when prompted.
NPM_CONFIG_TOKEN=$(grep _authToken ~/.npmrc | sed 's/.*=//') bun publish --access public
git tag v$(node -p "require('./package.json').version") && git push --tags
```

Always push the `vX.Y.Z` tag — the npm publish alone is not the release.

## Version pinning

`glimpseui` is pinned to an exact version (not `^`) because `launch.ts` relies on its internal host-resolution + `GLIMPSE_BINARY_PATH` override. Bump deliberately and re-test the native path after any glimpseui upgrade.

## Standalone binary (optional, not released)

`bun run build` compiles `dist/scratch.exe` and stages a prebuilt host in `dist/glimpse/` (so the native window works with only the .NET **Desktop Runtime**, no SDK). This is for local/turnkey use — it is **not** part of the release flow. `dist/` is gitignored; build fresh if you need it.
