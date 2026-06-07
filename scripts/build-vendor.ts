// Build offline, single-file IIFE bundles of the viewer's vendored libraries
// (highlight.js, mermaid) into src/ui/vendor/*.bundle.js. These are checked in
// and inlined into the viewer HTML at render time (conditionally), so the UI
// works with no network — including inside the glimpse WebView.
//
// Run:  bun run scripts/build-vendor.ts

import { join } from "node:path";

const dir = join(import.meta.dir, "..", "src", "ui", "vendor");
const targets = [
  { entry: join(dir, "hljs.entry.mjs"), out: join(dir, "hljs.bundle.js") },
  { entry: join(dir, "mermaid.entry.mjs"), out: join(dir, "mermaid.bundle.js") },
];

for (const t of targets) {
  const res = await Bun.build({
    entrypoints: [t.entry],
    target: "browser",
    format: "iife",
    minify: true,
  });
  if (!res.success) {
    for (const m of res.logs) console.error(m);
    process.exit(1);
  }
  const code = await res.outputs[0]!.text();
  await Bun.write(t.out, code);
  console.log(`built ${t.out}  (${(code.length / 1024).toFixed(0)} KB)`);
}
