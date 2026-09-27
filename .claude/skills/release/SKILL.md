---
name: release
description: Release the scratch CLI or the pi package: bump, tag, GitHub release, CI publishes to npm. Use for "release", "publish", "bump version" or "release candidate".
argument-hint: "[cli|pi] [version | rc]"
allowed-tools: Read, Edit, Bash(git *), Bash(gh *), Bash(bun *), Bash(npm view *)
---

# Release

The repo ships two packages, each with its own version and tag prefix:

| Package | `package.json` | Tag |
|---|---|---|
| `@nikiforovall/scratchpad` (CLI) | `package.json` | `v<version>` |
| `@nikiforovall/pi-scratchpad` | `pi/package.json` | `pi-scratchpad-v<version>` |

The tag push starts `.github/workflows/release.yml`, the only publisher. It checks the tag against `package.json`, runs the gate, packs with `bun pm pack` and publishes the tarball through npm trusted publishing. A stable CLI release then deploys the docs. Nobody publishes locally.

A version with `-` is a **prerelease**: `rc` means `0.31.0-rc.1`, or the next `-rc.N` when the current version is already one. It goes to the `rc` dist-tag, gets `--prerelease` on GitHub and skips the docs deploy.

## Steps

1. **Package.** From `$ARGUMENTS`, else from what changed since the package's last tag (`git log <last-tag>..HEAD -- <dir>`). Changes under `pi/` release the pi package; everything else releases the CLI. Done when you know which package, or both. Release each one through steps 2 to 7.

2. **Clean tree.** `git status --short` is empty and the branch is `main`. An RC may ship from another branch.

3. **Version.** Suggest one from the commits since the last tag: breaking is major, `feat` is minor, the rest is patch. Confirm it with `AskUserQuestion`, recommended option first.

4. **Gate.** CLI: `bun test`. pi: `bun build pi/extensions/scratch.ts --target=node --packages=external --outfile=<scratchpad>/check.js`. Done when it passes.

5. **Bump and push.** Edit `version` in that package's `package.json`. If `plugins/scratchpad/` changed since the last release, bump `plugins/scratchpad/.claude-plugin/plugin.json` in the same commit.
   ```bash
   git commit -am "🔖 chore(release): scratchpad <version>"   # or pi-scratchpad <version>; add ", plugin <v>"
   git push origin HEAD
   git tag <tag> && git push origin <tag>
   ```

6. **GitHub release.** Group the commits since the last tag of that package under Features (✨), Fixes (🐛) and Other. Describe what changed for a user, not raw commit messages. End with a Full Changelog compare link.
   ```bash
   gh release create <tag> --title "<tag>" --notes "<notes>" [--prerelease]
   ```

7. **Watch the run.**
   ```bash
   gh run list --workflow release.yml --limit 1
   gh run watch <run-id> --exit-status
   ```
   If it fails, fix the cause and run it again from the tag: `gh workflow run release.yml --ref <tag>`. The publish step skips a version that is already on npm. Done when the run is green and `npm view <pkg>@<version> version --prefer-online` prints the version. The registry can take a minute or two. For the CLI, `npm view @nikiforovall/scratchpad@<version> bin` must still list `scratch`.

8. **Report** the release URL, the run URL and the published version for each package.
