#!/usr/bin/env bun
// Populate the OFFLINE vendor cache (src/ui/vendor/) used by `scratch export --offline`.
//
// Idempotent: for each pinned asset, if the cached file already exists AND its bytes
// match the pinned SRI, it's left alone (no network). Only missing/changed files are
// downloaded — so a warm cache makes this a no-op and a normal `bun run build` needs
// no network. A COLD cache (fresh clone / CI) fetches once. The cache is gitignored.
//
// Pins (url + sri) come from src/ui/vendor-manifest.ts — the same constants render.ts
// uses for its CDN tags — so there's no second source of truth. Downloads are verified
// against that sri; a mismatch is fatal (CDN drift / tampering / wrong version).
//
// Frozen mode (SCRATCH_NO_FETCH=1 or --frozen): never download — error if anything is
// missing/stale. Use in environments that MUST build from a pre-warmed cache.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { KATEX_CSS, KATEX_FONTS_BASE, VENDOR_ASSETS } from "../src/ui/vendor-manifest.ts";

const VENDOR_DIR = join(import.meta.dir, "..", "src", "ui", "vendor");
const FONTS_DIR = join(VENDOR_DIR, "fonts");
const FROZEN = process.env.SCRATCH_NO_FETCH === "1" || process.argv.includes("--frozen");

/** Base64 sha384 of bytes, formatted as a subresource-integrity token. */
function sriOf(buf: Uint8Array): string {
  return "sha384-" + createHash("sha384").update(buf).digest("base64");
}

let fetched = 0;
let skipped = 0;
/** Cached lib bytes by manifest id — reused to generate the offline bundle module. */
const bytes: Record<string, Uint8Array> = {};

/** Ensure `file` holds bytes matching `sri`; download + verify if missing/stale. */
async function ensure(file: string, url: string, sri: string): Promise<Uint8Array> {
  if (existsSync(file)) {
    const have = await readFile(file);
    if (sriOf(have) === sri) {
      skipped++;
      return have;
    }
    if (FROZEN) throw new Error(`frozen: cached ${file} fails SRI (stale) — refusing to re-download`);
    console.warn(`fetch-vendor: cached ${file} fails SRI — re-downloading`);
  } else if (FROZEN) {
    throw new Error(`frozen: missing ${file} — run without --frozen / SCRATCH_NO_FETCH to populate`);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch-vendor: ${url} → HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const got = sriOf(buf);
  if (got !== sri) throw new Error(`fetch-vendor: SRI mismatch for ${url}\n  expected ${sri}\n  got      ${got}`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, buf);
  fetched++;
  return buf;
}

await mkdir(VENDOR_DIR, { recursive: true });

for (const a of VENDOR_ASSETS) {
  bytes[a.id] = await ensure(join(VENDOR_DIR, a.file), a.url, a.sri);
}

// KaTeX woff2 fonts: katex.min.css references them by relative url(fonts/X.woff2).
// They carry no SRI pin (there's no published per-font hash), so they're fetched
// if-missing only — the css's own SRI gates which font SET we trust. We take only
// woff2 (every target engine supports it); the offline render path drops woff/ttf.
const css = await readFile(join(VENDOR_DIR, KATEX_CSS.file), "utf8");
const fontRefs = [...new Set([...css.matchAll(/url\(fonts\/([A-Za-z0-9_.-]+\.woff2)\)/g)].map((m) => m[1]!))];
await mkdir(FONTS_DIR, { recursive: true });
for (const name of fontRefs) {
  const file = join(FONTS_DIR, name);
  if (existsSync(file)) {
    skipped++;
    continue;
  }
  if (FROZEN) throw new Error(`frozen: missing font ${file}`);
  const res = await fetch(KATEX_FONTS_BASE + "fonts/" + name);
  if (!res.ok) throw new Error(`fetch-vendor: font ${name} → HTTP ${res.status}`);
  await writeFile(file, new Uint8Array(await res.arrayBuffer()));
  fetched++;
}

// Build a KaTeX stylesheet with the woff2 fonts inlined as data: URIs and the
// woff/ttf @font-face sources stripped — so an offline export keeps math glyphs
// with zero network. Order matters: drop legacy formats first, then inline woff2.
let katexCss = css.replace(/,?url\(fonts\/[A-Za-z0-9_.-]+\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\)/g, "");
for (const name of fontRefs) {
  const b64 = Buffer.from(await readFile(join(FONTS_DIR, name))).toString("base64");
  katexCss = katexCss.replaceAll(`url(fonts/${name})`, `url(data:font/woff2;base64,${b64})`);
}

// Generate the offline bundle module consumed (dynamically) by render.ts on the
// --offline path:
//   *_GZ  — JS libs gzipped then base64 (mermaid 3.3MB→~1.2MB). render.ts emits these
//           in a data island; the page's bootstrap decompresses (DecompressionStream)
//           and injects each as a Blob-URL <script>. base64 is JS-string-safe as-is.
//   *_CSS — stylesheets inlined as-is (gzip barely helps: the KaTeX woff2 data: URIs
//           are already-compressed bytes). JSON-encoded; </style> neutralized so the
//           CSS can sit inside an inline <style> without closing it early.
// Derived + gitignored.
const gzb64 = (buf: Uint8Array) => Buffer.from(Bun.gzipSync(buf)).toString("base64");
const lit = (s: string) => JSON.stringify(s.replace(/<\/(style)/gi, "<\\/$1"));
const bundle = `// AUTO-GENERATED by scripts/fetch-vendor.ts — do not edit. Gitignored.
// Pinned vendor bytes for \`scratch export --offline\`. *_GZ are gzip+base64 JS libs
// (decompressed in-page); *_CSS are inline stylesheets (KaTeX fonts as woff2 data: URIs).
export const HLJS_JS_GZ = ${JSON.stringify(gzb64(bytes.hljs))};
export const MERMAID_JS_GZ = ${JSON.stringify(gzb64(bytes.mermaid))};
export const KATEX_JS_GZ = ${JSON.stringify(gzb64(bytes.katex))};
export const HLJS_THEME_DARK_CSS = ${lit(new TextDecoder().decode(bytes.hljsThemeDark))};
export const HLJS_THEME_LIGHT_CSS = ${lit(new TextDecoder().decode(bytes.hljsThemeLight))};
export const KATEX_CSS = ${lit(katexCss)};
`;
await writeFile(join(VENDOR_DIR, "bundle.ts"), bundle);

console.log(`fetch-vendor: ${fetched} fetched, ${skipped} cached (${VENDOR_ASSETS.length} libs + ${fontRefs.length} fonts) → src/ui/vendor/ (+bundle.ts, JS gzip+base64)`);
