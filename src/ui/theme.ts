// Lab-Notebook design tokens → CSS. claude-code-hub design system, verbatim
// tokens. Dark-first (#101114) + warm-paper light (#e8e6e3) siblings; one ember
// accent; tonal-first depth, flat at rest; two-voice serif/mono type.

export const THEME_CSS = `
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
html, body { height: 100%; margin: 0; }
body {
  background: var(--field);
  color: var(--ink-1);
  font-family: var(--mono);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.app { display: flex; flex-direction: column; height: 100vh; }

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
.shortcuts { margin: 0; padding: 12px 18px 18px; }
.shortcuts > div { display: flex; align-items: baseline; gap: 14px; padding: 5px 0; }
.shortcuts dt { flex: 0 0 118px; margin: 0; }
.shortcuts dt { font-family: var(--mono); font-size: 12px; color: var(--accent-text); }
.shortcuts dd { margin: 0; font-size: 13px; color: var(--ink-2); }

/* layout */
.body { display: flex; flex: 1; min-height: 0; }
.tree {
  width: var(--tree-w, 340px); flex: 0 0 auto; overflow-y: auto;
  background: var(--surface); border-right: 1px solid var(--border);
  padding: 14px 10px;
}
.tree.collapsed { display: none; }
.tree.collapsed + .resizer { display: none; }
/* Drag handle between sidebar and preview. A wide hit area (easy to grab) with a
   thin centered visual line that brightens on hover/drag. */
.resizer { flex: 0 0 6px; cursor: col-resize; position: relative; background: transparent;
  margin: 0 -3px; z-index: 5; user-select: none; touch-action: none; }
.resizer::after { content: ""; position: absolute; inset: 0 auto 0 50%; width: 1px;
  transform: translateX(-50%); background: var(--border); transition: background 0.15s ease; }
.resizer:hover::after, .resizer.dragging::after { background: var(--ember); width: 2px; }
.preview { flex: 1; min-width: 0; overflow-y: auto; padding: 24px 28px; }
/* Single centered reading column — everything inside shares one left edge and
   fills the column width (rendered markdown AND raw alike). */
.pbody { max-width: 1200px; margin: 0 auto; }

/* tree */
.label { font-size: 12px; font-weight: 500; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--ink-muted); padding: 6px 10px 10px; }
.frow {
  display: flex; align-items: baseline; gap: 9px; cursor: pointer;
  padding: 6px 12px; border-radius: 5px;
  font-size: 14px; color: var(--ink-2); transition: all 0.15s ease;
}
.frow:hover { background: var(--hover); }
.frow.active { color: var(--ink-1); background: var(--ember-dim); box-shadow: inset 2px 0 0 var(--ember); }
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
.pbtn { background: var(--field); color: var(--ink-muted); border: 1px solid var(--border);
  border-radius: 4px; padding: 1px 8px; font-family: var(--mono); font-size: 11px; cursor: pointer;
  transition: all 0.15s ease; }
.pbtn:hover { background: var(--hover); color: var(--ink-1); }
.pbtn.on { color: var(--accent-text); border-color: var(--ember-dim); }

/* mermaid */
.mermaid { margin: 1em 0; text-align: center; }
.mermaid svg { max-width: 100%; height: auto; }

/* highlight.js — mapped onto the Lab-Notebook ink ramp + one ember.
   Override hljs's own background so blocks share the recessed code surface. */
.hljs { background: transparent; color: var(--ink-1); }
.hljs-comment, .hljs-quote { color: var(--ink-muted); font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-built_in, .hljs-name, .hljs-tag { color: var(--ember-glow); }
.hljs-string, .hljs-attr, .hljs-template-tag, .hljs-addition { color: var(--ink-2); }
.hljs-number, .hljs-literal, .hljs-type, .hljs-symbol, .hljs-meta { color: var(--ink-3); }
.hljs-title, .hljs-function .hljs-title { color: var(--ink-1); font-weight: 500; }
.hljs-variable, .hljs-params, .hljs-property { color: var(--ink-2); }
/* Markdown source tokens — made deliberately colorful so the raw view reads as
   highlighted: headers in ember, list markers in ember, links in accent text. */
.hljs-section { color: var(--ember-glow); font-weight: 700; }
.hljs-bullet { color: var(--ember); font-weight: 700; }
.hljs-link { color: var(--accent-text); }
.hljs-code { color: var(--ink-2); }
.hljs-emphasis { font-style: italic; color: var(--ink-1); }
.hljs-strong { font-weight: 700; color: var(--ink-1); }

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
`;
