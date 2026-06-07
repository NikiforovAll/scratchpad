// Bundle entry: mermaid exposed on window for the viewer. Built to a single
// offline IIFE via `bun build` (see scripts/build-vendor.ts). Only inlined into
// the page when a pad actually contains a ```mermaid block.
import mermaid from "mermaid";
window.mermaid = mermaid;
