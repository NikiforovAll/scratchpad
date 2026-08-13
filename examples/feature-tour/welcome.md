# Welcome to scratch

A **scratchpad** is just a folder containing `scratchpad.json` — the folder path is its identity. There is no central store, no database, no lock-in. Delete the folder and it's gone.

`scratch` is a thin metadata layer over the filesystem:

- **You** (or your agent) write files with normal tools.
- The CLI registers them — *what* each file is and *why* it exists.
- The viewer renders them read-only, for humans.

Here is the whole loop, live (this widget is itself a scratch feature — an HTML file embedded with plain image syntax):

![The loop in 30 seconds](welcome-hero.html)

## This pad

This scratchpad is a **feature tour** — every file in the sidebar demonstrates one feature of scratch. Click through them:

| File | Shows off |
|------|-----------|
| [cli-workflow.md](cli-workflow.md) | The create → write → register → browse loop |
| [linked-files.md](linked-files.md) | Linking external files by reference |
| [markdown-showcase.md](markdown-showcase.md) | GFM rendering, alerts, task checkboxes, math |
| [mermaid-diagram.md](mermaid-diagram.md) | Mermaid diagrams from fenced blocks |
| [callstack-trace.md](callstack-trace.md) | Call-stack trees with change annotations |
| [snippets/manifest.ts](snippets/manifest.ts) | Code syntax highlighting |
| [charts/session-dashboard.html](charts/session-dashboard.html) | HTML artifacts embedded inline |
| [inline-comments.md](inline-comments.md) | Quote-anchored comments → back to the agent |
| [themes-and-shortcuts.md](themes-and-shortcuts.md) | 17 color themes, keyboard shortcuts |
| [export-and-share.md](export-and-share.md) | Single-file HTML export (this very page!) |
| [integrations.md](integrations.md) | Claude Code plugin & pi package |

> [!TIP]
> You are probably reading this as a `scratch export`: a single self-contained HTML file. The native viewer (`scratch ui`) looks exactly the same.
