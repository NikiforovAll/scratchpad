// Pad discovery + slug/path resolution.
//
// A pad is just a folder containing scratchpad.json; the folder path is its
// identity. There is NO central store. Discovery scans a root (default cwd,
// override via --dir or SCRATCH_DIR) for manifests. A pad is referenced by name
// (resolved within the root) or by an explicit path.

import { readdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { hasManifest, readManifest, type Manifest } from "./manifest.ts";

/** Directories never descended into during a scan. */
const IGNORE_DIRS = new Set(["node_modules", ".git", ".hg", ".svn", "dist", "build"]);

export interface Pad {
  /** Absolute path to the pad directory. */
  dir: string;
  manifest: Manifest;
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
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
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
  if (isAbsolute(ref) || ref.includes("/") || ref.includes("\\")) {
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
  const pads = await findPads(root);
  const wantSlug = slug;
  for (const p of pads) {
    const base = p.dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
    if (base === ref || base === wantSlug) return p;
    if (p.manifest.name === ref || slugify(p.manifest.name) === wantSlug) return p;
  }
  return null;
}
