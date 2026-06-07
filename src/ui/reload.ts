// Hot reload support shared by both transports. A Reloader watches each pad dir
// and, on change, rebuilds the view from disk and produces a fresh snapshot. The
// snapshot is either an in-place data payload (cheap; preserves selection/scroll)
// or, when the set of needed vendor bundles GROWS, a full page so highlighting/
// diagrams that weren't inlined at launch still load.

import { watch, type FSWatcher } from "node:fs";
import type { Pad } from "../discovery.ts";
import { readManifest } from "../manifest.ts";
import { bundleNeeds, buildView, payloadJson, renderHtml } from "./render.ts";

export interface Snapshot {
  /** Full self-contained page (fresh vendor bundles). */
  html: string;
  /** Data island JSON for an in-place patch via __scratchReload. */
  payloadJson: string;
  /** When true, vendor bundles changed → consumer should do a full reload. */
  full: boolean;
}

export interface Reloader {
  rebuild(): Promise<Snapshot>;
  /** Watch all pad dirs; calls onChange (debounced) on any file event. Returns a stop fn. */
  watch(onChange: () => void, debounceMs?: number): () => void;
}

export function createReloader(pads: Pad[], rootLabel: string): Reloader {
  // Bundle needs seen so far. A snapshot is "full" only when a NEW bundle becomes
  // necessary (e.g. first mermaid block added after launch); shrinking is fine to
  // keep in place.
  let haveHljs = false;
  let haveMermaid = false;
  let primed = false;

  async function rebuild(): Promise<Snapshot> {
    // Re-read manifests from disk so newly-registered files / edited metadata are
    // picked up (the in-memory Pad.manifest is a launch-time snapshot).
    const fresh: Pad[] = [];
    for (const p of pads) {
      try {
        fresh.push({ dir: p.dir, manifest: await readManifest(p.dir) });
      } catch {
        fresh.push(p); // manifest unreadable mid-write → keep the last good one
      }
    }
    const view = await buildView(fresh);
    const needs = bundleNeeds(view);
    const full = primed && ((needs.hljs && !haveHljs) || (needs.mermaid && !haveMermaid));
    haveHljs = haveHljs || needs.hljs;
    haveMermaid = haveMermaid || needs.mermaid;
    primed = true;
    return {
      html: await renderHtml(view, rootLabel),
      payloadJson: payloadJson(view, rootLabel),
      full,
    };
  }

  function watch(onChange: () => void, debounceMs = 150): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(onChange, debounceMs);
    };
    const watchers: FSWatcher[] = [];
    for (const p of pads) {
      try {
        watchers.push(watch(p.dir, { recursive: true }, fire));
      } catch {
        // Best-effort; a pad dir that can't be watched just won't live-update.
      }
    }
    return () => {
      if (timer) clearTimeout(timer);
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          /* already closed */
        }
      }
    };
  }

  return { rebuild, watch };
}
