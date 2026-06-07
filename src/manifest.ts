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
    return entry;
  });
  const ts = nowIso();
  return {
    version: typeof o.version === "number" ? o.version : SCHEMA_VERSION,
    name: o.name,
    ...(typeof o.id === "string" ? { id: o.id } : {}),
    created: typeof o.created === "string" ? o.created : ts,
    updated: typeof o.updated === "string" ? o.updated : ts,
    files,
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
