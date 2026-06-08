# Integrations

`scratch` is CLI-first, but it ships first-class integrations so coding agents know **when** and **how** to drive it. Both integrations only ship skills + commands — the `scratch` CLI itself still comes from the [Bun install](/guide#install).

## Claude Code plugin

This repo doubles as a Claude Code plugin marketplace. It ships the `scratch` skill so the agent knows the loop (`new` → write → `add` → `ls` → `show`).

```
/plugin marketplace add NikiforovAll/scratchpad
/plugin install scratchpad@scratchpad
```

## pi package

For the [pi coding agent](https://pi.dev), the [`@nikiforovall/pi-scratchpad`](https://www.npmjs.com/package/@nikiforovall/pi-scratchpad) package ships the same skills **plus** viewer commands.

```
pi install npm:@nikiforovall/pi-scratchpad
```

For local development, add the package directory to `~/.pi/agent/settings.json`:

```jsonc
{ "packages": ["~\\dev\\scratchpad\\pi"] }
```

### What it ships

- **Skills** — `scratch` (the CLI loop) and `planning-with-scratchpad` (planning conventions on top). These teach the pi agent when and how to drive the CLI.
- **Commands** — the bits a plain shell call can't do well:

| Command | Does |
|---------|------|
| `/scratch ui [pad] [--browser]` | Open the viewer. Long-running, so it's launched detached. No pad → interactive picker; type a pad → tab-completion. |
| `/scratch export [pad] [-o <file>]` | Write the standalone HTML and report the path. Same pad selection as `ui`. |
| `/scratch stop` | Close viewers opened this session. |

The commands and skills surface an install hint if the `scratch` CLI is missing from PATH.

### Runtime note

The `scratch` CLI runs on **Bun**; pi extensions run on **Node**. Rather than re-implement, the pi package **shells out** to the installed CLI — so `bun add -g @nikiforovall/scratchpad` is a prerequisite.
