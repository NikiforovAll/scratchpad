# Code in markdown

## Inline code

Run `scratch add my-pad notes.md --type note` to register a file. Flags such as `--link`, `--as <label>` and `--group` can be combined. A path like `snippets/manifest.ts` or a key like `ui.measure` sits inside a sentence and must not break the line height.

Inline code in **bold `scratch ls`**, in *italic `scratch ui`*, in a [link to `scratchpad.json`](https://example.com) and next to punctuation: (`a`), `b`, `c`; `d`.

A long unbroken span: `C:/Users/someone/dev/scratchpad/examples/visual-check/a-very-long-file-name-that-must-wrap.md` should wrap, not overflow.

- List item with `code`
- Nested:
  - `scratch export visual-check -o out.html`

| Command | What it does |
|---|---|
| `scratch new <name>` | Creates a pad folder and its manifest |
| `scratch rm <pad> --force` | Deletes the pad folder |

### Heading with `inline code`

## Fenced blocks

TypeScript, long enough for the line-number gutter:

```ts
import { readFile } from "node:fs/promises";

export interface FileEntry {
  path: string;
  src?: string;
  title?: string;
  type?: "note" | "snippet" | "output" | "artifact" | "reference";
  tags?: string[];
}

export async function readManifest(dir: string): Promise<FileEntry[]> {
  const raw = JSON.parse(await readFile(`${dir}/scratchpad.json`, "utf8"));
  return raw.files ?? [];
}
```

JSON:

```json
{
  "version": 1,
  "name": "visual-check",
  "files": [{ "path": "alerts.md", "title": "Alerts", "tags": ["markdown"] }]
}
```

Shell, one line:

```bash
bun run scratch -- ui visual-check --dir examples
```

A long line that must scroll sideways:

```js
const settings = { themeMode: "system", colorTheme: "lab-notebook", gridStyle: "dots", wideMode: false, readingFont: "sans", readingSize: "m", measure: 70, zoom: 1, autoReload: true };
```

Diff:

```diff
-.md pre { line-height: 1.7; }
+.md pre { line-height: 1.55; }
```

No language tag:

```
plain fenced block
with two lines and no highlighting
```

Python:

```python
def slugify(name: str) -> str:
    """Lower-case a pad name and join words with hyphens."""
    return "-".join(name.lower().split())
```
