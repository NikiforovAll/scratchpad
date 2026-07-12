// scratchpad.json manifest: types + read/write/validate (schema version 1).
// The manifest is a thin metadata layer over a pad folder; unknown keys are
// tolerated on read so the format can evolve forward-compatibly.

import { join } from "node:path";

export const MANIFEST_NAME = "scratchpad.json";
export const SCHEMA_VERSION = 1;

export const FILE_TYPES = [
  "note",
  "snippet",
  "output",
  "artifact",
  "reference",
] as const;
export type FileType = (typeof FILE_TYPES)[number];
export const DEFAULT_TYPE: FileType = "note";

export interface CommentAnchor {
  /** Exact selected text, as it appeared in the rendered preview. */
  quote: string;
  /** Up to ~32 chars of rendered text immediately before the quote. */
  prefix: string;
  /** Up to ~32 chars of rendered text immediately after the quote. */
  suffix: string;
}

export interface Comment {
  /** Stable id (crypto.randomUUID). */
  id: string;
  body: string;
  anchor: CommentAnchor;
  /** ISO-8601 UTC. */
  created: string;
  /** ISO-8601 UTC. */
  updated: string;
}

export interface FileEntry {
  /** Path relative to the pad dir — keeps the pad portable. */
  path: string;
  /**
   * Linked external source. When set, the file's CONTENT lives here (outside the
   * pad) while `path` is just its logical label inside the pad. Absolute, or
   * relative to the pad dir. Absent for normal in-pad files.
   */
  src?: string;
  title?: string;
  description?: string;
  tags?: string[];
  type?: FileType;
  /** Optional visual group — files sharing a group are listed together under a
   * group header in the viewer. Absent = ungrouped (listed under "FILES"). */
  group?: string;
  /** When true, the viewer omits this file from its list. The entry stays
   * registered (still in the manifest, still shown by `scratch ls`). */
  hidden?: boolean;
  /** Inline comments anchored to the file's rendered preview. "Orphaned" is
   * computed at render time when the quote can't be re-found — never stored. */
  comments?: Comment[];
}

/** One entry in `layout.groups`. Declares a group's display order (array index)
 * and optional default collapse state. */
export interface LayoutGroup {
  /** Group identity, matched case-insensitively against `FileEntry.group`
   * (`trim().toLowerCase()`). The empty string `""` is the reserved token for the
   * ungrouped "FILES" bucket. */
  name: string;
  /** Viewer-only: render this group collapsed by default (default expanded). */
  collapsed?: boolean;
}

/** Optional top-level display hint. Declares the order (and collapse) of groups in
 * the viewer sidebar and `scratch ls`. Groups not listed here sort after the listed
 * ones in first-appearance order; the ungrouped bucket sorts last unless positioned
 * via a `{ name: "" }` entry. Absent = today's first-appearance order everywhere. */
export interface Layout {
  groups: LayoutGroup[];
}

export interface Manifest {
  version: number;
  name: string;
  id?: string;
  /** ISO-8601 UTC. */
  created: string;
  /** ISO-8601 UTC. */
  updated: string;
  files: FileEntry[];
  layout?: Layout;
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function isFileType(v: unknown): v is FileType {
  return typeof v === "string" && (FILE_TYPES as readonly string[]).includes(v);
}

export function newManifest(name: string, id?: string): Manifest {
  const ts = nowIso();
  const m: Manifest = { version: SCHEMA_VERSION, name, created: ts, updated: ts, files: [] };
  if (id) m.id = id;
  return m;
}

/** Validate a raw comments value, dropping malformed entries. Shared by the
 * manifest parser and the viewer writeback path, so both apply the same rules:
 * id, body, and a non-empty anchor.quote are required; the rest is defaulted. */
export function sanitizeComments(raw: unknown): Comment[] {
  if (!Array.isArray(raw)) return [];
  const out: Comment[] = [];
  for (const c of raw) {
    if (typeof c !== "object" || c === null) continue;
    const o = c as Record<string, unknown>;
    const a = o.anchor as Record<string, unknown> | null | undefined;
    if (typeof o.id !== "string" || o.id.length === 0) continue;
    if (typeof o.body !== "string") continue;
    if (typeof a !== "object" || a === null || typeof a.quote !== "string" || a.quote.length === 0) continue;
    const ts = nowIso();
    out.push({
      id: o.id,
      body: o.body,
      anchor: {
        quote: a.quote,
        prefix: typeof a.prefix === "string" ? a.prefix : "",
        suffix: typeof a.suffix === "string" ? a.suffix : "",
      },
      created: typeof o.created === "string" ? o.created : ts,
      updated: typeof o.updated === "string" ? o.updated : ts,
    });
  }
  return out;
}

/** Normalize a group name to its comparison key (case-insensitive, trimmed).
 * Shared so layout matching and grouping agree. `""` = the ungrouped bucket. */
export function groupKey(raw: string | undefined | null): string {
  return (raw ?? "").trim().toLowerCase();
}

/** Validate a raw `layout` value defensively (malformed input is non-fatal, matching
 * how the rest of the manifest tolerates bad data). Returns undefined when `layout`
 * is absent or unusable — callers then fall back to first-appearance order. */
export function sanitizeLayout(raw: unknown): Layout | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const groupsRaw = (raw as Record<string, unknown>).groups;
  if (!Array.isArray(groupsRaw)) return undefined;
  const groups: LayoutGroup[] = [];
  for (const g of groupsRaw) {
    if (typeof g !== "object" || g === null) continue;
    const o = g as Record<string, unknown>;
    if (typeof o.name !== "string") continue;
    const entry: LayoutGroup = { name: o.name };
    if (o.collapsed === true) entry.collapsed = true;
    groups.push(entry);
  }
  return { groups };
}

/** Order group keys for display. `present` = normalized group keys in first-appearance
 * order (may include `""` for the ungrouped bucket). Returns the ordered subset of
 * `present`. Kept in sync with the client-side copy in `src/ui/render.ts` (buildTree).
 *
 * No layout → `present` unchanged (today's behavior). With a layout: laid-out groups
 * first (deduped first-wins, only if present), then leftover named groups in
 * first-appearance order, then the ungrouped `""` bucket last unless the layout
 * positioned it. */
export function orderGroupKeys(present: string[], layout?: Layout): string[] {
  if (!layout) return present;
  const presentSet = new Set(present);
  const emitted = new Set<string>();
  const out: string[] = [];
  for (const g of layout.groups) {
    const key = groupKey(g.name);
    if (!presentSet.has(key) || emitted.has(key)) continue;
    out.push(key);
    emitted.add(key);
  }
  for (const key of present) {
    if (key === "" || emitted.has(key)) continue;
    out.push(key);
    emitted.add(key);
  }
  if (presentSet.has("") && !emitted.has("")) out.push("");
  return out;
}

/** Validate + normalize a parsed object into a Manifest. Throws on hard errors. */
export function parseManifest(raw: unknown, source: string): Manifest {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Invalid manifest at ${source}: not a JSON object`);
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== "string" || o.name.length === 0) {
    throw new Error(`Invalid manifest at ${source}: missing "name"`);
  }
  const filesRaw = Array.isArray(o.files) ? o.files : [];
  const files: FileEntry[] = filesRaw.map((f, i) => {
    if (typeof f !== "object" || f === null || typeof (f as any).path !== "string") {
      throw new Error(`Invalid manifest at ${source}: files[${i}] missing "path"`);
    }
    const e = f as Record<string, unknown>;
    const entry: FileEntry = { path: e.path as string };
    if (typeof e.src === "string" && e.src.length > 0) entry.src = e.src;
    if (typeof e.title === "string") entry.title = e.title;
    if (typeof e.description === "string") entry.description = e.description;
    if (Array.isArray(e.tags)) entry.tags = e.tags.filter((t): t is string => typeof t === "string");
    if (isFileType(e.type)) entry.type = e.type;
    if (typeof e.group === "string" && e.group.length > 0) entry.group = e.group;
    if (e.hidden === true) entry.hidden = true;
    const comments = sanitizeComments(e.comments);
    if (comments.length > 0) entry.comments = comments;
    return entry;
  });
  const ts = nowIso();
  const layout = sanitizeLayout(o.layout);
  return {
    version: typeof o.version === "number" ? o.version : SCHEMA_VERSION,
    name: o.name,
    ...(typeof o.id === "string" ? { id: o.id } : {}),
    created: typeof o.created === "string" ? o.created : ts,
    updated: typeof o.updated === "string" ? o.updated : ts,
    files,
    ...(layout ? { layout } : {}),
  };
}

export function manifestPath(padDir: string): string {
  return join(padDir, MANIFEST_NAME);
}

export async function readManifest(padDir: string): Promise<Manifest> {
  const p = manifestPath(padDir);
  const text = await Bun.file(p).text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Invalid manifest at ${p}: not valid JSON`);
  }
  return parseManifest(parsed, p);
}

export async function writeManifest(padDir: string, m: Manifest): Promise<void> {
  m.updated = nowIso();
  await Bun.write(manifestPath(padDir), JSON.stringify(m, null, 2) + "\n");
}

export async function hasManifest(dir: string): Promise<boolean> {
  return Bun.file(manifestPath(dir)).exists();
}
