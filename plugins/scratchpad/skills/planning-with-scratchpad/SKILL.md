---
name: planning-with-scratchpad
description: Use when user explicitly requests planning with a scratchpad, or asks for persistent tracking of a complex task that the human can browse visually. Backs planning files with the `scratch` CLI so a pad's files are registered and viewable.
disable-model-invocation: true
---

# Planning with Scratchpad

Use persistent markdown files as external memory for complex tasks. Files survive context limits and session boundaries. The files live in a **scratchpad** (a `_plans/` folder + manifest) so the human can browse the plan in the visual viewer.

**Load the `scratch` skill first** — it owns all CLI mechanics (`new`, `add`, `ls`, `show`, `ui`). This skill adds the planning conventions on top.

Use persistent files for planning, `TaskCreate` for tracking execution. Before closing session, use `AskUserQuestion` to confirm findings, decisions, and deliverables are satisfactory.

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

Each file owns a single concern. Never merge concerns into one file — a 200-line plan.md that also contains research notes, decisions, and scratch work is hard to navigate and easy to lose track of. Split early; you can always cross-reference with relative links. Register each file with the matching `scratch add --type`.

| File | Concern | Create when | `--type` |
|------|---------|-------------|----------|
| `plan.md` | Goal, phases, status, errors | Always — this is the index | `note` |
| `research-<topic>.md` | Sources, findings for one topic | Any research needed. One file per distinct topic — e.g. `research-auth-providers.md`, `research-perf-benchmarks.md` | `reference` |
| `decisions.md` | ADRs, options, rationale | Any non-obvious tradeoff. For large efforts, split per decision: `decision-database-choice.md` | `note` |
| `scratch-<label>.md` | Drafts, working notes, exploratory code | Complex reasoning or prototyping. Disposable — can be deleted after use | `snippet` |
| `<deliverable>.md` | Final outputs | Reports, summaries, documentation | `artifact` |
| `references.md` | Links to external resources, docs, prior art | When multiple sources inform the work | `reference` |

Always pass `--desc "why this file exists"` — it's the most valuable metadata in the viewer.

### Splitting heuristic

- If a section in any file exceeds ~80 lines, extract it into its own file
- If you're about to add a second `## Research:` or `## Decision:` heading to an existing file, create a new file instead
- `plan.md` should stay lean — it's the map, not the territory. Link to detail files:
  ```markdown
  ## Research
  - [Auth providers](research-auth-providers.md)
  - [Performance](research-perf-benchmarks.md)
  ```

### plan.md Template

```markdown
# Plan: [Brief Description]

## Goal
[One sentence describing the end state]

## Phases
- [ ] Phase 1: [Description]
- [ ] Phase 2: [Description]
- [ ] Phase 3: [Description]

## Status
**Current:** [What's happening now]

## Decisions
- [Decision]: [Rationale]

## Errors Encountered
- [Error]: [Resolution]
```

### research.md Template

```markdown
# Research: [Topic]

## Sources
- [Source]: [Key findings]

## Findings
### [Category]
- [Finding]
```

### decisions.md Template

```markdown
# Decisions: [Task]

## [Decision Title]
**Status:** Decided | Pending
**Options:**
1. [Option A] - [Pros/Cons]
2. [Option B] - [Pros/Cons]

**Choice:** [Selected option]
**Rationale:** [Why]
```

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

### Refresh Goals When Context Gets Long

After many tool calls (~20+), re-read `plan.md` before major decisions. This brings goals back into the attention window.

### 1. Store, Don't Stuff
Large outputs go to files, not context. Keep paths in working memory, content in files.

### 2. Log All Errors
Every error goes in plan.md under "Errors Encountered". This builds knowledge and shows recovery.

### 3. Decisions Need Rationale
Don't just record what you decided - record WHY. Future-you needs this context.

### 4. Update Status Immediately
Mark phases complete as soon as they're done. Don't batch status updates.

## Anti-Patterns

| Don't | Do Instead |
|-------|------------|
| Create files in project root | Use a pad under `_plans/YYYY-MM-DD-name/` |
| Write files but forget to register them | `scratch add` each file so it shows in the viewer |
| State goals once and forget | Re-read plan.md when context is long |
| Hide errors and retry silently | Log errors with resolution |
| Stuff everything in context | Store large content in files |
| Start executing immediately | Create plan.md first for complex tasks |
| Put research + decisions + notes in one big file | One file per concern — split by topic |
| Let plan.md grow past ~80 lines | Extract sections into dedicated files, link from plan.md |
