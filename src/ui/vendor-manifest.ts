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
