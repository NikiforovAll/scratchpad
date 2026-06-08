# Publishing

Two distribution channels, two native-viewer stories. The browser viewer works
in both; the native window (glimpse) differs.

## 1. npm — `bun add -g scratchpad`

The published package is source-only (`src/` + `README` + `LICENSE`, ~86 KB).
The `scratch` bin runs under the user's Bun. `glimpseui` is a pinned runtime
dependency.

Native viewer: under **Bun**, glimpseui's `postinstall` never runs — Bun blocks
lifecycle scripts for untrusted deps, and a *transitive* dep can't be trusted
from our `package.json` — so the WebView2 host isn't built at install time. We do
**not** build it automatically. `scratch ui` opens the native window by default,
but if the host is missing it prints a one-time instruction and falls back to the
browser. The user builds it on demand with **`scratch ui --install-native`**,
which compiles the host into glimpseui's own `native/windows/bin/` (needs the
**.NET 8 SDK** + WebView2 runtime). `scratch ui --browser` forces the browser.

### Release steps

```sh
bun test                 # prepublishOnly also runs this
# bump "version" in package.json (semver), commit, push
git push
# publish with bun — NOT npm. On Windows bun ignores ~/.npmrc, so the token
# must be passed inline; web 2FA is approved in the browser when prompted.
NPM_CONFIG_TOKEN=<npm-token> bun publish --access public
git tag v$(node -p "require('./package.json').version") && git push --tags
```

`prepublishOnly` runs the test suite as a gate. Always push the `vX.Y.Z` tag —
the npm publish alone is not the release.

## 2. Standalone binary — GitHub Release

For a turnkey native experience (no .NET **SDK** required — only the .NET 8
**Desktop Runtime** + WebView2):

```sh
bun run build            # compiles dist/scratch.exe + stages dist/glimpse/ (the host)
```

`scripts/build-host.ts` copies glimpse's native host (~1.3 MB: exe + .NET deps +
WebView2 assemblies/loader) next to the binary; `launch.ts` points
`GLIMPSE_BINARY_PATH` at it. Ship `dist/scratch.exe` **and** `dist/glimpse/`
together (zip the `dist/` folder) — the binary is browser-only without the
adjacent host, because `bun --compile` can't resolve glimpse's host from its
virtual filesystem.

`dist/` is gitignored — build fresh per release.

## Version pinning

`glimpseui` is pinned to an exact version (not `^`) because `launch.ts` relies on
its internal host-resolution + `GLIMPSE_BINARY_PATH` override. Bump deliberately
and re-test the native path after any glimpseui upgrade.
