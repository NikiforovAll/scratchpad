// .excalidraw support: server-side scene → SVG rendering (src/excalidraw.ts),
// viewer/export embedding via buildView (kind flips to "image" with a data-URI
// SVG — exports carry no excalidraw code), and the `scratch preview` command.

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.ts";
import { parseScene, renderExcalidrawSvg } from "../src/excalidraw.ts";
import { buildView, renderHtml } from "../src/ui/render.ts";
import { persistExcalidrawScene } from "../src/ui/launch.ts";
import { writeManifest, newManifest } from "../src/manifest.ts";
import type { IO } from "../src/commands.ts";

// Minimal hand-written scene — restoreElements fills the rest of the element
// shape, so this doubles as coverage for scenes not authored by the editor.
const SCENE = JSON.stringify({
  type: "excalidraw",
  version: 2,
  elements: [
    { id: "r1", type: "rectangle", x: 10, y: 10, width: 120, height: 60 },
    {
      id: "t1", type: "text", x: 20, y: 30, width: 100, height: 25,
      text: "hello pad", originalText: "hello pad", fontSize: 20, fontFamily: 1,
      textAlign: "left", verticalAlign: "top", containerId: null,
      autoResize: true, lineHeight: 1.25,
    },
  ],
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
});

let root: string;
let log: string[];
let errs: string[];
const io: IO = { out: (s) => log.push(s), err: (s) => errs.push(s) };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "scratch-exca-"));
  log = [];
  errs = [];
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
// Rendering registers happy-dom globally (src/excalidraw.ts ensureDom) and never
// unregisters — fine for the CLI process, but ui-dom.test.ts boots its own
// window per test and register() throws if one is already up. Clean the slate.
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

describe("parseScene", () => {
  test("rejects non-JSON and non-scene JSON", () => {
    expect(() => parseScene("not json")).toThrow("not valid JSON");
    expect(() => parseScene('{"foo":1}')).toThrow("elements");
  });
});

describe("renderExcalidrawSvg", () => {
  test("renders a self-contained SVG with text and embedded font", async () => {
    const svg = await renderExcalidrawSvg(SCENE);
    expect(svg).toStartWith("<svg");
    expect(svg).toContain("hello pad");
    expect(svg).toContain("<path"); // the rectangle stroke
    // font subset embedded as data URI → no network needed to render text
    expect(svg).toContain("data:font/woff2;base64,");
    expect(svg).not.toContain("https://");
  });

  test("embedScene stores the scene payload for excalidraw round-trip", async () => {
    const svg = await renderExcalidrawSvg(SCENE, { embedScene: true });
    expect(svg).toContain("payload-type:application/vnd.excalidraw+json");
  });
});

describe("buildView with .excalidraw", () => {
  async function makePad(sceneText: string) {
    const dir = join(root, "pad");
    await Bun.write(join(dir, "drawing.excalidraw"), sceneText);
    const manifest = newManifest("pad");
    manifest.files.push({ path: "drawing.excalidraw" });
    await writeManifest(dir, manifest);
    return { dir, manifest };
  }

  test("valid scene embeds as an SVG image (no excalidraw code in the page)", async () => {
    const pad = await makePad(SCENE);
    const [view] = await buildView([pad]);
    const f = view!.files[0]!;
    expect(f.kind).toBe("image");
    expect(f.content).toStartWith("data:image/svg+xml;base64,");
    const svg = Buffer.from(f.content!.split(",")[1]!, "base64").toString();
    expect(svg).toContain("hello pad");
    // the raw scene rides along — the live viewer's in-place editor opens from it
    expect(f.source).toBe(SCENE);
  });

  test("empty scene (the init path) flags a placeholder, keeps the edit path", async () => {
    // The skill's starting point: an agent writes this one-liner, the user draws
    // in the viewer. A blank SVG stretched full-width is invisible, so the view
    // carries emptyScene (client shows a notice) — but kind=image + source stay,
    // because the ✏️ edit button requires them.
    const empty = JSON.stringify({ type: "excalidraw", version: 2, elements: [], appState: {}, files: {} });
    const pad = await makePad(empty);
    const [view] = await buildView([pad]);
    const f = view!.files[0]!;
    expect(f.kind).toBe("image");
    expect(f.emptyScene).toBe(true);
    expect(f.content).toBeNull();
    expect(f.source).toBe(empty);
  });

  test("editor CDN island ships in the live page only — exports carry no excalidraw refs", async () => {
    const pad = await makePad(SCENE);
    const view = await buildView([pad]);
    const live = await renderHtml(view, "Pad");
    expect(live).toContain('id="exca-cdn"');
    const exported = await renderHtml(view, "Pad", undefined, { exportMode: true });
    // the client script keeps its getElementById('exca-cdn') probe — what must
    // be gone is the island itself and with it every CDN url
    expect(exported).not.toContain('id="exca-cdn"');
    expect(exported).not.toContain("esm.sh");
    expect(exported).not.toContain("@excalidraw");
    // the raw scene JSON stays in both: the live editor reads it, `scratch import` restores from it
    expect(live).toContain('"source":');
    expect(exported).toContain('"source":');
  });

  test("unrenderable scene falls back to raw JSON source", async () => {
    const pad = await makePad('{"broken": true}');
    const [view] = await buildView([pad]);
    const f = view!.files[0]!;
    expect(f.kind).toBe("code");
    expect(f.lang).toBe("json");
    expect(f.content).toContain("broken");
  });
});

describe("persistExcalidrawScene", () => {
  async function makePad() {
    const dir = join(root, "pad");
    await Bun.write(join(dir, "drawing.excalidraw"), SCENE);
    await Bun.write(join(dir, "notes.md"), "# n\n");
    const manifest = newManifest("pad");
    manifest.files.push({ path: "drawing.excalidraw" }, { path: "notes.md" });
    await writeManifest(dir, manifest);
    return { dir, manifest };
  }

  test("writes a valid edited scene back to the file", async () => {
    const pad = await makePad();
    const edited = JSON.stringify({ type: "excalidraw", version: 2, elements: [], appState: {}, files: {} });
    const okWrite = await persistExcalidrawScene(
      [pad],
      { padDir: pad.dir, filePath: "drawing.excalidraw", scene: edited },
      io,
    );
    expect(okWrite).toBe(true);
    expect(await Bun.file(join(pad.dir, "drawing.excalidraw")).text()).toBe(edited);
  });

  test("rejects a payload that is not a scene — file untouched", async () => {
    const pad = await makePad();
    const okWrite = await persistExcalidrawScene(
      [pad],
      { padDir: pad.dir, filePath: "drawing.excalidraw", scene: '{"nope":1}' },
      io,
    );
    expect(okWrite).toBe(false);
    expect(await Bun.file(join(pad.dir, "drawing.excalidraw")).text()).toBe(SCENE);
  });

  test("only .excalidraw manifest entries are writable", async () => {
    const pad = await makePad();
    const scene = JSON.stringify({ elements: [] });
    // registered, but not an .excalidraw file
    expect(await persistExcalidrawScene([pad], { padDir: pad.dir, filePath: "notes.md", scene }, io)).toBe(false);
    expect(await Bun.file(join(pad.dir, "notes.md")).text()).toBe("# n\n");
    // unregistered path / unknown pad / junk payloads
    expect(await persistExcalidrawScene([pad], { padDir: pad.dir, filePath: "other.excalidraw", scene }, io)).toBe(false);
    expect(await persistExcalidrawScene([pad], { padDir: "elsewhere", filePath: "drawing.excalidraw", scene }, io)).toBe(false);
    expect(await persistExcalidrawScene([pad], null, io)).toBe(false);
    expect(await persistExcalidrawScene([pad], { padDir: pad.dir, filePath: "drawing.excalidraw", scene: 42 }, io)).toBe(false);
  });
});

describe("scratch preview", () => {
  test("writes a PNG under the OS temp dir by default and prints its path", async () => {
    const src = join(root, "diagram.excalidraw");
    await writeFile(src, SCENE);
    const code = await run(["preview", src], io);
    expect(code).toBe(0);
    // The printed path is the contract — agents read the image from it.
    const m = log.join("\n").match(/→ (\S+\.png)/);
    expect(m).not.toBeNull();
    const out = m![1]!;
    expect(out).toContain("scratch-preview/");
    expect(out).toContain("diagram-");
    expect(existsSync(out)).toBe(true);
    const bytes = new Uint8Array(await Bun.file(out).arrayBuffer());
    // PNG magic
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    // deterministic per source path — re-preview overwrites, no pile-up
    log = [];
    await run(["preview", src], io);
    expect(log.join("\n")).toContain(out);
  });

  test("-o out.svg writes the editable scene-embedded SVG twin", async () => {
    const src = join(root, "diagram.excalidraw");
    await writeFile(src, SCENE);
    const out = join(root, "diagram.excalidraw.svg");
    const code = await run(["preview", src, "-o", out], io);
    expect(code).toBe(0);
    const svg = await Bun.file(out).text();
    expect(svg).toStartWith("<svg");
    expect(svg).toContain("payload-type:application/vnd.excalidraw+json");
  });

  test("-o - prints the SVG to stdout", async () => {
    const src = join(root, "diagram.excalidraw");
    await writeFile(src, SCENE);
    const code = await run(["preview", src, "-o", "-"], io);
    expect(code).toBe(0);
    expect(log.join("\n")).toStartWith("<svg");
  });

  test("errors cleanly on missing file and invalid scene", async () => {
    expect(await run(["preview", join(root, "nope.excalidraw")], io)).toBe(1);
    expect(errs.join("\n")).toContain("no such file");
    const bad = join(root, "bad.excalidraw");
    await writeFile(bad, "not json");
    expect(await run(["preview", bad], io)).toBe(1);
    expect(errs.join("\n")).toContain("cannot render");
    expect(await run(["preview"], io)).toBe(2);
  });
});
