// File watching for auto hot-reload of `scratch ui`. A single debounced callback
// fires when anything under a watched pad changes on disk. We watch pad
// DIRECTORIES (recursive) rather than each resolved file so newly-added files and
// inline `![](rel)` assets are caught without re-deriving the exact path set on
// every change — the reloader re-reads only manifest-registered entries and the
// client patch no-ops when nothing rendered actually changed. External linked
// files (entry.src outside the pad) live elsewhere, so their parent dirs are
// watched too (non-recursive — the file sits directly in them, and the dir could
// be large, e.g. a home folder).

import { watch, type FSWatcher } from "node:fs";
import { dirname } from "node:path";
import { type Pad, resolveEntryPath } from "../discovery.ts";

export interface Watcher {
  close(): void;
}

// Coalesce an editor's multi-write save burst (and rapid successive edits) into a
// single rebuild — a per-change re-render was the "blinking" the old on-demand
// design avoided.
const DEBOUNCE_MS = 200;

export function createWatcher(pads: Pad[], onChange: () => void): Watcher {
  const watchers: FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, DEBOUNCE_MS);
  };

  const tryWatch = (dir: string, recursive: boolean) => {
    try {
      // A watch that can't be established (missing dir, platform limit) is
      // non-fatal — the viewer just falls back to manual reload for that path.
      watchers.push(watch(dir, { recursive }, fire));
    } catch {}
  };

  const padDirs = new Set(pads.map((p) => p.dir));
  const extDirs = new Set<string>();
  for (const p of pads) {
    for (const entry of p.manifest.files) {
      if (!entry.src) continue;
      const parent = dirname(resolveEntryPath(p.dir, entry));
      if (!padDirs.has(parent)) extDirs.add(parent);
    }
  }
  for (const dir of padDirs) tryWatch(dir, true);
  for (const dir of extDirs) tryWatch(dir, false);

  return {
    close() {
      if (timer) clearTimeout(timer);
      for (const w of watchers) {
        try {
          w.close();
        } catch {}
      }
    },
  };
}
