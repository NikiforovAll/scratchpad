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

export const KIT_CSS = `
:root {
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --font-serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --border-radius-md: 8px;
  --border-radius-lg: 12px;
  --border-radius-xl: 16px;
  --color-background-primary: light-dark(#ffffff, #2a2925);
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
html { box-sizing: border-box; scrollbar-width: none; }
html::-webkit-scrollbar, body::-webkit-scrollbar { display: none; }
*, *::before, *::after { box-sizing: inherit; }
body {
  margin: 0;
  padding: 16px;
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
`;

// Shared SVG defs — inline SVGs reference #arrow by id; the arrowhead inherits
// the referencing line's stroke color via context-stroke.
export const KIT_SVG_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker></defs></svg>`;
