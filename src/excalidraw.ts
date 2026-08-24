// Server-side .excalidraw → SVG rendering. The scene JSON stays the source of
// truth in the pad; the viewer/export embed only the rendered SVG, so exported
// artifacts carry zero excalidraw code (the dependency lives in the CLI).
//
// @excalidraw/excalidraw's exportToSvg expects a browser DOM. Under Bun we
// register happy-dom plus two shims it needs but happy-dom lacks:
//   - a canvas 2d context (feature-detected at module load; measureText drives
//     text wrapping — approximate metrics are fine because elements carry their
//     authored width/height, only re-wrap of bound text can drift slightly)
//   - the CSS Font Loading API (FontFace / document.fonts); with it excalidraw
//     subsets the used glyphs and embeds them as woff2 data URIs, so the SVG is
//     fully self-contained (text renders in Virgil, offline).
// Everything is lazy: nothing DOM-ish happens unless a scene is actually rendered.

let ready: Promise<typeof import("@excalidraw/excalidraw")> | null = null;

// This module owns the format — every "is this an excalidraw file" check goes
// through here so case handling / a future twin extension changes in one place.
export const EXCALIDRAW_EXT = ".excalidraw";
export function isExcalidrawPath(p: string): boolean {
  return p.toLowerCase().endsWith(EXCALIDRAW_EXT);
}

// Re-checked on every render, not just first load: the test suite (and any
// embedder) may register/unregister happy-dom between calls, which replaces the
// global document and HTMLCanvasElement — the stubs must follow.
async function ensureDom(): Promise<void> {
  if (typeof document === "undefined") {
    const { GlobalRegistrator } = await import("@happy-dom/global-registrator");
    if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
  }
  installCanvasStub();
  installFontFaceStub();
  // After any (re-)registration: happy-dom can swap the global console, which
  // would strand a wrapper installed on the old one.
  silenceWorkerPoolLog();
}

async function loadExcalidraw(): Promise<typeof import("@excalidraw/excalidraw")> {
  await ensureDom();
  if (!ready) ready = import("@excalidraw/excalidraw");
  return ready;
}

function installCanvasStub(): void {
  const Canvas = (globalThis as Record<string, any>).HTMLCanvasElement;
  if (!Canvas || document.createElement("canvas").getContext("2d")) return;
  const ctx = {
    filter: "none",
    font: "",
    measureText(s: string) {
      const size = Number.parseFloat(ctx.font) || 16;
      return {
        width: s.length * size * 0.6,
        actualBoundingBoxAscent: size * 0.8,
        actualBoundingBoxDescent: size * 0.2,
      };
    },
    save() {}, restore() {}, scale() {}, translate() {}, rotate() {},
    clearRect() {}, fillRect() {}, strokeRect() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, bezierCurveTo() {}, quadraticCurveTo() {}, arc() {},
    fill() {}, stroke() {}, clip() {}, drawImage() {}, setTransform() {},
    setLineDash() {}, fillText() {}, strokeText() {},
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData() {},
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
  };
  Canvas.prototype.getContext = () => ctx;
}

function installFontFaceStub(): void {
  const g = globalThis as Record<string, any>;
  if (typeof g.FontFace === "undefined") {
    g.FontFace = class FontFace {
      family: string;
      source: unknown;
      status = "unloaded";
      unicodeRange: string;
      style: string;
      weight: string;
      display: string;
      constructor(family: string, source: unknown, d?: Record<string, string>) {
        this.family = family;
        this.source = source;
        this.unicodeRange = d?.unicodeRange ?? "U+0-10FFFF";
        this.style = d?.style ?? "normal";
        this.weight = d?.weight ?? "normal";
        this.display = d?.display ?? "auto";
      }
      load() {
        this.status = "loaded";
        return Promise.resolve(this);
      }
    };
  }
  if (!document.fonts) {
    (document as Record<string, any>).fonts = {
      add() {}, delete() {}, check: () => true,
      ready: Promise.resolve(),
      load: () => Promise.resolve([]),
      [Symbol.iterator]: [][Symbol.iterator],
    };
  }
}

// excalidraw's font-subsetting worker pool logs "Job finished! Idle worker has
// been released from the pool." AFTER the render resolves — it would corrupt
// `scratch preview -o -` stdout and spams the `scratch ui` terminal. Drop just
// those lines, on every method the pool uses (log/info/debug). Re-applied from
// ensureDom on each render — a wrapped method is tagged so wrappers never stack,
// while a console swapped in by a happy-dom re-registration gets wrapped anew.
const POOL_NOISE = /Idle worker has been released|Job finished!/;
function silenceWorkerPoolLog(): void {
  const c = console as unknown as Record<string, ((...a: unknown[]) => void) & { __scratchQuiet?: true }>;
  for (const name of ["log", "info", "debug"] as const) {
    const orig = c[name];
    if (typeof orig !== "function" || orig.__scratchQuiet) continue;
    const wrapped = (...a: unknown[]) => {
      if (typeof a[0] === "string" && POOL_NOISE.test(a[0])) return;
      orig.apply(console, a);
    };
    wrapped.__scratchQuiet = true as const;
    c[name] = wrapped;
  }
}

export interface ExcalidrawScene {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

/** Parse .excalidraw JSON; throws with a readable message on anything that
 * isn't an excalidraw scene. */
export function parseScene(jsonText: string): ExcalidrawScene {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    throw new Error("not valid JSON");
  }
  const scene = raw as Record<string, unknown>;
  if (!scene || typeof scene !== "object" || !Array.isArray(scene.elements)) {
    throw new Error('not an excalidraw scene (missing "elements" array)');
  }
  return {
    elements: scene.elements,
    appState: (scene.appState as Record<string, unknown>) ?? {},
    files: (scene.files as Record<string, unknown>) ?? {},
  };
}

/** Render an .excalidraw scene (JSON text, or a scene already run through
 * parseScene — saves a re-parse when the caller inspected it first) to a
 * self-contained SVG string (fonts embedded as data URIs unless skipFonts).
 * Throws on invalid scenes or render failure. */
export async function renderExcalidrawSvg(
  input: string | ExcalidrawScene,
  opts: { embedScene?: boolean; scale?: number; skipFonts?: boolean } = {},
): Promise<string> {
  const scene = typeof input === "string" ? parseScene(input) : input;
  const { exportToSvg, restoreElements } = await loadExcalidraw();
  // restoreElements normalizes hand-written / older-version scenes to the shapes
  // the renderer expects (fills defaults, drops junk) — real editor files pass
  // through unchanged.
  const elements = restoreElements(scene.elements as never, null);
  const svg = await exportToSvg({
    elements,
    appState: {
      exportBackground: true,
      // exportEmbedScene writes the scene JSON into SVG metadata, making the
      // output round-trippable in Excalidraw (its own .excalidraw.svg format).
      exportEmbedScene: !!opts.embedScene,
      ...scene.appState,
      // After the spread so a stored exportScale can't undo the caller's choice.
      // Scales only the svg width/height attrs (vector) — the viewer's
      // max-width:100% clamps what would overflow the card.
      ...(opts.scale ? { exportScale: opts.scale } : {}),
    } as never,
    files: scene.files as never,
    ...(opts.skipFonts ? { skipInliningFonts: true as const } : {}),
  });
  return svg.outerHTML;
}

/** Render a scene to PNG bytes (via SVG → resvg). PNG is what agents can
 * actually look at (image-reading tools take raster, not SVG). Text falls back
 * to a system font — resvg can't consume the embedded woff2 subsets, so font
 * subsetting is skipped entirely here (it's the expensive part of the render);
 * the SVG/viewer paths keep the real Virgil. */
export async function renderExcalidrawPng(jsonText: string): Promise<Uint8Array> {
  const svg = await renderExcalidrawSvg(jsonText, { scale: 2, skipFonts: true });
  const { Resvg } = await import("@resvg/resvg-js");
  const resvg = new Resvg(svg, { font: { loadSystemFonts: true } });
  return resvg.render().asPng();
}
