# Agent integrations

The CLI is agent-first: `scratch new` prints an onboarding prompt, every listing takes `--json`, and `scratch comments` feeds human feedback back to the agent.

## Claude Code plugin

This repo doubles as a plugin marketplace. The plugin ships the `scratch` skill so the agent knows when and how to drive the CLI:

```
/plugin marketplace add NikiforovAll/scratchpad
/plugin install scratchpad@scratchpad
```

## pi package

For the [pi coding agent](https://pi.dev), `@nikiforovall/pi-scratchpad` ships the same skills plus viewer commands:

```
pi install npm:@nikiforovall/pi-scratchpad
```

```
/scratch ui        # open the viewer from a session
/scratch export    # export the current pad
/scratch stop      # close the viewer
```

## A typical agent session

1. Agent runs `scratch new "research-auth" --dir _scratchpads` and follows the printed prompt.
2. It writes findings, snippets, and command output into the pad, registering each with `--desc`.
3. You run `scratch ui research-auth`, read, tick checkboxes, leave inline comments.
4. Next session, the agent runs `scratch comments research-auth --json` and picks up where you left off.
