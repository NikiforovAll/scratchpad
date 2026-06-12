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
// upstream palettes onto the Lab-Notebook variable roles: one accent (--ember*),
// four surfaces (field→hover), one hairline (border), four-step ink ramp.
// Dark-only upstreams get a hand-derived light sibling (see per-theme comments);
// emberDim is mechanical: rgba(ember, 0.25) dark / 0.18 light.
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
  {
    id: "dracula",
    label: "Dracula",
    dark: {
      ember: "#bd93f9", emberGlow: "#d6b5ff", emberDim: "rgba(189,147,249,0.25)",
      field: "#21222c", surface: "#282a36", elevated: "#343746", hover: "#44475a",
      border: "#565a75", ink1: "#f8f8f2", ink2: "#d8d8d2", ink3: "#b0b3c5", inkMuted: "#6272a4",
    },
    // No official Dracula light: cool slate paper + the purple darkened until it
    // holds as accent text, inks pulled down to near-black.
    light: {
      ember: "#7c3aed", emberGlow: "#5b21b6", emberDim: "rgba(124,58,237,0.18)",
      field: "#e8e8ee", surface: "#f0f0f5", elevated: "#fbfbfd", hover: "#dfdfe8",
      border: "#c9c9d6", ink1: "#16161e", ink2: "#34343f", ink3: "#5a5a68", inkMuted: "#787885",
    },
  },
  {
    id: "nord",
    label: "Nord",
    dark: {
      ember: "#88c0d0", emberGlow: "#a8d8e8", emberDim: "rgba(136,192,208,0.25)",
      field: "#272c36", surface: "#2e3440", elevated: "#3b4252", hover: "#434c5e",
      border: "#4c566a", ink1: "#eceff4", ink2: "#d8dee9", ink3: "#aeb6c5", inkMuted: "#7b88a1",
    },
    // Snow Storm surfaces; accent switches to the darker frost blue (nord10) —
    // nord8 cyan has no contrast on paper.
    light: {
      ember: "#5e81ac", emberGlow: "#44688f", emberDim: "rgba(94,129,172,0.18)",
      field: "#e5e9f0", surface: "#eceff4", elevated: "#f8f9fb", hover: "#d8dee9",
      border: "#c2c9d6", ink1: "#2e3440", ink2: "#3b4252", ink3: "#4c566a", inkMuted: "#6b7589",
    },
  },
  {
    id: "rose-pine",
    label: "Rosé Pine",
    dark: {
      ember: "#c4a7e7", emberGlow: "#d9c4f2", emberDim: "rgba(196,167,231,0.25)",
      field: "#191724", surface: "#1f1d2e", elevated: "#26233a", hover: "#34304e",
      border: "#403d52", ink1: "#e0def4", ink2: "#c5c2dd", ink3: "#908caa", inkMuted: "#6e6a86",
    },
    // Rosé Pine Dawn.
    light: {
      ember: "#907aa9", emberGlow: "#6f598c", emberDim: "rgba(144,122,169,0.18)",
      field: "#f2e9e1", surface: "#faf4ed", elevated: "#fffaf3", hover: "#ebdfd4",
      border: "#dfdad9", ink1: "#575279", ink2: "#635e87", ink3: "#797593", inkMuted: "#9893a5",
    },
  },
  {
    id: "everforest",
    label: "Everforest",
    dark: {
      ember: "#a7c080", emberGlow: "#c3d6a2", emberDim: "rgba(167,192,128,0.25)",
      field: "#232a2e", surface: "#2d353b", elevated: "#343f44", hover: "#3d484d",
      border: "#475258", ink1: "#d3c6aa", ink2: "#bfb6a3", ink3: "#9da9a0", inkMuted: "#859289",
    },
    // Toned down from the canonical light palette: the chartreuse green
    // (#8da101) and bg1-deep paper read harsh — muted moss accent, one step
    // lighter paper, darker neutral ink.
    light: {
      ember: "#6f8352", emberGlow: "#56683f", emberDim: "rgba(111,131,82,0.18)",
      field: "#f4f0d9", surface: "#fdf6e3", elevated: "#fffbef", hover: "#efebd4",
      border: "#d8d3ba", ink1: "#4d5960", ink2: "#5c6a72", ink3: "#7a8478", inkMuted: "#939f91",
    },
  },
  {
    id: "kanagawa",
    label: "Kanagawa",
    dark: {
      ember: "#7e9cd8", emberGlow: "#9fb9ec", emberDim: "rgba(126,156,216,0.25)",
      field: "#16161d", surface: "#1f1f28", elevated: "#2a2a37", hover: "#363646",
      border: "#54546d", ink1: "#dcd7ba", ink2: "#c8c093", ink3: "#a6a69c", inkMuted: "#727169",
    },
    // Kanagawa Lotus, the canonical light sibling (yellow-tan paper).
    light: {
      ember: "#4d699b", emberGlow: "#38537f", emberDim: "rgba(77,105,155,0.18)",
      field: "#e5ddb0", surface: "#f2ecbc", elevated: "#faf5d2", hover: "#dcd5ac",
      border: "#c7bf94", ink1: "#545464", ink2: "#66667a", ink3: "#716e61", inkMuted: "#8a8775",
    },
  },
  {
    id: "one-dark",
    label: "One Dark",
    // Upstream card (#21252b) is darker than its bg — surfaces reordered by luminance.
    dark: {
      ember: "#61afef", emberGlow: "#8cc7ff", emberDim: "rgba(97,175,239,0.25)",
      field: "#21252b", surface: "#282c34", elevated: "#2f343e", hover: "#3e4452",
      border: "#4b5263", ink1: "#d7dae0", ink2: "#abb2bf", ink3: "#8b919e", inkMuted: "#5c6370",
    },
    // One Light (Atom's sibling theme).
    light: {
      ember: "#4078f2", emberGlow: "#2c5dd4", emberDim: "rgba(64,120,242,0.18)",
      field: "#eaeaeb", surface: "#fafafa", elevated: "#ffffff", hover: "#e0e0e2",
      border: "#d4d4d6", ink1: "#383a42", ink2: "#50525a", ink3: "#696c77", inkMuted: "#a0a1a7",
    },
  },
  {
    id: "night-owl",
    label: "Night Owl",
    dark: {
      ember: "#82aaff", emberGlow: "#a8c4ff", emberDim: "rgba(130,170,255,0.25)",
      field: "#011627", surface: "#0b2942", elevated: "#13344f", hover: "#1d3b53",
      border: "#5f7e97", ink1: "#d6deeb", ink2: "#b8c5d6", ink3: "#8ba3b8", inkMuted: "#637777",
    },
    // Light Owl (the official light variant): teal accent, soft grays.
    light: {
      ember: "#0c969b", emberGlow: "#0a7479", emberDim: "rgba(12,150,155,0.18)",
      field: "#ededed", surface: "#f6f6f6", elevated: "#fbfbfb", hover: "#e2e2e2",
      border: "#d0d0d0", ink1: "#403f53", ink2: "#545167", ink3: "#6f6e85", inkMuted: "#989fb1",
    },
  },
  {
    id: "monokai",
    label: "Monokai Pro",
    dark: {
      ember: "#ffd866", emberGlow: "#ffe6a0", emberDim: "rgba(255,216,102,0.25)",
      field: "#221f22", surface: "#2d2a2e", elevated: "#403e41", hover: "#4a484b",
      border: "#5b595c", ink1: "#fcfcfa", ink2: "#d9d8d6", ink3: "#939293", inkMuted: "#727072",
    },
    // Monokai Pro is dark-only: warm gray paper, yellow deepened to amber so
    // accent text survives on light.
    light: {
      ember: "#c08a00", emberGlow: "#9a6e00", emberDim: "rgba(192,138,0,0.18)",
      field: "#e9e6e4", surface: "#f1efed", elevated: "#fcfbfa", hover: "#e0dcda",
      border: "#cdc8c5", ink1: "#2c292d", ink2: "#46434a", ink3: "#6b686d", inkMuted: "#8d8a8d",
    },
  },
  {
    id: "github",
    label: "GitHub",
    // Upstream --border (#1b1f23) is darker than the bg — swapped for a visible
    // Primer hairline.
    dark: {
      ember: "#58a6ff", emberGlow: "#85bdff", emberDim: "rgba(88,166,255,0.25)",
      field: "#1f2428", surface: "#24292e", elevated: "#2b3138", hover: "#2f363d",
      border: "#444d56", ink1: "#e1e4e8", ink2: "#d1d5da", ink3: "#959da5", inkMuted: "#6a737d",
    },
    light: {
      ember: "#0366d6", emberGlow: "#044289", emberDim: "rgba(3,102,214,0.18)",
      field: "#f0f2f4", surface: "#f6f8fa", elevated: "#ffffff", hover: "#e8eaed",
      border: "#d1d5da", ink1: "#24292e", ink2: "#444d56", ink3: "#586069", inkMuted: "#6a737d",
    },
  },
  {
    id: "ayu",
    label: "Ayu",
    // Upstream --border (#1b1f29) vanishes on these surfaces — bumped two steps.
    dark: {
      ember: "#e6b450", emberGlow: "#f0cd85", emberDim: "rgba(230,180,80,0.25)",
      field: "#0d1017", surface: "#10141c", elevated: "#141821", hover: "#1d2330",
      border: "#2d3343", ink1: "#bfbdb6", ink2: "#a8a6a0", ink3: "#8a9199", inkMuted: "#6c7380",
    },
    // ayu-light: the yellow stays for fills, but accent text (glow) drops to a
    // burnt orange for contrast.
    light: {
      ember: "#f2ae49", emberGlow: "#b87514", emberDim: "rgba(242,174,73,0.18)",
      field: "#eff1f3", surface: "#f8f9fa", elevated: "#fcfcfc", hover: "#e7eaed",
      border: "#d8dde2", ink1: "#3d4149", ink2: "#5c6166", ink3: "#787b80", inkMuted: "#8a9199",
    },
  },
  {
    id: "vitesse",
    label: "Vitesse",
    // Upstream borders (#252525 / #f0f0f0) are near-invisible — bumped a step.
    dark: {
      ember: "#4d9375", emberGlow: "#6fb392", emberDim: "rgba(77,147,117,0.25)",
      field: "#121212", surface: "#181818", elevated: "#1e1e1e", hover: "#262626",
      border: "#333333", ink1: "#dbd7ca", ink2: "#bfbaaa", ink3: "#8f8f85", inkMuted: "#758575",
    },
    light: {
      ember: "#1c6b48", emberGlow: "#145236", emberDim: "rgba(28,107,72,0.18)",
      field: "#f0f0f0", surface: "#f7f7f7", elevated: "#ffffff", hover: "#e7e7e7",
      border: "#d6d6d6", ink1: "#393a34", ink2: "#4e4f47", ink3: "#6b6d63", inkMuted: "#a0ada0",
    },
  },
  {
    id: "synthwave",
    label: "Synthwave '84",
    // Upstream --muted-foreground is #ffffff99 — replaced with the canonical
    // comment lavender; elevated/hover derived (upstream card ≈ bg).
    dark: {
      ember: "#ff7edb", emberGlow: "#ffa9e7", emberDim: "rgba(255,126,219,0.25)",
      field: "#241b2f", surface: "#262335", elevated: "#322a47", hover: "#3d3460",
      border: "#495495", ink1: "#ffffff", ink2: "#d8d6e8", ink3: "#b6b1d8", inkMuted: "#848bbd",
    },
    // Dark-only upstream: lavender-tinted paper, magenta deepened for contrast.
    light: {
      ember: "#c936a6", emberGlow: "#9c2381", emberDim: "rgba(201,54,166,0.18)",
      field: "#e6e2f0", surface: "#efecf6", elevated: "#fbfafd", hover: "#ddd7ec",
      border: "#c5bcdd", ink1: "#241b2f", ink2: "#3d3455", ink3: "#5c5380", inkMuted: "#7d76a3",
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
  border: 1.5px solid var(--ink-muted); border-radius: 3px; font-size: 0.8em; color: transparent;
  cursor: pointer; transition: border-color 0.12s, background 0.12s; }
.md li.task .chk:hover { border-color: #2ea043; }
.md li.task.done .chk { background: #2ea043; border-color: #2ea043; color: #fff; }
.md li.task.done .chk:hover { background: #3fb950; border-color: #3fb950; }
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

/* inline comments — highlighted spans, popover, add affordance, orphan pill */
.cmt-hl { background: color-mix(in srgb, var(--ember) 18%, transparent);
  border-bottom: 1px dotted var(--ember); cursor: pointer; }
.cmt-hl:hover { background: color-mix(in srgb, var(--ember) 32%, transparent); }
:root[data-comments-off] .cmt-hl { background: transparent; border-bottom: 0; cursor: inherit; }
:root[data-comments-off] .cmt-orphans { display: none; }
/* Always-visible concise note after the highlight. Rendered from data-note via
   ::after so the text is unselectable and invisible to quote-matching. */
.cmt-note { cursor: pointer; }
.cmt-note::after { content: '💬 ' attr(data-note); margin-left: 4px; padding: 1px 7px;
  border-radius: 9px; background: color-mix(in srgb, var(--ember) 12%, transparent);
  border: 1px solid var(--ember-dim); color: var(--ink-2);
  font-family: var(--mono); font-size: 0.72em; font-style: normal; font-weight: 400;
  vertical-align: baseline; white-space: nowrap; }
.cmt-note:hover::after { color: var(--accent-text); border-color: var(--ember); }
:root[data-comments-off] .cmt-note { display: none; }
.cmt-add { position: fixed; z-index: 9000; background: var(--elevated); color: var(--ink-1);
  border: 1px solid var(--ember-dim); border-radius: 5px; padding: 4px 10px;
  font-family: var(--mono); font-size: 11px; cursor: pointer;
  box-shadow: 0 4px 14px rgba(0,0,0,0.25); }
.cmt-add:hover { color: var(--accent-text); border-color: var(--ember); }
.cmt-pop { position: fixed; z-index: 9001; width: 300px; background: var(--elevated);
  border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px;
  box-shadow: 0 6px 22px rgba(0,0,0,0.3); font-size: 13px; color: var(--ink-1); }
.cmt-pop .cmt-body { white-space: pre-wrap; word-break: break-word; }
.cmt-pop .cmt-when { margin-top: 6px; font-family: var(--mono); font-size: 10px; color: var(--ink-muted); }
.cmt-pop .cmt-quote { font-family: var(--mono); font-size: 11px; color: var(--ink-muted);
  font-style: italic; margin-bottom: 4px; word-break: break-word; }
.cmt-pop textarea { width: 100%; min-height: 64px; box-sizing: border-box; resize: vertical;
  background: var(--field); color: var(--ink-1); border: 1px solid var(--border);
  border-radius: 4px; padding: 6px 8px; font-family: inherit; font-size: 13px; }
.cmt-actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 8px; }
.cmt-orow { padding: 6px 0; }
.cmt-orow + .cmt-orow { border-top: 1px solid var(--border); }
.cmt-orphans { display: inline-flex; align-items: center; gap: 6px; margin: 6px 0 10px;
  font-family: var(--mono); font-size: 11px; color: var(--ink-muted);
  border: 1px dashed var(--border); border-radius: 5px; padding: 4px 10px; cursor: pointer; }
.cmt-orphans:hover { color: var(--ink-1); border-color: var(--ember-dim); }
.icon-btn.muted { opacity: 0.45; }

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

/* theme gallery — settings shows only starred cards (max 3) + a Browse button;
   the gallery modal lists every theme with a star toggle per card. */
/* The Browse button is a grid cell: display:contents lifts the starred cards
   into the parent grid so the button flows inline right after them. */
.starred-cards { display: contents; }
/* Match .theme-card's natural height (8px padding + 14px content row — the
   12px swatch plus its borders) so the button is the same size whether it
   shares a row with a card (stretched) or sits on its own row (natural). */
.browse-themes { justify-content: center; padding: 8px 10px; line-height: 14px; }
.gallery-scrim { z-index: 60; } /* above the settings scrim (50) — settings stays open */
.modal-wide { width: 560px; max-width: 560px; }
.gallery-body { padding: 14px 18px 18px; max-height: 70vh; overflow-y: auto; }
/* Star rides the card's right edge; it toggles a favorite without applying the
   theme (click is swallowed before the card handler). */
.theme-card .fttl { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.theme-star { flex: 0 0 auto; margin-left: auto; background: none; border: 0; padding: 0 2px;
  font-size: 14px; line-height: 1; color: var(--ink-muted); cursor: pointer;
  transition: color 0.15s ease; }
.theme-star:hover { color: var(--ember-glow); }
.theme-star.on { color: var(--ember); }
`;

export const THEME_CSS = BASE_CSS + colorThemeCss();
