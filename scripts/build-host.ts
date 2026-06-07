#!/usr/bin/env bun
// Stage glimpse's native WebView host next to the compiled binary.
//
// Why: `bun build --compile` packs JS into a virtual FS (B:\~BUN\), so glimpseui
// can't find its host relative to its module. We copy the host into dist/glimpse/
// and launch.ts points GLIMPSE_BINARY_PATH at it. Without this, the compiled
// scratch.exe is browser-only. (Dev/`bun add -g` use node_modules and skip this.)
//
// The host is framework-dependent .NET 8 + WebView2 — the target machine still
// needs the .NET 8 Desktop Runtime and the Evergreen WebView2 Runtime installed.

import { cp, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const SRC = "node_modules/glimpseui/native/windows/bin";
const DEST = "dist/glimpse";

if (process.platform !== "win32") {
  console.log("build-host: non-Windows platform — nothing to stage.");
  process.exit(0);
}
if (!existsSync(SRC)) {
  console.error(`build-host: host not found at ${SRC} (is glimpseui installed?).`);
  process.exit(1);
}

await mkdir(DEST, { recursive: true });

// Runtime set only: the executable, its .NET deps, and the WebView2 assemblies +
// native loader. Skip the *.WebView2 user-data cache (created at runtime), the
// Release/ + obj/ build trees, and *.pdb debug symbols.
let copied = 0;
for (const name of await readdir(SRC)) {
  if (/\.(exe|dll)$/i.test(name) || /\.(deps|runtimeconfig)\.json$/i.test(name)) {
    await cp(join(SRC, name), join(DEST, name));
    copied++;
  }
}

// Native WebView2 loader lives under runtimes/<rid>/native/.
const loader = join(SRC, "runtimes", "win-x64", "native", "WebView2Loader.dll");
if (existsSync(loader)) {
  const out = join(DEST, "runtimes", "win-x64", "native");
  await mkdir(out, { recursive: true });
  await cp(loader, join(out, "WebView2Loader.dll"));
  copied++;
}

console.log(`build-host: staged ${copied} files into ${DEST}/ (native glimpse for the compiled binary).`);
