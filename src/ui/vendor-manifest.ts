// Single source of truth for the viewer's pinned vendor builds (version + SRI).
// render.ts imports these for its CDN <script>/<link> tags; scripts/fetch-vendor.ts
// imports them to populate the offline build cache (src/ui/vendor/), verifying each
// download against the SAME sri here — so there is no second hash to keep in sync.
// SRI is computed from the exact CDN bytes; bump it when bumping a pinned version.
//
// `file` is the cache filename under src/ui/vendor/. `kind`:
//   js  — script-global build (highlight.min.js / mermaid.min.js / katex.min.js)
//   css — stylesheet (hljs themes, katex.min.css)
// The KaTeX woff2 fonts referenced by katex.min.css are NOT listed individually;
// fetch-vendor.ts derives them from the css's url(fonts/…woff2) refs.

export interface VendorAsset {
  /** Stable id used by render.ts to pick the right inline blob. */
  id: "hljs" | "mermaid" | "katex" | "katexCss" | "hljsThemeDark" | "hljsThemeLight";
  /** Cache filename under src/ui/vendor/. */
  file: string;
  kind: "js" | "css";
  url: string;
  sri: string;
}

// highlight.js script-global build — sets window.hljs. Loaded when a pad has code
// or any markdown/html (rendered fences AND the raw markdown view are highlighted).
export const HLJS_CDN: VendorAsset = {
  id: "hljs",
  file: "highlight.min.js",
  kind: "js",
  url: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js",
  sri: "sha384-RH2xi4eIQ/gjtbs9fUXM68sLSi99C7ZWBRX1vDrVv6GQXRibxXLbwO2NGZB74MbU",
};
// mermaid script-global build — sets window.mermaid. Loaded only when a ```mermaid
// block is present. Self-contained bundle (no dynamic import()), so it works fully
// offline for every diagram type.
export const MERMAID_CDN: VendorAsset = {
  id: "mermaid",
  file: "mermaid.min.js",
  kind: "js",
  url: "https://cdn.jsdelivr.net/npm/mermaid@11.15.0/dist/mermaid.min.js",
  sri: "sha384-yQ4mmBBT+vhTAwjFH0toJXNYJ6O4usWnt6EPIdWwrRvx2V/n5lXuDZQwQFeSFydF",
};
// highlight.js token-color THEMES (CSS). Code blocks use these full IDE-style
// palettes; the raw-markdown view keeps our own warm palette (scoped to .mdsrc in
// theme.ts). Both load when hljs does; the client enables one per light/dark.
export const HLJS_THEME_DARK: VendorAsset = {
  id: "hljsThemeDark",
  file: "github-dark.min.css",
  kind: "css",
  url: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github-dark.min.css",
  sri: "sha384-wH75j6z1lH97ZOpMOInqhgKzFkAInZPPSPlZpYKYTOqsaizPvhQZmAtLcPKXpLyH",
};
export const HLJS_THEME_LIGHT: VendorAsset = {
  id: "hljsThemeLight",
  file: "github.min.css",
  kind: "css",
  url: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github.min.css",
  sri: "sha384-eFTL69TLRZTkNfYZOLM+G04821K1qZao/4QLJbet1pP4tcF+fdXq/9CdqAbWRl/L",
};
// KaTeX (math). The script-global build sets window.katex; the client renders
// $…$ / $$…$$ spans in enhance(). Added CONDITIONALLY (only when a doc has math).
export const KATEX_CDN: VendorAsset = {
  id: "katex",
  file: "katex.min.js",
  kind: "js",
  url: "https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js",
  sri: "sha384-cMkvdD8LoxVzGF/RPUKAcvmm49FQ0oxwDF3BGKtDXcEc+T1b2N+teh/OJfpU0jr6",
};
// KaTeX stylesheet. Online it pulls the math fonts by RELATIVE url from the CDN,
// so an export opened OFFLINE loses the glyphs (the .math span then degrades to its
// raw $…$ source). The offline render path rewrites the woff2 url()s to data: URIs
// (see render.ts) so the glyphs survive with no network. Versioned with katex.min.js.
export const KATEX_CSS: VendorAsset = {
  id: "katexCss",
  file: "katex.min.css",
  kind: "css",
  url: "https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css",
  sri: "sha384-5TcZemv2l/9On385z///+d7MSYlvIEw9FuZTIdZ14vJLqWphw7e7ZPuOiCHJcFCP",
};

export const VENDOR_ASSETS: VendorAsset[] = [
  HLJS_CDN,
  MERMAID_CDN,
  KATEX_CDN,
  KATEX_CSS,
  HLJS_THEME_DARK,
  HLJS_THEME_LIGHT,
];

/** Base URL for the KaTeX woff2 fonts referenced (relatively) by katex.min.css. */
export const KATEX_FONTS_BASE = "https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/";

// UI webfonts (theme.ts --mono / --serif), from @fontsource npm packages on jsdelivr.
// @font-face fetches cannot carry SRI, so like the KaTeX fonts the trust anchor is
// the immutable npm version in the URL. Each face is split into Google-Fonts
// unicode-range subsets: online the browser fetches only the subsets a page uses;
// --offline embeds only the subsets the pad's text needs (render.ts).
export interface FontSubset {
  name: "latin" | "latin-ext" | "cyrillic" | "cyrillic-ext" | "vietnamese";
  range: string;
}
export const FONT_SUBSETS: FontSubset[] = [
  { name: "latin", range: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" },
  { name: "latin-ext", range: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" },
  { name: "cyrillic", range: "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116" },
  { name: "cyrillic-ext", range: "U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F" },
  { name: "vietnamese", range: "U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB" },
];

export interface FontFace { weight: number; style: "normal" | "italic" }
export interface UiFont {
  family: string;
  pkg: string;
  subsets: FontSubset["name"][];
  faces: FontFace[];
  /** Set on a prose font: an offline export embeds it only when it is the active reading font. */
  reading?: "sans" | "serif";
}
export const UI_FONTS: UiFont[] = [
  {
    family: "IBM Plex Mono",
    pkg: "@fontsource/ibm-plex-mono@5.3.0",
    subsets: ["latin", "latin-ext", "cyrillic", "cyrillic-ext", "vietnamese"],
    faces: [
      { weight: 400, style: "normal" }, { weight: 500, style: "normal" },
      { weight: 700, style: "normal" }, { weight: 400, style: "italic" },
    ],
  },
  {
    family: "Playfair Display",
    pkg: "@fontsource/playfair-display@5.3.0",
    subsets: ["latin", "latin-ext", "cyrillic", "vietnamese"],
    faces: [{ weight: 500, style: "normal" }, { weight: 600, style: "normal" }],
  },
  {
    family: "IBM Plex Sans",
    pkg: "@fontsource/ibm-plex-sans@5.3.0",
    subsets: ["latin", "latin-ext", "cyrillic", "cyrillic-ext", "vietnamese"],
    faces: [{ weight: 400, style: "normal" }, { weight: 600, style: "normal" }, { weight: 400, style: "italic" }],
    reading: "sans",
  },
  {
    family: "IBM Plex Serif",
    pkg: "@fontsource/ibm-plex-serif@5.3.0",
    subsets: ["latin", "latin-ext", "cyrillic", "cyrillic-ext", "vietnamese"],
    faces: [{ weight: 400, style: "normal" }, { weight: 600, style: "normal" }, { weight: 400, style: "italic" }],
    reading: "serif",
  },
];
// Faces are the minimum theme.ts needs; each one costs ~15–23 KB per subset in an
// offline export. CSS font matching covers the gaps: 600 mono resolves to the 700
// face, 700 Playfair/Plex Sans/Plex Serif to the 600 face; only bold italic is
// synthesized (from 400 italic).

/** Cache filename under src/ui/vendor/fonts/ui/, identical to the package's own. */
export function uiFontFile(font: UiFont, subset: string, face: FontFace): string {
  const id = font.pkg.slice("@fontsource/".length, font.pkg.lastIndexOf("@"));
  return `${id}-${subset}-${face.weight}-${face.style}.woff2`;
}
export function uiFontUrl(font: UiFont, file: string): string {
  return `https://cdn.jsdelivr.net/npm/${font.pkg}/files/${file}`;
}

// The live viewer's in-place Excalidraw editor loads react + @excalidraw/excalidraw
// from esm.sh (excalidraw's official browser path: an ESM graph whose react peer
// deps esm.sh resolves in-URL — responses aren't byte-stable, so no SRI, unlike
// the script-global vendors above; that's also why this isn't a VendorAsset and
// has no offline copy). `files` (jsdelivr, serving the npm package verbatim)
// hosts index.css plus the font/locale chunks excalidraw fetches at runtime via
// EXCALIDRAW_ASSET_PATH. One `pkg` pin drives both hosts, so a version bump
// can't mix editor code with another release's assets. render.ts injects this
// into the live page as the #exca-cdn island — never into an export.
const EXCA_PKG = "@excalidraw/excalidraw@0.18.1";
export const EXCA_EDITOR_CDN = {
  pkg: EXCA_PKG,
  react: "19.0.0",
  esm: "https://esm.sh",
  files: `https://cdn.jsdelivr.net/npm/${EXCA_PKG}/dist/prod/`,
};
