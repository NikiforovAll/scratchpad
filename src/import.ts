// scratch import: rebuild a pad folder from an exported viewer HTML. The export
// embeds every file's content in its data island (render.ts payloadJson), so the
// reverse is a parse + write. This is a deliberate exception to "the CLI never
// authors content": the bytes came from the user's own export and the command is
// an explicit restore, never an implicit side effect.

import { mkdir, readdir } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { slugify } from "./discovery.ts";
import { DEFAULT_TYPE, hasManifest, parseManifest, writeManifest, type Manifest } from "./manifest.ts";
import { DATA_ISLAND_OPEN, type FileView, type PadView } from "./ui/render.ts";

/** A pad as the export wrote it. Old exports may lack fields, so every file
 * field is optional; the manifest fields pass through parseManifest untouched. */
export type ExportedFile = Partial<FileView> & { path: string };
export type ExportedPad = Pick<PadView, "name" | "id" | "layout"> & { dir?: string; files: ExportedFile[] };

const SCRIPT_CLOSE = "</script>";

/** Parse the embedded pad payload out of an exported page. Throws when the page
 * is not a scratch export (or the island is malformed). */
export function extractPads(html: string): ExportedPad[] {
  const i = html.indexOf(DATA_ISLAND_OPEN);
  const j = i === -1 ? -1 : html.indexOf(SCRIPT_CLOSE, i);
  if (j === -1) throw new Error("no scratch data island found — is this a `scratch export` file?");
  let raw: unknown;
  try {
    raw = JSON.parse(html.slice(i + DATA_ISLAND_OPEN.length, j));
  } catch (e) {
    throw new Error(`data island is not valid JSON: ${(e as Error).message}`);
  }
  const pads = (raw as { pads?: unknown })?.pads;
  if (!Array.isArray(pads)) throw new Error("data island has no `pads` array");
  return pads.filter(
    (p): p is ExportedPad =>
      typeof p === "object" && p !== null && typeof (p as ExportedPad).name === "string" && Array.isArray((p as ExportedPad).files),
  );
}

export interface PlannedFile {
  path: string;
  /** Why the file is skipped; absent when it will be written. */
  reason?: string;
  /** Source of the bytes to write; decoded lazily in applyPlan so a --dry-run
   * and the planning pass never materialize a second copy of the export. */
  file?: ExportedFile;
}

export interface PadPlan {
  name: string;
  dir: string;
  files: PlannedFile[];
  manifest: Manifest;
}

/** The path stays inside `dir` once resolved: no absolute, no `..` escape. */
function insideDir(dir: string, p: string): boolean {
  const root = resolve(dir);
  return resolve(root, p).startsWith(root + sep);
}

/** Why a file cannot be restored from the payload; undefined when it can. */
function skipReason(f: ExportedFile): string | undefined {
  if (f.external) return "linked file (content lives outside the pad)";
  if (typeof f.source === "string") return undefined;
  if (f.kind === "toolarge") return "too large — content was not embedded";
  if (f.kind === "binary" || f.content == null) return "binary — content was not embedded";
  if (f.kind === "image" && !f.content.startsWith("data:")) return "image is not a data URI";
  return undefined;
}

const BASE64_MARK = ";base64,";

/** Inverse of render.ts imageDataUri for images; raw text otherwise. */
function decode(f: ExportedFile): Buffer {
  if (typeof f.source === "string") return Buffer.from(f.source, "utf8");
  const c = f.content!;
  if (f.kind !== "image") return Buffer.from(c, "utf8");
  const k = c.indexOf(BASE64_MARK);
  return k === -1 ? Buffer.from(c.slice(c.indexOf(",") + 1), "utf8") : Buffer.from(c.slice(k + BASE64_MARK.length), "base64");
}

/** Decide what `import` would write for one pad; performs no I/O. Skipped
 * in-pad files keep a manifest entry — the metadata is worth having even when
 * the bytes did not survive the export. Linked (external) files get neither:
 * their `src` pointed outside the exporter's pad and means nothing here. */
export function planPad(pad: ExportedPad, dir: string): PadPlan {
  const files: PlannedFile[] = [];
  const entries: ExportedFile[] = [];
  for (const f of pad.files) {
    if (typeof f.path !== "string") continue;
    if (!insideDir(dir, f.path)) {
      files.push({ path: f.path, reason: "unsafe path (absolute or escapes the pad)" });
      continue;
    }
    const reason = skipReason(f);
    files.push(reason ? { path: f.path, reason } : { path: f.path, file: f });
    if (!f.external) entries.push(f.type === DEFAULT_TYPE ? { ...f, type: undefined } : f);
  }
  const manifest = parseManifest({ name: pad.name, id: pad.id, layout: pad.layout, files: entries }, "<export>");
  return { name: pad.name, dir, files, manifest };
}

/** Lay pads out under `out`: a single pad lands in `out` itself, several go to
 * `out/<folder>/` each, named after the exporter's pad folder when known. */
export function planAll(pads: ExportedPad[], out: string): PadPlan[] {
  const base = resolve(out);
  if (pads.length === 1) return [planPad(pads[0]!, base)];
  return pads.map((p) => planPad(p, join(base, (p.dir && basename(p.dir)) || slugify(p.name))));
}

/** A target is clean when it does not exist or is an empty dir; anything else
 * needs --force (a manifest there means a pad we would overwrite). */
export async function targetState(dir: string): Promise<"clean" | "pad" | "nonempty"> {
  if (await hasManifest(dir)) return "pad";
  try {
    const names = await readdir(dir);
    return names.length ? "nonempty" : "clean";
  } catch {
    return "clean";
  }
}

export async function applyPlan(plan: PadPlan): Promise<void> {
  const writes = plan.files.filter((f) => f.file);
  const dirs = new Set(writes.map((f) => dirname(join(plan.dir, f.path))));
  dirs.add(plan.dir);
  for (const d of dirs) await mkdir(d, { recursive: true });
  for (const f of writes) await Bun.write(join(plan.dir, f.path), decode(f.file!));
  await writeManifest(plan.dir, plan.manifest);
}
