# scratch — HTML diagram design guide for agents

You are authoring a standalone `.html` file that the scratch viewer transcludes
inline wherever a markdown doc references it. Unlike a live sketch surface, this
is **durable knowledge**: the file is baked into the page at render time and must
keep working offline and after `scratch export`. Read this once before your first
diagram.

## Embedding

Write `diagram.html` as a loose file **next to** the markdown doc, then reference
it with image syntax — that's the whole API:

```md
![Cache layout](diagram.html)
```

- Resolved by relative path. Do **not** `scratch add` it — it's a loose asset,
  not a registered pad file.
- The viewer reads the file at render time and inlines it as a sandboxed
  `<iframe srcdoc>`. Nothing is fetched when the page is viewed.
- To revise, just rewrite the file and reload the viewer; there is no versioning
  or publish step — git is your history.

## No feedback loop

scratch's viewer is **read-only**. A diagram is draw-only: there is no
`sendPrompt`, no `openLink`, no back-channel from the iframe to you. If you need
reviewer input, that lives at the pad level — reviewers attach inline comments in
the viewer and you read them with `scratch comments "<pad>"`. Don't build
affordances inside a diagram that expect to reach you; they can't.

## HTML contract

- Prefer a **complete standalone document** (`<!doctype html>…`) so the file also
  opens directly in a browser. A bare body fragment also renders — `srcdoc`
  auto-wraps it. (Note: opened raw in a plain browser, the file won't have the
  kit below — the kit only exists inside the viewer's iframe. Keep that in mind
  if a standalone-openable file matters to you.)
- The frame is **~760px wide** and centered; content sizes its own height
  automatically (an injected `ResizeObserver` reports it).
- `<style>` and `<script>` are allowed. Scripts run in a sandboxed,
  opaque-origin iframe — in-frame JS (animation, toggles, canvas) works; forms,
  popups, top-level navigation, storage, and host access are blocked.
- **Never use `position: fixed`, viewport-sticky layout, or `min-height: 100vh`**
  — the frame is sized to content height, so viewport-relative sizing breaks it
  (`100vh` also causes a resize feedback loop). Use normal-flow layout.
- **Keep it compact — one concept, aim for ≤ ~600px tall.** The frame grows to
  whatever you draw, so a sprawling page just makes a giant frame to scroll past.

## Built-in kit — reach for it before writing CSS

Every embed gets a kit baked in (no network, survives export). Bare `button`,
`input`, `select`, and `textarea` are pre-styled to match the viewer, hover/focus
included — write the plain element, don't restyle it. Checkboxes, radios, ranges,
and progress bars are themed via `accent-color`.

SVG utility classes, available in every embed:

| class                                                            | effect                                                                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `t` / `ts` / `th`                                                | text presets: 14px / 12px muted / 14px medium heading                                                                |
| `box`                                                            | neutral rect — secondary fill, faint stroke, rx 8                                                                    |
| `arr`                                                            | 1.2px connector line                                                                                                 |
| `leader`                                                         | dashed guide line                                                                                                    |
| `node`                                                           | pointer cursor + hover dim, for clickable shapes                                                                     |
| `c-blue` `c-teal` `c-amber` `c-coral` `c-green` `c-red` `c-gray` | color ramp: fill+stroke on shapes (or a whole `<g>`); child `<text>` auto-switches to readable ink in light and dark |

A `<marker id="arrow">` is injected into every embed — end any line with
`marker-end="url(#arrow)"` and the arrowhead inherits the line's stroke color.

```html
<svg width="100%" viewBox="0 0 680 70">
  <g class="c-blue">
    <rect class="box" x="10" y="10" width="130" height="40" />
    <text class="th" x="75" y="35" text-anchor="middle">API</text>
  </g>
  <text class="ts" x="250" y="24" text-anchor="middle">202 + job id</text>
  <line class="arr" x1="140" y1="30" x2="360" y2="30" marker-end="url(#arrow)" />
</svg>
```

## Theming — dark mode is mandatory

For anything the kit doesn't cover, use the pre-defined CSS variables — they
adapt to the viewer's light/dark theme automatically (via `light-dark()`, driven
by the resolved viewer theme, **not** the OS). Never hardcode colors;
`color: #333` is invisible in dark mode.

- Backgrounds: `--color-background-primary|secondary|tertiary` and semantic
  `-info|-danger|-success|-warning`
- Text: `--color-text-primary|secondary|tertiary`, plus the same semantic variants
- Borders: `--color-border-tertiary` (default, faint), `-secondary`, `-primary`,
  plus semantic variants
- Fonts: `--font-sans|serif|mono`; radius: `--border-radius-md|lg|xl` (8/12/16px)

Mental test: if the background were near-black, would every element still read?

## External resources — inline everything

There is **no CSP allowlist** here, but the embed is baked into the page and must
survive offline `file://` viewing and `scratch export`. So treat external
resources as forbidden: inline styles in `<style>`, scripts in `<script>`, and
images as `data:` URIs. An external `<link>` / `<script src>` / CDN font is not
blocked, but it breaks the instant the pad is exported or opened offline. The kit
above covers most styling needs without any network — prefer it over CDN libs.

## Style

- Flat and clean: no gradients, drop shadows, or decorative effects.
- Sentence case for headings and labels. No emoji.
- Two font weights only: 400 and 500.
- SVG works great — for diagrams use `<svg width="100%" viewBox="0 0 680 H">`
  with the kit classes above.
- Keep it focused: one concept per file. A series of small diagrams across the
  doc beats one giant page.
