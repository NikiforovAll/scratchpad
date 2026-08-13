# Linked files

A pad can reference files that live **outside** it — the content stays where it is; the pad just gets a labeled pointer.

```bash
scratch add feature-tour ../../README.md --link --as README.md \
  --desc "the project readme, linked in place"
```

In the manifest this becomes a `FileEntry` with a `src` field:

```json
{
  "path": "README.md",
  "src": "../../README.md",
  "type": "reference",
  "description": "the project readme, linked in place"
}
```

- `path` is the file's **label inside the pad** (what you see in the sidebar).
- `src` is where the content actually lives — absolute, or relative to the pad dir.

Use it to pull a spec, an ADR, or a config from your repo into the pad's story without copying it. Unregistering a linked file (`scratch rm <pad> <label>`) removes only the pointer — the real file is never touched.
