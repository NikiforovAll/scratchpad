// Build the viewer HTML page. The CLI does all file I/O here and embeds the pad
// data + file contents into one HTML string, so glimpse and the browser fallback
// render identically with no round-trips. highlight.js and mermaid load from a
// pinned CDN, added CONDITIONALLY — hljs only when a pad has code, mermaid only
// when a ```mermaid block is present.

import { stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import type { ScratchConfig } from "../config.ts";
import { type Pad, exportFileSlug, resolveEntryPath } from "../discovery.ts";
import { type Comment, DEFAULT_TYPE, type FileEntry } from "../manifest.ts";
import { KIT_CSS, KIT_SVG_DEFS } from "./kit.ts";
import { COLOR_THEMES, DEFAULT_COLOR_THEME, THEME_CSS } from "./theme.ts";

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
// KaTeX (math). The script-global build sets window.katex; the client renders
// $…$ / $$…$$ spans in enhance(). Added CONDITIONALLY (only when a doc has math).
const KATEX_CDN = {
  url: "https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js",
  sri: "sha384-cMkvdD8LoxVzGF/RPUKAcvmm49FQ0oxwDF3BGKtDXcEc+T1b2N+teh/OJfpU0jr6",
};
// KaTeX stylesheet. It pulls the math fonts by RELATIVE url from the CDN, so an
// export opened OFFLINE loses the glyphs — the .math span then degrades to its
// raw $…$ source (kept as the span's fallback text). Deliberately NOT inlined:
// same graceful-online-degradation contract as hljs/mermaid.
const KATEX_CSS = {
  url: "https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css",
  sri: "sha384-5TcZemv2l/9On385z///+d7MSYlvIEw9FuZTIdZ14vJLqWphw7e7ZPuOiCHJcFCP",
};

const MAX_EMBED_BYTES = 512 * 1024; // skip embedding text/code content above this
// Images get a far larger budget than text — a single screenshot routinely
// exceeds 512KB, and embedding it is the only way it survives an export over
// file://. Base64 inflates bytes ~33%, so this is the on-disk source ceiling.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

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
  /** For markdown: raw inline-image src → embedded data URI, so `![](rel)` refs
   * survive an export over file://. Absent when the doc has no local images. */
  assets?: Record<string, string>;
  /** ISO timestamps from the file on disk (manifest has only pad-level dates). */
  created?: string;
  updated?: string;
  /** Inline comments from the manifest (quote-anchored; see manifest.ts). */
  comments?: Comment[];
}
interface PadView {
  name: string;
  id?: string;
  dir: string;
  files: FileView[];
}

/** Base64 data URI for an embedded image's bytes (shared by the registered-file
 * and inline-markdown embed paths). */
function imageDataUri(buf: Buffer, ext: string): string {
  return `data:${MIME[ext] ?? "application/octet-stream"};base64,${buf.toString("base64")}`;
}

/** Extract the bare src token from an ![](...) destination — drops an optional
 * "title" and surrounding <...>. Must mirror the client's extraction so the
 * server-built asset key matches the client lookup. */
function imageSrcToken(raw: string): string {
  let s = raw.trim();
  const sp = s.search(/\s/);
  if (sp >= 0) s = s.slice(0, sp);
  if (s.startsWith("<") && s.endsWith(">")) s = s.slice(1, -1);
  return s;
}

/** Embed each local file referenced by a markdown `![alt](src)` so the page stays
 * self-contained, keyed by raw src. Images become a data URI; a local `.html` ref
 * becomes its raw markup (rendered live in a sandboxed iframe client-side — md stays
 * prose, the diagram is its own loose file, NOT a manifest entry). Remote/scheme refs
 * and other types are left for the browser; missing/oversized files are skipped.
 * Resolves relative to the doc's dir. */
async function embedInlineAssets(markdown: string, baseDir: string): Promise<Record<string, string>> {
  const assets: Record<string, string> = {};
  // ![alt](src) — src is everything up to the first whitespace ("title" follows)
  // or the closing paren. Local regex (not module-level) so the /g lastIndex is
  // never shared across the concurrent scanPadFiles map.
  for (const m of markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    const src = imageSrcToken(m[1]!);
    if (!src || src in assets) continue; // assets dedups by key
    if (/^(https?:|data:|file:|\/\/)/i.test(src)) continue;
    const ext = extname(src).toLowerCase();
    const isImage = IMAGE_EXT.has(ext), isHtml = HTML_EXT.has(ext);
    if (!isImage && !isHtml) continue;
    let rel = src;
    try {
      rel = decodeURIComponent(src); // paths may be percent-encoded (e.g. %20)
    } catch {
      // malformed escape — fall back to the raw token
    }
    const file = Bun.file(isAbsolute(rel) ? rel : resolve(baseDir, rel));
    if (file.size > (isImage ? MAX_IMAGE_BYTES : MAX_EMBED_BYTES)) continue; // 0 for a missing file → falls through to the read
    try {
      assets[src] = isImage
        ? imageDataUri(Buffer.from(await file.arrayBuffer()), ext)
        : await file.text();
    } catch {
      // missing / unreadable (raced delete, perms) — leave the ref untouched
    }
  }
  return assets;
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
    const abs = resolveEntryPath(pad.dir, meta);
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
      const cap = kind === "image" ? MAX_IMAGE_BYTES : MAX_EMBED_BYTES;
      if (size > cap) {
        kind = "toolarge";
      } else if (kind === "image") {
        content = imageDataUri(Buffer.from(await file.arrayBuffer()), ext);
      } else if (kind === "binary") {
        content = null;
      } else {
        content = await file.text();
      }
    } else {
      kind = "binary";
      content = null;
    }
    // Markdown may reference local images / html diagrams by relative path; embed
    // them so the page stays self-contained (esp. an export, where the file isn't
    // on disk).
    let assets: Record<string, string> | undefined;
    if (kind === "markdown" && content) {
      const embedded = await embedInlineAssets(content, dirname(abs));
      if (Object.keys(embedded).length) assets = embedded;
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
      assets,
      created,
      updated,
      comments: meta.comments,
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
// TeX math: $$display$$ (one line or multi-line) OR inline $…$. The inline arm
// requires non-space adjacency to the delimiters and a non-word/non-$ char
// outside them, so prose currency ("$5 and $10") doesn't trip it. Kept in sync
// with the client extractor in mdInline/renderMarkdown; a drift only over- or
// under-loads the bundle (the client still degrades to raw source).
const MATH_RE = /\$\$[\s\S]+?\$\$|(?<![\\\w$])\$(?=\S)(?:\\.|[^$\n\\])+?(?<=\S)\$(?![\w$])/;

/** The embedded data island, escaped for inline <script> AND safe as an eval arg. */
export function payloadJson(view: PadView[], rootLabel: string): string {
  return JSON.stringify({ pads: view, rootLabel }).replace(/</g, "\\u003c");
}

/** Which vendor bundles a view requires — used to decide in-place vs full reload. */
export function bundleNeeds(view: PadView[]): { hljs: boolean; mermaid: boolean; math: boolean } {
  return { hljs: needsHljs(view), mermaid: needsMermaid(view), math: needsMath(view) };
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
function needsMath(view: PadView[]): boolean {
  return view.some((p) =>
    p.files.some((f) => f.kind === "markdown" && f.content != null && MATH_RE.test(f.content)),
  );
}

/** Viewer settings embedded into the page (persisted in the user config file).
 * Derived from ScratchConfig.ui so the shapes can't drift; frameless is a
 * launch-time concern, and zoom / starredThemes / gridStyle / wideMode are
 * optional here (renderHtml defaults them: 1 / [] / dots / false) so partial
 * call sites keep working. */
export type UiSettings = Omit<
  ScratchConfig["ui"],
  "frameless" | "zoom" | "starredThemes" | "gridStyle" | "wideMode"
> &
  Partial<Pick<ScratchConfig["ui"], "zoom" | "starredThemes" | "gridStyle" | "wideMode">>;

const DEFAULT_UI: UiSettings = {
  themeMode: "system",
  colorTheme: DEFAULT_COLOR_THEME,
  starredThemes: [],
  gridStyle: "dots",
  wideMode: false,
};

export async function renderHtml(
  view: PadView[],
  rootLabel: string,
  ui: UiSettings = DEFAULT_UI,
  opts: { exportMode?: boolean } = {},
): Promise<string> {
  const data = payloadJson(view, rootLabel);
  // Static kit (tokens + classes + #arrow marker) baked into every ![](file.html)
  // embed's iframe; same <-escape as the data island so it's inline-script-safe.
  const kitJson = JSON.stringify({ css: KIT_CSS, defs: KIT_SVG_DEFS }).replace(/</g, "\\u003c");
  const titleName = view.length === 1 ? view[0]!.name : rootLabel;
  // Suggested filename for in-viewer save — the same slug `scratch export` writes.
  const exportName = exportFileSlug(view.length === 1 ? view[0]!.name : null, rootLabel);
  const zoom = ui.zoom ?? 1;
  const gridStyle = ui.gridStyle ?? "dots";
  const wideMode = ui.wideMode ?? false;
  // Persisted theme/zoom land on <html> server-side so the first paint is
  // already correct (no flash). "system" stays attribute-less until the client
  // resolves prefers-color-scheme — same dark-first default as today.
  const htmlAttrs =
    ` data-color-theme="${escapeHtml(ui.colorTheme)}"` +
    ` data-grid="${escapeHtml(gridStyle)}"` +
    (ui.themeMode === "system" ? "" : ` data-theme="${ui.themeMode}"`) +
    (wideMode ? " data-wide" : "") +
    // Static export: no host listens, so the page file is the comment store.
    // The client keys "save a copy" behavior off this attribute, and it rides
    // along when the page re-saves itself, so saved copies stay exports.
    (opts.exportMode ? " data-export" : "") +
    ` data-export-name="${escapeHtml(exportName)}"` +
    (zoom === 1 ? "" : ` style="zoom: ${zoom}"`);
  // NOT part of payloadJson: __scratchReload diff-compares the data island to
  // detect "no changes", and settings must not break that.
  const settingsJson = JSON.stringify({
    ...ui,
    starredThemes: ui.starredThemes ?? [],
    gridStyle,
    wideMode,
    zoom,
  }).replace(/</g, "\\u003c");

  // CDN tags are blocking (no defer) so window.hljs/window.mermaid are ready
  // before the client script runs. SRI + crossorigin guard integrity; on load
  // failure the client degrades gracefully.
  const cdnTag = (c: { url: string; sri: string }) =>
    `<script src="${c.url}" integrity="${c.sri}" crossorigin="anonymous" referrerpolicy="no-referrer"></script>\n`;

  let vendor = "";
  if (needsHljs(view)) vendor += cdnTag(HLJS_CDN);
  if (needsMermaid(view)) vendor += cdnTag(MERMAID_CDN);
  if (needsMath(view)) vendor += cdnTag(KATEX_CDN);

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
  // KaTeX CSS is theme-agnostic (math inherits the page `color`), so a single
  // link — no light/dark pair like hljs.
  if (needsMath(view)) vendorCss += cssLink("katex-css", KATEX_CSS);

  // The Save-a-copy button ships in BOTH modes (Ctrl+S in the client script
  // mirrors it). In an export, saving is what persists comments (no write-back
  // channel); in a live viewer it exports a standalone copy of the page — the
  // saved file gets data-export injected so it opens as a real export. The
  // saveDot (unsaved-comments hint) only ever fires in export mode.
  const saveTitle = opts.exportMode
    ? "Save a copy of this page — comments live in the saved file"
    : "Export a copy of this page to a file (Ctrl+S)";
  const saveBtn = `<button class="icon-btn" id="saveCopy" title="${saveTitle}" aria-label="Save a copy">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        <span class="save-dot" id="saveDot" hidden></span>
      </button>
      `;

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
      ${saveBtn}<button class="icon-btn" id="commentsToggle" title="Comments summary (toggle visibility with C)" aria-label="Comments summary">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span class="cmt-count" id="cmtCount" aria-label="Comment count" hidden></span>
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
      <button class="icon-btn" id="closeBtn" title="Close (q)" aria-label="Close" style="display:none">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
  </header>
  <div class="body">
    <div class="sidebar" id="sidebar">
      <button class="icon-btn" id="sidebarToggle" title="Collapse sidebar ([)" aria-label="Collapse sidebar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>
      </button>
      <nav class="tree" id="tree"></nav>
      <div class="appver" title="scratch version">v${escapeHtml(pkg.version)}</div>
    </div>
    <div class="resizer" id="resizer" role="separator" aria-orientation="vertical" title="Drag to resize"></div>
    <main class="preview" id="preview" tabindex="0"></main>
    <aside class="toc" id="toc" aria-label="On this page"></aside>
    <button class="icon-btn" id="sidebarOpen" title="Show sidebar ([)" aria-label="Show sidebar">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>
    </button>
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
        <div><dt><kbd>o</kbd></dt><dd>Toggle table of contents</dd></div>
        <div><dt><kbd>c</kbd></dt><dd>Toggle comments</dd></div>
        <div class="sc-live"><dt><kbd>Shift</kbd><span class="sc-plus">+</span><kbd>C</kbd></dt><dd>Copy active file path</dd></div>
        <div><dt><kbd>t</kbd></dt><dd>Toggle theme</dd></div>
        <div><dt><kbd>[</kbd></dt><dd>Toggle sidebar</dd></div>
        <div><dt><kbd>Ctrl</kbd><span class="sc-plus">+</span><kbd>+</kbd><kbd>−</kbd><kbd>0</kbd></dt><dd>Zoom in / out / reset</dd></div>
        <div><dt><kbd>Ctrl</kbd><span class="sc-plus">+</span><kbd>S</kbd></dt><dd>Save / export a copy to a file</dd></div>
        <div class="sc-group">General</div>
        <div class="sc-live"><dt><kbd>r</kbd></dt><dd>Reload from disk</dd></div>
        <div><dt><kbd>s</kbd></dt><dd>Settings</dd></div>
        <div><dt><kbd>?</kbd></dt><dd>Show this help</dd></div>
        <div class="sc-live"><dt><kbd>q</kbd></dt><dd>Quit (close window)</dd></div>
        <div><dt><kbd>Esc</kbd></dt><dd>Close dialogs</dd></div>
      </dl>
    </div>
  </div>
  ${SETTINGS_MODAL_HTML}
  ${GALLERY_MODAL_HTML}
</div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script id="data" type="application/json">${data}</script>
<script id="settings" type="application/json">${settingsJson}</script>
<script id="themes" type="application/json">${THEMES_JSON}</script>
<script id="kit" type="application/json">${kitJson}</script>
${vendor}<script>${CLIENT_JS}</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

// Theme registry slimmed for the page: id/label + the 4 swatch-dot colors per
// mode. Cards (settings strip AND gallery) are rendered client-side from this
// island — the starred strip changes as stars toggle, so static server markup
// can't carry it. Static registry → build once at module load.
const THEMES_JSON = JSON.stringify(
  COLOR_THEMES.map((t) => ({
    id: t.id,
    label: t.label,
    dark: [t.dark.field, t.dark.surface, t.dark.ember, t.dark.ink1],
    light: [t.light.field, t.light.surface, t.light.ember, t.light.ink1],
  })),
).replace(/</g, "\\u003c");

function settingsModalHtml(): string {
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
          <div class="theme-grid">
            <div class="starred-cards" id="starredGrid"></div>
            <button class="pbtn browse-themes" id="browseThemes">Browse all themes…</button>
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
          <div class="settings-label">Width</div>
          <div class="seg" id="widthSeg">
            <button data-wide="off">Normal</button>
            <button data-wide="on">Wide</button>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-label">Contents (O)</div>
          <div class="seg" id="tocSeg">
            <button data-toc="on">On</button>
            <button data-toc="off">Off</button>
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

// Theme gallery: every theme, each card with a star toggle (max 3 starred —
// those are the cards the settings panel shows). Grid filled client-side from
// the #themes island; scrim sits above the settings scrim so settings stays open.
const GALLERY_MODAL_HTML = `<div class="modal-scrim gallery-scrim" id="galleryModal" style="display:none">
    <div class="modal modal-wide">
      <div class="modal-head"><span>Themes</span><button class="icon-btn" id="galleryClose" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
      <div class="gallery-body"><div class="theme-grid" id="galleryGrid"></div></div>
    </div>
  </div>`;

// Client-side: tree nav, preview switching, minimal markdown renderer, raw/
// rendered toggle, syntax highlighting (if hljs present), mermaid (if present),
// and auto-detected theme. Kept dependency-free; vendored libs are optional.
const CLIENT_JS = String.raw`
let DATA = JSON.parse(document.getElementById('data').textContent);
// Static export (scratch export bakes data-export onto <html>): no host listens,
// so the page file itself is where comments persist. Capture the pristine source
// now, before any rendering mutates the DOM — saveCopy() splices the live DATA
// back into this string instead of re-serializing the mutated document. Captured
// in every mode: a live viewer's Ctrl+S exports a copy off this same snapshot.
const EXPORT_MODE = document.documentElement.hasAttribute('data-export');
const PRISTINE = '<!doctype html>\n' + document.documentElement.outerHTML;
const esc = (s) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Wrap an author HTML doc/fragment as srcdoc for a sandboxed iframe (used by
// ![](file.html) embeds). color-scheme follows the host theme; a ResizeObserver
// posts content height up so the parent can size the frame to its content (see the
// message listener in enhance). Runs in an opaque-origin iframe — no host access.
// Static embed kit (tokens + classes + #arrow marker), read once from the #kit
// island. See kit.ts.
const KIT = (function () {
  try { return JSON.parse(document.getElementById('kit').textContent); }
  catch (_) { return { css: '', defs: '' }; }
})();
// Static frame script: posts content height up (ResizeObserver) so the parent can
// size the frame, and forwards keystrokes up so the host's shortcuts (t/s/?/…) still
// fire when focus is inside the frame (an iframe otherwise swallows them; keys typed
// into the frame's own inputs are left alone). Fully static — built once, not per
// embed. srcdoc auto-wraps content in a document, so no doctype/html/head/body
// scaffolding. The script tags are built as '<' + 'script>' so no literal script-tag
// (least of all a closing one) appears in this source — this whole block is itself
// emitted inside the host page's own script element, where a closing tag would end it.
const FRAME_SCRIPT = '<' + 'script>(function(){function p(){var d=document.documentElement,b=document.body,h=Math.max(d.scrollHeight,b?b.scrollHeight:0,b?b.offsetHeight:0);parent.postMessage({__scratchFrame:1,h:h},"*");}var o=new ResizeObserver(p);o.observe(document.documentElement);if(document.body)o.observe(document.body);addEventListener("load",p);p();addEventListener("keydown",function(e){var x=e.target;if(x&&(x.tagName==="INPUT"||x.tagName==="TEXTAREA"||x.isContentEditable))return;parent.postMessage({__scratchKey:1,key:e.key,ctrlKey:e.ctrlKey,metaKey:e.metaKey,altKey:e.altKey,shiftKey:e.shiftKey},"*");});})();' + '<' + '/script>';
function htmlFrameDoc(fragment) {
  // Force color-scheme to the RESOLVED viewer theme (not the OS) so the kit's
  // light-dark() tokens track the toggle. data-theme is absent in system mode →
  // fall back to the OS preference, dark-first like the rest of the viewer.
  const t = document.documentElement.dataset.theme;
  const dark = t === 'dark' || (!t && (!window.matchMedia || matchMedia('(prefers-color-scheme: dark)').matches));
  // body:flow-root (in the kit) contains child margins so the last child's bottom
  // margin is counted in scrollHeight — otherwise a collapsed margin under-reports
  // and the frame shows a phantom scrollbar (FRAME_SCRIPT measures the max metric).
  return '<style>:root{color-scheme:' + (dark ? 'dark' : 'light') + '}' + KIT.css + '</style>'
    + KIT.defs
    + fragment
    + FRAME_SCRIPT;
}

// Footnote registry for the current renderMarkdown pass (Pandoc/GFM [^id] refs +
// [^id]: defs). Set/reset by renderMarkdown; null outside a render so mdInline
// leaves stray [^x] literal. { defs: id→text, order: [id…] in ref order, seen: id→n }.
let FN = null;

function mdInline(s) {
  // Stash inline code spans and math BEFORE escaping/emphasis run — their bodies
  // hold chars ($ _ * \\ <) those passes would corrupt, and a $…$ inside \`code\`
  // must stay literal (not become math). Restored at the very end.
  const stash = [];
  const hold = (html) => { stash.push(html); return '\x00S' + (stash.length - 1) + '\x00'; };
  s = s.replace(/\`([^\`]+)\`/g, (_, c) => hold('<code>' + esc(c) + '</code>'));
  // $$display$$ or inline $…$ (single line). data-tex carries the source; KaTeX
  // renders it in enhance(). Offline (no katex) the raw source stays as the span's
  // text, so math degrades to readable source. Kept in sync with MATH_RE.
  s = s.replace(/\$\$([^$\n]+?)\$\$|(?<![\\\w$])\$(?=\S)((?:\\.|[^$\n\\])+?)(?<=\S)\$(?![\w$])/g, (raw, disp, inl) => {
    const display = disp != null, tex = display ? disp : inl;
    return hold('<span class="math' + (display ? ' math-display' : '') + '" data-tex="' + esc(tex) + '">' + esc(raw) + '</span>');
  });
  // Backslash escapes (GFM): \\<punct> → the literal punctuation. Stashed here —
  // AFTER code/math extraction so a real $…$ span keeps its own backslashes — so
  // the emphasis/link/footnote passes never see the escaped char and \\$ renders
  // as a plain $ (consistent with a bare $). Backtick is omitted: code spans own
  // it, and it'd clash with this raw-template delimiter.
  s = s.replace(/\\([\\$*_~\[\]()#+\-.!<>{}|])/g, (_, ch) => hold(esc(ch)));
  s = esc(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  // Underscore emphasis (__bold__ / _italic_). Per GFM, underscores inside a
  // word don't open/close emphasis (snake_case stays literal), so require a
  // non-word char on the outer side of each delimiter.
  s = s.replace(/(^|[^\w])__([^_]+)__(?!\w)/g, '$1<strong>$2</strong>');
  s = s.replace(/(^|[^\w])_([^_]+)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  // Images BEFORE links — else the link rule eats the [alt](src) tail. Local
  // refs resolve to the embedded data URI (currentRef.f.assets, built server-
  // side so exports stay self-contained); URLs/unknown refs pass through.
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, dst) => {
    let src = dst.trim();
    const sp = src.search(/\s/); if (sp >= 0) src = src.slice(0, sp);
    if (src.startsWith('<') && src.endsWith('>')) src = src.slice(1, -1);
    const a = currentRef && currentRef.f && currentRef.f.assets;
    // A local .html ref embeds as raw markup (server-side) → render it live in a
    // sandboxed iframe. Keeps the md as prose; the diagram is its own loose file.
    if (/\.html?$/i.test(src) && a && a[src] != null)
      return '<iframe class="htmlframe" sandbox="allow-scripts" srcdoc="' + esc(htmlFrameDoc(a[src])) + '" title="' + alt + '"></iframe>';
    return '<img class="mdimg" src="' + ((a && a[src]) || src) + '" alt="' + alt + '" loading="lazy"/>';
  });
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, h) => '<a href="' + h + '">' + t + '</a>');
  // Footnote references [^id]: numbered by first-appearance order, linked to the
  // definitions list renderMarkdown appends. Only refs with a matching definition
  // are transformed; an unknown [^x] is left literal. ([^id] has no (…) tail, so
  // the link rule above never touches it.)
  if (FN) s = s.replace(/\[\^([^\]\s]+)\]/g, (whole, id) => {
    if (FN.defs[id] == null) return whole;
    let n = FN.seen[id];
    if (!n) { FN.order.push(id); n = FN.order.length; FN.seen[id] = n; }
    return '<sup class="fnref" id="fnref-' + esc(id) + '"><a href="#fn-' + esc(id) + '">' + n + '</a></sup>';
  });
  if (stash.length) s = s.replace(/\x00S(\d+)\x00/g, (_, n) => stash[+n]);
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
  // Pre-pass: collect footnote definitions ([^id]: text) so inline refs can be
  // numbered and a definitions list rendered at the end. Lines are NOT removed —
  // task-checkbox data-line uses the source index — the main loop skips them.
  FN = { defs: {}, order: [], seen: {} };
  for (const ln of lines) { const d = ln.match(/^\[\^([^\]\s]+)\]:\s*(.*)$/); if (d) FN.defs[d[1]] = d[2]; }
  while (i < lines.length) {
    let line = lines[i];
    if (/^\[\^[^\]\s]+\]:/.test(line)) { i++; continue; } // a footnote def — collected above
    let fence = line.match(/^\s*\`\`\`\s*([^\s\`]*)\s*$/);
    if (fence) {
      closeLists(); const lang = normLang(fence[1] || ''); i++; let buf = [];
      while (i < lines.length && !/^\s*\`\`\`\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      if (lang === 'mermaid') html += '<div class="mermaid">' + esc(buf.join('\n')) + '</div>';
      else html += '<pre><code' + (lang ? ' class="language-' + lang + '"' : '') + '>' + esc(buf.join('\n')) + '</code></pre>';
      continue;
    }
    // Display math block: a line that STARTS with $$. Scan forward to the matching
    // closing $$ — which may be on a later line and/or followed by trailing prose —
    // so a block can be lone-delimiter ($$ on its own lines), a full single line
    // ($$x$$), or span lines with text after the close ($$…$$ where …). The closing
    // line's trailing text is re-emitted as a paragraph. Scanning to the FIRST $$
    // (not a lone-$$ line) is what stops a stray $$ from swallowing later
    // headings/tables. Kept in sync with MATH_RE / the inline extractor.
    if (/^\s*\$\$/.test(line)) {
      closeLists();
      let rest = line.slice(line.indexOf('$$') + 2);
      const parts = []; let closed = false, tail = '';
      for (;;) {
        const ci = rest.indexOf('$$');
        if (ci >= 0) { parts.push(rest.slice(0, ci)); tail = rest.slice(ci + 2); closed = true; break; }
        parts.push(rest); i++;
        if (i >= lines.length) break;
        rest = lines[i];
      }
      i++; // past the closing line (or off the end if unclosed)
      const tex = parts.join('\n').trim();
      html += '<div class="math math-display" data-tex="' + esc(tex) + '">' + esc('$$' + tex + '$$') + '</div>';
      if (closed && tail.trim()) html += '<p>' + mdInline(tail) + '</p>';
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
      // data-line carries the 0-based source line index so a checkbox click can
      // toggle the exact "[ ]"/"[x]" marker back in the file (see the checkbox
      // click handler — the one place the read-only viewer writes file content).
      const task = m[1].match(/^\[([ xX])\]\s+(.*)$/);
      if (task) {
        const done = task[1] !== ' ';
        html += '<li class="task' + (done ? ' done' : '') + '" data-line="' + i + '"><span class="chk" role="checkbox" tabindex="0" aria-checked="' + done + '">' + (done ? '✓' : '') + '</span>' + mdInline(task[2]) + '</li>';
      } else { html += '<li>' + mdInline(m[1]) + '</li>'; }
      i++; continue;
    }
    if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) { if (!inOl) { closeLists(); html += '<ol>'; inOl = true; } html += '<li>' + mdInline(m[1]) + '</li>'; i++; continue; }
    if (/^\s*$/.test(line)) { closeLists(); i++; continue; }
    closeLists(); html += '<p>' + mdInline(line) + '</p>'; i++;
  }
  closeLists();
  // Footnote definitions list, in reference order, each with a ↩ back-link.
  if (FN.order.length) {
    const ids = FN.order.slice(); // snapshot — a def may itself reference a footnote
    html += '<hr class="fn-sep"/><section class="footnotes"><ol>';
    for (const id of ids) {
      html += '<li id="fn-' + esc(id) + '">' + mdInline(FN.defs[id]) +
        ' <a href="#fnref-' + esc(id) + '" class="fn-back" aria-label="Back to reference">↩</a></li>';
    }
    html += '</ol></section>';
  }
  FN = null; // outside a render, leave stray [^x] literal
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
const scrollMem = {};     // fileKey -> last scrollTop (session-only)
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

// Size each rendered html-frame to its content. Added once; matches the posting
// frame by contentWindow so multiple frames on a page resize independently.
function armHtmlFrames() {
  if (window.__scratchFrameListener) return;
  window.__scratchFrameListener = true;
  addEventListener('message', (e) => {
    if (!e.data) return;
    // Keystroke forwarded out of an embed iframe (which would otherwise swallow
    // it) — replay it on the host document so the global shortcut handler runs.
    if (e.data.__scratchKey === 1) {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: e.data.key, ctrlKey: e.data.ctrlKey, metaKey: e.data.metaKey,
        altKey: e.data.altKey, shiftKey: e.data.shiftKey, bubbles: true,
      }));
      return;
    }
    if (e.data.__scratchFrame !== 1) return;
    document.querySelectorAll('iframe.htmlframe').forEach(f => {
      if (f.contentWindow === e.source) f.style.height = (e.data.h + 1) + 'px';
    });
  });
}

function enhance(container) {
  armHtmlFrames();
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
  // KaTeX: render each .math node in place. data-tex holds the source (the DOM
  // decodes the attribute on read). If katex is absent (offline) the raw $…$ left
  // in the node stays visible — graceful degradation, like mermaid above.
  if (window.katex) {
    container.querySelectorAll('.math').forEach(el => {
      const tex = el.getAttribute('data-tex');
      if (tex == null) return;
      try { window.katex.render(tex, el, { displayMode: el.classList.contains('math-display'), throwOnError: false }); }
      catch (e) {}
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

// Clipboard: navigator.clipboard needs a secure context, but glimpse delivers
// the page via NavigateToString / file:// — an opaque origin where it's absent
// or rejects (the copy silently no-ops). Fall back to a hidden-textarea
// execCommand('copy'), which works in that context (and in the browser).
function execCopy(text) {
  return new Promise((resolve, reject) => {
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
}
function copyText(text) {
  return navigator.clipboard && navigator.clipboard.writeText
    ? navigator.clipboard.writeText(text).catch(() => execCopy(text))
    : execCopy(text);
}
// Copy the active file's path (Shift+C). Mirrors the 🔗 path button, including
// its absence in exports (the path only means something on the exporter's machine).
function copyActivePath() {
  const f = currentRef && currentRef.f;
  if (!f || EXPORT_MODE) return;
  copyText(f.abs || f.path)
    .then(() => showToast('Path copied', 'success'))
    .catch(() => showToast('Copy failed'));
}

// ---------------------------------------------------------------------------
// In-app navigation history (back / forward across viewed documents).
// The viewer is a single setHTML page with NO server and NO real URLs, so the
// WebView's back/forward — including the mouse side buttons (3/4) — would leave
// it for the blank initial entry the host opened before NavigateToString (the
// "empty hanging page"). We mirror every document switch into the History API
// so those buttons traverse the docs we've actually viewed. A buffer entry +
// popstate trap keep the user from ever falling off the start onto that blank
// page (back at the first doc just stays put; forward history is preserved).
let navStack = [];        // [fileKey] viewed, in order
let navIdx = -1;          // current position in navStack
let navApplying = false;  // suppress recording while applying a popstate

function navResolve(key) {
  const sep = key.indexOf('::');
  if (sep < 0) return null;
  const dir = key.slice(0, sep), path = key.slice(sep + 2);
  // Match by string (dir::path) — resilient across reloads that rebuild ITEMS
  // with fresh pad/f objects but identical identities.
  return ITEMS.find(x => x.pad.dir === dir && x.f.path === path) || null;
}

// Record a document switch as a History API entry. Called from renderPreview
// for every switch; skipped while applying a popstate and de-duped when the key
// is unchanged (raw-mode toggles, theme re-renders, hot-reloads of the same
// file all re-call renderPreview without being real navigations).
function navRecord(key) {
  if (navApplying) return;
  if (navIdx >= 0 && navStack[navIdx] === key) return;
  if (navStack.length === 0) {
    // Buffer entry: a same-document history slot below the first doc, so the
    // first "back" is absorbed here (we bounce forward) instead of reloading
    // the blank initial page cross-document.
    try { history.replaceState({ scratchNav: '__buffer__' }, ''); } catch (_) {}
  }
  navStack = navStack.slice(0, navIdx + 1);
  navStack.push(key);
  navIdx = navStack.length - 1;
  try { history.pushState({ scratchNav: navIdx }, ''); } catch (_) {}
}

window.addEventListener('popstate', (e) => {
  const v = e.state && e.state.scratchNav;
  if (v === '__buffer__' || v == null) {
    // At (or below) the buffer — bounce forward to the first doc so the blank
    // initial page is never shown. forward() keeps any forward entries intact.
    if (navStack.length) { try { history.forward(); } catch (_) {} }
    return;
  }
  const idx = typeof v === 'number' ? v : -1;
  if (idx < 0 || idx >= navStack.length || idx === navIdx) return;
  const it = navResolve(navStack[idx]);
  if (!it) return;
  navIdx = idx;
  navApplying = true;
  try { renderPreview(it.pad, it.f); } finally { navApplying = false; }
});

// nav describes how this render was triggered, which decides the scroll target:
//   • { anchor }   — a link with a #fragment → land on that heading
//   • { top:true } — a plain link → top of the doc (a fresh read, not a resume)
//   • absent       — left-nav / history / re-render → restore the remembered scroll
function renderPreview(pad, f, nav) {
  // Remember the outgoing file's scroll so returning to it lands where you left
  // off (session-only — not persisted across launches).
  if (current && previewEl) scrollMem[current] = previewEl.scrollTop;
  current = pad.dir + '::' + f.path; currentRef = { pad, f };
  navRecord(current);
  curIdx = ITEMS.findIndex(it => it.pad === pad && it.f === f);
  // Meta is a single tight dot-separated line (type · #tags) — not scattered chips.
  const metaBits = [f.registered ? esc(f.type || 'note') : 'unregistered'];
  if (f.external) metaBits.push('linked');
  (f.tags || []).forEach(t => metaBits.push('#' + esc(t)));
  const metaLine = metaBits.join(' · ');
  const canRaw = (f.kind === 'markdown' || f.kind === 'html') && f.content != null;
  const canCopyContent = f.content != null && (f.kind === 'markdown' || f.kind === 'html' || f.kind === 'code' || f.kind === 'text');
  const hasComments = !!(f.comments && f.comments.length);
  const ctrls = '<span class="pctrls">' +
    // The path is the exporter's local filesystem path — meaningless to whoever
    // receives an exported copy, so exports don't offer it.
    (EXPORT_MODE ? '' : '<button class="pbtn" id="copyPath">🔗 path</button>') +
    (canCopyContent ? '<button class="pbtn" id="copyContent">⧉ copy</button>' : '') +
    (hasComments ? '<button class="pbtn" id="clearComments" title="Delete all comments on this file">🗑 ' + nComments(f.comments.length) + '</button>' : '') +
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

  // The preview pane is the only scrollable element (html/body are overflow:hidden),
  // so keyboard scrolling and a browser Vimium need it focused to act on it — they
  // target the focused/document element, not an arbitrary inner overflow box.
  // preventScroll so this never fights the reload scroll-position restore.
  preview.focus({ preventScroll: true });

  if (canRaw) {
    const rd = document.getElementById('vRendered'), rw = document.getElementById('vRaw');
    rd.addEventListener('click', () => { if (rawMode) { setRaw(false); renderPreview(pad, f); } });
    rw.addEventListener('click', () => { if (!rawMode) { setRaw(true); renderPreview(pad, f); } });
  }
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
  // Bulk-clear is irreversible, so it arms on the first click and only deletes on
  // the second (within 3s) — unlike the per-comment delete, which fires straight away.
  const clr = document.getElementById('clearComments');
  if (clr) {
    const label = clr.textContent;
    let armed = false;
    clr.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        clr.textContent = '⚠ clear all?';
        clr.classList.add('on');
        clearTimeout(clr._t);
        clr._t = setTimeout(() => { armed = false; clr.textContent = label; clr.classList.remove('on'); }, 3000);
        return;
      }
      deleteAllComments();
      clr.remove();
    });
  }
  enhance(preview);
  // After hljs rewrote the code blocks' text nodes — comment quote-matching
  // walks the final DOM. (Comments are a rendered-markdown concept: applyComments
  // no-ops when there's no .md container, i.e. raw mode or non-markdown files.)
  applyComments();
  buildToc();
  document.querySelectorAll('.frow').forEach(el => el.classList.toggle('active', el.dataset.key === current));
  const wantKey = current;
  // A link with a #fragment lands on the heading — beating the rAF re-apply below,
  // so the scroll-restore is skipped entirely when an anchor target resolves.
  if (nav && nav.anchor) {
    // Resolve the heading once — it's in the DOM from the innerHTML set above and
    // enhance() doesn't replace it, so the rAF re-applies reuse the same node.
    const el = document.getElementById(nav.anchor);
    const toAnchor = () => { if (el) { try { scrollToAnchor(el); } catch (_) {} } };
    toAnchor();
    // hljs/mermaid/images shift heights right after render and would drift the
    // heading off the top, so re-apply across the next few frames until layout
    // settles (mermaid in particular lays out async) — unless the user navigated away.
    if (el && typeof requestAnimationFrame === 'function') {
      let n = 0;
      const tick = () => { if (current !== wantKey) return; toAnchor(); if (++n < 6) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }
    return;
  }
  // A plain link forces the top (nav.top); left-nav / history / re-renders resume
  // where the file was last left (0 the first time it's opened).
  const wantScroll = nav && nav.top ? 0 : (scrollMem[current] || 0);
  if (previewEl) {
    previewEl.scrollTop = wantScroll;
    // Highlighting / images / async content can shift heights right after render
    // and nudge the position, so re-apply once layout settles — unless the user
    // already switched away (wantKey stale) or scrolled the restored view.
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        if (current === wantKey && previewEl && previewEl.scrollTop !== wantScroll) {
          previewEl.scrollTop = wantScroll;
        }
      });
    }
  }
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

  updateCommentsCount();

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
// Theme registry for the page (id/label + 4 swatch dots per mode) — theme cards
// are rendered client-side because the starred strip changes as stars toggle.
const THEMES = (function () {
  try { return JSON.parse(document.getElementById('themes').textContent); } catch (_) { return []; }
})();
const THEME_IDS = THEMES.map((t) => t.id);
// Mirror of sanitizeStarred (src/config.ts) — keep in sync: known ids, deduped, newest 3 (FIFO).
function clampStarred(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const id of v) if (typeof id === 'string' && THEME_IDS.indexOf(id) >= 0 && out.indexOf(id) < 0) out.push(id);
  return out.slice(-3);
}
const SETTINGS = (function () {
  // tocVisible is deliberately NOT persisted — the TOC is on-demand and always
  // boots hidden, toggled ('o' / settings) for the current session only. So it's
  // absent from the embedded snapshot / localStorage / saveConfig, unlike the rest.
  let s = { themeMode: 'system', colorTheme: 'ember', starredThemes: [], gridStyle: 'dots', wideMode: false, tocVisible: false, zoom: 1 };
  try { s = Object.assign(s, JSON.parse(document.getElementById('settings').textContent)); } catch (_) {}
  // Over file:// (export) the embedded snapshot is whatever the exporting machine
  // had saved — the reader's own remembered choice wins ('scratch.theme' is the
  // pre-settings key, kept as a migration seed).
  const hasChannel = (window.chrome && window.chrome.webview) || /^https?:$/.test(location.protocol);
  if (!hasChannel) {
    try {
      const m = localStorage.getItem('scratch.themeMode') || localStorage.getItem('scratch.theme');
      const c = localStorage.getItem('scratch.colorTheme');
      let st = null;
      try { st = clampStarred(JSON.parse(localStorage.getItem('scratch.starredThemes') || 'null')); } catch (_) {}
      const g = localStorage.getItem('scratch.gridStyle');
      const w = localStorage.getItem('scratch.wideMode');
      const z = parseFloat(localStorage.getItem('scratch.zoom'));
      if (m === 'dark' || m === 'light' || m === 'system') s.themeMode = m;
      if (c) s.colorTheme = c;
      if (st) s.starredThemes = st;
      if (g === 'off' || g === 'dots' || g === 'lines') s.gridStyle = g;
      if (w === 'true' || w === 'false') s.wideMode = w === 'true';
      if (z >= 0.5 && z <= 2) s.zoom = z;
    } catch (_) {}
  }
  return s;
})();
// Push a payload to whichever host is listening: WebView2 postMessage (wrapped
// under the given message key) or a POST to the browser server. Returns false
// when neither channel exists (the file:// export) so callers can fall back.
function postToHost(key, path, payload, onFail) {
  const wv = window.chrome && window.chrome.webview;
  if (wv) {
    try { const m = {}; m[key] = payload; wv.postMessage(m); } catch (_) {}
    return true;
  }
  if (/^https?:$/.test(location.protocol)) {
    try {
      fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
        .then(r => { if (!r.ok && onFail) onFail(); })
        .catch(() => { if (onFail) onFail(); });
    } catch (_) {}
    return true;
  }
  return false;
}
function persistSettings() {
  const payload = { themeMode: SETTINGS.themeMode, colorTheme: SETTINGS.colorTheme, starredThemes: SETTINGS.starredThemes, gridStyle: SETTINGS.gridStyle, wideMode: SETTINGS.wideMode, zoom: SETTINGS.zoom };
  if (postToHost('__scratch_settings', '/settings', payload)) return;
  try {
    localStorage.setItem('scratch.themeMode', SETTINGS.themeMode);
    localStorage.setItem('scratch.colorTheme', SETTINGS.colorTheme);
    localStorage.setItem('scratch.starredThemes', JSON.stringify(SETTINGS.starredThemes));
    localStorage.setItem('scratch.gridStyle', SETTINGS.gridStyle);
    localStorage.setItem('scratch.wideMode', String(SETTINGS.wideMode));
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
// Theme cards (settings strip + gallery), rendered from THEMES. Each card
// carries dot previews for BOTH modes; CSS shows only the resolved mode's set
// (.sw-dark / .sw-light). The star is a span (a button can't nest in the card
// button) that toggles a favorite WITHOUT applying the theme.
function swatchesHtml(dots, cls) {
  return '<span class="swatches ' + cls + '">' + dots.map((c) => '<span class="swatch" style="background:' + c + '"></span>').join('') + '</span>';
}
function themeCardHtml(t, withStar) {
  return '<button class="theme-card" data-theme-id="' + esc(t.id) + '">' +
    swatchesHtml(t.dark, 'sw-dark') + swatchesHtml(t.light, 'sw-light') +
    '<span class="fttl">' + esc(t.label) + '</span>' +
    (withStar ? '<span class="theme-star" role="button" tabindex="0" data-star="' + esc(t.id) + '" aria-label="Star theme"></span>' : '') +
    '</button>';
}
// Settings shows the starred cards (max 3) plus the active theme when it isn't
// starred — the current choice must always be visible/clickable there.
function renderStarredGrid() {
  const g = document.getElementById('starredGrid');
  if (!g) return;
  const ids = SETTINGS.starredThemes.slice();
  if (ids.indexOf(SETTINGS.colorTheme) < 0) ids.push(SETTINGS.colorTheme);
  g.innerHTML = ids.map((id) => THEMES.find((t) => t.id === id)).filter(Boolean).map((t) => themeCardHtml(t, false)).join('');
  syncThemeCards();
}
function renderGalleryGrid() {
  const g = document.getElementById('galleryGrid');
  if (!g) return;
  g.innerHTML = THEMES.map((t) => themeCardHtml(t, true)).join('');
  syncThemeCards();
}
function syncThemeCards() {
  document.querySelectorAll('.theme-card').forEach((b) => b.classList.toggle('on', b.dataset.themeId === SETTINGS.colorTheme));
  document.querySelectorAll('.theme-star').forEach((s) => {
    const on = SETTINGS.starredThemes.indexOf(s.dataset.star) >= 0;
    s.classList.toggle('on', on);
    s.textContent = on ? '★' : '☆';
  });
}
function toggleStar(id) {
  const st = SETTINGS.starredThemes;
  const i = st.indexOf(id);
  if (i >= 0) st.splice(i, 1);
  else { st.push(id); if (st.length > 3) st.shift(); } // FIFO: the oldest star drops
  renderStarredGrid();
  persistSettings();
}
function applyTheme() {
  const r = document.documentElement;
  r.dataset.theme = resolvedMode();
  r.dataset.colorTheme = SETTINGS.colorTheme;
  r.dataset.grid = SETTINGS.gridStyle;
  r.toggleAttribute('data-wide', !!SETTINGS.wideMode);
  syncThemeIcon();
  // Reflect the active choice in the settings modal.
  document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === SETTINGS.themeMode));
  syncThemeCards();
  document.querySelectorAll('#gridSeg button').forEach((b) => b.classList.toggle('on', b.dataset.grid === SETTINGS.gridStyle));
  document.querySelectorAll('#widthSeg button').forEach((b) => b.classList.toggle('on', b.dataset.wide === (SETTINGS.wideMode ? 'on' : 'off')));
  document.querySelectorAll('#tocSeg button').forEach((b) => b.classList.toggle('on', b.dataset.toc === (SETTINGS.tocVisible ? 'on' : 'off')));
  updateToc();
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
  // The active-but-unstarred card rides the starred strip — re-render it so the
  // new choice appears there (and the old one drops out).
  renderStarredGrid();
  applyTheme();
  persistSettings();
}
function setGridStyle(g) {
  SETTINGS.gridStyle = g;
  applyTheme();
  persistSettings();
}
function setWideMode(on) {
  SETTINGS.wideMode = on;
  applyTheme();
  persistSettings();
}
function setTocVisible(on) {
  SETTINGS.tocVisible = on;
  applyTheme(); // re-syncs the segment + calls updateToc(); session-only, not persisted
}
// The table of contents is an opaque on-demand panel: off by default, shown only
// when the user asks for it ('o' / settings) AND the file has ≥2 headings. Being
// opaque, it can float over the gutter without a transparency/legibility worry,
// so no width gating is needed.
let tocObserver = null;
function tocShouldShow() {
  return SETTINGS.tocVisible &&
    document.querySelectorAll('#preview .md :is(h1,h2,h3,h4,h5,h6)').length >= 2;
}
function updateToc() {
  const toc = document.getElementById('toc');
  if (toc) toc.style.display = tocShouldShow() ? 'block' : 'none';
}
// Build the TOC from the rendered markdown's full heading hierarchy (H1–H6).
// Runs after each preview render (file switch, raw↔rendered, reload) — it
// (re)assigns heading ids, wires smooth-scroll links indented by level, and a
// scroll-spy observer that lights the active section.
function buildToc() {
  const toc = document.getElementById('toc');
  if (!toc) return;
  if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }
  const md = document.querySelector('#preview .md');
  const heads = md ? Array.from(md.querySelectorAll('h1, h2, h3, h4, h5, h6')) : [];
  const used = {};
  const slug = (t) => {
    // GFM slug: drop everything but [a-z0-9], space and hyphen, then map each
    // space to ONE hyphen. Must NOT collapse runs — "A — B" loses the em-dash to
    // two spaces → "a--b" (double hyphen), which is the id GitHub/the author links to.
    let base = (t || '').toLowerCase().replace(/[^a-z0-9 -]+/g, '').replace(/ /g, '-').replace(/^-+|-+$/g, '') || 'section';
    if (used[base] == null) { used[base] = 0; return base; }
    return base + '-' + (++used[base]);
  };
  // Assign GFM heading ids before the <2-heading early return, so in-page anchor
  // links ([x](#heading)) resolve even on docs with too few headings for a TOC.
  heads.forEach((h) => { if (!h.id) h.id = slug(h.textContent); });
  if (heads.length < 2) { toc.innerHTML = ''; updateToc(); return; }
  let html = '<div class="toc-head">On this page</div><nav class="toc-nav">';
  const links = {};
  heads.forEach((h) => {
    const id = h.id;
    html += '<a class="toc-link toc-' + h.tagName.toLowerCase() + '" href="#' + id +
      '" data-tid="' + id + '" title="' + esc(h.textContent) + '">' + esc(h.textContent) + '</a>';
  });
  toc.innerHTML = html + '</nav>';
  // Move the .active class between two links rather than rescanning every entry
  // on each scroll-spy batch (fires repeatedly while scrolling).
  let activeLink = null;
  const setActive = (id) => {
    const next = links[id] || null;
    if (next === activeLink) return;
    if (activeLink) activeLink.classList.remove('active');
    if (next) next.classList.add('active');
    activeLink = next;
  };
  toc.querySelectorAll('.toc-link').forEach((a) => {
    links[a.dataset.tid] = a;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const t = document.getElementById(a.dataset.tid);
      if (t) scrollToAnchor(t);
      // Light the clicked entry right away; the spy keeps it correct as you scroll.
      setActive(a.dataset.tid);
    });
  });
  // Scroll-spy: a heading counts as "current" while it's in the top 30% band (the
  // bottom rootMargin clips the rest). Several can sit in the band at once, and
  // IntersectionObserver delivers entries in no positional order — so we track the
  // visible set and always light the *topmost* (document-order) one, rather than
  // letting whichever entry fired last win (which lit the next heading instead).
  if (typeof IntersectionObserver === 'function') {
    const visible = new Set();
    tocObserver = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) visible.add(en.target.id);
        else visible.delete(en.target.id);
      });
      const top = heads.find((h) => visible.has(h.id));
      if (top) setActive(top.id);
    }, { root: document.getElementById('preview'), rootMargin: '0px 0px -70% 0px', threshold: 0 });
    heads.forEach((h) => tocObserver.observe(h));
  }
  updateToc();
}
window.addEventListener('resize', updateToc);
renderGalleryGrid();
renderStarredGrid();
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
document.querySelectorAll('#gridSeg button').forEach((b) => b.addEventListener('click', () => setGridStyle(b.dataset.grid)));
document.querySelectorAll('#widthSeg button').forEach((b) => b.addEventListener('click', () => setWideMode(b.dataset.wide === 'on')));
document.querySelectorAll('#tocSeg button').forEach((b) => b.addEventListener('click', () => setTocVisible(b.dataset.toc === 'on')));

// Theme grids use delegation — the starred strip re-renders its cards, so
// per-card listeners would go stale. Star click toggles a favorite only; it
// must not bubble into the card (which would also apply the theme).
function bindThemeGrid(el) {
  el.addEventListener('click', (e) => {
    const star = e.target.closest && e.target.closest('.theme-star');
    if (star) { e.stopPropagation(); toggleStar(star.dataset.star); return; }
    const card = e.target.closest && e.target.closest('.theme-card');
    if (card) setColorTheme(card.dataset.themeId);
  });
}
bindThemeGrid(document.getElementById('starredGrid'));
bindThemeGrid(document.getElementById('galleryGrid'));

// Theme gallery modal: opened from settings (which stays open underneath).
const galleryModal = document.getElementById('galleryModal');
const showGallery = (v) => { galleryModal.style.display = v ? 'flex' : 'none'; };
document.getElementById('browseThemes').addEventListener('click', () => showGallery(true));
document.getElementById('galleryClose').addEventListener('click', () => showGallery(false));
galleryModal.addEventListener('click', (e) => { if (e.target === galleryModal) showGallery(false); });

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
  const starred = clampStarred(cfg.starredThemes);
  if (starred && JSON.stringify(starred) !== JSON.stringify(SETTINGS.starredThemes)) { SETTINGS.starredThemes = starred; drift = true; }
  if ((cfg.gridStyle === 'off' || cfg.gridStyle === 'dots' || cfg.gridStyle === 'lines') && cfg.gridStyle !== SETTINGS.gridStyle) { SETTINGS.gridStyle = cfg.gridStyle; drift = true; }
  if (typeof cfg.wideMode === 'boolean' && cfg.wideMode !== SETTINGS.wideMode) { SETTINGS.wideMode = cfg.wideMode; drift = true; }
  if (typeof cfg.zoom === 'number' && cfg.zoom >= 0.5 && cfg.zoom <= 2 && cfg.zoom !== SETTINGS.zoom) { SETTINGS.zoom = cfg.zoom; drift = true; }
  if (!drift) return;
  renderStarredGrid();
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
  // An export has no disk to reload from — location.reload() would just re-read
  // the file and silently drop unsaved comments.
  if (EXPORT_MODE) return;
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

// Collapsible sidebar (in-pane panel button / '['). Like the resizable width
// (scratch.treeW above), this is per-machine window geometry — localStorage,
// not the config file.
const sidebarEl = document.getElementById('sidebar');
function toggleSidebar() {
  const c = sidebarEl.classList.toggle('collapsed');
  try { localStorage.setItem('scratch.sidebarCollapsed', c ? '1' : '0'); } catch (_) {}
}
document.getElementById('sidebarToggle').addEventListener('click', toggleSidebar);
// The in-pane toggle collapses away with the pane; this floater (top-left of
// the body, shown by CSS only while collapsed) is the way back.
document.getElementById('sidebarOpen').addEventListener('click', toggleSidebar);
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
    // Save / export a copy — swallow the host's "save page" so ours runs instead.
    if (e.key === 's' || e.key === 'S') { e.preventDefault(); saveCopy(); return; }
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (e.key === 'Escape') {
    // Esc only dismisses open overlays — never closes the window ('q' does that).
    if (galleryModal.style.display !== 'none') showGallery(false);
    else if (settingsModal.style.display !== 'none') showSettings(false);
    else if (helpModal.style.display !== 'none') showHelp(false);
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
  if (e.key === 'o') { setTocVisible(!SETTINGS.tocVisible); return; }
  if (e.key === 'C') { copyActivePath(); return; }
  if (e.key === 'c') { setCommentsVisible(!commentsVisible); return; }
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
// page (loaded via setHTML in the WebView2 host — NO server, NO real URLs), so
// letting a link navigate the webview lands on a dead URL = blank window. Instead:
//   • relative link to a pad file  → open that file in the viewer
//   • external (http/https/mailto) → hand off to the system browser
//   • anything else                → swallow (no navigation)
// Scroll an in-doc anchor to the top of the preview, CLAMPED to the container's
// scroll range. A near-bottom target — notably the footnotes block, which
// renderMarkdown appends at the very end — has less content below it than the
// viewport height, and scrollIntoView({block:'start'}) over-scrolls past the
// bottom here (WebView2/Chromium), leaving a blank gap below the doc. Computing
// the target scrollTop and clamping to [0, scrollHeight - clientHeight] keeps the
// scroll constrained to actual content. ANCHOR_GAP gives a little headroom above
// the target (mirrors the headings' scroll-margin-top).
const ANCHOR_GAP = 24;
function scrollToAnchor(el) {
  if (!el || !previewEl) return;
  const offsetTop = el.getBoundingClientRect().top - previewEl.getBoundingClientRect().top;
  const top = previewEl.scrollTop + offsetTop - ANCHOR_GAP;
  const max = Math.max(0, previewEl.scrollHeight - previewEl.clientHeight);
  // Set scrollTop directly (clamped) rather than scrollTo({behavior:'smooth'}):
  // the destination clamp is the actual fix (a near-bottom target like the
  // appended footnotes can't over-scroll past the content), and a direct set is
  // synchronous — scrollTo's smooth animation schedules an async scroll event that
  // outlives a headless page and crashes the test runner.
  previewEl.scrollTop = Math.max(0, Math.min(top, max));
}
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
  const hashAt = href.indexOf('#');
  const filePart = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const hash = hashAt >= 0 ? decodeURIComponent(href.slice(hashAt + 1)) : '';
  // Pure in-page anchor [x](#heading): scroll within the current doc (ids assigned
  // by buildToc on every render). No re-render, so no scroll-restore to fight.
  if (!filePart) {
    const t = hash && document.getElementById(hash);
    if (t) scrollToAnchor(t);
    return;
  }
  const target = resolveRel(currentRef.f.path, filePart);
  const pad = currentRef.pad;
  const f = pad.files.find(x => x.path === target || x.path === filePart || x.path.endsWith('/' + target));
  // Cross-file link: open the doc at its #fragment, or at the top for a plain link
  // — following a link is a fresh read, NOT a resume (that's reserved for the nav).
  if (f) { renderPreview(pad, f, hash ? { anchor: hash } : { top: true }); }
});

// ---------------------------------------------------------------------------
// Clickable task checkboxes. The viewer is read-only EXCEPT here: clicking a
// rendered "- [ ]" / "- [x]" toggles that marker in the source FILE (not the
// manifest). The edit is line-addressed — li.dataset.line is the source line —
// and persists through the same channel fan-out as settings/comments
// (WebView2 __scratch_checkbox / POST /checkbox). The TASK_MARKER regex mirrors
// the host's (launch.ts persistFileCheckbox) so both flip the same char.
const TASK_MARKER = /^(\s*[-*+]\s+\[)([ xX])(\].*)$/;
function persistCheckbox(line, checked) {
  if (!currentRef) return false;
  const payload = { padDir: currentRef.pad.dir, filePath: currentRef.f.path, line: line, checked: checked };
  return postToHost('__scratch_checkbox', '/checkbox', payload, () => showToast('Saving checkbox failed'));
}
previewEl.addEventListener('click', (e) => {
  const chk = e.target.closest && e.target.closest('.md li.task .chk');
  if (!chk) return;
  const li = chk.closest('li.task');
  const f = currentRef && currentRef.f;
  if (!li || !f || f.kind !== 'markdown' || f.content == null) return;
  const line = parseInt(li.dataset.line, 10);
  if (isNaN(line)) return;
  const checked = !li.classList.contains('done');
  // Flip the marker in the embedded content too, so the raw view, a re-render,
  // and a second click all stay in sync. Bail if the line drifted (file changed
  // underneath) rather than edit the wrong line.
  const lines = f.content.replace(/\r\n/g, '\n').split('\n');
  const m = lines[line] != null && lines[line].match(TASK_MARKER);
  if (!m) return;
  lines[line] = m[1] + (checked ? 'x' : ' ') + m[3];
  f.content = lines.join('\n');
  li.classList.toggle('done', checked);
  chk.textContent = checked ? '✓' : '';
  chk.setAttribute('aria-checked', String(checked));
  if (!persistCheckbox(line, checked)) showToast('Checkboxes cannot be saved from an exported page', 'info');
});

// ---------------------------------------------------------------------------
// Inline comments. Quote-anchored margin notes on the RENDERED markdown view
// (see _plans/SPEC.md): the manifest stores {quote, prefix, suffix} and we
// re-find the quote in the preview's text on every render. Mutations replace
// the file's whole comments array and persist through the same channel as
// settings (WebView2 postMessage / POST /comments); the page updates in place.
let commentsVisible = true;
try { commentsVisible = localStorage.getItem('scratch.comments') !== '0'; } catch (_) {}
let ORPHANS = []; // comments whose quote wasn't found in the current render

function cmtNowIso() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }
function nComments(n) { return n + ' comment' + (n > 1 ? 's' : ''); }
function cmtId() {
  if (window.crypto && window.crypto.randomUUID) { try { return window.crypto.randomUUID(); } catch (_) {} }
  return 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// All text nodes under root, excluding SVG (mermaid output) subtrees — anchoring
// inside a diagram is too brittle, so those comments render as orphaned instead.
function cmtTextNodes(root) {
  const out = [];
  (function walk(n) {
    if (n.nodeType === 3) { out.push(n); return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName ? n.tagName.toLowerCase() : '';
    if (tag === 'svg' || (n.classList && n.classList.contains('mermaid'))) return;
    for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
  })(root);
  return out;
}

// Re-find a comment's quote in the container. Multiple occurrences are
// disambiguated by how many chars of prefix/suffix match contiguously from the
// quote's boundary outward; ties keep the first match (deterministic).
function cmtFindAnchor(container, anchor) {
  if (!anchor || !anchor.quote) return null;
  const nodes = cmtTextNodes(container);
  let text = '';
  const starts = nodes.map(n => { const s = text.length; text += n.nodeValue; return s; });
  const q = anchor.quote;
  const hits = [];
  let i = text.indexOf(q);
  while (i !== -1) { hits.push(i); i = text.indexOf(q, i + 1); }
  if (!hits.length) return null;
  let best = hits[0];
  if (hits.length > 1) {
    const p = anchor.prefix || '', s = anchor.suffix || '';
    let bestScore = -1;
    hits.forEach(h => {
      const before = text.slice(Math.max(0, h - p.length), h);
      const after = text.slice(h + q.length, h + q.length + s.length);
      let score = 0;
      for (let k = 1; k <= before.length; k++) { if (p[p.length - k] === before[before.length - k]) score++; else break; }
      for (let k = 0; k < after.length; k++) { if (s[k] === after[k]) score++; else break; }
      if (score > bestScore) { bestScore = score; best = h; }
    });
  }
  return { nodes, starts, start: best, end: best + q.length };
}

// Wrap the matched flat-text range in highlight spans. Markdown nests elements,
// so the range may cross several text nodes — split each at the boundaries and
// wrap the inner piece (find-and-highlight style). Returns the created spans.
function cmtWrap(found, cid) {
  const spans = [];
  for (let ni = 0; ni < found.nodes.length; ni++) {
    const node = found.nodes[ni];
    const ns = found.starts[ni], ne = ns + node.nodeValue.length;
    if (ne <= found.start || ns >= found.end) continue;
    const from = Math.max(found.start, ns) - ns;
    const to = Math.min(found.end, ne) - ns;
    let target = node;
    if (from > 0) target = target.splitText(from);
    if (to - from < target.nodeValue.length) target.splitText(to - from);
    const span = document.createElement('span');
    span.className = 'cmt-hl';
    span.dataset.cid = cid;
    target.parentNode.replaceChild(span, target);
    span.appendChild(target);
    spans.push(span);
  }
  return spans;
}

// Always-visible concise note pill after the highlight. The text lives in a
// data attribute rendered via CSS ::after, so it's not a DOM text node — it
// can't be selected and never pollutes quote/prefix matching.
function cmtNoteText(body) { return body.length > 48 ? body.slice(0, 48) + '…' : body; }
function cmtAttachNote(c, lastSpan) {
  const n = document.createElement('span');
  n.className = 'cmt-note';
  n.dataset.cid = c.id;
  n.dataset.note = cmtNoteText(c.body);
  n.title = c.body;
  lastSpan.parentNode.insertBefore(n, lastSpan.nextSibling);
}
function cmtMark(found, c) {
  const spans = cmtWrap(found, c.id);
  if (spans.length) cmtAttachNote(c, spans[spans.length - 1]);
}

function cmtUnwrap(cid) {
  document.querySelectorAll('.cmt-note').forEach(n => { if (n.dataset.cid === cid) n.remove(); });
  document.querySelectorAll('.cmt-hl').forEach(sp => {
    if (sp.dataset.cid !== cid) return;
    const p = sp.parentNode;
    while (sp.firstChild) p.insertBefore(sp.firstChild, sp);
    p.removeChild(sp);
    if (p.normalize) p.normalize();
  });
}

function findComment(cid) {
  const f = currentRef && currentRef.f;
  return f && (f.comments || []).find(c => c.id === cid);
}

// Persist the active file's full comment array (add/edit/delete all replace it
// wholesale). Same channel fan-out as persistSettings; in an export there is no
// host — the mutation already lives in DATA, so arm Save-a-copy instead: saving
// the page file is what persists comments there.
function persistComments() {
  if (!currentRef) return;
  if (EXPORT_MODE) {
    setExportDirty(true);
    showToast('Comment kept in this page — Save a copy to keep it in the file', 'info');
    updateCommentsCount();
    return;
  }
  const payload = { padDir: currentRef.pad.dir, filePath: currentRef.f.path, comments: currentRef.f.comments || [] };
  const sent = postToHost('__scratch_comments', '/comments', payload, () => showToast('Saving comment failed'));
  if (!sent) showToast('Comments cannot be saved from this page', 'info');
  updateCommentsCount();
}

// --- Save a copy (static export only) ---
// New/edited comments in an export live only in DATA until the user saves the
// page itself. Saving = splice the current DATA into the boot-time PRISTINE
// source (never the live DOM — hljs and comment marks have rewritten it) and
// hand the result over as a real file (showSaveFilePicker) or a download.
let exportDirty = false;
function setExportDirty(v) {
  exportDirty = v;
  const d = document.getElementById('saveDot');
  if (d) d.hidden = !v;
  const b = document.getElementById('saveCopy');
  if (b) b.title = v
    ? 'Unsaved comments — save a copy of this file to keep them'
    : 'Save a copy of this page — comments live in the saved file';
}
function builtExportHtml() {
  // Saving from a live viewer turns the snapshot into a standalone export: mark
  // <html> with data-export so the saved file opens in export mode (file is the
  // comment store). Already present when re-saving an export — replace only the
  // real opening tag, never an escaped <html in rendered content.
  const src = EXPORT_MODE ? PRISTINE : PRISTINE.replace(/<html(?=[ >])/, '<html data-export');
  const open = '<script id="data" type="application/json">';
  const close = '</' + 'script>';
  const i = src.indexOf(open);
  const j = i === -1 ? -1 : src.indexOf(close, i);
  if (j === -1) return null;
  // payloadJson's escaping, so the island can never contain a closing script tag.
  return src.slice(0, i + open.length) + JSON.stringify(DATA).replace(/</g, '\\u003c') + src.slice(j);
}
function saveCopyName() {
  // Match the scratch export output name (baked onto <html> at render time).
  const n = document.documentElement.getAttribute('data-export-name');
  if (n) return n + '.html';
  try {
    const p = decodeURIComponent(location.pathname.split('/').pop() || '');
    if (/\.html?$/i.test(p)) return p;
  } catch (_) {}
  return 'scratchpad.html';
}
// The native host echoes a save result here (it owns the real OS dialog).
window.__scratchSaved = function (res) {
  if (res && res.saved) { setExportDirty(false); showToast(res.path ? 'Saved → ' + res.path : 'Saved', 'success'); }
};
function saveCopy() {
  const html = builtExportHtml();
  if (html == null) { showToast('Save failed'); return; }
  const name = saveCopyName();
  // Native WebView2: setHTML's origin isn't a secure context, so showSaveFilePicker
  // is unavailable — hand the bytes to the host, which opens a real OS save dialog
  // and writes the file (it calls back via window.__scratchSaved).
  const wv = window.chrome && window.chrome.webview;
  if (wv) {
    try { wv.postMessage({ __scratch_save: { html: html, name: name } }); showToast('Choose where to save…', 'info'); }
    catch (_) { showToast('Save failed'); }
    return;
  }
  const blob = new Blob([html], { type: 'text/html' });
  const done = () => { setExportDirty(false); showToast('Saved — that file carries the comments', 'success'); };
  if (window.showSaveFilePicker) {
    // file:// counts as a secure context in Chromium, so exports get a real
    // save dialog; everywhere else falls back to a plain download.
    window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'HTML page', accept: { 'text/html': ['.html'] } }] })
      .then((h) => h.createWritable())
      .then((w) => w.write(blob).then(() => w.close()))
      .then(done)
      .catch((e) => { if (!e || e.name !== 'AbortError') downloadCopy(blob, name, done); });
    return;
  }
  downloadCopy(blob, name, done);
}
function downloadCopy(blob, name, done) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => { try { URL.revokeObjectURL(a.href); } catch (_) {} }, 10000);
  done();
}
const saveCopyBtn = document.getElementById('saveCopy');
if (saveCopyBtn) saveCopyBtn.addEventListener('click', saveCopy);
// Don't let unsaved comments vanish with a casual tab close.
if (EXPORT_MODE) window.addEventListener('beforeunload', (e) => {
  if (exportDirty) { e.preventDefault(); e.returnValue = ''; }
});

// --- popover (one at a time; view / edit / new / orphan-list modes) ---
let cmtPopEl = null;
function closeCmtPop() { if (cmtPopEl) { cmtPopEl.remove(); cmtPopEl = null; } }
function openCmtPop(rect, build) {
  closeCmtPop();
  const el = document.createElement('div');
  el.className = 'cmt-pop';
  build(el);
  document.body.appendChild(el);
  // rect is in screen (viewport) px, but this fixed element sits inside the
  // zoomed root, so its left/top get multiplied by zoom at layout — assign
  // them in the root's own coordinate space or the popover lands away from
  // the comment whenever zoom != 100%.
  const z = SETTINGS.zoom || 1;
  const w = el.offsetWidth || 300, h = el.offsetHeight || 120;
  const vw = (window.innerWidth || 1280) / z, vh = (window.innerHeight || 800) / z;
  const left = Math.min(Math.max(8, rect.left / z), Math.max(8, vw - w - 8));
  let top = rect.bottom / z + 6;
  if (top + h > vh - 8) top = Math.max(8, rect.top / z - h - 6);
  el.style.left = left + 'px';
  el.style.top = top + 'px';
  cmtPopEl = el;
}
function cmtBtn(label, onClick) {
  const b = document.createElement('button');
  b.className = 'pbtn';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
function cmtViewPop(c, rect) {
  openCmtPop(rect, (el) => {
    const body = document.createElement('div'); body.className = 'cmt-body'; body.textContent = c.body; el.appendChild(body);
    const when = document.createElement('div'); when.className = 'cmt-when';
    when.textContent = 'created ' + fmtWhen(c.created) + (c.updated && c.updated !== c.created ? ' · updated ' + fmtWhen(c.updated) : '');
    when.title = 'created ' + fmtFull(c.created) + (c.updated && c.updated !== c.created ? ' · updated ' + fmtFull(c.updated) : '');
    el.appendChild(when);
    const act = document.createElement('div'); act.className = 'cmt-actions';
    act.appendChild(cmtBtn('edit', () => cmtEditPop(c, rect)));
    act.appendChild(cmtBtn('delete', () => deleteComment(c.id)));
    el.appendChild(act);
  });
}
// Ctrl/Cmd+Enter in a comment textarea submits, like every commenting UI.
function cmtCtrlEnter(ta, submit) {
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
  });
}
function cmtEditPop(c, rect) {
  openCmtPop(rect, (el) => {
    const ta = document.createElement('textarea'); ta.value = c.body; el.appendChild(ta);
    const act = document.createElement('div'); act.className = 'cmt-actions';
    act.appendChild(cmtBtn('cancel', () => cmtViewPop(c, rect)));
    const save = () => {
      const body = ta.value.trim();
      if (!body) return;
      c.body = body;
      c.updated = cmtNowIso();
      persistComments();
      document.querySelectorAll('.cmt-note').forEach(n => {
        if (n.dataset.cid === c.id) { n.dataset.note = cmtNoteText(c.body); n.title = c.body; }
      });
      closeCmtPop();
      showToast('Comment saved', 'success');
    };
    act.appendChild(cmtBtn('save', save));
    el.appendChild(act);
    cmtCtrlEnter(ta, save);
    try { ta.focus(); } catch (_) {}
  });
}
function cmtNewPop(anchor, rect) {
  openCmtPop(rect, (el) => {
    const ta = document.createElement('textarea'); ta.setAttribute('placeholder', 'Add a comment…'); el.appendChild(ta);
    const act = document.createElement('div'); act.className = 'cmt-actions';
    act.appendChild(cmtBtn('cancel', () => closeCmtPop()));
    const add = () => {
      const body = ta.value.trim();
      if (!body || !currentRef) return;
      const ts = cmtNowIso();
      const c = { id: cmtId(), body, anchor, created: ts, updated: ts };
      const f = currentRef.f;
      f.comments = f.comments || [];
      f.comments.push(c);
      persistComments();
      // Highlight in place — re-rendering the whole preview would lose scroll.
      const md = previewEl.querySelector('.md');
      const found = md && cmtFindAnchor(md, anchor);
      if (found) cmtMark(found, c);
      else { ORPHANS.push(c); refreshOrphanPill(); }
      closeCmtPop();
      hideCmtAdd();
      try { const sel = window.getSelection(); if (sel) sel.removeAllRanges(); } catch (_) {}
      showToast('Comment added', 'success');
    };
    act.appendChild(cmtBtn('add', add));
    el.appendChild(act);
    cmtCtrlEnter(ta, add);
    try { ta.focus(); } catch (_) {}
  });
}
function openOrphansPop(pill) {
  const rect = pill.getBoundingClientRect();
  openCmtPop(rect, (el) => {
    ORPHANS.forEach(c => {
      const row = document.createElement('div'); row.className = 'cmt-orow';
      const q = document.createElement('div'); q.className = 'cmt-quote';
      const quote = c.anchor && c.anchor.quote || '';
      q.textContent = '“' + (quote.length > 60 ? quote.slice(0, 60) + '…' : quote) + '”';
      const body = document.createElement('div'); body.className = 'cmt-body'; body.textContent = c.body;
      const act = document.createElement('div'); act.className = 'cmt-actions';
      act.appendChild(cmtBtn('edit', () => cmtEditPop(c, rect)));
      act.appendChild(cmtBtn('delete', () => deleteComment(c.id)));
      row.appendChild(q); row.appendChild(body); row.appendChild(act);
      el.appendChild(row);
    });
  });
}

// Pad-wide comments summary, anchored to the header toggle. Read-only list grouped
// by file; clicking a row jumps to that comment. Visibility is toggled via 'c'.
function openCommentsSummary(btn) {
  const rect = btn.getBoundingClientRect();
  const items = [];
  (DATA.pads || []).forEach(pad => (pad.files || []).forEach(f =>
    (f.comments || []).forEach(c => items.push({ pad, f, c }))));
  openCmtPop(rect, (el) => {
    el.classList.add('cmt-summary');
    const head = document.createElement('div'); head.className = 'cmt-shead';
    head.textContent = items.length ? nComments(items.length) : 'No comments';
    el.appendChild(head);
    if (!items.length) {
      const hint = document.createElement('div'); hint.className = 'cmt-when';
      hint.textContent = 'Select text in a file to add one.';
      el.appendChild(hint);
      return;
    }
    let lastFile = null;
    items.forEach(({ pad, f, c }) => {
      if (f !== lastFile) {
        lastFile = f;
        const fh = document.createElement('div'); fh.className = 'cmt-sfile';
        fh.textContent = f.title || f.path;
        el.appendChild(fh);
      }
      const row = document.createElement('div'); row.className = 'cmt-srow';
      const body = document.createElement('div'); body.className = 'cmt-body'; body.textContent = c.body;
      row.appendChild(body);
      const quote = ((c.anchor && c.anchor.quote) || '').trim();
      if (quote) {
        const q = document.createElement('div'); q.className = 'cmt-quote';
        q.textContent = quote.length > 80 ? quote.slice(0, 80) + '…' : quote;
        row.appendChild(q);
      }
      const when = document.createElement('div'); when.className = 'cmt-when';
      when.textContent = fmtWhen(c.created);
      when.title = fmtFull(c.created);
      row.appendChild(when);
      row.addEventListener('click', () => gotoComment(pad, f, c));
      el.appendChild(row);
    });
  });
}

// Open a comment's file from the summary and surface it (scroll + popover when
// the quote still resolves in the render; orphans just navigate).
function gotoComment(pad, f, c) {
  closeCmtPop();
  if (!currentRef || currentRef.f !== f) renderPreview(pad, f);
  const hl = document.querySelector('.cmt-hl[data-cid="' + c.id + '"]');
  if (hl) {
    try { hl.scrollIntoView({ block: 'center' }); } catch (_) {}
    if (commentsVisible) cmtViewPop(c, hl.getBoundingClientRect());
  }
}

function deleteComment(cid) {
  const f = currentRef && currentRef.f;
  if (!f) return;
  f.comments = (f.comments || []).filter(c => c.id !== cid);
  ORPHANS = ORPHANS.filter(c => c.id !== cid);
  persistComments();
  cmtUnwrap(cid);
  refreshOrphanPill();
  closeCmtPop();
  showToast('Comment deleted', 'success');
}

// Clear every comment on the active file in one shot (current-file scope only —
// persistComments writes just this file's array). Unwraps all highlights/notes
// and orphans, then persists the now-empty array through the same channel.
function deleteAllComments() {
  const f = currentRef && currentRef.f;
  if (!f || !f.comments || !f.comments.length) return;
  const n = f.comments.length;
  const ids = f.comments.map(c => c.id);
  f.comments = [];
  ORPHANS = [];
  persistComments();
  ids.forEach(cmtUnwrap);
  refreshOrphanPill();
  closeCmtPop();
  showToast(nComments(n) + ' deleted', 'success');
}

function refreshOrphanPill() {
  let pill = document.getElementById('cmtOrphans');
  if (!ORPHANS.length) { if (pill) pill.remove(); return; }
  const label = '⚠ ' + ORPHANS.length + ' orphaned comment' + (ORPHANS.length > 1 ? 's' : '');
  if (pill) { pill.textContent = label; return; }
  const md = previewEl.querySelector('.md');
  if (!md) return;
  pill = document.createElement('div');
  pill.id = 'cmtOrphans';
  pill.className = 'cmt-orphans';
  pill.title = 'Comments whose quoted text was not found in the file';
  pill.textContent = label;
  pill.addEventListener('click', () => { if (commentsVisible) openOrphansPop(pill); });
  md.parentNode.insertBefore(pill, md);
}

// (Re)apply all of the current file's comments to a fresh preview render.
// Orphans (quote not found) are kept and surfaced via the pill — never dropped.
function applyComments() {
  closeCmtPop();
  hideCmtAdd();
  ORPHANS = [];
  const old = document.getElementById('cmtOrphans');
  if (old) old.remove();
  const f = currentRef && currentRef.f;
  const md = previewEl.querySelector('.md');
  if (!md || !f || !f.comments || !f.comments.length) return;
  f.comments.forEach(c => {
    const found = cmtFindAnchor(md, c.anchor);
    if (found) cmtMark(found, c);
    else ORPHANS.push(c);
  });
  refreshOrphanPill();
}

// --- add affordance: floating button near a fresh selection ---
let cmtAddEl = null, pendingSel = null;
function hideCmtAdd() { if (cmtAddEl) cmtAddEl.style.display = 'none'; pendingSel = null; }
function ensureCmtAdd() {
  if (cmtAddEl) return cmtAddEl;
  cmtAddEl = document.createElement('button');
  cmtAddEl.id = 'cmtAdd';
  cmtAddEl.className = 'cmt-add';
  cmtAddEl.textContent = '✎ comment';
  cmtAddEl.style.display = 'none';
  document.body.appendChild(cmtAddEl);
  // mousedown would collapse the selection before click fires — keep it alive.
  cmtAddEl.addEventListener('mousedown', (e) => e.preventDefault());
  cmtAddEl.addEventListener('click', () => {
    if (!pendingSel) return;
    const s = pendingSel;
    cmtAddEl.style.display = 'none';
    cmtNewPop(s.anchor, s.rect);
  });
  return cmtAddEl;
}
document.addEventListener('mouseup', (e) => {
  if (!commentsVisible) return;
  if (e.target && e.target.closest && e.target.closest('.cmt-pop, .cmt-add')) return;
  const md = previewEl.querySelector('.md');
  if (!md || !currentRef) { hideCmtAdd(); return; }
  let sel = null;
  try { sel = window.getSelection(); } catch (_) {}
  if (!sel || sel.isCollapsed || !sel.rangeCount) { hideCmtAdd(); return; }
  const range = sel.getRangeAt(0);
  if (!md.contains(range.commonAncestorContainer)) { hideCmtAdd(); return; }
  const quote = range.toString();
  if (!quote || !quote.trim()) { hideCmtAdd(); return; }
  // prefix/suffix from ranges spanning [start of preview, selection start] and
  // [selection end, end of preview] — same text the matcher will search.
  let prefix = '', suffix = '';
  try {
    const pre = document.createRange();
    pre.selectNodeContents(md);
    pre.setEnd(range.startContainer, range.startOffset);
    prefix = pre.toString().slice(-32);
    const post = document.createRange();
    post.selectNodeContents(md);
    post.setStart(range.endContainer, range.endOffset);
    suffix = post.toString().slice(0, 32);
  } catch (_) {}
  let rect = { left: e.clientX || 0, top: e.clientY || 0, bottom: (e.clientY || 0) };
  try { const r = range.getBoundingClientRect(); if (r && (r.width || r.height || r.left || r.top)) rect = r; } catch (_) {}
  pendingSel = { anchor: { quote, prefix, suffix }, rect };
  const btn = ensureCmtAdd();
  // Same zoom-space conversion as openCmtPop: rect is screen px, the fixed
  // button lives inside the zoomed root.
  const z = SETTINGS.zoom || 1;
  btn.style.left = Math.max(8, rect.left / z) + 'px';
  btn.style.top = (rect.bottom / z + 6) + 'px';
  btn.style.display = '';
});

// Click a highlight or its note pill → view popover.
previewEl.addEventListener('click', (e) => {
  if (!commentsVisible) return;
  const hl = e.target.closest && e.target.closest('.cmt-hl, .cmt-note');
  if (!hl) return;
  const c = findComment(hl.dataset.cid);
  if (c) cmtViewPop(c, hl.getBoundingClientRect());
});
// Click elsewhere → dismiss the popover.
document.addEventListener('mousedown', (e) => {
  if (!cmtPopEl) return;
  const t = e.target;
  if (t && t.closest && t.closest('.cmt-pop, .cmt-hl, .cmt-note, .cmt-add, .cmt-orphans, #commentsToggle')) return;
  closeCmtPop();
});
// Fixed-position popovers drift when the preview scrolls under them.
previewEl.addEventListener('scroll', () => { closeCmtPop(); hideCmtAdd(); });

// Global show/hide. Highlights stay in the DOM; CSS neutralizes them (and the
// orphan pill) when off, and the handlers above guard on commentsVisible.
// Persisted per-session in localStorage like scratch.raw.
// Pad-wide comment tally on the header toggle. Recomputed from DATA on every
// render (buildTree) and every live mutation (persistComments). Hidden at zero.
function updateCommentsCount() {
  let n = 0;
  (DATA.pads || []).forEach(p => (p.files || []).forEach(f => { n += (f.comments && f.comments.length) || 0; }));
  const el = document.getElementById('cmtCount');
  if (!el) return;
  el.textContent = n > 99 ? '99+' : String(n);
  el.hidden = n === 0;
}
function applyCommentsVisibility() {
  document.documentElement.toggleAttribute('data-comments-off', !commentsVisible);
  const b = document.getElementById('commentsToggle');
  if (b) b.classList.toggle('muted', !commentsVisible);
}
function setCommentsVisible(v) {
  commentsVisible = v;
  try { localStorage.setItem('scratch.comments', v ? '1' : '0'); } catch (_) {}
  applyCommentsVisibility();
  if (!v) { closeCmtPop(); hideCmtAdd(); }
  showToast(v ? 'Comments shown' : 'Comments hidden', 'info');
}
// Click shows the pad-wide summary; visibility toggle moved to the 'c' shortcut.
document.getElementById('commentsToggle').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  if (cmtPopEl && cmtPopEl.classList.contains('cmt-summary')) { closeCmtPop(); return; }
  openCommentsSummary(btn);
});
applyCommentsVisibility();

buildTree();
`;
