import type { ReadingFont } from "../config.ts";
import { FONT_SUBSETS, UI_FONTS, uiFontFile, uiFontUrl, type FontSubset } from "./vendor-manifest.ts";

type SubsetName = FontSubset["name"];

function parseRange(range: string): [number, number][] {
  return range.split(",").map((part) => {
    const [lo, hi] = part.replace("U+", "").split("-");
    return [parseInt(lo!, 16), parseInt(hi ?? lo!, 16)];
  });
}
const RANGES = FONT_SUBSETS.map((s) => ({ name: s.name, spans: parseRange(s.range) }));
const RANGE_OF = new Map(FONT_SUBSETS.map((s) => [s.name, s.range]));

/** Subsets whose ranges cover at least one character of `text`; latin always. */
export function subsetsFor(text: string): Set<SubsetName> {
  const out = new Set<SubsetName>(["latin"]);
  const seen = new Set<number>();
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x100 || seen.has(cp)) continue;
    seen.add(cp);
    for (const r of RANGES) {
      if (!out.has(r.name) && r.spans.some(([lo, hi]) => cp >= lo && cp <= hi)) out.add(r.name);
    }
    if (out.size === RANGES.length) break;
  }
  return out;
}

/** @font-face rules for the UI fonts, one per face × subset. With `b64` (file →
 * base64 woff2) the sources are data: URIs, otherwise the pinned CDN. `only`
 * limits the subsets; `reading` drops the prose fonts other than that one. */
export function uiFontCss(opts: { b64?: Record<string, string>; only?: Set<SubsetName>; reading?: ReadingFont } = {}): string {
  let css = "";
  for (const font of UI_FONTS) {
    if (opts.reading && font.reading && font.reading !== opts.reading) continue;
    for (const face of font.faces) {
      for (const subset of font.subsets) {
        if (opts.only && !opts.only.has(subset)) continue;
        const file = uiFontFile(font, subset, face);
        const src = opts.b64 ? `data:font/woff2;base64,${opts.b64[file]}` : uiFontUrl(font, file);
        css += `@font-face{font-family:'${font.family}';font-style:${face.style};font-weight:${face.weight};font-display:swap;` +
          `src:url(${src}) format('woff2');unicode-range:${RANGE_OF.get(subset)}}\n`;
      }
    }
  }
  return css;
}

/** Live and CDN pages declare every face; the browser fetches only what it renders. */
export const UI_FONT_CSS_CDN = uiFontCss();
