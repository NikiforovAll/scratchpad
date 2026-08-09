# Callstack eval

Does an agent given the `scratch` skill author call-stack blocks that actually render correctly?

Absolute score, no baseline. Every assertion is about the artifact itself — the fence is tagged, the sigils are in grammar, the annotations chip, the block copies back byte-for-byte — so a run either satisfies the rules or it doesn't, and there is nothing to compare it against.

## Layout

```
evals/evals.json          prompts + the assertions each one is scored on
scripts/grade.ts          grader + aggregator
iteration-N/
  eval-<n>-<name>/
    outputs/              the pad the agent wrote
    timing.json           tokens + duration, captured from the run notification
    grading.json          per-assertion pass/fail with evidence
  benchmark.json|.md      aggregate
```

## Running

Spawn one subagent per eval, pointing it at `plugins/scratchpad/skills/scratch/SKILL.md`
and telling it to work inside that eval's `outputs/`. Then:

```bash
bun run _evals/callstack-skill/scripts/grade.ts _evals/callstack-skill/iteration-1
```

Grading is idempotent — rerun it any time to refresh `grading.json` and `benchmark.md`.

## How grading works

The grader renders each note through `buildView` + `renderHtml`, then boots the page
in happy-dom and executes its client script — the same harness as `test/ui-dom.test.ts`.
Markdown is rendered in the browser, not in `renderHtml`, so inspecting the HTML string
alone would grade a different artifact than the one the user sees. "Every `←` annotation
actually renders as a badge" is answered by counting `.cs-b` elements in the booted DOM,
and the lossless check compares the block's `textContent` against the source fence.

An assertion that can only be answered by eye does not belong here — keep those in the
`callstack-render-lab` pad, which exists to be looked at.
