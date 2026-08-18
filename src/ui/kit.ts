// Embed kit — design tokens + element defaults + SVG utility classes baked into
// every ![](file.html) embed's sandboxed iframe (see htmlFrameDoc in render.ts).
// Ported from sibling project `sideshow` (server/snippetPage.ts) so an agent
// authoring a scratch diagram reuses the same vocabulary. Documented as a
// reference table in skills/scratch/references/HTML_DESIGN_GUIDE.md — keep in sync.
//
// Difference from sideshow: sideshow switches tokens via @media
// (prefers-color-scheme), which follows the OS. scratch forces the scheme from
// the viewer's own theme toggle, so every themed value uses CSS light-dark() and
// htmlFrameDoc sets `color-scheme` to the resolved scheme — the kit then tracks
// the viewer theme, not the OS. (light-dark() is Chromium 2024+; WebView2 is
// evergreen Chromium, and exported pages target modern browsers.)
//
// CSS rules override SVG presentation attributes, so bare element selectors must
// never set properties diagrams commonly set via attributes (fill/font-size on
// text) — that's why text styling is opt-in via .t/.ts/.th classes.
//
// Scrollbars use the standard scrollbar-width/-color: in Chromium, touching
// ::-webkit-scrollbar opts the element out of the standard path entirely. Transparent
// track so the bar overlays the author's background instead of painting a gutter. It
// only ever shows in full-window mode — inline embeds are sized to their content.

// The kit's page background, exported because the HOST stylesheet has to paint the
// iframe ELEMENT the same color (theme.ts --embed-paper) — the frame's scrollbar track
// is transparent, so the element behind it is what paints the scroll gutter. Shared
// rather than retyped so the two can't drift apart.
export const KIT_BG = { light: "#ffffff", dark: "#2a2925" };

export const KIT_CSS = `
:root {
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --font-serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --border-radius-md: 8px;
  --border-radius-lg: 12px;
  --border-radius-xl: 16px;
  --color-background-primary: light-dark(${KIT_BG.light}, ${KIT_BG.dark});
  --color-background-secondary: light-dark(#f5f4ed, #21201c);
  --color-background-tertiary: light-dark(#faf9f5, #1b1a17);
  --color-background-info: light-dark(#e6f1fb, rgba(55, 138, 221, 0.18));
  --color-background-danger: light-dark(#fcebeb, rgba(226, 75, 74, 0.18));
  --color-background-success: light-dark(#eaf3de, rgba(151, 196, 89, 0.18));
  --color-background-warning: light-dark(#faeeda, rgba(239, 159, 39, 0.18));
  --color-text-primary: light-dark(#1a1915, #eceadf);
  --color-text-secondary: light-dark(#5f5e56, #b3b1a4);
  --color-text-tertiary: light-dark(#8e8d83, #8a887c);
  --color-text-info: light-dark(#185fa5, #85b7eb);
  --color-text-danger: light-dark(#a32d2d, #f09595);
  --color-text-success: light-dark(#3b6d11, #c0dd97);
  --color-text-warning: light-dark(#854f0b, #fac775);
  --color-border-primary: light-dark(rgba(20, 20, 10, 0.4), rgba(255, 255, 250, 0.4));
  --color-border-secondary: light-dark(rgba(20, 20, 10, 0.25), rgba(255, 255, 250, 0.25));
  --color-border-tertiary: light-dark(rgba(20, 20, 10, 0.12), rgba(255, 255, 250, 0.12));
  --color-border-info: #378add;
  --color-border-danger: #e24b4a;
  --color-border-success: #97c459;
  --color-border-warning: #ef9f27;
  --c-teal-bg: light-dark(#e1f4f1, rgba(31, 169, 150, 0.18));
  --c-teal-line: #1fa996;
  --c-teal-text: light-dark(#0c6e62, #6fd0c2);
  --c-coral-bg: light-dark(#fdece5, rgba(232, 131, 94, 0.18));
  --c-coral-line: #e8835e;
  --c-coral-text: light-dark(#a44f28, #f0a987);
}
/* Deliberately NO overscroll containment here: an embed sized to its content never
   scrolls, so containing it only meant "this embed swallows the wheel" — the article
   behind it would not move and the reader could not scroll past the embed at all.
   Native scroll chaining is what an inline embed wants. Full window is already covered
   without it: the one case where the frame hides the article has
   :root[data-focus] .preview{overflow:hidden} (theme.ts), so there is nothing behind
   the frame left to chain into. */
/* The page gutter lives HERE, not on body: the kit is prepended to the author's
   document, so a body padding rule of theirs wins the cascade — a compact
   4px-0 (or a 0 reset) left the drawing flush against the frame's edge with
   nothing to breathe. Authors style body, essentially never html, so the viewer
   keeps the breathing room and their own padding stacks inside it. Setting
   html padding 0 is the deliberate opt-out for an embed that must bleed to the
   edge. The gutter still paints in the page color: html stays background-less,
   so body's background propagates to the canvas and covers the whole frame. */
html { box-sizing: border-box; padding: 16px; scrollbar-width: thin;
  scrollbar-color: var(--color-border-secondary) transparent; }
*, *::before, *::after { box-sizing: inherit; }
body {
  margin: 0;
  display: flow-root;
  background: var(--color-background-primary);
  color: var(--color-text-primary);
  font: 16px/1.6 var(--font-sans);
}
button {
  font: 500 14px/1.4 var(--font-sans);
  color: var(--color-text-primary);
  background: none;
  border: 0.5px solid var(--color-border-secondary);
  border-radius: var(--border-radius-md);
  padding: 6px 14px;
  cursor: pointer;
}
button:hover { background: var(--color-background-secondary); }
input:not([type=checkbox]):not([type=radio]):not([type=range]), select, textarea {
  font: 14px/1.4 var(--font-sans);
  color: var(--color-text-primary);
  background: var(--color-background-primary);
  border: 0.5px solid var(--color-border-secondary);
  border-radius: var(--border-radius-md);
  padding: 6px 10px;
  outline: none;
}
input:focus, select:focus, textarea:focus { border-color: var(--color-border-info); }
input::placeholder, textarea::placeholder { color: var(--color-text-tertiary); }
textarea { resize: vertical; }
input[type=checkbox], input[type=radio], input[type=range], progress {
  accent-color: var(--color-border-info);
}
svg { font-family: var(--font-sans); fill: var(--color-text-primary); }
.t { font-size: 14px; }
.ts { font-size: 12px; fill: var(--color-text-secondary); }
.th { font-size: 14px; font-weight: 500; }
.box { fill: var(--color-background-secondary); stroke: var(--color-border-tertiary); rx: 8px; }
.arr { stroke: var(--color-text-secondary); stroke-width: 1.2; fill: none; }
.leader { stroke: var(--color-border-secondary); stroke-width: 1; stroke-dasharray: 3 4; fill: none; }
.node { cursor: pointer; }
.node:hover { opacity: 0.75; }
.c-blue, .c-blue .box { fill: var(--color-background-info); stroke: var(--color-border-info); }
.c-blue text, text.c-blue { fill: var(--color-text-info); stroke: none; }
.c-teal, .c-teal .box { fill: var(--c-teal-bg); stroke: var(--c-teal-line); }
.c-teal text, text.c-teal { fill: var(--c-teal-text); stroke: none; }
.c-amber, .c-amber .box { fill: var(--color-background-warning); stroke: var(--color-border-warning); }
.c-amber text, text.c-amber { fill: var(--color-text-warning); stroke: none; }
.c-coral, .c-coral .box { fill: var(--c-coral-bg); stroke: var(--c-coral-line); }
.c-coral text, text.c-coral { fill: var(--c-coral-text); stroke: none; }
.c-green, .c-green .box { fill: var(--color-background-success); stroke: var(--color-border-success); }
.c-green text, text.c-green { fill: var(--color-text-success); stroke: none; }
.c-red, .c-red .box { fill: var(--color-background-danger); stroke: var(--color-border-danger); }
.c-red text, text.c-red { fill: var(--color-text-danger); stroke: none; }
.c-gray, .c-gray .box { fill: var(--color-background-secondary); stroke: var(--color-border-secondary); }
.c-gray text, text.c-gray { fill: var(--color-text-secondary); stroke: none; }

/* Component vocabulary — ported from sideshow's opt-in "issues" kit (server/kits.ts).
   sideshow ships these per-surface (kits:[...]); scratch has no per-embed opt-in
   channel (embeds are loose files referenced by path), so — consistent with the
   rest of this kit — they are baked in unconditionally. They are inert class
   definitions: an embed pays nothing until it writes the classes. Documented in
   skills/scratch/references/HTML_DESIGN_GUIDE.md — keep in sync.
   Layout + text helpers. */
.stack { display: flex; flex-direction: column; gap: 8px; }
.stack.sm { gap: 4px; } .stack.lg { gap: 16px; }
.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.row.sm { gap: 4px; }
.between { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.grow { flex: 1; min-width: 0; }
.title { font: 500 15px/1.35 var(--font-sans); color: var(--color-text-primary); }
.dim { color: var(--color-text-secondary); } .faint { color: var(--color-text-tertiary); }
.mono { font-family: var(--font-mono); } .num { font-variant-numeric: tabular-nums; }
.hr { height: 1px; border: 0; margin: 2px 0; background: var(--color-border-secondary); }
.kbd { font: 400 12px/1 var(--font-mono); padding: 2px 6px;
  border: 1px solid var(--color-border-secondary); border-bottom-width: 2px; border-radius: 6px;
  background: var(--color-background-secondary); color: var(--color-text-secondary); }
/* Cards, status badges/dots, mono ref chips, rollup bars, nesting tree rail
   (.tree → nest another .tree to indent) — composes an issue/PR/CI tree,
   a status board, or a dependency tree. */
.card { background: var(--color-background-primary); border: 1px solid var(--color-border-secondary);
  border-radius: var(--border-radius-lg); padding: 14px 16px; }
.card.soft { background: var(--color-background-secondary); }
.badge { display: inline-flex; align-items: center; gap: 5px; font: 500 12px/1.4 var(--font-sans);
  padding: 2px 9px; border-radius: 999px;
  background: var(--color-background-secondary); color: var(--color-text-secondary); }
.badge.ok { background: var(--color-background-success); color: var(--color-text-success); }
.badge.info { background: var(--color-background-info); color: var(--color-text-info); }
.badge.warn { background: var(--color-background-warning); color: var(--color-text-warning); }
.badge.danger { background: var(--color-background-danger); color: var(--color-text-danger); }
.chip { display: inline-flex; align-items: center; gap: 4px; font: 400 12px/1.4 var(--font-mono);
  padding: 1px 7px; border-radius: var(--border-radius-md);
  border: 1px solid var(--color-border-secondary); color: var(--color-text-secondary); }
.dot { width: 8px; height: 8px; border-radius: 999px; background: var(--color-text-tertiary); flex: none; }
.dot.ok { background: var(--color-text-success); } .dot.info { background: var(--color-text-info); }
.dot.warn { background: var(--color-text-warning); } .dot.danger { background: var(--color-text-danger); }
.bar { height: 6px; border-radius: 999px; background: var(--color-background-secondary); overflow: hidden; }
.bar > i { display: block; height: 100%; border-radius: inherit; background: var(--color-text-success); }
.tree { display: flex; flex-direction: column; gap: 7px; margin: 0; padding: 0; list-style: none; }
.tree .tree { margin-top: 7px; margin-left: 9px; padding-left: 14px;
  border-left: 1px solid var(--color-border-secondary); }
`;

// Shared SVG defs — inline SVGs reference #arrow by id; the arrowhead inherits
// the referencing line's stroke color via context-stroke.
export const KIT_SVG_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker></defs></svg>`;
