// Build the viewer HTML page. The CLI does all file I/O here and embeds the pad
// data + file contents into one HTML string, so glimpse and the browser fallback
// render identically with no round-trips. highlight.js and mermaid load from a
// pinned CDN, added CONDITIONALLY — hljs only when a pad has code, mermaid only
// when a ```mermaid block is present.

import { readdir } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import type { Pad } from "../discovery.ts";
import { DEFAULT_TYPE, MANIFEST_NAME, type FileEntry } from "../manifest.ts";
import { THEME_CSS } from "./theme.ts";

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

const MAX_EMBED_BYTES = 512 * 1024; // skip embedding content above this

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico"]);
const MD_EXT = new Set([".md", ".markdown", ".mdx"]);
const TEXT_EXT = new Set([
  ".txt", ".log", ".csv", ".tsv", ".env", ".ini", ".cfg", ".conf", ".gitignore",
]);
const CODE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".jsonc", ".py", ".rb",
  ".go", ".rs", ".java", ".kt", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".swift",
  ".sh", ".bash", ".zsh", ".ps1", ".sql", ".yaml", ".yml", ".toml", ".xml", ".html",
  ".css", ".scss", ".less", ".vue", ".svelte", ".lua", ".r", ".scala", ".dart",
]);

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".bmp": "image/bmp", ".ico": "image/x-icon",
};

type Kind = "markdown" | "code" | "image" | "text" | "binary" | "toolarge";

interface FileView {
  path: string;
  registered: boolean;
  /** Linked from outside the pad — content read from the manifest `src`. */
  external?: boolean;
  title?: string;
  description?: string;
  tags?: string[];
  type?: string;
  kind: Kind;
  /** language hint for code files (extension without dot). */
  lang?: string;
  /** text content for markdown/code/text; data URI for image; null otherwise. */
  content: string | null;
}
interface PadView {
  name: string;
  id?: string;
  dir: string;
  files: FileView[];
}

function classify(ext: string): Kind {
  if (IMAGE_EXT.has(ext)) return "image";
  if (MD_EXT.has(ext)) return "markdown";
  if (CODE_EXT.has(ext)) return "code";
  if (TEXT_EXT.has(ext)) return "text";
  return "binary";
}

/** List ALL files in a pad dir (recursively), merged with manifest metadata. */
async function scanPadFiles(pad: Pad): Promise<FileView[]> {
  const registered = new Map<string, FileEntry>();
  for (const f of pad.manifest.files) registered.set(f.path, f);

  const onDisk: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === MANIFEST_NAME) continue;
      if (e.name.startsWith(".")) continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules") continue;
        await walk(abs);
      } else {
        onDisk.push(relative(pad.dir, abs).split("\\").join("/"));
      }
    }
  }
  await walk(pad.dir);

  // Union of on-disk files and registered paths (a registered file may not exist yet).
  const paths = new Set<string>([...onDisk, ...registered.keys()]);
  const views: FileView[] = [];
  for (const path of paths) {
    const meta = registered.get(path);
    const ext = extname(path).toLowerCase();
    let kind = classify(ext);
    let content: string | null = null;
    // Linked entries read from `src` (outside the pad); the rest from path under the pad dir.
    const abs = meta?.src
      ? (isAbsolute(meta.src) ? meta.src : resolve(pad.dir, meta.src))
      : join(pad.dir, path);
    const file = Bun.file(abs);
    if (await file.exists()) {
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
    views.push({
      path,
      registered: !!meta,
      external: !!meta?.src,
      title: meta?.title,
      description: meta?.description,
      tags: meta?.tags,
      type: meta?.type ?? (meta ? DEFAULT_TYPE : undefined),
      kind,
      lang: kind === "code" ? ext.slice(1) : undefined,
      content,
    });
  }

  // Order = scratchpad.json order: registered files in manifest.files[] sequence
  // (the author's deliberate reading order), then unregistered on-disk files
  // appended alphabetically.
  const manifestOrder = new Map(pad.manifest.files.map((f, i) => [f.path, i]));
  return views.sort((a, b) => {
    const ia = manifestOrder.get(a.path);
    const ib = manifestOrder.get(b.path);
    if (ia != null && ib != null) return ia - ib;
    if (ia != null) return -1;
    if (ib != null) return 1;
    return a.path.localeCompare(b.path);
  });
}

export async function buildView(pads: Pad[]): Promise<PadView[]> {
  const out: PadView[] = [];
  for (const p of pads) {
    out.push({
      name: p.manifest.name,
      id: p.manifest.id,
      dir: p.dir,
      files: await scanPadFiles(p),
    });
  }
  return out;
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
    p.files.some((f) => f.content != null && (f.kind === "code" || f.kind === "markdown")),
  );
}
function needsMermaid(view: PadView[]): boolean {
  return view.some((p) =>
    p.files.some((f) => f.kind === "markdown" && f.content != null && MERMAID_RE.test(f.content)),
  );
}

export async function renderHtml(view: PadView[], rootLabel: string): Promise<string> {
  const data = payloadJson(view, rootLabel);
  const titleName = view.length === 1 ? view[0]!.name : rootLabel;

  // CDN tags are blocking (no defer) so window.hljs/window.mermaid are ready
  // before the client script runs. SRI + crossorigin guard integrity; on load
  // failure the client degrades gracefully.
  const cdnTag = (c: { url: string; sri: string }) =>
    `<script src="${c.url}" integrity="${c.sri}" crossorigin="anonymous" referrerpolicy="no-referrer"></script>\n`;

  let vendor = "";
  if (needsHljs(view)) vendor += cdnTag(HLJS_CDN);
  if (needsMermaid(view)) vendor += cdnTag(MERMAID_CDN);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>scratch · ${escapeHtml(titleName)}</title>
<style>${THEME_CSS}</style>
</head>
<body>
<div class="app">
  <header class="topbar" id="topbar">
    <div class="brand">
      <span class="wordmark">scratch<span class="dot">.</span></span>
      <span class="padname" id="padname"></span>
    </div>
    <div class="view-actions">
      <button class="icon-btn" id="reloadBtn" title="Reload from disk (R)" aria-label="Reload">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
      </button>
      <button class="icon-btn" id="themeToggle" title="Toggle theme (T)" aria-label="Toggle theme">
        <svg class="i-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>
        <svg class="i-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
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
    <nav class="tree" id="tree"></nav>
    <main class="preview" id="preview"></main>
  </div>
  <div class="modal-scrim" id="helpModal" style="display:none">
    <div class="modal">
      <div class="modal-head"><span>Keyboard shortcuts</span><button class="icon-btn" id="helpClose" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
      <dl class="shortcuts">
        <div><dt>↑ ↓ ← → / j k</dt><dd>Next / previous file</dd></div>
        <div><dt>r</dt><dd>Reload from disk</dd></div>
        <div><dt>v</dt><dd>Toggle raw / rendered (markdown)</dd></div>
        <div><dt>t</dt><dd>Toggle theme</dd></div>
        <div><dt>?</dt><dd>Show this help</dd></div>
        <div><dt>Esc</dt><dd>Close help / window</dd></div>
      </dl>
    </div>
  </div>
</div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script id="data" type="application/json">${data}</script>
${vendor}<script>${CLIENT_JS}</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

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
function renderMarkdown(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  let html = '', i = 0, inUl = false, inOl = false;
  const closeLists = () => { if (inUl) { html += '</ul>'; inUl = false; } if (inOl) { html += '</ol>'; inOl = false; } };
  while (i < lines.length) {
    let line = lines[i];
    let fence = line.match(/^\s*\`\`\`\s*([\w-]*)\s*$/);
    if (fence) {
      closeLists(); const lang = (fence[1] || '').toLowerCase(); i++; let buf = [];
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
    const open = lines[i].match(/^\s*\`\`\`+\s*([\w-]*)\s*$/);
    if (open) {
      const lang = (open[1] || '').toLowerCase();
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

function renderPreview(pad, f) {
  current = pad.dir + '::' + f.path; currentRef = { pad, f };
  curIdx = ITEMS.findIndex(it => it.pad === pad && it.f === f);
  // Meta is a single tight dot-separated line (type · #tags) — not scattered chips.
  const metaBits = [f.registered ? esc(f.type || 'note') : 'unregistered'];
  if (f.external) metaBits.push('linked');
  (f.tags || []).forEach(t => metaBits.push('#' + esc(t)));
  const metaLine = metaBits.join(' · ');
  const canRaw = f.kind === 'markdown' && f.content != null;
  const ctrls = canRaw
    ? '<span class="pctrls"><button class="pbtn ' + (!rawMode ? 'on' : '') + '" id="vRendered">rendered</button>' +
      '<button class="pbtn ' + (rawMode ? 'on' : '') + '" id="vRaw">raw</button></span>'
    : '';

  let bodyHtml = '';
  if (f.kind === 'toolarge') bodyHtml = '<div class="notice">File too large to preview.</div>';
  else if (f.kind === 'image' && f.content) bodyHtml = '<div class="imgwrap"><img src="' + f.content + '" alt="' + esc(f.path) + '"/></div>';
  else if (f.kind === 'markdown' && f.content != null) bodyHtml = rawMode
    ? (window.hljs
        ? '<pre class="code"><code class="hljs hl-done">' + highlightRawMarkdown(f.content) + '</code></pre>'
        : '<pre class="code"><code class="language-markdown">' + esc(f.content) + '</code></pre>')
    : '<div class="md">' + renderMarkdown(f.content) + '</div>';
  else if ((f.kind === 'code' || f.kind === 'text') && f.content != null) {
    const cls = f.lang ? ' class="language-' + esc(f.lang) + '"' : '';
    bodyHtml = '<pre class="code"><code' + cls + '>' + esc(f.content) + '</code></pre>';
  } else bodyHtml = '<div class="notice">No preview available (binary or missing file).</div>';

  const preview = document.getElementById('preview');
  // One reading column wraps the whole view so the header strip, title, meta,
  // and body all share a single left edge (per-element margins no longer fight
  // the centering).
  preview.innerHTML = '<div class="pbody">' +
    '<div class="phead"><span class="pfile">' + esc(f.path) + '</span>' + ctrls + '</div>' +
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
  ITEMS = items;

  document.getElementById('padname').textContent = DATA.pads.length === 1 ? DATA.pads[0].name : DATA.rootLabel;

  if (!items.length) {
    const msg = DATA.pads.length
      ? '<div class="empty"><div class="big">Empty scratchpad</div><div>No files yet.</div></div>'
      : '<div class="empty"><div class="big">No scratchpad here</div><div>Create one: <code>scratch new &lt;name&gt; --dir &lt;parent&gt;</code></div></div>';
    document.getElementById('preview').innerHTML = msg;
    tree.innerHTML = '<div class="label">FILES</div><div class="notice" style="padding:8px">none</div>';
    return;
  }

  let html = '<div class="label">FILES</div>';
  items.forEach(({ pad, f, pi, fi }) => {
    const key = pad.dir + '::' + f.path;
    const cls = 'frow' + (f.registered ? '' : ' unreg');
    const ttl = f.title || f.path;
    const tag = f.registered ? (f.type || 'note') : '·';
    html += '<div class="' + cls + '" data-key="' + esc(key) + '" data-pi="' + pi + '" data-fi="' + fi + '">' +
      '<span class="fttl">' + esc(ttl) + '</span><span class="ftag">' + esc(tag) + '</span></div>';
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

// Auto-detect theme from the OS (works in the glimpse WebView and the browser).
// A manual toggle overrides; after that we stop following the system.
let manualTheme = false;
function syncThemeIcon() {
  const dark = document.documentElement.dataset.theme !== 'light';
  const d = document.querySelector('#themeToggle .i-dark'), l = document.querySelector('#themeToggle .i-light');
  if (d) d.style.display = dark ? '' : 'none';
  if (l) l.style.display = dark ? 'none' : '';
}
function applySystemTheme() {
  if (manualTheme) return;
  const dark = !window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  syncThemeIcon();
}
applySystemTheme();
if (window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(() => {
    applySystemTheme();
    if (currentRef) renderPreview(currentRef.pad, currentRef.f);
  });
}
function toggleTheme() {
  manualTheme = true;
  const r = document.documentElement;
  r.dataset.theme = r.dataset.theme === 'dark' ? 'light' : 'dark';
  syncThemeIcon();
  if (currentRef) renderPreview(currentRef.pad, currentRef.f);
}
document.getElementById('themeToggle').addEventListener('click', toggleTheme);

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

// Keyboard shortcuts (see the help modal). Ignored while typing in a field.
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (e.key === 'Escape') {
    if (helpModal.style.display !== 'none') showHelp(false);
    else if (closeWindow) closeWindow();
    return;
  }
  if (e.key === '?') { showHelp(helpModal.style.display === 'none'); return; }
  if (e.key === 't') { toggleTheme(); return; }
  if (e.key === 'r') { requestReload(); return; }
  if (e.key === 'v' && currentRef && currentRef.f.kind === 'markdown' && currentRef.f.content != null) {
    setRaw(!rawMode); renderPreview(currentRef.pad, currentRef.f); return;
  }
  const next = e.key === 'j' || e.key === 'ArrowDown' || e.key === 'ArrowRight';
  const prev = e.key === 'k' || e.key === 'ArrowUp' || e.key === 'ArrowLeft';
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
document.getElementById('preview').addEventListener('click', (e) => {
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
