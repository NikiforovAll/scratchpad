// Build the viewer HTML page. The CLI does all file I/O here and embeds the pad
// data + file contents into one HTML string, so glimpse and the browser fallback
// render identically with no round-trips. highlight.js and mermaid load from a
// pinned CDN, added CONDITIONALLY — hljs only when a pad has code, mermaid only
// when a ```mermaid block is present.

import { stat } from "node:fs/promises";
import { extname, isAbsolute, join, resolve } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import type { ScratchConfig } from "../config.ts";
import type { Pad } from "../discovery.ts";
import { DEFAULT_TYPE, type FileEntry } from "../manifest.ts";
import { COLOR_THEMES, DEFAULT_COLOR_THEME, type Palette, THEME_CSS } from "./theme.ts";

// Pinned CDN builds (version + SRI). The script-global builds (highlight.min.js /
// mermaid.min.js) set window.hljs / window.mermaid; if they fail to load
// (offline), the client degrades gracefully (plain code + mermaid source). SRI is
// computed from the exact CDN bytes — bump it when bumping the pinned versions.
const HLJS_CDN = {
  url: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js",
  sri: "sha384-RH2xi4eIQ/gjtbs9fUXM68sLSi99C7ZWBRX1vDrVv6GQXRibxXLbwO2NGZB74MbU",
};
const MERMAID_CDN = {
  url: "https://cdn.jsdelivr.net/npm/mermaid@11.15.0/dist/mermaid.min.js",
  sri: "sha384-yQ4mmBBT+vhTAwjFH0toJXNYJ6O4usWnt6EPIdWwrRvx2V/n5lXuDZQwQFeSFydF",
};
// highlight.js token-color THEMES (CSS). Code blocks use these full IDE-style
// palettes; the raw-markdown view keeps our own warm palette (scoped to .mdsrc in
// theme.ts). Both load when hljs does; the client enables one per light/dark.
const HLJS_THEME_DARK = {
  url: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github-dark.min.css",
  sri: "sha384-wH75j6z1lH97ZOpMOInqhgKzFkAInZPPSPlZpYKYTOqsaizPvhQZmAtLcPKXpLyH",
};
const HLJS_THEME_LIGHT = {
  url: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github.min.css",
  sri: "sha384-eFTL69TLRZTkNfYZOLM+G04821K1qZao/4QLJbet1pP4tcF+fdXq/9CdqAbWRl/L",
};

const MAX_EMBED_BYTES = 512 * 1024; // skip embedding content above this

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico"]);
const MD_EXT = new Set([".md", ".markdown", ".mdx"]);
const TEXT_EXT = new Set([
  ".txt", ".log", ".csv", ".tsv", ".env", ".ini", ".cfg", ".conf", ".gitignore",
]);
const CODE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".jsonc", ".py", ".rb",
  ".go", ".rs", ".java", ".kt", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".swift",
  ".sh", ".bash", ".zsh", ".ps1", ".sql", ".yaml", ".yml", ".toml", ".xml",
  ".css", ".scss", ".less", ".vue", ".svelte", ".lua", ".r", ".scala", ".dart",
]);
// Rendered in a sandboxed iframe (scripts disabled) rather than as source.
const HTML_EXT = new Set([".html", ".htm"]);

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".bmp": "image/bmp", ".ico": "image/x-icon",
};

type Kind = "markdown" | "code" | "image" | "text" | "html" | "binary" | "toolarge";

interface FileView {
  path: string;
  /** Absolute on-disk path (resolves manifest `src`); used for copy-full-path. */
  abs: string;
  registered: boolean;
  /** Linked from outside the pad — content read from the manifest `src`. */
  external?: boolean;
  title?: string;
  description?: string;
  tags?: string[];
  type?: string;
  /** Visual group header the file sits under (absent = ungrouped). */
  group?: string;
  kind: Kind;
  /** language hint for code files (extension without dot). */
  lang?: string;
  /** text content for markdown/code/text; data URI for image; null otherwise. */
  content: string | null;
  /** ISO timestamps from the file on disk (manifest has only pad-level dates). */
  created?: string;
  updated?: string;
}
interface PadView {
  name: string;
  id?: string;
  dir: string;
  files: FileView[];
}

function classify(ext: string): Kind {
  if (IMAGE_EXT.has(ext)) return "image";
  if (HTML_EXT.has(ext)) return "html";
  if (MD_EXT.has(ext)) return "markdown";
  if (CODE_EXT.has(ext)) return "code";
  if (TEXT_EXT.has(ext)) return "text";
  return "binary";
}

/** List the pad's registered files (from the manifest), merged with metadata.
 * Unregistered on-disk files are intentionally not shown. */
async function scanPadFiles(pad: Pad): Promise<FileView[]> {
  // Files are independent, so read them concurrently; Promise.all keeps the
  // result in manifest.files[] order — the author's deliberate reading order.
  const views = pad.manifest.files.map(async (meta): Promise<FileView> => {
    const path = meta.path;
    const ext = extname(path).toLowerCase();
    let kind = classify(ext);
    let content: string | null = null;
    // Linked entries read from `src` (outside the pad); the rest from path under the pad dir.
    const abs = meta.src
      ? (isAbsolute(meta.src) ? meta.src : resolve(pad.dir, meta.src))
      : join(pad.dir, path);
    const file = Bun.file(abs);
    let created: string | undefined;
    let updated: string | undefined;
    if (await file.exists()) {
      try {
        const st = await stat(abs);
        updated = st.mtime.toISOString();
        // birthtime is 0/epoch (or trails mtime) on filesystems that don't track
        // creation — only surface it when it's a real date.
        if (st.birthtimeMs > 0 && st.birthtimeMs <= st.mtimeMs) {
          created = st.birthtime.toISOString();
        }
      } catch {
        // stat raced a delete/rename — dates just stay absent
      }
      const size = file.size;
      if (size > MAX_EMBED_BYTES) {
        kind = "toolarge";
      } else if (kind === "image") {
        const buf = Buffer.from(await file.arrayBuffer());
        content = `data:${MIME[ext] ?? "application/octet-stream"};base64,${buf.toString("base64")}`;
      } else if (kind === "binary") {
        content = null;
      } else {
        content = await file.text();
      }
    } else {
      kind = "binary";
      content = null;
    }
    return {
      path,
      abs,
      registered: true,
      external: !!meta.src,
      title: meta.title,
      description: meta.description,
      tags: meta.tags,
      type: meta.type ?? DEFAULT_TYPE,
      group: meta.group,
      kind,
      lang: kind === "code" ? ext.slice(1) : undefined,
      content,
      created,
      updated,
    };
  });
  return Promise.all(views);
}

export async function buildView(pads: Pad[]): Promise<PadView[]> {
  return Promise.all(
    pads.map(async (p) => ({
      name: p.manifest.name,
      id: p.manifest.id,
      dir: p.dir,
      files: await scanPadFiles(p),
    })),
  );
}

const MERMAID_RE = /```[ \t]*mermaid\b/;

/** The embedded data island, escaped for inline <script> AND safe as an eval arg. */
export function payloadJson(view: PadView[], rootLabel: string): string {
  return JSON.stringify({ pads: view, rootLabel }).replace(/</g, "\\u003c");
}

/** Which vendor bundles a view requires — used to decide in-place vs full reload. */
export function bundleNeeds(view: PadView[]): { hljs: boolean; mermaid: boolean } {
  return { hljs: needsHljs(view), mermaid: needsMermaid(view) };
}

function needsHljs(view: PadView[]): boolean {
  // Any code file, or any markdown (rendered fences AND the raw markdown source
  // view are both syntax-highlighted), needs the hljs bundle inlined.
  return view.some((p) =>
    p.files.some(
      (f) => f.content != null && (f.kind === "code" || f.kind === "markdown" || f.kind === "html"),
    ),
  );
}
function needsMermaid(view: PadView[]): boolean {
  return view.some((p) =>
    p.files.some((f) => f.kind === "markdown" && f.content != null && MERMAID_RE.test(f.content)),
  );
}

/** Viewer settings embedded into the page (persisted in the user config file).
 * Derived from ScratchConfig.ui so the shapes can't drift; frameless is a
 * launch-time concern, and zoom is optional here (defaults to 1). */
export type UiSettings = Omit<ScratchConfig["ui"], "frameless" | "zoom"> &
  Partial<Pick<ScratchConfig["ui"], "zoom">>;

const DEFAULT_UI: UiSettings = {
  themeMode: "system",
  colorTheme: DEFAULT_COLOR_THEME,
  gridStyle: "dots",
};

export async function renderHtml(
  view: PadView[],
  rootLabel: string,
  ui: UiSettings = DEFAULT_UI,
): Promise<string> {
  const data = payloadJson(view, rootLabel);
  const titleName = view.length === 1 ? view[0]!.name : rootLabel;
  const zoom = ui.zoom ?? 1;
  const gridStyle = ui.gridStyle ?? "dots";
  // Persisted theme/zoom land on <html> server-side so the first paint is
  // already correct (no flash). "system" stays attribute-less until the client
  // resolves prefers-color-scheme — same dark-first default as today.
  const htmlAttrs =
    ` data-color-theme="${escapeHtml(ui.colorTheme)}"` +
    ` data-grid="${escapeHtml(gridStyle)}"` +
    (ui.themeMode === "system" ? "" : ` data-theme="${ui.themeMode}"`) +
    (zoom === 1 ? "" : ` style="zoom: ${zoom}"`);
  // NOT part of payloadJson: __scratchReload diff-compares the data island to
  // detect "no changes", and settings must not break that.
  const settingsJson = JSON.stringify({ ...ui, gridStyle, zoom }).replace(/</g, "\\u003c");

  // CDN tags are blocking (no defer) so window.hljs/window.mermaid are ready
  // before the client script runs. SRI + crossorigin guard integrity; on load
  // failure the client degrades gracefully.
  const cdnTag = (c: { url: string; sri: string }) =>
    `<script src="${c.url}" integrity="${c.sri}" crossorigin="anonymous" referrerpolicy="no-referrer"></script>\n`;

  let vendor = "";
  if (needsHljs(view)) vendor += cdnTag(HLJS_CDN);
  if (needsMermaid(view)) vendor += cdnTag(MERMAID_CDN);

  // hljs theme stylesheets, placed BEFORE our <style> so equal-specificity
  // overrides (e.g. transparent .hljs background) win without !important. Both
  // present with an id; the client enables exactly one per the active theme.
  const cssLink = (id: string, c: { url: string; sri: string }) =>
    `<link id="${id}" rel="stylesheet" href="${c.url}" integrity="${c.sri}" crossorigin="anonymous" referrerpolicy="no-referrer" />\n`;
  let vendorCss = "";
  if (needsHljs(view)) {
    vendorCss += cssLink("hljs-dark", HLJS_THEME_DARK);
    vendorCss += cssLink("hljs-light", HLJS_THEME_LIGHT);
  }

  return `<!doctype html>
<html lang="en"${htmlAttrs}>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>scratch · ${escapeHtml(titleName)}</title>
${vendorCss}<style>${THEME_CSS}</style>
</head>
<body>
<div class="app">
  <header class="topbar" id="topbar">
    <div class="brand">
      <span class="wordmark">scratch<span class="dot">.</span></span>
      <span class="padname" id="padname"></span>
    </div>
    <div class="view-actions">
      <button class="icon-btn" id="sidebarToggle" title="Toggle sidebar ([)" aria-label="Toggle sidebar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>
      </button>
      <button class="icon-btn" id="reloadBtn" title="Reload from disk (R)" aria-label="Reload">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
      </button>
      <button class="icon-btn" id="themeToggle" title="Toggle theme (T)" aria-label="Toggle theme">
        <svg class="i-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>
        <svg class="i-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
      </button>
      <button class="icon-btn" id="settingsBtn" title="Settings (S)" aria-label="Settings">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
      <button class="icon-btn" id="helpBtn" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/></svg>
      </button>
      <a class="icon-btn" id="repoLink" href="https://github.com/nikiforovall/scratchpad" target="_blank" title="View on GitHub" aria-label="View on GitHub">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
      </a>
      <button class="icon-btn" id="closeBtn" title="Close (Esc)" aria-label="Close" style="display:none">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
  </header>
  <div class="body">
    <div class="sidebar" id="sidebar">
      <nav class="tree" id="tree"></nav>
      <div class="appver" title="scratch version">v${escapeHtml(pkg.version)}</div>
    </div>
    <div class="resizer" id="resizer" role="separator" aria-orientation="vertical" title="Drag to resize"></div>
    <main class="preview" id="preview"></main>
  </div>
  <div class="modal-scrim" id="helpModal" style="display:none">
    <div class="modal">
      <div class="modal-head"><span>Keyboard shortcuts</span><button class="icon-btn" id="helpClose" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
      <dl class="shortcuts">
        <div class="sc-group">Navigate</div>
        <div><dt><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd></dt><dd>Next / previous file</dd></div>
        <div class="sc-group">Scroll</div>
        <div><dt><kbd>j</kbd><kbd>k</kbd></dt><dd>Down / up</dd></div>
        <div><dt><kbd>d</kbd><kbd>u</kbd></dt><dd>Half page down / up</dd></div>
        <div><dt><kbd>g</kbd><kbd>G</kbd></dt><dd>Top / bottom</dd></div>
        <div class="sc-group">View</div>
        <div><dt><kbd>v</kbd></dt><dd>Toggle raw / rendered (markdown)</dd></div>
        <div><dt><kbd>t</kbd></dt><dd>Toggle theme</dd></div>
        <div><dt><kbd>[</kbd></dt><dd>Toggle sidebar</dd></div>
        <div><dt><kbd>Ctrl</kbd><span class="sc-plus">+</span><kbd>+</kbd><kbd>−</kbd><kbd>0</kbd></dt><dd>Zoom in / out / reset</dd></div>
        <div class="sc-group">General</div>
        <div><dt><kbd>r</kbd></dt><dd>Reload from disk</dd></div>
        <div><dt><kbd>s</kbd></dt><dd>Settings</dd></div>
        <div><dt><kbd>?</kbd></dt><dd>Show this help</dd></div>
        <div><dt><kbd>q</kbd></dt><dd>Quit (close window)</dd></div>
        <div><dt><kbd>Esc</kbd></dt><dd>Close dialogs / window</dd></div>
      </dl>
    </div>
  </div>
  ${SETTINGS_MODAL_HTML}
</div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script id="data" type="application/json">${data}</script>
<script id="settings" type="application/json">${settingsJson}</script>
${vendor}<script>${CLIENT_JS}</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

// Settings modal, generated from the theme registry. Each card carries dot
// previews for BOTH modes; CSS shows only the resolved mode's set (.sw-dark /
// .sw-light), so cards always preview what picking them would look like.
function swatchesHtml(p: Palette, cls: string): string {
  const dots = [p.field, p.surface, p.ember, p.ink1]
    .map((c) => `<span class="swatch" style="background:${c}"></span>`)
    .join("");
  return `<span class="swatches ${cls}">${dots}</span>`;
}

function settingsModalHtml(): string {
  const cards = COLOR_THEMES.map(
    (t) =>
      `<button class="theme-card" data-theme-id="${escapeHtml(t.id)}">` +
      swatchesHtml(t.dark, "sw-dark") +
      swatchesHtml(t.light, "sw-light") +
      `<span>${escapeHtml(t.label)}</span></button>`,
  ).join("\n          ");
  return `<div class="modal-scrim" id="settingsModal" style="display:none">
    <div class="modal">
      <div class="modal-head"><span>Settings</span><button class="icon-btn" id="settingsClose" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
      <div class="settings-body">
        <div class="settings-section">
          <div class="settings-label">Mode</div>
          <div class="seg" id="modeSeg">
            <button data-mode="light">Light</button>
            <button data-mode="dark">Dark</button>
            <button data-mode="system">System</button>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-label">Theme</div>
          <div class="theme-grid" id="themeGrid">
          ${cards}
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-label">Background</div>
          <div class="seg" id="gridSeg">
            <button data-grid="off">Off</button>
            <button data-grid="dots">Dots</button>
            <button data-grid="lines">Lines</button>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-label">Zoom</div>
          <div class="seg" id="zoomSeg">
            <button id="zoomOut" aria-label="Zoom out" title="Zoom out (Ctrl+-)">&minus;</button>
            <button id="zoomReset" title="Reset zoom (Ctrl+0)">100%</button>
            <button id="zoomIn" aria-label="Zoom in" title="Zoom in (Ctrl+=)">+</button>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

// Depends only on the static theme registry, so build it once at module load
// instead of on every render.
const SETTINGS_MODAL_HTML = settingsModalHtml();

// Client-side: tree nav, preview switching, minimal markdown renderer, raw/
// rendered toggle, syntax highlighting (if hljs present), mermaid (if present),
// and auto-detected theme. Kept dependency-free; vendored libs are optional.
const CLIENT_JS = String.raw`
let DATA = JSON.parse(document.getElementById('data').textContent);
const esc = (s) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function mdInline(s) {
  s = esc(s);
  s = s.replace(/\`([^\`]+)\`/g, (_, c) => '<code>' + c + '</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, h) => '<a href="' + h + '">' + t + '</a>');
  return s;
}
// Map a fence/extension language token to highlight.js's canonical grammar name.
// Two reasons this is needed: (1) hljs parses the language out of the
// "language-X" class with [\\w-]+, so a class like "language-c#" yields just "c"
// (highlighted as C, not C#) — normalizing to "csharp" fixes that; (2) some file
// extensions (hpp, cxx, h) aren't hljs aliases. Anything not in the map passes
// through unchanged, so hljs's built-in aliases (cs, rs, py, ...) still work.
const LANG_ALIAS = {
  'c#': 'csharp', 'cs': 'csharp',
  'c++': 'cpp', 'cxx': 'cpp', 'cc': 'cpp', 'hpp': 'cpp', 'hxx': 'cpp', 'h': 'c',
  'f#': 'fsharp', 'fs': 'fsharp',
  'objective-c': 'objectivec', 'objc': 'objectivec', 'obj-c': 'objectivec',
  'ps1': 'powershell', 'ps': 'powershell', 'pwsh': 'powershell',
};
function normLang(lang) {
  if (!lang) return lang;
  const k = lang.toLowerCase();
  return LANG_ALIAS[k] || k;
}
function renderMarkdown(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  let html = '', i = 0, inUl = false, inOl = false;
  const closeLists = () => { if (inUl) { html += '</ul>'; inUl = false; } if (inOl) { html += '</ol>'; inOl = false; } };
  while (i < lines.length) {
    let line = lines[i];
    let fence = line.match(/^\s*\`\`\`\s*([^\s\`]*)\s*$/);
    if (fence) {
      closeLists(); const lang = normLang(fence[1] || ''); i++; let buf = [];
      while (i < lines.length && !/^\s*\`\`\`\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      if (lang === 'mermaid') html += '<div class="mermaid">' + esc(buf.join('\n')) + '</div>';
      else html += '<pre><code' + (lang ? ' class="language-' + lang + '"' : '') + '>' + esc(buf.join('\n')) + '</code></pre>';
      continue;
    }
    // GFM pipe table: a header row followed by a |---|:--:|---| separator row.
    if (line.indexOf('|') !== -1 && i + 1 < lines.length &&
        /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
      closeLists();
      const cells = (r) => { let s = r.trim(); if (s.startsWith('|')) s = s.slice(1); if (s.endsWith('|')) s = s.slice(0, -1); return s.split('|').map(c => c.trim()); };
      const heads = cells(line);
      const aligns = cells(lines[i + 1]).map(c => { const l = c.startsWith(':'), r = c.endsWith(':'); return l && r ? 'center' : r ? 'right' : l ? 'left' : ''; });
      const sty = (ci) => aligns[ci] ? ' style="text-align:' + aligns[ci] + '"' : '';
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].indexOf('|') !== -1 && !/^\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
      let t = '<table><thead><tr>';
      heads.forEach((h, ci) => { t += '<th' + sty(ci) + '>' + mdInline(h) + '</th>'; });
      t += '</tr></thead><tbody>';
      rows.forEach(rc => { t += '<tr>'; heads.forEach((_, ci) => { t += '<td' + sty(ci) + '>' + mdInline(rc[ci] || '') + '</td>'; }); t += '</tr>'; });
      html += t + '</tbody></table>';
      continue;
    }
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { closeLists(); html += '<h' + m[1].length + '>' + mdInline(m[2]) + '</h' + m[1].length + '>'; i++; continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { closeLists(); html += '<hr/>'; i++; continue; }
    if ((m = line.match(/^\s*>\s?(.*)$/))) { closeLists(); html += '<blockquote>' + mdInline(m[1]) + '</blockquote>'; i++; continue; }
    if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
      if (!inUl) { closeLists(); html += '<ul>'; inUl = true; }
      // GFM task list item: "- [ ] todo" / "- [x] done". Checked → green box.
      const task = m[1].match(/^\[([ xX])\]\s+(.*)$/);
      if (task) {
        const done = task[1] !== ' ';
        html += '<li class="task' + (done ? ' done' : '') + '"><span class="chk">' + (done ? '✓' : '') + '</span>' + mdInline(task[2]) + '</li>';
      } else { html += '<li>' + mdInline(m[1]) + '</li>'; }
      i++; continue;
    }
    if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) { if (!inOl) { closeLists(); html += '<ol>'; inOl = true; } html += '<li>' + mdInline(m[1]) + '</li>'; i++; continue; }
    if (/^\s*$/.test(line)) { closeLists(); i++; continue; }
    closeLists(); html += '<p>' + mdInline(line) + '</p>'; i++;
  }
  closeLists();
  return html;
}

// Highlight a code string with hljs for a given language; falls back to escaped
// plain text when hljs or the grammar is unavailable.
function hlCode(code, lang) {
  if (window.hljs && lang && window.hljs.getLanguage && window.hljs.getLanguage(lang)) {
    try { return window.hljs.highlight(code, { language: lang }).value; } catch (e) {}
  }
  return esc(code);
}
// Raw markdown view: hljs's markdown grammar does NOT recurse into fenced blocks
// (a \`\`\`json block stays plain), so we split the source ourselves — markdown
// runs highlighted as markdown, each fence's body highlighted as ITS language —
// and stitch them back with the fence delimiter lines preserved.
function highlightRawMarkdown(src) {
  if (!window.hljs) return esc(src);
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const parts = []; let mdbuf = [], i = 0;
  const flush = () => { if (mdbuf.length) { parts.push(hlCode(mdbuf.join('\n'), 'markdown')); mdbuf = []; } };
  while (i < lines.length) {
    const open = lines[i].match(/^\s*\`\`\`+\s*([^\s\`]*)\s*$/);
    if (open) {
      const lang = normLang(open[1] || '');
      const openLine = lines[i]; i++;
      const code = [];
      while (i < lines.length && !/^\s*\`\`\`+\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
      const hasClose = i < lines.length; const closeLine = hasClose ? lines[i] : '';
      if (hasClose) i++;
      flush();
      let block = '<span class="hljs-code">' + esc(openLine) + '</span>';
      if (code.length) block += '\n' + hlCode(code.join('\n'), lang);
      if (hasClose) block += '\n<span class="hljs-code">' + esc(closeLine) + '</span>';
      parts.push(block);
      continue;
    }
    mdbuf.push(lines[i]); i++;
  }
  flush();
  return parts.join('\n');
}

let current = null;       // key of selected file
let currentRef = null;    // { pad, f }
let rawMode = false;      // markdown: show source instead of rendered
// Remember the raw/rendered preference across files AND sessions (localStorage
// works in the browser fallback; the native data-URL origin may not persist it,
// so it's wrapped in try/catch). The choice is sticky — switching files keeps it.
try { rawMode = localStorage.getItem('scratch.raw') === '1'; } catch (_) {}
function setRaw(v) {
  rawMode = v;
  try { localStorage.setItem('scratch.raw', v ? '1' : '0'); } catch (_) {}
}
let ITEMS = [];           // flat [{pad,f}] in tree order — for j/k navigation
let curIdx = -1;          // index of selected file within ITEMS
let lastTreeHtml = null;  // last tree markup rendered — skip DOM swap when unchanged

// Resolve a relative link target against the current file's directory → a pad
// path. Pads are usually flat, but handle ./ and ../ segments anyway.
function resolveRel(from, rel) {
  if (rel.startsWith('/')) return rel.replace(/^\/+/, '');
  const base = from.split('/').slice(0, -1);
  rel.split('/').forEach(p => { if (p === '..') base.pop(); else if (p !== '.' && p !== '') base.push(p); });
  return base.join('/');
}

function mermaidTheme() { return document.documentElement.dataset.theme === 'light' ? 'neutral' : 'dark'; }

function enhance(container) {
  if (window.hljs) {
    container.querySelectorAll('pre code:not(.hl-done)').forEach(el => { try { window.hljs.highlightElement(el); } catch (e) {} });
  }
  if (window.mermaid) {
    const nodes = container.querySelectorAll('.mermaid');
    if (nodes.length) {
      try {
        window.mermaid.initialize({ startOnLoad: false, theme: mermaidTheme(), securityLevel: 'strict' });
        window.mermaid.run({ nodes });
      } catch (e) {}
    }
  } else {
    // CDN mermaid failed to load (offline): show the diagram SOURCE as a readable
    // code block instead of a div with whitespace-collapsed text.
    container.querySelectorAll('.mermaid').forEach(el => {
      const pre = document.createElement('pre'); pre.className = 'code';
      const code = document.createElement('code'); code.textContent = el.textContent;
      pre.appendChild(code); el.replaceWith(pre);
    });
  }
}

// Compact "when": relative while it reads naturally (today), then a short date,
// with the year only when it isn't this year. Hover shows the full timestamp.
function fmtWhen(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const now = new Date(), diff = now - d;
  if (diff >= 0 && diff < 60e3) return 'just now';
  if (diff >= 0 && diff < 3600e3) return Math.round(diff / 60e3) + 'm ago';
  if (diff >= 0 && diff < 86400e3 && now.toDateString() === d.toDateString()) return Math.round(diff / 3600e3) + 'h ago';
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}
function fmtFull(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString();
}

function renderPreview(pad, f) {
  current = pad.dir + '::' + f.path; currentRef = { pad, f };
  curIdx = ITEMS.findIndex(it => it.pad === pad && it.f === f);
  // Meta is a single tight dot-separated line (type · #tags) — not scattered chips.
  const metaBits = [f.registered ? esc(f.type || 'note') : 'unregistered'];
  if (f.external) metaBits.push('linked');
  (f.tags || []).forEach(t => metaBits.push('#' + esc(t)));
  const metaLine = metaBits.join(' · ');
  const canRaw = (f.kind === 'markdown' || f.kind === 'html') && f.content != null;
  const canCopyContent = f.content != null && (f.kind === 'markdown' || f.kind === 'html' || f.kind === 'code' || f.kind === 'text');
  const ctrls = '<span class="pctrls">' +
    '<button class="pbtn" id="copyPath">🔗 path</button>' +
    (canCopyContent ? '<button class="pbtn" id="copyContent">⧉ copy</button>' : '') +
    (canRaw
      ? '<button class="pbtn ' + (!rawMode ? 'on' : '') + '" id="vRendered">rendered</button>' +
        '<button class="pbtn ' + (rawMode ? 'on' : '') + '" id="vRaw">raw</button>'
      : '') +
    '</span>';
  // File dates, kept quiet next to the controls. An untouched file has
  // created === updated — one "created" entry says it all.
  const dateBits = [];
  if (f.created && fmtWhen(f.created)) dateBits.push(['created', f.created]);
  if (f.updated && fmtWhen(f.updated) && !(f.created && fmtWhen(f.created) === fmtWhen(f.updated))) {
    dateBits.push(['updated', f.updated]);
  }
  const datesHtml = dateBits.length
    ? '<span class="pdates" title="' + esc(dateBits.map(([w, iso]) => w + ' ' + fmtFull(iso)).join(' · ')) + '">' +
      dateBits.map(([w, iso]) => w + ' ' + esc(fmtWhen(iso))).join(' · ') + '</span>'
    : '';

  let bodyHtml = '';
  if (f.kind === 'toolarge') bodyHtml = '<div class="notice">File too large to preview.</div>';
  else if (f.kind === 'image' && f.content) bodyHtml = '<div class="imgwrap"><img src="' + f.content + '" alt="' + esc(f.path) + '"/></div>';
  else if (f.kind === 'markdown' && f.content != null) bodyHtml = rawMode
    ? (window.hljs
        ? '<pre class="code"><code class="hljs hl-done mdsrc">' + highlightRawMarkdown(f.content) + '</code></pre>'
        : '<pre class="code"><code class="language-markdown">' + esc(f.content) + '</code></pre>')
    : '<div class="md">' + renderMarkdown(f.content) + '</div>';
  else if (f.kind === 'html' && f.content != null) bodyHtml = rawMode
    ? '<pre class="code"><code class="language-html">' + esc(f.content) + '</code></pre>'
    // Sandboxed with scripts disabled: static HTML renders, no script/form/popup
    // can escape. srcdoc value is attribute-escaped by esc().
    : '<iframe class="htmlframe" sandbox="" srcdoc="' + esc(f.content) + '"></iframe>';
  else if ((f.kind === 'code' || f.kind === 'text') && f.content != null) {
    const cls = f.lang ? ' class="language-' + esc(normLang(f.lang)) + '"' : '';
    bodyHtml = '<pre class="code"><code' + cls + '>' + esc(f.content) + '</code></pre>';
  } else bodyHtml = '<div class="notice">No preview available (binary or missing file).</div>';

  const preview = document.getElementById('preview');
  // One reading column wraps the whole view so the header strip, title, meta,
  // and body all share a single left edge (per-element margins no longer fight
  // the centering).
  preview.innerHTML = '<div class="pbody">' +
    '<div class="phead"><span class="pfile">' + esc(f.path) + '</span>' + datesHtml + ctrls + '</div>' +
    '<h1 class="ptitle">' + esc(f.title || f.path) + '</h1>' +
    '<div class="pmeta">' + metaLine + '</div>' +
    (f.description ? '<div class="pdesc">' + esc(f.description) + '</div>' : '') +
    '<hr class="divider"/>' + bodyHtml +
    '</div>';

  if (canRaw) {
    const rd = document.getElementById('vRendered'), rw = document.getElementById('vRaw');
    rd.addEventListener('click', () => { if (rawMode) { setRaw(false); renderPreview(pad, f); } });
    rw.addEventListener('click', () => { if (!rawMode) { setRaw(true); renderPreview(pad, f); } });
  }
  // Clipboard: navigator.clipboard needs a secure context, but glimpse delivers
  // the page via NavigateToString / file:// — an opaque origin where it's absent
  // or rejects (the copy silently no-ops). Fall back to a hidden-textarea
  // execCommand('copy'), which works in that context (and in the browser).
  const execCopy = (text) => new Promise((resolve, reject) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('execCommand copy failed'));
    } catch (e) { reject(e); }
  });
  const copyText = (text) =>
    navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(text).catch(() => execCopy(text))
      : execCopy(text);
  // Flash the button label (✓ copied) and pop a toast so the action registers
  // whether the user is looking at the button or the corner.
  const flash = (btn, label, toast) => {
    btn.textContent = '✓ copied';
    btn.classList.add('on');
    clearTimeout(btn._flashTimer);
    btn._flashTimer = setTimeout(() => { btn.textContent = label; btn.classList.remove('on'); }, 1200);
    showToast(toast, 'success');
  };
  const cp = document.getElementById('copyPath');
  if (cp) cp.addEventListener('click', () =>
    copyText(f.abs || f.path)
      .then(() => flash(cp, '🔗 path', 'Path copied'))
      .catch(() => showToast('Copy failed')));
  const cc = document.getElementById('copyContent');
  if (cc) cc.addEventListener('click', () =>
    copyText(f.content)
      .then(() => flash(cc, '⧉ copy', 'Content copied'))
      .catch(() => showToast('Copy failed')));
  enhance(preview);
  document.querySelectorAll('.frow').forEach(el => el.classList.toggle('active', el.dataset.key === current));
}

function buildTree(preferKey, prevSelJson) {
  const tree = document.getElementById('tree');
  // Single-pad focus: the viewer shows the current pad's files as a flat list —
  // no pad-level grouping or switching. (Multiple pads, if ever passed, are
  // listed together; the current pad is the only mental model.)
  const items = [];
  DATA.pads.forEach((pad, pi) => pad.files.forEach((f, fi) => items.push({ pad, f, pi, fi })));
  // Group files by their (optional) group, preserving first-appearance order of
  // both the groups and the files within each. Ungrouped files share the '' key,
  // rendered under the default "FILES" header. ITEMS (j/k nav order) is rebuilt in
  // this grouped order so keyboard navigation matches the visible layout.
  const groupOrder = [], groups = new Map();
  items.forEach((it) => {
    const g = it.f.group || '';
    if (!groups.has(g)) { groups.set(g, []); groupOrder.push(g); }
    groups.get(g).push(it);
  });
  ITEMS = groupOrder.flatMap((g) => groups.get(g));

  document.getElementById('padname').textContent = DATA.pads.length === 1 ? DATA.pads[0].name : DATA.rootLabel;

  if (!items.length) {
    const msg = DATA.pads.length
      ? '<div class="empty"><div class="big">Empty scratchpad</div><div>No files yet.</div></div>'
      : '<div class="empty"><div class="big">No scratchpad here</div><div>Create one: <code>scratch new &lt;name&gt; --dir &lt;parent&gt;</code></div></div>';
    document.getElementById('preview').innerHTML = msg;
    tree.innerHTML = '<div class="label">FILES</div><div class="notice" style="padding:8px">none</div>';
    return;
  }

  let html = '';
  groupOrder.forEach((g) => {
    html += '<div class="label">' + (g ? esc(g) : 'FILES') + '</div>';
    groups.get(g).forEach(({ pad, f, pi, fi }) => {
      const key = pad.dir + '::' + f.path;
      const cls = 'frow' + (f.registered ? '' : ' unreg');
      const ttl = f.title || f.path;
      const tag = f.registered ? (f.type || 'note') : '·';
      html += '<div class="' + cls + '" data-key="' + esc(key) + '" data-pi="' + pi + '" data-fi="' + fi + '">' +
        '<span class="fttl" title="' + esc(ttl) + '">' + esc(ttl) + '</span><span class="ftag">' + esc(tag) + '</span></div>';
    });
  });
  // Only swap the tree DOM when the markup actually changed — otherwise reloading
  // (or re-selecting) needlessly destroys/recreates the sidebar = a visible flash.
  // Compare against the last GENERATED string (reading back innerHTML is unreliable
  // — the browser normalizes it).
  if (lastTreeHtml !== html) {
    lastTreeHtml = html;
    tree.innerHTML = html;
    tree.querySelectorAll('.frow[data-fi]').forEach(row => row.addEventListener('click', () => {
      const pad = DATA.pads[+row.dataset.pi]; renderPreview(pad, pad.files[+row.dataset.fi]);
    }));
  }

  // On a hot-reload we re-select the file the user was on (by pad::path) so the
  // view doesn't jump back to the top. If it's gone (deleted/renamed), fall back
  // to the first file and drop raw mode.
  let sel = items[0];
  if (preferKey) {
    const m = items.find(it => (it.pad.dir + '::' + it.f.path) === preferKey);
    if (m) sel = m;
  }
  // On a hot-reload, if the selected file is byte-for-byte unchanged, skip the
  // preview re-render (it swaps innerHTML + re-runs hljs/mermaid → a visible
  // blink). Just refresh the tree's active highlight and leave the preview be.
  const selKey = sel.pad.dir + '::' + sel.f.path;
  if (prevSelJson != null && selKey === current && JSON.stringify(sel.f) === prevSelJson) {
    document.querySelectorAll('.frow').forEach(el => el.classList.toggle('active', el.dataset.key === current));
    return;
  }
  renderPreview(sel.pad, sel.f);
}

// On-demand reload (native host): on a reload request the launcher rebuilds from
// disk and calls this via win.send(__scratchReload(...)). We patch DATA in place
// and re-render, preserving the selected file, raw mode, and scroll position —
// and skipping the preview re-render entirely when the open file is unchanged
// (buildTree handles that). (When the set of needed vendor bundles GROWS, the
// launcher re-navigates the whole page instead so highlighting/diagrams load.)
// Transient bottom-left toast (reload feedback). Re-triggerable: each call resets
// the auto-dismiss timer; an optional variant ('success' | 'info') tints it.
let _toastTimer;
function showToast(msg, variant) {
  // Guard the document ref: a deferred caller (e.g. the reload toast) can fire
  // after the DOM is gone (headless teardown), where document is undefined.
  if (typeof document === 'undefined') return;
  const el = document.getElementById('toast');
  if (!el) return;
  clearTimeout(_toastTimer);
  el.classList.remove('toast-success', 'toast-info');
  el.textContent = msg;
  if (variant) el.classList.add('toast-' + variant);
  el.classList.add('visible');
  _toastTimer = setTimeout(() => el.classList.remove('visible'), 2000);
}

window.__scratchReload = function (payload) {
  if (!payload || !payload.pads) return;
  // Nothing on disk changed since last render → no DOM swap, no flash; just tell
  // the user it's current. This is the common case when reload is pressed out of habit.
  if (JSON.stringify(payload) === JSON.stringify(DATA)) { showToast('No changes — up to date', 'info'); return; }
  const key = currentRef ? currentRef.pad.dir + '::' + currentRef.f.path : null;
  const prevSelJson = currentRef ? JSON.stringify(currentRef.f) : null;
  const pv = document.getElementById('preview');
  const scroll = pv ? pv.scrollTop : 0;
  DATA = payload;
  buildTree(key, prevSelJson);
  const pv2 = document.getElementById('preview');
  if (pv2) pv2.scrollTop = scroll;
  showToast('Reloaded from disk', 'success');
};

// Theme + settings. The server embeds the persisted choice (#settings island,
// from the user config file); changes are pushed back through whichever channel
// exists: WebView2 postMessage → POST /settings (browser server) → localStorage
// (the file:// export, where no host is listening).
const SETTINGS = (function () {
  let s = { themeMode: 'system', colorTheme: 'ember', gridStyle: 'dots', zoom: 1 };
  try { s = Object.assign(s, JSON.parse(document.getElementById('settings').textContent)); } catch (_) {}
  // Over file:// (export) the embedded snapshot is whatever the exporting machine
  // had saved — the reader's own remembered choice wins ('scratch.theme' is the
  // pre-settings key, kept as a migration seed).
  const hasChannel = (window.chrome && window.chrome.webview) || /^https?:$/.test(location.protocol);
  if (!hasChannel) {
    try {
      const m = localStorage.getItem('scratch.themeMode') || localStorage.getItem('scratch.theme');
      const c = localStorage.getItem('scratch.colorTheme');
      const g = localStorage.getItem('scratch.gridStyle');
      const z = parseFloat(localStorage.getItem('scratch.zoom'));
      if (m === 'dark' || m === 'light' || m === 'system') s.themeMode = m;
      if (c) s.colorTheme = c;
      if (g === 'off' || g === 'dots' || g === 'lines') s.gridStyle = g;
      if (z >= 0.5 && z <= 2) s.zoom = z;
    } catch (_) {}
  }
  return s;
})();
function persistSettings() {
  const payload = { themeMode: SETTINGS.themeMode, colorTheme: SETTINGS.colorTheme, gridStyle: SETTINGS.gridStyle, zoom: SETTINGS.zoom };
  const wv = window.chrome && window.chrome.webview;
  if (wv) { try { wv.postMessage({ __scratch_settings: payload }); } catch (_) {} return; }
  if (/^https?:$/.test(location.protocol)) {
    try {
      fetch('/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => {});
    } catch (_) {}
    return;
  }
  try {
    localStorage.setItem('scratch.themeMode', SETTINGS.themeMode);
    localStorage.setItem('scratch.colorTheme', SETTINGS.colorTheme);
    localStorage.setItem('scratch.gridStyle', SETTINGS.gridStyle);
    localStorage.setItem('scratch.zoom', String(SETTINGS.zoom));
  } catch (_) {}
}
function resolvedMode() {
  if (SETTINGS.themeMode === 'dark' || SETTINGS.themeMode === 'light') return SETTINGS.themeMode;
  const dark = !window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches;
  return dark ? 'dark' : 'light';
}
function syncThemeIcon() {
  const dark = document.documentElement.dataset.theme !== 'light';
  const d = document.querySelector('#themeToggle .i-dark'), l = document.querySelector('#themeToggle .i-light');
  if (d) d.style.display = dark ? '' : 'none';
  if (l) l.style.display = dark ? 'none' : '';
  // Enable exactly one hljs theme stylesheet to match the active mode.
  const hd = document.getElementById('hljs-dark'), hl = document.getElementById('hljs-light');
  if (hd) hd.disabled = !dark;
  if (hl) hl.disabled = dark;
}
function applyTheme() {
  const r = document.documentElement;
  r.dataset.theme = resolvedMode();
  r.dataset.colorTheme = SETTINGS.colorTheme;
  r.dataset.grid = SETTINGS.gridStyle;
  syncThemeIcon();
  // Reflect the active choice in the settings modal.
  document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === SETTINGS.themeMode));
  document.querySelectorAll('.theme-card').forEach((b) => b.classList.toggle('on', b.dataset.themeId === SETTINGS.colorTheme));
  document.querySelectorAll('#gridSeg button').forEach((b) => b.classList.toggle('on', b.dataset.grid === SETTINGS.gridStyle));
}
function setThemeMode(m) {
  SETTINGS.themeMode = m;
  applyTheme();
  persistSettings();
  // Mode flips swap the mermaid palette → re-render the open preview.
  if (currentRef) renderPreview(currentRef.pad, currentRef.f);
}
function setColorTheme(id) {
  SETTINGS.colorTheme = id;
  applyTheme();
  persistSettings();
}
function setGridStyle(g) {
  SETTINGS.gridStyle = g;
  applyTheme();
  persistSettings();
}
applyTheme();
if (window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(() => {
    if (SETTINGS.themeMode !== 'system') return;
    applyTheme();
    if (currentRef) renderPreview(currentRef.pad, currentRef.f);
  });
}
// Quick toggle (topbar button / 't'): flips to an explicit light/dark mode.
function toggleTheme() { setThemeMode(resolvedMode() === 'dark' ? 'light' : 'dark'); }
document.getElementById('themeToggle').addEventListener('click', toggleTheme);

// Settings modal.
const settingsModal = document.getElementById('settingsModal');
const showSettings = (v) => { settingsModal.style.display = v ? 'flex' : 'none'; };
document.getElementById('settingsBtn').addEventListener('click', () => showSettings(true));
document.getElementById('settingsClose').addEventListener('click', () => showSettings(false));
settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) showSettings(false); });
document.querySelectorAll('#modeSeg button').forEach((b) => b.addEventListener('click', () => setThemeMode(b.dataset.mode)));
document.querySelectorAll('.theme-card').forEach((b) => b.addEventListener('click', () => setColorTheme(b.dataset.themeId)));
document.querySelectorAll('#gridSeg button').forEach((b) => b.addEventListener('click', () => setGridStyle(b.dataset.grid)));

// Zoom. Owned by the page (CSS zoom on the root) because neither host remembers
// zoom across launches: glimpse never exposes WebView2's ZoomFactor, and the
// browser server binds a random port so the per-origin zoom memory never matches.
// Persisted as ui.zoom through the same settings channel.
function applyZoom() {
  document.documentElement.style.zoom = SETTINGS.zoom;
  const r = document.getElementById('zoomReset');
  if (r) r.textContent = Math.round(SETTINGS.zoom * 100) + '%';
}
function setZoom(z) {
  const next = Math.min(2, Math.max(0.5, Math.round(z * 10) / 10));
  if (next === SETTINGS.zoom) return;
  SETTINGS.zoom = next;
  applyZoom();
  persistSettings();
  showToast('Zoom ' + Math.round(next * 100) + '%', 'info');
}
applyZoom();
document.getElementById('zoomIn').addEventListener('click', () => setZoom(SETTINGS.zoom + 0.1));
document.getElementById('zoomOut').addEventListener('click', () => setZoom(SETTINGS.zoom - 0.1));
document.getElementById('zoomReset').addEventListener('click', () => setZoom(1));
// Ctrl+wheel: replace the host's transient zoom with ours (non-passive so
// preventDefault stops Chromium's own page zoom from stacking on top).
window.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  setZoom(SETTINGS.zoom + (e.deltaY < 0 ? 0.1 : -0.1));
}, { passive: false });

// Re-sync settings from the host after a native reload. A WebView2 reload
// (Ctrl+R/F5) re-renders the HTML string presented at launch, so the #settings
// island — and thus SETTINGS above — reflects config as of launch, not changes
// saved since. We ask the host for the authoritative config (it replies via
// __scratchSettings) and re-apply whatever drifted. No-op on first launch (island
// already matches disk) and outside the webview (the browser re-fetches a freshly
// rebuilt page; the file:// export has no host to ask).
window.__scratchSettings = function (cfg) {
  if (!cfg || typeof cfg !== 'object') return;
  let drift = false;
  if ((cfg.themeMode === 'dark' || cfg.themeMode === 'light' || cfg.themeMode === 'system') && cfg.themeMode !== SETTINGS.themeMode) { SETTINGS.themeMode = cfg.themeMode; drift = true; }
  if (cfg.colorTheme && cfg.colorTheme !== SETTINGS.colorTheme) { SETTINGS.colorTheme = cfg.colorTheme; drift = true; }
  if ((cfg.gridStyle === 'off' || cfg.gridStyle === 'dots' || cfg.gridStyle === 'lines') && cfg.gridStyle !== SETTINGS.gridStyle) { SETTINGS.gridStyle = cfg.gridStyle; drift = true; }
  if (typeof cfg.zoom === 'number' && cfg.zoom >= 0.5 && cfg.zoom <= 2 && cfg.zoom !== SETTINGS.zoom) { SETTINGS.zoom = cfg.zoom; drift = true; }
  if (!drift) return;
  applyTheme();
  applyZoom();
  // A mode flip swaps the mermaid palette → re-render the open file.
  if (currentRef) renderPreview(currentRef.pad, currentRef.f);
};
(function () {
  const wv = window.chrome && window.chrome.webview;
  if (wv) { try { wv.postMessage({ __scratch_get_settings: true }); } catch (_) {} }
})();

// Shortcuts help modal.
const helpModal = document.getElementById('helpModal');
const showHelp = (v) => { helpModal.style.display = v ? 'flex' : 'none'; };
document.getElementById('helpBtn').addEventListener('click', () => showHelp(true));
document.getElementById('helpClose').addEventListener('click', () => showHelp(false));
helpModal.addEventListener('click', (e) => { if (e.target === helpModal) showHelp(false); });

// Frameless window chrome: glimpse's Windows WebView2 host opens with no system
// title bar (frameless), so the page must offer its own close affordance. The
// host closes when the page posts {__glimpse_close:true}. Only shown when running
// inside the WebView2 host (window.chrome.webview); in the browser fallback there
// is a normal tab/title bar, so the button stays hidden.
const webview = window.chrome && window.chrome.webview;
const closeWindow = webview ? () => webview.postMessage({ __glimpse_close: true })
  : (window.glimpse && window.glimpse.close ? () => window.glimpse.close() : null);

// Manual reload (button + 'r'). Reload is on-demand, not automatic — a watcher
// that re-rendered on every disk change blinked. In the WebView2 host we ask the
// launcher to rebuild from disk and push fresh data (it replies via
// __scratchReload, which only re-renders the preview if the open file changed);
// in the browser we just reload the page (the server rebuilds per request).
function requestReload() {
  if (webview) { try { webview.postMessage({ __scratch_reload: true }); } catch (_) {} }
  // Browser: full reload (the server rebuilds per request). Stash a flag so the
  // freshly-loaded page can surface the toast the native path shows inline.
  else { try { sessionStorage.setItem('scratch_reloaded', '1'); } catch (_) {} location.reload(); }
}
document.getElementById('reloadBtn').addEventListener('click', requestReload);
// Browser reload just happened → show the toast the pre-reload page couldn't.
try { if (sessionStorage.getItem('scratch_reloaded')) { sessionStorage.removeItem('scratch_reloaded'); showToast('Reloaded from disk', 'success'); } } catch (_) {}
(function () {
  const btn = document.getElementById('closeBtn');
  if (closeWindow && btn) { btn.style.display = ''; btn.addEventListener('click', closeWindow); }
})();

// GitHub link: in the WebView2 host a target=_blank popup has no handler, so
// hand the URL to the system browser via the host (browser fallback keeps the
// normal anchor behavior).
document.getElementById('repoLink').addEventListener('click', (e) => {
  if (!webview) return;
  e.preventDefault();
  webview.postMessage({ __glimpse_open: e.currentTarget.href });
});

// Resizable sidebar: drag the handle to set the tree width, persisted across
// sessions. Width is clamped so neither pane can be dragged away entirely.
(function () {
  const TREE_MIN = 200, TREE_MAX = 640;
  const resizer = document.getElementById('resizer');
  const tree = document.getElementById('sidebar');
  const setW = (px) => {
    const w = Math.max(TREE_MIN, Math.min(TREE_MAX, px));
    document.documentElement.style.setProperty('--tree-w', w + 'px');
    return w;
  };
  try { const saved = parseInt(localStorage.getItem('scratch.treeW'), 10); if (saved) setW(saved); } catch (_) {}
  let dragging = false;
  const onMove = (e) => { if (dragging) setW(e.clientX - tree.getBoundingClientRect().left); };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('dragging');
    tree.classList.remove('resizing');
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    try { localStorage.setItem('scratch.treeW', String(tree.getBoundingClientRect().width | 0)); } catch (_) {}
  };
  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    resizer.classList.add('dragging');
    tree.classList.add('resizing');
    // Suppress text selection + keep the resize cursor through the whole drag.
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  // Double-click resets to the default width. preventDefault stops the browser's
  // double-click default (text selection / smart-zoom) from firing on the handle.
  resizer.addEventListener('dblclick', (e) => {
    e.preventDefault();
    document.documentElement.style.removeProperty('--tree-w');
    try { localStorage.removeItem('scratch.treeW'); } catch (_) {}
    showToast('Sidebar width reset', 'info');
  });
})();

// Collapsible sidebar (topbar panel button / '['). Like the resizable width
// (scratch.treeW above), this is per-machine window geometry — localStorage,
// not the config file.
const sidebarEl = document.getElementById('sidebar');
function toggleSidebar() {
  const c = sidebarEl.classList.toggle('collapsed');
  try { localStorage.setItem('scratch.sidebarCollapsed', c ? '1' : '0'); } catch (_) {}
}
document.getElementById('sidebarToggle').addEventListener('click', toggleSidebar);
try {
  if (localStorage.getItem('scratch.sidebarCollapsed') === '1') {
    // Restore closed without the slide-shut animation playing at boot.
    sidebarEl.style.transition = 'none';
    sidebarEl.classList.add('collapsed');
    setTimeout(() => { sidebarEl.style.transition = ''; }, 0);
  }
} catch (_) {}

// Keyboard shortcuts (see the help modal). Ignored while typing in a field.
const previewEl = document.getElementById('preview');
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    // Take over the host's zoom accelerators so OUR (persisted) zoom is the one
    // that moves, instead of Chromium's forgotten-on-relaunch page zoom.
    if (e.key === '=' || e.key === '+') { e.preventDefault(); setZoom(SETTINGS.zoom + 0.1); return; }
    if (e.key === '-') { e.preventDefault(); setZoom(SETTINGS.zoom - 0.1); return; }
    if (e.key === '0') { e.preventDefault(); setZoom(1); return; }
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (e.key === 'Escape') {
    if (settingsModal.style.display !== 'none') showSettings(false);
    else if (helpModal.style.display !== 'none') showHelp(false);
    else if (closeWindow) closeWindow();
    return;
  }
  if (e.key === 'q' && closeWindow) { closeWindow(); return; }
  if (e.key === '?') { showHelp(helpModal.style.display === 'none'); return; }
  if (e.key === 's') { showSettings(settingsModal.style.display === 'none'); return; }
  if (e.key === 't') { toggleTheme(); return; }
  if (e.key === '[') { toggleSidebar(); return; }
  if (e.key === 'r') { requestReload(); return; }
  if (e.key === 'v' && currentRef && currentRef.f.kind === 'markdown' && currentRef.f.content != null) {
    setRaw(!rawMode); renderPreview(currentRef.pad, currentRef.f); return;
  }
  // vimium-style scrolling: j/k line steps, d/u half page. Instant (no smooth) —
  // smooth scrollBy queues badly under key auto-repeat. File nav stays on arrows.
  if (e.key === 'j' || e.key === 'k') {
    e.preventDefault(); previewEl.scrollBy(0, e.key === 'j' ? 60 : -60); return;
  }
  if (e.key === 'd' || e.key === 'u') {
    e.preventDefault(); previewEl.scrollBy(0, (e.key === 'd' ? 1 : -1) * previewEl.clientHeight / 2); return;
  }
  if (e.key === 'g' || e.key === 'G') {
    e.preventDefault(); previewEl.scrollTo(0, e.key === 'g' ? 0 : previewEl.scrollHeight); return;
  }
  const next = e.key === 'ArrowDown' || e.key === 'ArrowRight';
  const prev = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
  if ((next || prev) && ITEMS.length) {
    e.preventDefault();
    const n = curIdx + (next ? 1 : -1);
    if (n >= 0 && n < ITEMS.length) { renderPreview(ITEMS[n].pad, ITEMS[n].f); }
  }
});

// Intercept link clicks in the preview. The viewer is a single self-contained
// page (loaded via setHTML in the WebView2 host — NO server, NO back button), so
// letting a link navigate the webview lands on a dead URL = blank window. Instead:
//   • relative link to a pad file  → open that file in the viewer
//   • external (http/https/mailto) → hand off to the system browser
//   • anything else                → swallow (no navigation)
previewEl.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a');
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute('href') || '';
  if (/^(https?:|mailto:)/i.test(href)) {
    const wv = window.chrome && window.chrome.webview;
    if (wv) wv.postMessage({ __glimpse_open: href }); else window.open(href, '_blank');
    return;
  }
  if (!currentRef || !href) return;
  const target = resolveRel(currentRef.f.path, href.split('#')[0]);
  const pad = currentRef.pad;
  const f = pad.files.find(x => x.path === target || x.path === href || x.path.endsWith('/' + target));
  if (f) { renderPreview(pad, f); }
});

buildTree();
`;
