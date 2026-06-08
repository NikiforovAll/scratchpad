// Headless-DOM tests: load the rendered viewer HTML into happy-dom, execute its
// client script, and assert the interactive behavior the user asked for —
// markdown rendering, mermaid blocks, syntax-highlight wiring, raw/rendered
// toggle, and auto-detected theme. (Mermaid's own SVG render needs a real
// browser, so we stub window.mermaid and assert it's invoked.)

import { afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildView, renderHtml } from "../src/ui/render.ts";
import { newManifest, writeManifest, readManifest } from "../src/manifest.ts";
import type { Pad } from "../src/discovery.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "scratch-dom-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function renderPad(): Promise<string> {
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "doc.md"),
    "# Heading\n\nText **bold**.\n\n```ts\nconst x = 1;\n```\n\n```mermaid\ngraph TD; A-->B;\n```\n",
    "utf8",
  );
  const m = newManifest("P");
  m.files.push({ path: "doc.md", title: "Doc", description: "a doc", tags: ["t"], type: "note" });
  await writeManifest(dir, m);
  const pad: Pad = { dir, manifest: await readManifest(dir) };
  return renderHtml(await buildView([pad]), "P");
}

/** Boot happy-dom, inject HTML, stub vendor libs, run the page's inline script. */
async function boot(html: string, seedStorage?: Record<string, string>) {
  GlobalRegistrator.register();
  const w = globalThis as any;
  // Seed localStorage BEFORE the page script runs (it reads prefs at startup).
  if (seedStorage) for (const [k, v] of Object.entries(seedStorage)) localStorage.setItem(k, v);
  // Stub vendored libs (their real bundles are huge / need a real browser).
  const mermaidCalls: any[] = [];
  w.hljs = { highlightElement: (el: any) => el.classList.add("hljs") };
  w.mermaid = {
    initialize: (cfg: any) => mermaidCalls.push(["init", cfg]),
    run: (opts: any) => mermaidCalls.push(["run", opts?.nodes?.length ?? 0]),
  };
  // Simulate a dark-preferring OS (happy-dom's own matchMedia returns false).
  w.matchMedia = () => ({ matches: true, addEventListener() {}, addListener() {} });
  // Neutralize attribute-less inline <script> blocks except the app script (has
  // buildTree()). The vendor libs are CDN <script src=…> tags (we stubbed
  // window.hljs/mermaid above and there's no network here), and the data island
  // carries a type attribute — both have attributes, so this regex leaves them be.
  const slim = html
    // Drop CDN <link> stylesheets (hljs themes) — no network in happy-dom.
    .replace(/<link\b[^>]*\bcrossorigin\b[^>]*>/g, "")
    .replace(/<script>[\s\S]*?<\/script>/g, (m) =>
      m.includes("buildTree()") ? m : "<script></script>",
    );
  document.documentElement.innerHTML = slim
    .replace(/^[\s\S]*?<html[^>]*>/, "")
    .replace(/<\/html>[\s\S]*$/, "");
  // Execute every inline <script> in order (skip the JSON data island).
  for (const s of Array.from(document.querySelectorAll("script"))) {
    if (s.getAttribute("type") === "application/json") continue;
    // strip vendor bundles (we stubbed them); run only the app script
    if (s.textContent && s.textContent.includes("buildTree()")) {
      try {
        // eslint-disable-next-line no-eval
        (0, eval)(s.textContent);
      } catch (e) {
        console.error("APP SCRIPT THREW:", (e as Error).stack || e);
        throw e;
      }
    }
  }
  return { mermaidCalls };
}

function teardown() {
  GlobalRegistrator.unregister();
}

test("renders markdown, highlights code, invokes mermaid, builds tree", async () => {
  const html = await renderPad();
  const { mermaidCalls } = await boot(html);
  try {
    const preview = document.getElementById("preview")!;
    // markdown rendered to a heading
    expect(preview.querySelector(".md h1")?.textContent).toContain("Heading");
    // code block present + highlight wiring ran (stub adds .hljs)
    const code = preview.querySelector("pre code");
    expect(code).not.toBeNull();
    expect(code!.classList.contains("hljs")).toBe(true);
    // mermaid block emitted + mermaid.run invoked with 1 node
    expect(preview.querySelector(".mermaid")).not.toBeNull();
    expect(mermaidCalls.some((c) => c[0] === "run" && c[1] === 1)).toBe(true);
    // metadata strip
    expect(preview.querySelector(".pmeta")?.textContent).toContain("#t");
    // tree built with the file row
    expect(document.querySelector(".frow")?.textContent).toContain("Doc");
  } finally {
    teardown();
  }
});

test("groups files under group headers, keeping ungrouped under FILES", async () => {
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  for (const n of ["a.md", "b.md", "c.md"]) await writeFile(join(dir, n), "# " + n + "\n", "utf8");
  const m = newManifest("P");
  // Mixed: one ungrouped, two sharing "Appendix" — first-appearance order kept.
  m.files.push({ path: "a.md", title: "A", type: "note" });
  m.files.push({ path: "b.md", title: "B", type: "note", group: "Appendix" });
  m.files.push({ path: "c.md", title: "C", type: "note", group: "Appendix" });
  await writeManifest(dir, m);
  const pad: Pad = { dir, manifest: await readManifest(dir) };
  const html = await renderHtml(await buildView([pad]), "P");
  await boot(html);
  try {
    const labels = Array.from(document.querySelectorAll(".tree .label")).map((l) => l.textContent);
    expect(labels).toEqual(["FILES", "Appendix"]);
    // The "Appendix" header is followed by its two rows.
    const rows = Array.from(document.querySelectorAll(".frow")).map((r) => r.querySelector(".fttl")?.textContent);
    expect(rows).toEqual(["A", "B", "C"]);
  } finally {
    teardown();
  }
});

test("fence languages with special chars normalize to hljs grammar names", async () => {
  const dir = join(root, "p");
  await mkdir(dir, { recursive: true });
  // ```c# / ```c++ used to break: the fence regex dropped the # / +, and even when
  // captured, "language-c#" made hljs parse only "c". Both must become csharp/cpp.
  await writeFile(
    join(dir, "doc.md"),
    "# H\n\n```c#\npublic class Foo {}\n```\n\n```c++\nint main(){}\n```\n",
    "utf8",
  );
  const m = newManifest("P");
  m.files.push({ path: "doc.md", title: "Doc", type: "note" });
  await writeManifest(dir, m);
  const pad: Pad = { dir, manifest: await readManifest(dir) };
  const html = await renderHtml(await buildView([pad]), "P");
  await boot(html);
  try {
    const langs = Array.from(document.querySelectorAll("#preview pre code")).map(
      (c) => (c.className.match(/language-(\S+)/) || [])[1],
    );
    expect(langs).toContain("csharp");
    expect(langs).toContain("cpp");
  } finally {
    teardown();
  }
});

test("raw/rendered toggle swaps between source and rendered markdown", async () => {
  const html = await renderPad();
  await boot(html);
  try {
    const preview = document.getElementById("preview")!;
    expect(preview.querySelector(".md")).not.toBeNull(); // rendered by default
    (document.getElementById("vRaw") as any).click();
    expect(preview.querySelector(".md")).toBeNull();
    expect(preview.querySelector("pre.code")?.textContent).toContain("# Heading"); // raw source
    (document.getElementById("vRendered") as any).click();
    expect(preview.querySelector(".md")).not.toBeNull(); // back to rendered
  } finally {
    teardown();
  }
});

test("auto-detects dark theme from prefers-color-scheme", async () => {
  const html = await renderPad();
  await boot(html); // matchMedia stub returns matches:true (dark)
  try {
    expect(document.documentElement.dataset.theme).toBe("dark");
  } finally {
    teardown();
  }
});

test("a saved theme overrides the OS and toggling persists the choice", async () => {
  const html = await renderPad();
  // OS prefers dark (matchMedia stub), but a remembered 'light' must win.
  await boot(html, { "scratch.theme": "light" });
  try {
    expect(document.documentElement.dataset.theme).toBe("light");
    // Toggling writes the new choice back to storage.
    (document.getElementById("themeToggle") as any).click();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("scratch.theme")).toBe("dark");
  } finally {
    teardown();
  }
});

test("in-place reload shows a toast (success on change, info when unchanged)", async () => {
  const html = await renderPad();
  await boot(html);
  try {
    const toast = document.getElementById("toast")!;
    const w = globalThis as any;
    // The app script parsed the data island into its internal DATA; reuse it.
    const data = JSON.parse(document.getElementById("data")!.textContent!);

    // Identical payload → no changes → info toast.
    w.__scratchReload(data);
    expect(toast.classList.contains("visible")).toBe(true);
    expect(toast.classList.contains("toast-info")).toBe(true);
    expect(toast.textContent).toContain("No changes");

    // Changed payload → reloaded → success toast (variant swaps, not stacks).
    const changed = JSON.parse(JSON.stringify(data));
    changed.pads[0].files[0].content = "# Changed\n";
    w.__scratchReload(changed);
    expect(toast.classList.contains("visible")).toBe(true);
    expect(toast.classList.contains("toast-success")).toBe(true);
    expect(toast.classList.contains("toast-info")).toBe(false);
    expect(toast.textContent).toContain("Reloaded from disk");
  } finally {
    teardown();
  }
});
