// Bundle entry: highlight.js (common languages) exposed on window for the viewer.
// Built to a single offline IIFE via `bun build` (see scripts/build-vendor.ts).
import hljs from "highlight.js/lib/common";
window.hljs = hljs;
