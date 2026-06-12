// Map a stored comment anchor back onto its SOURCE markdown so an agent can read
// comments from the CLI with the relevant slice of the file in hand.
//
// The viewer anchors comments to RENDERED text ({quote, prefix, suffix}; see
// manifest.ts) and re-finds the quote in the live DOM. The CLI has no DOM, so we
// approximate the same match against a normalized copy of the source: strip the
// inline/block markdown syntax the renderer would have dropped, collapse
// whitespace (paragraphs render as one line), and search for the quote. From the
// matched line range we return the enclosing markdown block (the paragraph / list
// / blockquote the quote sits in, blank-line delimited) plus the nearest heading
// for orientation — that block is the editable unit handed back to the agent.

import type { Comment } from "./manifest.ts";

export interface LocatedComment extends Comment {
  /** True when the quote was found in the source. */
  matched: boolean;
  /** 1-based source line where the quote starts; null when unmatched. */
  line: number | null;
  /** 1-based source line where the quote ends; null when unmatched. */
  endLine: number | null;
  /** Nearest enclosing heading text (orientation only); null if none / unmatched. */
  heading: string | null;
  /** The markdown block (paragraph/list/quote) the quote sits in; null when unmatched. */
  context: string | null;
  /** 1-based source line range of `context` (inclusive); null when unmatched. */
  contextLines: [number, number] | null;
}

const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;

/** Strip inline markdown the renderer collapses to plain text. */
function stripInline(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images → alt
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → text
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1");
}

/** Strip leading block markers (heading hashes, blockquote, list bullets). */
function stripBlock(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^\s*>\s?/, "")
    .replace(/^\s*([-*+]|\d+[.)])\s+/, "");
}

const isFence = (line: string) => /^\s*(```|~~~)/.test(line);
const collapseWs = (s: string) => s.replace(/\s+/g, " ");
const normWs = (s: string) => collapseWs(s).trim();

/** A source file parsed once: lines, per-line fenced-code state, and a
 * whitespace-collapsed/syntax-stripped projection with a char→line map. Built
 * with `buildIndex` so a file with many comments pays the parse cost only once. */
export interface SourceIndex {
  lines: string[];
  /** Per-line "inside a fenced code block" flag (so `#` in code isn't a heading). */
  inFence: boolean[];
  /** Rendered-text projection: hit positions resolve to lines via `lineOf`. */
  text: string;
  lineOf: number[];
}

export function buildIndex(source: string): SourceIndex {
  const lines = source.split(/\r?\n/);
  const inFence: boolean[] = [];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    inFence[i] = fence;
    if (isFence(lines[i]!)) fence = !fence;
  }
  // Project to rendered text + char→line map: strip markdown outside fences,
  // keep fenced lines verbatim, collapse all whitespace (paragraphs render as
  // one line, so a line/paragraph break becomes a single space between words).
  const chars: string[] = [];
  const lineOf: number[] = [];
  let lastSpace = true;
  const push = (str: string, ln: number) => {
    for (const ch of str) {
      if (/\s/.test(ch)) {
        if (lastSpace) continue;
        chars.push(" ");
        lineOf.push(ln);
        lastSpace = true;
      } else {
        chars.push(ch);
        lineOf.push(ln);
        lastSpace = false;
      }
    }
  };
  lines.forEach((raw, idx) => {
    if (isFence(raw)) return; // fence markers render to nothing
    push(inFence[idx] ? raw : stripInline(stripBlock(raw)), idx + 1);
    if (!lastSpace) {
      chars.push(" ");
      lineOf.push(idx + 1);
      lastSpace = true;
    }
  });
  return { lines, inFence, text: chars.join(""), lineOf };
}

/** Nearest heading text at or above a 1-based source line (orientation only). */
export function headingFor(idx: SourceIndex, line: number): { heading: string | null; level: number } {
  for (let i = Math.min(line, idx.lines.length) - 1; i >= 0; i--) {
    if (idx.inFence[i]) continue;
    const m = idx.lines[i]!.match(HEADING_RE);
    if (m) return { heading: m[2]!.trim(), level: m[1]!.length };
  }
  return { heading: null, level: 0 };
}

/** The markdown block (paragraph / list / blockquote) covering a 1-based line
 * range — expanded outward to the surrounding blank lines, the natural editable
 * unit. Headings and fence markers act as hard boundaries. */
export function blockFor(
  idx: SourceIndex,
  startLine: number,
  endLine: number,
): { text: string; lines: [number, number] } {
  const { lines, inFence } = idx;
  const blank = (i: number) => lines[i]!.trim() === "";
  const bound = (i: number) => !inFence[i] && (isFence(lines[i]!) || HEADING_RE.test(lines[i]!));
  let s = startLine - 1;
  let e = Math.min(endLine, lines.length) - 1;
  while (s > 0 && !blank(s - 1) && !bound(s - 1)) s--;
  while (e < lines.length - 1 && !blank(e + 1) && !bound(e + 1)) e++;
  return { text: lines.slice(s, e + 1).join("\n").trim(), lines: [s + 1, e + 1] };
}

// Find a quote in the projection, disambiguating multiple matches by how many
// chars of prefix/suffix match contiguously outward from the quote's boundary
// (ties keep the first hit). Mirrors the viewer's cmtFindAnchor so the CLI and
// the rendered view resolve the same occurrence. Returns -1 when not found.
function findQuote(text: string, q: string, prefix: string, suffix: string): number {
  if (!q) return -1;
  const hits: number[] = [];
  for (let i = text.indexOf(q); i !== -1; i = text.indexOf(q, i + 1)) hits.push(i);
  if (hits.length <= 1) return hits[0] ?? -1;
  let best = hits[0]!;
  let bestScore = -1;
  for (const h of hits) {
    const before = text.slice(Math.max(0, h - prefix.length), h);
    const after = text.slice(h + q.length, h + q.length + suffix.length);
    let score = 0;
    for (let k = 1; k <= before.length; k++) {
      if (prefix[prefix.length - k] === before[before.length - k]) score++;
      else break;
    }
    for (let k = 0; k < after.length; k++) {
      if (suffix[k] === after[k]) score++;
      else break;
    }
    if (score > bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best;
}

const UNMATCHED = { matched: false, line: null, endLine: null, heading: null, context: null, contextLines: null } as const;

/** Locate a comment's quote in a parsed source and resolve its enclosing block. */
export function locateComment(idx: SourceIndex, comment: Comment): LocatedComment {
  const { text, lineOf } = idx;
  // Prefix/suffix keep their boundary whitespace (only inner runs collapse) — the
  // space adjacent to the quote is what disambiguates between occurrences.
  const prefix = collapseWs(stripInline(comment.anchor.prefix ?? ""));
  const suffix = collapseWs(stripInline(comment.anchor.suffix ?? ""));
  let q = normWs(stripInline(comment.anchor.quote));
  let at = findQuote(text, q, prefix, suffix);
  if (at === -1 && comment.anchor.quote) {
    // Fallback: the quote may have already been plain (e.g. code) — try as-is.
    q = normWs(comment.anchor.quote);
    at = findQuote(text, q, prefix, suffix);
  }
  if (at === -1) return { ...comment, ...UNMATCHED };
  const line = lineOf[at]!;
  const endLine = lineOf[Math.min(at + q.length - 1, lineOf.length - 1)]!;
  const block = blockFor(idx, line, endLine);
  return {
    ...comment,
    matched: true,
    line,
    endLine,
    heading: headingFor(idx, line).heading,
    context: block.text,
    contextLines: block.lines,
  };
}
