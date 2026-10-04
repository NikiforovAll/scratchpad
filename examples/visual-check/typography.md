# Typography stress test

This file checks font loading, weights, styles and glyph coverage. Every line should render in the intended face, with no fallback boxes (□) and no font swap after load.

## Weights and styles

Regular text. **Bold text.** *Italic text.* ***Bold italic text.*** ~~Strikethrough.~~ `inline code` and **`bold code`** and *`italic code`*.

A [link to the docs](https://github.com/NikiforovAll/scratchpad) and a **[bold link](https://example.com)** inside a sentence.

## Heading with `inline code` and a very long title that must wrap onto a second line without overlapping the next block

### H3 heading
#### H4 heading
##### H5 heading
###### H6 heading

## Punctuation and symbols

“Curly double quotes”, ‘curly single quotes’, it’s, en dash 1–9, em dash — like this, ellipsis…, non-breaking 10 km, bullet •, middle dot ·, section §, pilcrow ¶, dagger †, degree 21 °C.

Arrows → ← ↑ ↓ ⇒ ⇐ ↔ · math ≤ ≥ ≠ ≈ ± × ÷ √ ∞ ∑ · fractions ½ ¼ ¾ · currency € £ ¥ ₴ ₹ $ · trademark © ® ™.

## Latin extended

café, naïve, façade, Zürich, Ærøskøbing, Łódź, Kraków, Ångström, São Paulo, Dvořák, İstanbul, Tiếng Việt có dấu, Ðakovo.

## Cyrillic and Greek

Українська: Швидка бура лисиця перестрибує через ледачого пса. Ґанок, їжак, є.

Русский: Съешь же ещё этих мягких французских булок, да выпей чаю.

Ελληνικά: Ξεσκεπάζω την ψυχοφθόρα βδελυγμία.

## Scripts expected to fall back

These are not in the bundled fonts. They must still render through the system fallback, with no boxes:

- 日本語のテキスト · 中文文本 · 한국어 텍스트
- العربية من اليمين إلى اليسار · עברית
- Emoji: ✅ ⚠️ 🚀 🧪 📦 👍🏽

## Numbers in a table

| Metric | Before | After | Δ |
|---|---:|---:|---:|
| Export size (KB) | 333.0 | 1,118.4 | +785.4 |
| First paint (ms) | 1,111 | 888 | −223 |
| Glyph misses | 0 | 0 | 0 |
| Weights shipped | 0 | 7 | +7 |

Digits for alignment: 0123456789 · 1111111111 · 8888888888

## Lists, quotes, tasks

1. First ordered item with **bold** and *italic*
   - Nested bullet with `code`
     - Third level with a long line that wraps so we can check the hanging indent and the line height together
2. Second ordered item

> A blockquote in the reading font, with *emphasis* and a [link](https://example.com).
>
> — Attribution line

- [ ] Open task with `code`
- [x] Done task with **bold**

Footnote reference here.[^1]

[^1]: The footnote text, which is smaller and uses the same face.

## Math

Inline $e^{i\pi} + 1 = 0$ next to reading text, and display math:

$$
\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}
$$
