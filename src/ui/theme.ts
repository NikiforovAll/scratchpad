// Lab-Notebook design tokens → CSS. claude-code-hub design system, verbatim
// tokens. Dark-first (#101114) + warm-paper light (#e8e6e3) siblings; one ember
// accent; tonal-first depth, flat at rest; two-voice serif/mono type.

/** The 12 color variables a color theme must define, per mode. */
export interface Palette {
  ember: string;
  emberGlow: string;
  emberDim: string;
  field: string;
  surface: string;
  elevated: string;
  hover: string;
  border: string;
  ink1: string;
  ink2: string;
  ink3: string;
  inkMuted: string;
}

export interface ColorTheme {
  id: string;
  label: string;
  dark: Palette;
  light: Palette;
}

export const DEFAULT_COLOR_THEME = "ember";

// Curated registry. "ember" mirrors the :root defaults below (it has no override
// block — clearing data-color-theme is how you get it); the ports map canonical
// upstream palettes (Gruvbox, Catppuccin Mocha/Latte, Tokyo Night/Day, Solarized)
// onto the Lab-Notebook variable roles: one accent (--ember*), four surfaces
// (field→hover), one hairline (border), four-step ink ramp.
export const COLOR_THEMES: ColorTheme[] = [
  {
    id: "ember",
    label: "Ember",
    dark: {
      ember: "#e86f33", emberGlow: "#f0a070", emberDim: "rgba(232,111,51,0.25)",
      field: "#101114", surface: "#16181c", elevated: "#1e2025", hover: "#282a30",
      border: "#363840", ink1: "#f0f1f3", ink2: "#c2c4c9", ink3: "#9a9da5", inkMuted: "#7d808a",
    },
    light: {
      ember: "#e86f33", emberGlow: "#b85a20", emberDim: "rgba(184,90,32,0.18)",
      field: "#e8e6e3", surface: "#efede9", elevated: "#fbfaf9", hover: "#e0ddd7",
      border: "#cfcbc4", ink1: "#0a0a0a", ink2: "#2c2c2c", ink3: "#565656", inkMuted: "#767676",
    },
  },
  {
    id: "gruvbox",
    label: "Gruvbox",
    dark: {
      ember: "#fe8019", emberGlow: "#f9b27c", emberDim: "rgba(254,128,25,0.25)",
      field: "#1d2021", surface: "#282828", elevated: "#32302f", hover: "#3c3836",
      border: "#504945", ink1: "#ebdbb2", ink2: "#d5c4a1", ink3: "#bdae93", inkMuted: "#928374",
    },
    // Light surfaces are deliberately desaturated vs canonical gruvbox-light
    // (#f2e5bc/#f9f5d7): the full-strength yellow wash was hard to read on. Keep
    // the warm cast + gruvbox inks/accent, drop the saturation of the paper.
    light: {
      ember: "#d65d0e", emberGlow: "#af3a03", emberDim: "rgba(214,93,14,0.18)",
      field: "#ede7d5", surface: "#f3eee0", elevated: "#faf7ec", hover: "#e4dcc6",
      border: "#c9bc9d", ink1: "#3c3836", ink2: "#504945", ink3: "#665c54", inkMuted: "#7c6f64",
    },
  },
  {
    id: "catppuccin",
    label: "Catppuccin",
    dark: {
      ember: "#cba6f7", emberGlow: "#d8c2fa", emberDim: "rgba(203,166,247,0.25)",
      field: "#11111b", surface: "#181825", elevated: "#1e1e2e", hover: "#313244",
      border: "#45475a", ink1: "#cdd6f4", ink2: "#bac2de", ink3: "#a6adc8", inkMuted: "#7f849c",
    },
    light: {
      ember: "#8839ef", emberGlow: "#6f2dbd", emberDim: "rgba(136,57,239,0.18)",
      field: "#e6e9ef", surface: "#eff1f5", elevated: "#ffffff", hover: "#ccd0da",
      border: "#bcc0cc", ink1: "#4c4f69", ink2: "#5c5f77", ink3: "#6c6f85", inkMuted: "#8c8fa1",
    },
  },
  {
    id: "tokyo-night",
    label: "Tokyo Night",
    dark: {
      ember: "#7aa2f7", emberGlow: "#9ab8ff", emberDim: "rgba(122,162,247,0.25)",
      field: "#16161e", surface: "#1a1b26", elevated: "#1f2335", hover: "#292e42",
      border: "#3b4261", ink1: "#c0caf5", ink2: "#a9b1d6", ink3: "#787c99", inkMuted: "#565f89",
    },
    light: {
      ember: "#2e7de9", emberGlow: "#1659c7", emberDim: "rgba(46,125,233,0.18)",
      field: "#e1e2e7", surface: "#e9eaf0", elevated: "#f7f8fc", hover: "#d0d5e3",
      border: "#a8aecb", ink1: "#343b58", ink2: "#565a6e", ink3: "#6c6e75", inkMuted: "#848cb5",
    },
  },
  {
    id: "solarized",
    label: "Solarized",
    dark: {
      ember: "#cb4b16", emberGlow: "#e9663a", emberDim: "rgba(203,75,22,0.25)",
      field: "#002b36", surface: "#073642", elevated: "#0a4250", hover: "#11505f",
      border: "#586e75", ink1: "#93a1a1", ink2: "#839496", ink3: "#657b83", inkMuted: "#586e75",
    },
    light: {
      ember: "#cb4b16", emberGlow: "#b34a12", emberDim: "rgba(203,75,22,0.18)",
      field: "#eee8d5", surface: "#f5efdc", elevated: "#fdf6e3", hover: "#e4ddc8",
      border: "#d3cbb7", ink1: "#073642", ink2: "#586e75", ink3: "#657b83", inkMuted: "#839496",
    },
  },
];

export const COLOR_THEME_IDS = COLOR_THEMES.map((t) => t.id);

function paletteVars(p: Palette): string {
  return (
    `--ember: ${p.ember}; --ember-glow: ${p.emberGlow}; --ember-dim: ${p.emberDim}; ` +
    `--field: ${p.field}; --surface: ${p.surface}; --elevated: ${p.elevated}; ` +
    `--hover: ${p.hover}; --border: ${p.border}; ` +
    `--ink-1: ${p.ink1}; --ink-2: ${p.ink2}; --ink-3: ${p.ink3}; --ink-muted: ${p.inkMuted};`
  );
}

// Override blocks per non-default theme. Only the 12 color vars change —
// --accent-text/fonts inherit from :root, and hljs CODE blocks keep their CDN
// theme (toggled by mode, not color theme).
function colorThemeCss(): string {
  let css = "\n/* color themes (settings > theme) */\n";
  for (const t of COLOR_THEMES) {
    if (t.id === DEFAULT_COLOR_THEME) continue;
    css += `:root[data-color-theme="${t.id}"] { ${paletteVars(t.dark)} }\n`;
    css += `:root[data-color-theme="${t.id}"][data-theme="light"] { ${paletteVars(t.light)} }\n`;
  }
  return css;
}

const BASE_CSS = `
:root {
  /* dark (canonical) */
  --ember: #e86f33;
  --ember-glow: #f0a070;
  --ember-dim: rgba(232,111,51,0.25);
  --field: #101114;
  --surface: #16181c;
  --elevated: #1e2025;
  --hover: #282a30;
  --border: #363840;
  --ink-1: #f0f1f3;
  --ink-2: #c2c4c9;
  --ink-3: #9a9da5;
  --ink-muted: #7d808a;
  --accent-text: var(--ember-glow);
  --serif: 'Playfair Display', Georgia, serif;
  --mono: 'IBM Plex Mono', ui-monospace, 'Cascadia Code', Consolas, monospace;
}
:root[data-theme="light"] {
  --ember: #e86f33;
  --ember-glow: #b85a20;
  --ember-dim: rgba(184,90,32,0.18);
  --field: #e8e6e3;
  --surface: #efede9;
  --elevated: #fbfaf9;
  --hover: #e0ddd7;
  --border: #cfcbc4;
  --ink-1: #0a0a0a;
  --ink-2: #2c2c2c;
  --ink-3: #565656;
  --ink-muted: #767676;
  --accent-text: var(--ember-glow);
}

* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; overflow: hidden; }
body {
  background: var(--field);
  color: var(--ink-1);
  font-family: var(--mono);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
/* height:100% (not 100vh): CSS zoom on :root scales 100vh ABOVE the real window
   height, pushing the app's bottom below the viewport where body's overflow:hidden
   clips it (the scroll container's end becomes unreachable). The 100% chain
   (html→body→app) tracks the zoomed viewport correctly. */
.app { display: flex; flex-direction: column; height: 100%; }

/* top bar — borrowed from claude-code-hub: left brand, right icon actions */
.topbar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 12px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex: 0 0 auto;
  /* In the frameless WebView2 window this strip is the drag handle. */
  -webkit-app-region: drag;
  user-select: none;
}
.brand { display: flex; align-items: baseline; gap: 10px; overflow: hidden; }
.wordmark { font-family: var(--serif); font-weight: 500; font-size: 18px; letter-spacing: -0.02em; }
.wordmark .dot { color: var(--ember); }
.padname { font-family: var(--serif); font-size: 15px; color: var(--ink-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.view-actions { display: flex; align-items: center; gap: 10px; -webkit-app-region: no-drag; }
.icon-btn {
  width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid var(--border); border-radius: 6px;
  color: var(--ink-muted); cursor: pointer; transition: all 0.15s ease;
  text-decoration: none; padding: 0;
}
.icon-btn:hover { background: var(--hover); color: var(--ink-1); border-color: var(--ink-muted); }
.icon-btn svg { width: 16px; height: 16px; }
#closeBtn:hover { background: var(--ember); color: #fff; border-color: var(--ember); }

/* shortcuts modal */
.modal-scrim { position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { background: var(--elevated); border: 1px solid var(--border); border-radius: 10px;
  min-width: 340px; max-width: 440px; box-shadow: 0 12px 40px rgba(0,0,0,0.4); }
.modal-head { display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-bottom: 1px solid var(--border);
  font-family: var(--serif); font-size: 16px; color: var(--ink-1); }
.shortcuts { margin: 0; padding: 4px 18px 18px; }
.shortcuts > div { display: flex; align-items: center; gap: 14px; padding: 3px 0; }
.shortcuts dt { flex: 0 0 132px; margin: 0; display: flex; align-items: center; gap: 4px; }
.shortcuts dd { margin: 0; font-size: 13px; color: var(--ink-2); }
.shortcuts .sc-group { padding: 12px 0 4px; font-size: 10px; font-weight: 600;
  letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-muted); }
/* keycap chips: surface fill + thicker bottom border reads as a key */
.shortcuts kbd { display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 20px; padding: 0 5px; box-sizing: border-box;
  font-family: var(--mono); font-size: 11px; color: var(--ink-1);
  background: var(--surface); border: 1px solid var(--border);
  border-bottom-width: 2px; border-radius: 5px; }
.shortcuts .sc-plus { color: var(--ink-muted); font-size: 11px; }

/* layout */
.body { display: flex; flex: 1; min-height: 0; }
.sidebar {
  width: var(--tree-w, 340px); flex: 0 0 auto; min-height: 0;
  display: flex; flex-direction: column;
  background: var(--surface); border-right: 1px solid var(--border);
  overflow: hidden;
  transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
/* Collapse slides the pane shut instead of popping it away. Rows are
   nowrap+ellipsis, so the shrinking width clips cleanly. */
.sidebar.collapsed { width: 0; border-right: none; }
.sidebar.collapsed + .resizer { display: none; }
/* Manual drag must track the pointer 1:1 — no easing while resizing. */
.sidebar.resizing { transition: none; }
.tree { flex: 1; overflow-y: auto; padding: 14px 10px; }
/* App version, pinned to the sidebar foot (bottom-left). */
.appver { flex: 0 0 auto; padding: 6px 12px; border-top: 1px solid var(--border);
  font-family: var(--mono); font-size: 11px; color: var(--ink-muted); }
/* Drag handle between sidebar and preview. A wide hit area (easy to grab) with a
   thin centered visual line that brightens on hover/drag. */
.resizer { flex: 0 0 6px; cursor: col-resize; position: relative; background: transparent;
  margin: 0 -3px; z-index: 5; user-select: none; touch-action: none; }
.resizer::after { content: ""; position: absolute; inset: 0 auto 0 50%; width: 1px;
  transform: translateX(-50%); background: var(--border); transition: background 0.15s ease; }
.resizer:hover::after, .resizer.dragging::after { background: var(--ember); width: 2px; }
/* Recessed margin field. The optional grid (settings > background) is an
   engineering-notebook texture drawn from the ink ramp so it tracks every color
   theme + mode; it reads only in the margins around the raised .pbody card. The
   pattern is attribute-driven (data-grid on <html>) — default dots, see below. */
/* padding-bottom omitted on purpose: a scroll container's bottom padding is
   dropped from the scroll range (Chromium/WebView2), clipping the last line.
   The bottom gap lives on .pbody's margin instead, which the scroll range keeps. */
.preview { flex: 1; min-width: 0; overflow-y: auto; padding: 28px 28px 0;
  --grid: color-mix(in srgb, var(--ink-muted) 30%, transparent);
  background-color: var(--field); background-size: 22px 22px; }
/* off = no image (flat field). dots = intersections; lines = crosshatch (a touch
   fainter since lines cover more area). */
:root[data-grid="dots"] .preview {
  background-image: radial-gradient(circle, var(--grid) 1px, transparent 1.5px); }
:root[data-grid="lines"] .preview {
  --grid: color-mix(in srgb, var(--ink-muted) 18%, transparent);
  background-image:
    linear-gradient(to right, var(--grid) 1px, transparent 1px),
    linear-gradient(to bottom, var(--grid) 1px, transparent 1px); }
/* Single centered reading column, lifted onto a card surface one step up from
   the margin field so it pops in both dark & light. Everything inside shares one
   left edge and fills the column width (rendered markdown AND raw alike). */
.pbody { max-width: 1200px; margin: 0 auto 28px; padding: 34px 44px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.08), 0 6px 20px rgba(0,0,0,0.12); }
/* Wide mode (settings > width): a roomier column that still leaves a margin so
   the grid reads around the card. Off by default. */
:root[data-wide] .pbody { max-width: 95%; }

/* tree */
.label { font-size: 12px; font-weight: 500; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--ink-muted); padding: 6px 10px 10px; }
/* Stacked group headers: separate each group from the rows above it. The first
   header sits flush at the top; only subsequent ones get the gap + hairline. */
.label ~ .label { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border); }
.frow {
  display: flex; align-items: baseline; gap: 9px; cursor: pointer;
  padding: 6px 12px; border-radius: 5px;
  font-size: 14px; color: var(--ink-2); transition: all 0.15s ease;
}
.frow:hover { background: var(--hover); }
/* Active row: neutral fill + thin ember bar (a tinted pill read as noise). The
   bar sits flush against the squared-off left edge; the radius stays on the right. */
.frow.active { color: var(--ink-1); background: var(--hover);
  box-shadow: inset 2px 0 0 var(--ember); border-radius: 0 5px 5px 0; }
.frow.unreg { color: var(--ink-muted); font-style: italic; }
.frow .fttl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.frow .ftag { color: var(--ink-muted); font-size: 11px; }

/* preview */
/* header strip: filename crumb (left) + rendered/raw controls (right), with a
   hairline rule under it so the title block below reads as one grouped unit. */
.phead { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding-bottom: 10px; margin-bottom: 14px; border-bottom: 1px solid var(--border); }
.pfile { font-family: var(--mono); font-size: 12px; color: var(--accent-text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* file dates ride the right edge of the header strip, next to the controls */
.pdates { margin-left: auto; font-family: var(--mono); font-size: 11px;
  color: var(--ink-muted); white-space: nowrap; flex-shrink: 0; }
.ptitle { font-family: var(--serif); font-weight: 500; font-size: 22px; line-height: 1.2; margin: 0 0 4px; }
.pmeta { font-family: var(--mono); font-size: 12px; color: var(--ink-muted);
  letter-spacing: 0.02em; margin-bottom: 6px; }
.pdesc { color: var(--ink-3); font-size: 13px; margin: 4px 0 18px; }
.divider { border: 0; border-top: 1px solid var(--border); margin: 14px 0 20px; }

/* markdown — fills the reading column (width governed by .pbody). Body copy sits
   one step down the ink ramp so bold (full-strength + heavier) clearly stands out;
   heading levels are color-coded down the ember ramp for at-a-glance hierarchy. */
/* Single sizing knob: heading sizes below are em-relative, so adjusting this one
   font-size scales the whole reading column proportionally. */
.md { max-width: 100%; color: var(--ink-2); font-size: 15px; line-height: 1.7; }
.md strong, .md b { font-weight: 700; color: var(--ink-1); }
.md h1, .md h2, .md h3, .md h4, .md h5, .md h6 {
  font-family: var(--serif); font-weight: 600; line-height: 1.25; margin: 1.4em 0 0.5em; }
/* Stepped progression: h1 accent, then a uniform size + ink-ramp descent. */
.md h1 { font-size: 1.625em; color: var(--ember-glow); }
.md h2 { font-size: 1.3125em; color: var(--ink-1); border-bottom: 1px solid var(--border); padding-bottom: 0.25em; }
.md h3 { font-size: 1.125em; color: var(--ink-1); }
.md h4 { font-size: 1em; color: var(--ink-2); }
.md h5 { font-size: 0.875em; color: var(--ink-3); }
.md h6 { font-size: 0.8125em; color: var(--ink-muted); }
.md p { margin: 0.7em 0; }
.md a { color: var(--accent-text); text-decoration: none; border-bottom: 1px solid var(--ember-dim); }
.md ul, .md ol { padding-left: 1.4em; margin: 0.6em 0; }
.md li { margin: 0.2em 0; }
/* GFM task list items: hanging checkbox, checked ones tinted green.
   NOT a flex container — flex would make every inline fragment (each text run
   AND each inline <code>) its own flex item, scattering the sentence. The text
   must flow as normal inline content; only the checkbox hangs (absolute). */
.md li.task { list-style: none; margin-left: -1.4em; padding-left: 1.6em; position: relative; }
.md li.task .chk { position: absolute; left: 0; top: 0.28em;
  display: inline-flex; align-items: center; justify-content: center;
  width: 1.05em; height: 1.05em;
  border: 1.5px solid var(--ink-muted); border-radius: 3px; font-size: 0.8em; color: transparent; }
.md li.task.done .chk { background: #2ea043; border-color: #2ea043; color: #fff; }
.md li.task.done { color: var(--ink-3); }
.md blockquote { border-left: 2px solid var(--border); margin: 0.8em 0; padding: 0 0 0 14px; color: var(--ink-3); }
.md hr { border: 0; border-top: 1px solid var(--border); margin: 1.4em 0; }
.md code { font-family: var(--mono); font-size: 0.9em;
  background: color-mix(in srgb, var(--ink-muted) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  border-radius: 3px; padding: 1px 5px; }
.md pre { background: color-mix(in srgb, var(--ink-muted) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 6px; padding: 12px 14px; overflow-x: auto; margin: 0.9em 0; }
.md pre code { background: none; border: 0; padding: 0; font-size: 14px; line-height: 1.7; }
.md table { border-collapse: collapse; margin: 1em 0; font-size: 13px; width: 100%; display: block; overflow-x: auto; }
.md th, .md td { border: 1px solid var(--border); padding: 6px 11px; text-align: left; vertical-align: top; }
.md thead th { background: color-mix(in srgb, var(--ink-muted) 12%, transparent); color: var(--ink-1); font-weight: 600; }
.md tbody tr:nth-child(even) { background: color-mix(in srgb, var(--ink-muted) 5%, transparent); }

/* code / raw — larger, more readable monospace for source/raw views */
pre.code { font-family: var(--mono); font-size: 15px; line-height: 1.75;
  background: color-mix(in srgb, var(--ink-muted) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 6px; padding: 14px 16px; margin: 0;
  /* wrap long lines instead of truncating; break only at whitespace so words/
     tokens stay intact, with overflow-wrap as the last resort for unbreakable runs */
  white-space: pre-wrap; word-break: normal; overflow-wrap: anywhere; tab-size: 2; }
.imgwrap { display: flex; justify-content: center; padding: 12px 0; }
.imgwrap img { max-width: 100%; max-height: 80vh; object-fit: contain;
  border: 1px solid var(--border); border-radius: 6px; background: var(--elevated); }
.notice { color: var(--ink-muted); font-size: 13px; padding: 20px 0; }
.htmlframe { width: 100%; height: 75vh; border: 1px solid var(--border);
  border-radius: 6px; background: #fff; }

/* preview header controls */
.pctrls { display: inline-flex; gap: 6px; margin-left: 8px; }
.pbtn { display: inline-flex; align-items: center; gap: 4px; line-height: 1;
  background: var(--field); color: var(--ink-muted); border: 1px solid var(--border);
  border-radius: 4px; padding: 3px 8px; font-family: var(--mono); font-size: 11px; cursor: pointer;
  transition: all 0.15s ease; }
.pbtn:hover { background: var(--hover); color: var(--ink-1); }
.pbtn.on { color: var(--accent-text); border-color: var(--ember-dim); }

/* mermaid */
.mermaid { margin: 1em 0; text-align: center; }
.mermaid svg { max-width: 100%; height: auto; }

/* highlight.js — CODE blocks get a full CDN theme (github-dark / github, loaded
   in <head>). We only strip the theme's own background + padding so blocks sit on
   our recessed code surface; token colors come from the CDN theme. */
.hljs { background: transparent; padding: 0; }

/* Raw MARKDOWN source view keeps the warm Lab-Notebook palette (ink ramp + one
   ember), scoped to .mdsrc so it never touches the CDN-themed code blocks. */
.mdsrc.hljs { color: var(--ink-1); }
.mdsrc .hljs-comment, .mdsrc .hljs-quote { color: var(--ink-muted); font-style: italic; }
.mdsrc .hljs-keyword, .mdsrc .hljs-selector-tag, .mdsrc .hljs-built_in, .mdsrc .hljs-name, .mdsrc .hljs-tag { color: var(--ember-glow); }
.mdsrc .hljs-string, .mdsrc .hljs-attr, .mdsrc .hljs-template-tag, .mdsrc .hljs-addition { color: var(--ink-2); }
.mdsrc .hljs-number, .mdsrc .hljs-literal, .mdsrc .hljs-type, .mdsrc .hljs-symbol, .mdsrc .hljs-meta { color: var(--ink-3); }
.mdsrc .hljs-title, .mdsrc .hljs-function .hljs-title { color: var(--ink-1); font-weight: 500; }
.mdsrc .hljs-variable, .mdsrc .hljs-params, .mdsrc .hljs-property { color: var(--ink-2); }
/* Markdown structural tokens — colorful so the raw view reads as highlighted:
   headers + list markers in ember, links in accent text. */
.mdsrc .hljs-section { color: var(--ember-glow); font-weight: 700; }
.mdsrc .hljs-bullet { color: var(--ember); font-weight: 700; }
.mdsrc .hljs-link { color: var(--accent-text); }
.mdsrc .hljs-code { color: var(--ink-2); }
.mdsrc .hljs-emphasis { font-style: italic; color: var(--ink-1); }
.mdsrc .hljs-strong { font-weight: 700; color: var(--ink-1); }

/* empty states */
.empty { display: flex; flex-direction: column; align-items: center; justify-content: center;
  height: 100%; color: var(--ink-muted); text-align: center; gap: 8px; }
.empty .big { font-family: var(--serif); font-size: 20px; color: var(--ink-3); }
.empty code { background: var(--field); border: 1px solid var(--border);
  border-radius: 4px; padding: 2px 8px; font-size: 12px; color: var(--ink-2); }

/* toast — transient feedback (e.g. reload), bottom-left, auto-dismissed */
.toast {
  position: fixed; bottom: 16px; left: 16px; z-index: 10000;
  background: var(--elevated); border: 1px solid var(--border); border-radius: 6px;
  padding: 8px 14px; font-family: var(--mono); font-size: 11px; color: var(--ink-2);
  box-shadow: 0 4px 18px rgba(0,0,0,0.25);
  opacity: 0; transform: translateY(10px); pointer-events: none;
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.toast.visible { opacity: 1; transform: translateY(0); }
.toast.toast-success { border-color: var(--ember); color: var(--ember); }
.toast.toast-info { color: var(--ink-2); }

/* settings modal — mode segmented control + color theme cards */
.settings-body { padding: 14px 18px 18px; }
.settings-section { margin-bottom: 16px; }
.settings-section:last-child { margin-bottom: 0; }
.settings-label { font-size: 11px; font-weight: 500; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--ink-muted); margin-bottom: 8px; }
.seg { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.seg button { background: transparent; border: 0; color: var(--ink-muted);
  font-family: var(--mono); font-size: 12px; padding: 6px 14px; cursor: pointer;
  transition: all 0.15s ease; }
.seg button + button { border-left: 1px solid var(--border); }
.seg button:hover { background: var(--hover); color: var(--ink-1); }
.seg button.on { color: var(--accent-text); background: var(--ember-dim); }
.theme-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.theme-card { display: flex; align-items: center; gap: 10px;
  background: var(--field); border: 1px solid var(--border); border-radius: 6px;
  padding: 8px 10px; cursor: pointer; text-align: left;
  font-family: var(--mono); font-size: 12px; color: var(--ink-2); transition: all 0.15s ease; }
.theme-card:hover { background: var(--hover); color: var(--ink-1); }
.theme-card.on { color: var(--accent-text); border-color: var(--ember); }
.swatches { display: inline-flex; gap: 3px; flex: 0 0 auto; }
.swatch { width: 12px; height: 12px; border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--ink-muted) 40%, transparent); }
/* Each card carries both mode previews; show only the resolved mode's dots.
   (No data-theme attribute = dark default, so hide .sw-light via :not.) */
:root[data-theme="light"] .sw-dark { display: none; }
:root:not([data-theme="light"]) .sw-light { display: none; }
`;

export const THEME_CSS = BASE_CSS + colorThemeCss();
