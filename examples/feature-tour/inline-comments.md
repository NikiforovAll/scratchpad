# Inline comments — the feedback loop

Select any text in a rendered file and the viewer offers to attach a **comment** to it. Comments are quote-anchored — they survive edits as long as the quoted text can still be found (otherwise they show as *orphaned*, never silently lost).

Try it: select this sentence and add a comment.

## Where they live

- In `scratch ui`, comments write back to the pad's `scratchpad.json`.
- In a static **export**, the saved page file is the comment store — press `Ctrl+S` to save a copy with your comments inside.

## Closing the loop with the agent

The human reviews in the viewer; the agent reads the feedback back out:

```bash
scratch comments feature-tour              # human-readable, with context lines
scratch comments feature-tour --json      # agent-friendly
scratch comments feature-tour "*.md"      # filter: exact path, glob, or substring
```

Each comment comes with the quote, its `file:line`, the nearest section heading, and surrounding context — enough for an agent to act on without re-reading the whole pad.

Press `c` to toggle comment visibility; `Ctrl+Alt+C` copies this file's comments as JSON (`Ctrl+Shift+Alt+C` for the whole pad).
