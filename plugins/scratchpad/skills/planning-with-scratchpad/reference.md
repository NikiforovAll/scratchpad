# Reference: Manus Context Engineering Principles

Background reading on the principles behind this skill. Based on context engineering practices from Manus.

## The 6 Principles

### 1. Filesystem as External Memory

> "Markdown is my 'working memory' on disk."

Context windows have limits. Treat the filesystem as unlimited memory:
- Store large content in files
- Keep only paths in context
- Agent can "look up" information when needed

### 2. Attention Manipulation Through Repetition

After ~50 tool calls, models forget original goals ("lost in the middle" effect).

Solution: Keep a plan file that gets RE-READ throughout execution:
```
Start of context: [Original goal - far away, forgotten]
...many tool calls...
End of context: [Recently read plan.md - gets ATTENTION!]
```

By reading the plan before decisions, goals appear in the attention window.

### 3. Keep Failure Traces

> "Error recovery is one of the clearest signals of TRUE agentic behavior."

KEEP failed actions visible:
```markdown
## Errors Encountered
- FileNotFoundError: config.json not found → Created default config
- API timeout → Retried with exponential backoff, succeeded
```

The model updates its internal understanding when seeing failures.

### 4. Avoid Few-Shot Overfitting

> "Uniformity breeds fragility."

Repetitive action-observation pairs cause drift and hallucination. Introduce controlled variation:
- Vary phrasings slightly
- Don't copy-paste patterns blindly
- Recalibrate on repetitive tasks

### 5. Stable Prefixes for Cache Optimization

Agents are input-heavy (100:1 ratio). Structure for cache hits:
- Put static content FIRST
- Append-only context (never modify history)
- Consistent serialization

### 6. Append-Only Context

NEVER modify previous messages. Always append new information. Modifying previous messages invalidates KV-cache.

## Key Statistics

| Metric | Value |
|--------|-------|
| Average tool calls per task | ~50 |
| Input-to-output ratio | 100:1 |

## Key Quotes

> "If the model improvement is the rising tide, we want Manus to be the boat, not the piling stuck on the seafloor."

> "For complex tasks, I save notes, code, and findings to files so I can reference them as I work."

> "I used file.edit to update checkboxes in my plan as I progressed, rather than rewriting the whole file."

## Source

Based on Manus's context engineering documentation:
https://manus.im/de/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus
