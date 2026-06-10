# @nikiforovall/pi-scratchpad

A [pi](https://pi.dev) package for [scratchpad](https://www.npmjs.com/package/@nikiforovall/scratchpad) — organize agent knowledge into *scratchpads* (a folder + `scratchpad.json` manifest) with a read-only visual viewer.

It ships:

- **Skills** — `scratch` (the CLI loop: `new` → write → `add` → `ls` → `show`) and `planning-with-scratchpad` (planning conventions on top). These teach the pi agent when and how to drive the CLI.
- **Commands** — the bits a plain shell call can't do well:
  - `/scratch ui [pad] [--browser]` — open the viewer. The viewer is long-running, so it's launched detached. No pad → interactive picker; type a pad → tab-completion.
  - `/scratch export [pad] [-o <file>]` — write the standalone HTML and report the path. Same pad selection as `ui`.
  - `/scratch stop` — close viewers opened this session.

## Requirements

The `scratch` CLI must be on your PATH (it runs on [Bun](https://bun.sh)):

```sh
bun add -g @nikiforovall/scratchpad
```

The commands and skills surface this hint if the CLI is missing.

## Install

```sh
pi install npm:@nikiforovall/pi-scratchpad
```

Or, for local development, add the package directory to `~/.pi/agent/settings.json`:

```jsonc
{ "packages": ["~\\dev\\scratchpad\\pi"] }
```
