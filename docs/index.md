---
layout: home

hero:
  name: scratch
  text: A home for agent knowledge
  tagline: Organize session notes, snippets, and artifacts into scratchpads — a folder + manifest — with a read-only visual viewer. Just files on disk, no central store, no lock-in.
  image:
    src: /demo.png
    alt: scratch viewer
  actions:
    - theme: brand
      text: Get Started
      link: /guide
    - theme: alt
      text: View on GitHub
      link: https://github.com/nikiforovall/scratchpad
    - theme: alt
      text: npm
      link: https://www.npmjs.com/package/@nikiforovall/scratchpad

features:
  - title: Durable agent memory
    details: The agent writes files and registers them with a description and type. The knowledge survives the session and stays reviewable — not buried in chat history.
  - title: A human can browse it
    details: "scratch ui opens a read-only viewer (markdown, syntax highlighting, mermaid) so you can see what the agent gathered — native window, browser fallback."
  - title: No lock-in
    details: A scratchpad is just a folder containing scratchpad.json. The CLI never authors or moves content. Delete the folder and it's gone.
  - title: Works with your agent
    details: Ships a Claude Code plugin and a pi package, so the agent knows when and how to drive the CLI.
---

## What is a scratchpad?

A scratchpad is **just a folder containing `scratchpad.json`** — the folder path is its identity. There is **no central store**.

`scratch` is a thin metadata layer over the filesystem: it initializes pads, prints how to use them, and registers files you create. **You** write and edit files with your normal tools — the CLI never authors, copies, or moves content.

## Why

Agents generate a lot of knowledge per session — notes, snippets, command output, intermediate artifacts — and it has no home. It ends up scattered across the repo, buried in chat history, or lost when the context window rolls over.

A scratchpad gives that working memory a deliberate place: a folder + `scratchpad.json` manifest, kept out of your source tree, that captures **what** each file is and **why** it exists.

## Install

Requires [Bun](https://bun.sh) — `scratch` runs on the Bun runtime.

```bash
bun add -g @nikiforovall/scratchpad   # exposes the `scratch` command
```

Then head to the [User Guide](/guide).
