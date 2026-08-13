# The CLI loop

Four steps, no magic. The CLI never authors, copies, or moves content — it only creates the pad dir, writes the manifest, and tracks metadata.

## 1. Create

```bash
scratch new "feature-tour" --dir examples
```

`--dir` is **required** — placement is always deliberate. This prints an onboarding prompt an agent can follow.

## 2. Write

Write files into the pad dir with your normal tools (editor, agent, `>` redirect — anything).

## 3. Register

```bash
scratch add feature-tour notes.md \
  --title "Session notes" \
  --desc "why this file exists — the most valuable field" \
  --type note --tag research,v2 --group "Research"
```

Re-running `add` on the same path updates its metadata. Types: `note` · `snippet` · `output` · `artifact` · `reference`.

## 4. Inspect & browse

```bash
scratch ls                    # pads under the root
scratch ls feature-tour       # files in this pad
scratch show feature-tour cli-workflow.md
scratch ui feature-tour       # this viewer
```

Every listing command takes `--json` for machine consumption.

## Cleanup

```bash
scratch rm feature-tour notes.md   # unregister — file stays on disk
scratch rm feature-tour --force    # delete the whole pad
```

## Addressing

Pads resolve by **name** within a scanned root, or by an explicit **path**. Root order: `--dir` → `$SCRATCH_DIR` → current directory.
