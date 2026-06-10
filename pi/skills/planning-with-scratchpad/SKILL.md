---
name: planning-with-scratchpad
description: Use when user explicitly requests planning with a scratchpad, or asks for persistent tracking of a complex task that the human can browse visually. Backs planning files with the `scratch` CLI so a pad's files are registered and viewable.
---

# Planning with Scratchpad

Use persistent markdown files as external memory for complex tasks. Files survive context limits and session boundaries. The files live in a **scratchpad** (a `_plans/` folder + manifest) so the human can browse the plan in the visual viewer.

**Load the `scratch` skill first** — it owns all CLI mechanics (`new`, `add`, `ls`, `show`, `ui`). This skill adds the planning conventions on top.

## Bundled References

Read these when you need deeper guidance on a specific aspect:

- **[reference.md](reference.md)** — Context engineering principles (Manus-inspired). Read when designing how to structure planning files for a long-running or multi-agent task.
- **[examples.md](examples.md)** — Real task examples showing different file combinations. Read when unsure which files to create for a given task shape.

## When to Use

- User explicitly requests planning/tracking with a scratchpad
- Complex multi-session tasks
- Research-heavy work requiring persistent notes
- Tasks where decisions and rationale need to be preserved

## When NOT to Use

- Simple single-session tasks (use Plan Mode instead)
- Quick fixes or small changes
- Tasks with clear requirements needing no research

## Directory Convention

One pad per task, created in `_plans/` with a date-prefixed folder:

```
scratch new "<task-name>" --dir _plans --id "$SESSION_ID"
```

This creates `_plans/YYYY-MM-DD-<slug>/`. Write files into that folder with your normal tools, then **register each** with `scratch add` so it appears in the viewer:

```
_plans/
  2026-01-08-dark-mode-toggle/
    scratchpad.json          # manifest (managed by scratch)
    plan.md
    research-css-strategies.md
    decisions.md
  2026-01-09-api-auth-refactor/
    scratchpad.json
    plan.md
    research-auth-providers.md
    research-token-storage.md
    decision-oauth-vs-saml.md
    decision-session-strategy.md
    references.md
    scratch-migration-steps.md
```

**Naming:** `YYYY-MM-DD-task-name` (kebab-case, concise description) — `scratch new` derives this from the task name + date.

## File Types — One Concern Per File

Each file owns a single concern. **When in doubt, create a new file.** A pad with 8 focused files is better than one with 3 bloated ones. Split early — you can always cross-reference with relative links. Register each file with `scratch add --type`.

The table below is a **starting point, not an exhaustive list**. Invent file names that match your task. If a concern doesn't fit a pattern below, name it after the concern and create it anyway.

| Pattern | Concern | `--type` |
|---------|---------|----------|
| `plan.md` | Goal, phases, status — the index | `note` |
| `errors.md` | Errors encountered + resolutions. One running log. | `note` |
| `research-<topic>.md` | Findings for one topic. One file per topic. | `reference` |
| `decision-<name>.md` | One ADR: options, rationale, choice | `note` |
| `scratch-<label>.md` | Drafts, working notes, exploratory code. Disposable. | `snippet` |
| `<deliverable>.md` | Final output: report, summary, spec | `artifact` |
| `references.md` | Links to external resources, docs, prior art | `reference` |
| **`<anything>-<label>.md`** | **Any other distinct concern — name it and create it** | pick closest |

**Examples of task-specific files you should create freely:**

```
api-shape.md           # sketching the API surface before implementing
risk-<area>.md         # risks identified for a specific area
constraints.md         # hard limits discovered during research
timeline.md            # sequencing and dependency notes
test-plan.md           # what to verify and how
migration-steps.md     # ordered rollout steps
open-questions.md      # unresolved questions to revisit
```

Always pass `--desc "why this file exists"` — it's the most valuable metadata in the viewer.

### Split eagerly — don't wait for files to get big

Create a new file **before** the content exists, at the moment you know a distinct concern will need tracking. Triggers:

- You are about to write a second `##` heading of the same kind in any file → **split now**
- You think "I'll add this to plan.md for now" → **it needs its own file**
- A section you're about to write could stand alone as a document → **give it one**
- ~30 lines of content exist on a single concern → **extract before it grows**

`plan.md` should stay lean — it's the map, not the territory. Link to detail files:

```markdown
## Research
- [Auth providers](research-auth-providers.md)
- [Token storage](research-token-storage.md)

## Constraints
- [Hard limits](constraints.md)

## Open Questions
- [Unresolved items](open-questions.md)
```

### Templates

Copy starting templates for `plan.md`, `research-*.md`, and `decision-*.md` from **[examples.md](examples.md)**.

## Task System Integration

Planning files and tasks serve different stages:

| Stage | Tool | Purpose |
|-------|------|---------|
| **Investigation** | Planning Files | Research, decisions, rationale, error logs |
| **Execution** | TaskCreate/TaskList | Decomposed work items with dependencies |

### Workflow

```
1. scratch new "<task>" --dir _plans --id "$SESSION_ID"   # create the pad + plan.md
2. Research and document in planning files; `scratch add` each one
3. Make decisions, document rationale
4. Outline ALL tasks in plan.md first — present to user for review
5. After user approves, batch-create all tasks via TaskCreate
6. Link tasks back to planning docs
7. scratch ui "<task>" --dir _plans   # backgrounded, for the human
```

**Updating plan.md is part of the workflow, not optional bookkeeping.** After every completed unit of work — phase, decision, or error — run the Progress Checkpoint below before moving on.

### Progress Checkpoint (run after EVERY completed unit)

Three steps, in order. Do not skip or defer:

1. **Mark done** — change `- [ ]` → `- [x]` for the completed phase/task in `plan.md`
2. **Update Status** — rewrite the `## Status` line to reflect what's happening *right now*
3. **Log anything new** — append any decision to plan.md's `## Decisions`, any error to `errors.md`

Trigger conditions (any one is sufficient):
- A phase completes
- A non-obvious decision is made
- An error is encountered (even if recovered)
- You are about to start a new phase

**Example — before / after completing Phase 1:**

```markdown
# Before
## Phases
- [ ] Phase 1: Research auth providers
- [ ] Phase 2: Implement auth flow

## Status
**Current:** Researching OAuth2 options

# After
## Phases
- [x] Phase 1: Research auth providers
- [ ] Phase 2: Implement auth flow

## Status
**Current:** Starting Phase 2 — implementing /auth/login endpoint

## Decisions
- Use Auth0 over rolling our own: team lacks ops capacity for token rotation
```

This pattern keeps `plan.md` accurate for the human watching the viewer, and forces you to re-anchor on goals before context drifts.

### Outline Before Creating Tasks

Do NOT create tasks one by one as you discover them. Instead:

1. Collect all phases and tasks during investigation, write them as a checklist in `plan.md`
2. Present the full outline to the user via `AskUserQuestion` — they need to see the complete picture before committing
3. Only after approval, batch-create **all** tasks in a single pass — both phase-level and work-item tasks

This matters because the user needs to evaluate scope, reorder priorities, and spot gaps — which is impossible when tasks trickle in one at a time.

### Task Hierarchy

Create tasks at two levels:

1. **Phase tasks** — one per phase, owns the high-level goal. Mark complete when all child tasks are done.
2. **Work-item tasks** — concrete implementation steps within a phase.

Example batch after outline approval:
```
TaskCreate: subject: "Phase 1: Research auth providers"
TaskCreate: subject: "Phase 1.1: Compare OAuth2 libraries"
TaskCreate: subject: "Phase 1.2: Evaluate token storage options"
TaskCreate: subject: "Phase 2: Implement auth flow"
TaskCreate: subject: "Phase 2.1: Add OAuth2 login endpoint"
TaskCreate: subject: "Phase 2.2: Add token refresh middleware"
```

Phase tasks give the user a progress overview; work-item tasks track actual execution.

### Linking Tasks to Planning Documents

When batch-creating, reference the pad dir in each task:

```
TaskCreate:
  subject: "Add OAuth2 login endpoint"
  description: |
    Implement /auth/login endpoint.
    References: _plans/2026-01-23-auth-api/plan.md
  metadata:
    planDir: "_plans/2026-01-23-auth-api"
```

Tasks can have dependencies on each other, and all link back to the same pad directory for context.

## Recommended Tools

| Tool | When to Use |
|------|-------------|
| **Explore subagent** | Search codebase, find patterns, understand existing structure before planning |
| **AskUserQuestion** | Clarify requirements, validate assumptions, confirm decisions before proceeding |
| **scratch ui** | Open the pad in the visual viewer (backgrounded) so the human can browse the plan |

Use these proactively during investigation to avoid wrong assumptions and wasted effort.

## Success Criteria

Planning is complete when:
- [ ] A pad exists under `_plans/` with `plan.md` (clear goal and phases) registered
- [ ] All phases marked complete or explicitly deferred
- [ ] Key decisions documented with rationale
- [ ] Errors encountered are logged with resolutions
- [ ] All files registered with `scratch add` (visible in the viewer)
- [ ] User confirms deliverables via `AskUserQuestion`

## Critical Rules

### Refresh Goals Before Major Decisions

Before a significant decision or starting a new phase, re-read `plan.md`. This brings the goal back into the attention window before context drifts.

### 1. Store, Don't Stuff
Large outputs go to files, not context. Keep paths in working memory, content in files.

### 2. Log All Errors
Every error goes in `errors.md` with its resolution. This builds knowledge and shows recovery.

### 3. Decisions Need Rationale
Don't just record what you decided - record WHY. Future-you needs this context.

### 4. Run the Progress Checkpoint After Every Completed Unit
Mark the phase done, rewrite `## Status`, log decisions/errors — in that order, before starting the next thing. See the **Progress Checkpoint** section in Workflow for the exact steps. Never batch updates at the end.

## Anti-Patterns

| Don't | Do Instead |
|-------|------------|
| Create files in project root | Use a pad under `_plans/YYYY-MM-DD-name/` |
| Write files but forget to register them | `scratch add` each file so it shows in the viewer |
| State goals once and forget | Re-read plan.md when context is long |
| Finish a phase without updating plan.md | Run the Progress Checkpoint immediately — mark done, update Status, log decisions |
| Defer all plan.md updates to the end | Update after *each* completed unit so the viewer stays accurate |
| Hide errors and retry silently | Log errors with resolution |
| Stuff everything in context | Store large content in files |
| Start executing immediately | Create plan.md first for complex tasks |
| Put research + decisions + notes in one big file | One file per concern — split by topic |
| Let plan.md grow past ~80 lines | Extract sections into dedicated files, link from plan.md |
| Treat the file-type table as a closed list | Invent file names for any new concern — `constraints.md`, `open-questions.md`, etc. |
| Think "I'll add this to plan.md for now" | That thought is the signal to create a new file instead |
| Wait until a file is long before splitting | Split at the moment you identify a new distinct concern |
