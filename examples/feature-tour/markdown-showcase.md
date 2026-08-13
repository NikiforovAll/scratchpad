# Markdown showcase

Markdown renders with GitHub-flavored extras. Hit the **raw** toggle (top right, or press `v`) to see this file's source.

## Tables

| Feature | Where it lives | Status |
|---------|----------------|:------:|
| GFM tables | this file | ✅ |
| Task lists | below | ✅ |
| Footnotes | the sentence after this table | ✅ |
| Math | further down | ✅ |

Footnotes work too — like this one[^1].

[^1]: Footnotes render at the bottom of the file, and the reference is a clickable link.

## Task lists — the one write the viewer does

The viewer is read-only, with **one deliberate exception**: click a checkbox below and it flips the `[ ]`/`[x]` marker in the source file on disk. Line-addressed, verified before writing — great for agent-authored plans you review by hand.

- [x] render the pad
- [x] click a checkbox
- [ ] watch it persist to the file
- [ ] use it to track a real plan

*(In a static export, toggles live in the page until you save a copy.)*

## Math

Inline math like $O(n \log n)$ and display math render via KaTeX:

$$
\text{softmax}(x_i) = \frac{e^{x_i}}{\sum_j e^{x_j}}
$$

## Alerts

GitHub-style alerts render as callouts — all five types:

> [!NOTE]
> A pad is just a folder with a `scratchpad.json` manifest.

> [!TIP]
> Press `t` to open the theme gallery.

> [!IMPORTANT]
> The CLI never authors or moves file content — it only registers metadata.

> [!WARNING]
> Deleting the folder deletes the pad. There is no central store to recover from.

> [!CAUTION]
> `scratch rm <pad> --force` deletes the pad directory and everything in it.

## Inline HTML embeds

A markdown doc can embed a standalone `.html` file with image syntax — `![pad flow](pad-flow.html)` — and the viewer renders it live in a sandboxed iframe right here:

![pad flow](pad-flow.html)

The file is a loose asset next to the doc (never `scratch add`-ed) and uses the viewer's built-in kit, so it re-themes with light/dark. For a full-page HTML artifact, see [charts/session-dashboard.html](charts/session-dashboard.html) in the sidebar.

## Everything else

Blockquotes, images inline; oversized/binary files get a notice instead of garbage.

> Vendor libs (highlight.js, mermaid, KaTeX) are added to the page **only if a file needs them**.
