# Examples: Planning with Scratchpad

> Layouts below omit the `scratchpad.json` manifest each pad carries. Create the pad with `scratch new "<task>" --dir _plans`, write the files, then `scratch add` each one.

## Example 1: Bug Fix (Minimal - plan.md only)

**User Request:** "Fix the login bug in the authentication module"

**Files Created:**
```
_plans/2026-01-08-fix-login-bug/
  plan.md
```

### plan.md

```markdown
# Plan: Fix Login Bug

## Goal
Identify and fix the bug preventing successful login.

## Phases
- [x] Phase 1: Understand the bug report
- [x] Phase 2: Locate relevant code
- [x] Phase 3: Identify root cause
- [ ] Phase 4: Implement fix
- [ ] Phase 5: Test and verify

## Status
**Current:** Found root cause, preparing fix

## Decisions
- Auth handler is in src/auth/login.ts
- Error occurs in validateToken() function

## Errors Encountered
- TypeError: Cannot read property 'token' of undefined
  → Root cause: user object not awaited properly
```

---

## Example 2: Research Task (plan.md + research.md)

**User Request:** "Investigate API rate limiting options for our service"

**Files Created:**
```
_plans/2026-01-08-api-rate-limiting-research/
  plan.md
  research.md
```

### plan.md

```markdown
# Plan: API Rate Limiting Research

## Goal
Evaluate rate limiting strategies and recommend an approach.

## Phases
- [x] Phase 1: Research existing solutions
- [x] Phase 2: Evaluate options against our requirements
- [ ] Phase 3: Write recommendation

## Status
**Current:** Synthesizing findings, preparing recommendation

## Decisions
- Focus on token bucket and sliding window algorithms
- Must support distributed deployment
```

### research.md

```markdown
# Research: API Rate Limiting

## Sources

### Redis Rate Limiting
- URL: https://redis.io/commands/incr
- Key points:
  - INCR with EXPIRE for simple counting
  - Lua scripts for atomic operations
  - Built-in support in redis-cell module

### Token Bucket Algorithm
- Key points:
  - Allows bursts up to bucket size
  - Smooth rate over time
  - Easy to understand and implement

### Sliding Window
- Key points:
  - More accurate than fixed windows
  - Higher memory overhead
  - Better for strict rate enforcement

## Findings

### Algorithm Comparison
| Algorithm | Burst Handling | Memory | Complexity |
|-----------|---------------|--------|------------|
| Token Bucket | Good | Low | Low |
| Sliding Window | Poor | High | Medium |
| Leaky Bucket | None | Low | Low |

### Our Requirements Match
- Need burst handling → Token Bucket
- Distributed system → Redis-backed
- Simple implementation → redis-cell module
```

---

## Example 3: Feature Development (plan.md + decisions.md)

**User Request:** "Add dark mode toggle to settings"

**Files Created:**
```
_plans/2026-01-08-dark-mode-toggle/
  plan.md
  decisions.md
```

### plan.md

```markdown
# Plan: Dark Mode Toggle

## Goal
Add functional dark mode toggle to settings page.

## Phases
- [x] Phase 1: Research existing theme system
- [x] Phase 2: Design implementation approach
- [ ] Phase 3: Implement toggle component
- [ ] Phase 4: Add theme switching logic
- [ ] Phase 5: Test and polish

## Status
**Current:** Building toggle component

## Errors Encountered
- CSS variables not updating on Safari
  → Added -webkit-transition property
```

### decisions.md

```markdown
# Decisions: Dark Mode Toggle

## Theme Storage Mechanism
**Status:** Decided

**Options:**
1. localStorage - Simple, persists across sessions, no server sync
2. User preferences API - Syncs across devices, requires backend
3. Cookie - Works with SSR, limited size

**Choice:** localStorage
**Rationale:** No backend changes needed, sufficient for MVP. Can migrate to API later.

## CSS Approach
**Status:** Decided

**Options:**
1. CSS custom properties - Modern, easy to switch, good browser support
2. Separate stylesheets - Clean separation, but doubles CSS size
3. CSS-in-JS - Dynamic, but adds runtime overhead

**Choice:** CSS custom properties
**Rationale:** Already using them for colors. Just need to swap variable values.

## Default Theme
**Status:** Decided

**Choice:** System preference via prefers-color-scheme
**Rationale:** Respects user OS settings, good UX practice.
```

---

## Example 4: Complex Refactor (All File Types)

**User Request:** "Refactor the user service to use the new repository pattern"

**Files Created:**
```
_plans/2026-01-08-user-service-refactor/
  plan.md
  research.md
  decisions.md
  scratch.md
```

### scratch.md (Working Notes)

```markdown
# Scratch: User Service Refactor

## Current Structure
- UserService directly calls database
- Business logic mixed with data access
- Tests require database connection

## Target Structure
- UserService → UserRepository → Database
- Repository handles data mapping
- Service contains pure business logic

## Files to Change
1. src/services/user.service.ts - Remove DB calls
2. src/repositories/user.repository.ts - New file
3. src/interfaces/user-repository.interface.ts - New file
4. tests/user.service.test.ts - Mock repository

## Draft Interface
```typescript
interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  save(user: User): Promise<User>;
  delete(id: string): Promise<void>;
}
```

## Questions to Resolve
- [ ] Use class or functional repository?
- [ ] How to handle transactions?
- [ ] Migration strategy for existing code?
```

---

## Example 5: Error Recovery Pattern

When something fails, log it and adapt:

### Wrong Approach
```
Action: Read config.json
Error: File not found
Action: Read config.json  # Silent retry
Action: Read config.json  # Another retry
```

### Correct Approach
```
Action: Read config.json
Error: File not found

# Update plan.md:
## Errors Encountered
- config.json not found → Will create default config

Action: Write config.json (default config)
Action: Read config.json
Success!
```

The error and resolution are now documented for future reference.

---

## The Read-Before-Decide Pattern

After many tool calls, refresh goals by reading the plan:

```
[20+ tool calls have happened...]
[Context is getting long...]
[Original goal might be out of attention...]

→ Read plan.md            # Brings goals back into attention
→ Make the decision       # Goals are fresh in context
```

This prevents drift on complex tasks. Use it when:
- You've made 20+ tool calls
- You're about to make a significant decision
- You feel uncertain about the original goal

Don't overuse it - reading before every small action adds overhead.

---

## File Type Selection Guide

| Task Type | Files to Create |
|-----------|-----------------|
| Simple bug fix | `plan.md` |
| Feature with tradeoffs | `plan.md` + `decisions.md` |
| Research/investigation | `plan.md` + `research.md` |
| Complex refactor | `plan.md` + `research.md` + `decisions.md` + `scratch.md` |
| Documentation task | `plan.md` + `[deliverable].md` |

Start minimal. Add file types as the task demands them.
