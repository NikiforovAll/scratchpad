// Pad discovery + slug/path resolution.
//
// A pad is just a folder containing scratchpad.json; the folder path is its
// identity. There is NO central store. Discovery scans a root (default cwd,
// override via --dir or SCRATCH_DIR) for manifests. A pad is referenced by name
// (resolved within the root) or by an explicit path.

import { readdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { hasManifest, readManifest, relatedRefs, type Manifest } from "./manifest.ts";

/** Directories never descended into during a scan. */
const IGNORE_DIRS = new Set(["node_modules", ".git", ".hg", ".svn", "dist", "build"]);

/** A pad's place in a pad set (see resolvePadSet). */
export interface SetRole {
  primary?: boolean;
  /** Short label of the link to the opened pad, e.g. "feeds". */
  rel?: string;
  /** "out": the opened pad lists this one in `related`; "in": this one lists the opened pad. */
  direction?: "out" | "in";
}

export interface Pad {
  /** Absolute path to the pad directory. */
  dir: string;
  manifest: Manifest;
  /** Set only when the pad was opened as part of a pad set. */
  set?: SetRole;
}

/** Forward-slash a path — portable + safe across Git Bash, where backslashes and
 * drive letters get mangled. */
export const toPosix = (p: string) => p.split("\\").join("/");

/** Comparison key for a path: absolute, forward-slashed, and case-folded on
 * win32, where the filesystem ignores case. */
export const pathKey = (p: string) => {
  const s = toPosix(resolve(p));
  return process.platform === "win32" ? s.toLowerCase() : s;
};

/** Ref → path test shared by `resolvePad` and `related` refs. */
const isPathRef = (ref: string) => isAbsolute(ref) || ref.includes("/") || ref.includes("\\");

/** Whether a name ref picks pad `p`: by folder basename, manifest name, or either's slug. */
function nameMatches(ref: string, p: Pad): boolean {
  const slug = slugify(ref);
  const base = basename(p.dir.replace(/[\\/]+$/, ""));
  return base === ref || base === slug || p.manifest.name === ref || slugify(p.manifest.name) === slug;
}

/** Absolute on-disk path of a file entry: a linked `src` (absolute, or relative
 * to the pad dir) wins; otherwise the entry's `path` under the pad dir. */
export function resolveEntryPath(padDir: string, entry: { path: string; src?: string }): string {
  return entry.src
    ? isAbsolute(entry.src) ? entry.src : resolve(padDir, entry.src)
    : join(padDir, entry.path);
}

/** Validate a pad name. Returns an error message, or null if valid. Names must
 * not contain whitespace — use hyphens (the slug form) instead. */
export function validateName(name: string): string | null {
  if (/\s/.test(name)) {
    return `pad name must not contain whitespace: "${name}"\n       use hyphens instead, e.g. "${slugify(name)}"`;
  }
  return null;
}

/** lowercase, spaces/punct → "-", trim repeats. "Auth Refactor!" → "auth-refactor". */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return s || "pad";
}

/** The default export/save filename slug (sans extension): a single pad's name,
 * else the root folder's. Shared by `scratch export`, the live viewer's Ctrl+S,
 * and pad selection so all three agree on the name. */
export function exportFileSlug(singleName: string | null, root: string): string {
  return singleName != null ? slugify(singleName) : slugify(basename(root)) || "scratchpads";
}

/** Resolve the scan root: explicit dir → SCRATCH_DIR env → cwd. */
export function resolveRoot(dir?: string): string {
  const raw = dir ?? process.env.SCRATCH_DIR ?? process.cwd();
  return resolve(raw);
}

/**
 * Find pads under root by scanning for scratchpad.json. Recursive, but does NOT
 * descend into a pad once found (no nested pads) nor into IGNORE_DIRS.
 */
export async function findPads(root: string, maxDepth = 6): Promise<Pad[]> {
  const pads: Pad[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (await hasManifest(dir)) {
      try {
        pads.push({ dir, manifest: await readManifest(dir) });
      } catch {
        // Skip unreadable/invalid manifests rather than aborting the whole scan.
      }
      return; // don't descend into a pad
    }
    if (depth >= maxDepth) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (!entries) return;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (IGNORE_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      await walk(join(dir, e.name), depth + 1);
    }
  }
  await walk(root, 0);
  pads.sort((a, b) => (b.manifest.updated ?? "").localeCompare(a.manifest.updated ?? ""));
  return pads;
}

/**
 * Resolve a pad reference to its directory. A ref is either an explicit path
 * (absolute, or contains a separator) or a name/slug resolved within root.
 * Returns the absolute pad dir, or null if not found.
 */
export async function resolvePad(ref: string, root: string): Promise<Pad | null> {
  // Explicit path?
  if (isPathRef(ref)) {
    const dir = resolve(ref);
    if (await hasManifest(dir)) return { dir, manifest: await readManifest(dir) };
    return null;
  }
  // Direct child of root by slug/name?
  const direct = join(root, ref);
  if (await hasManifest(direct)) return { dir: direct, manifest: await readManifest(direct) };
  const slug = slugify(ref);
  const directSlug = join(root, slug);
  if (slug !== ref && (await hasManifest(directSlug))) {
    return { dir: directSlug, manifest: await readManifest(directSlug) };
  }
  // Otherwise scan and match by slug(name), manifest.name, or folder basename.
  return (await findPads(root)).find((p) => nameMatches(ref, p)) ?? null;
}

/** Display label for a pad selection: the pad names, opened pad first. */
export const setLabel = (pads: Pad[]) => pads.map((p) => p.manifest.name).join(", ");

/** Resolve one `related` ref written in `from`'s manifest. A path is relative to
 * `from`'s dir; a name is looked up among `from`'s siblings first, then under root. */
async function resolveRelated(ref: string, from: Pad, root: string): Promise<Pad | null> {
  if (isPathRef(ref)) return resolvePad(resolve(from.dir, ref), root);
  return (await resolvePad(ref, dirname(from.dir))) ?? (await resolvePad(ref, root));
}

/**
 * The opened pad plus the pads it is related to, one level deep and each pad
 * once: pads it lists in `related` ("out"), then pads under the scan root that
 * list it ("in"). The scan root is `root` when the pad sits under it, otherwise
 * the pad's parent dir. Unresolvable refs in the opened pad are reported through
 * `warn`; broken refs in other pads are ignored. A pad with no relations comes
 * back alone and without a `set` role.
 */
export async function resolvePadSet(
  pad: Pad,
  root: string,
  warn: (msg: string) => void = () => {},
): Promise<Pad[]> {
  const out: Pad[] = [{ ...pad, set: { primary: true } }];
  const seen = new Set([pathKey(pad.dir)]);
  const refs = relatedRefs(pad.manifest);
  const resolved = await Promise.all(refs.map((ref) => resolveRelated(ref.pad, pad, root).catch(() => null)));
  refs.forEach((ref, i) => {
    const r = resolved[i];
    if (!r) return warn(`related pad "${ref.pad}" (listed in ${pad.manifest.name}) not found`);
    if (seen.has(pathKey(r.dir))) return;
    seen.add(pathKey(r.dir));
    out.push({ ...r, set: { direction: "out", ...(ref.rel ? { rel: ref.rel } : {}) } });
  });
  const rel = relative(root, pad.dir);
  const scanRoot = rel && !rel.startsWith("..") && !isAbsolute(rel) ? root : dirname(pad.dir);
  // Inbound refs are matched against the opened pad directly, not resolved, so
  // the scan stays one tree walk however many pads list `related`.
  const target = pathKey(pad.dir);
  for (const q of await findPads(scanRoot)) {
    if (seen.has(pathKey(q.dir))) continue;
    const ref = relatedRefs(q.manifest).find((r) =>
      isPathRef(r.pad) ? pathKey(resolve(q.dir, r.pad)) === target : nameMatches(r.pad, pad),
    );
    if (ref) out.push({ ...q, set: { direction: "in", ...(ref.rel ? { rel: ref.rel } : {}) } });
  }
  return out.length === 1 ? [pad] : out;
}
