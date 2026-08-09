// Grades a run by pushing its output through the REAL viewer — render the page,
// then boot it in happy-dom and run its client script, exactly as the DOM tests
// do. That matters: markdown is rendered in the browser, not in renderHtml, so
// anything that inspects the HTML string alone is grading a different artifact
// than the one the user looks at. An assertion like "the ← markers actually
// chip" is only worth stating if the renderer is the thing answering it.
//
//   bun run _evals/callstack-skill/scripts/grade.ts <iteration-dir>
//
// Writes grading.json into each run directory.

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { mkdir, readdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { buildView, renderHtml } from "../../../src/ui/render.ts";
import { newManifest, writeManifest, readManifest } from "../../../src/manifest.ts";
import type { Pad } from "../../../src/discovery.ts";

const CS_FENCE = /^```callstack[ \t]*$([\s\S]*?)^```[ \t]*$/gm;
const MERMAID_FENCE = /^```mermaid[ \t]*$/m;
const SIGILS = "+-~";
const CHANGE_KINDS = ["cs-new", "cs-del", "cs-mod"];

type Check = { text: string; passed: boolean; evidence: string };
type Painted = { text: string; badges: { cls: string; text: string }[] };

async function walkMd(dir: string, out: string[] = []): Promise<string[]> {
  let entries: string[];
  try { entries = await readdir(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    if ((await stat(p)).isDirectory()) await walkMd(p, out);
    else if (e.endsWith(".md")) out.push(p);
  }
  return out;
}

async function renderPage(content: string): Promise<string> {
  const dir = join(tmpdir(), "cs-grade-" + Math.random().toString(36).slice(2));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "doc.md"), content, "utf8");
  const m = newManifest("P");
  m.files.push({ path: "doc.md", title: "Doc", type: "note" });
  await writeManifest(dir, m);
  const pad: Pad = { dir, manifest: await readManifest(dir) };
  const html = await renderHtml(await buildView([pad]), "P");
  await rm(dir, { recursive: true, force: true });
  return html;
}

/** Boot the page in happy-dom and read back what the callstack blocks became.
 * Mirrors test/ui-dom.test.ts boot(): stub the CDN libs, strip their tags, copy
 * the <html> attributes across, then execute the app script. */
async function paint(html: string): Promise<Painted[]> {
  GlobalRegistrator.register();
  try {
    const w = globalThis as any;
    delete w.chrome;
    w.hljs = { highlightElement: (el: any) => el.classList.add("hljs") };
    w.mermaid = { initialize() {}, run() {} };
    w.katex = { render: (_t: string, el: any) => el.setAttribute("data-rendered", "1") };
    w.matchMedia = () => ({ matches: true, addEventListener() {}, addListener() {} });
    const slim = html
      .replace(/<link\b[^>]*\bcrossorigin\b[^>]*>/g, "")
      .replace(/<script>[\s\S]*?<\/script>/g, (m) => (m.includes("buildTree()") ? m : "<script></script>"));
    const rootTag = /<html([^>]*)>/.exec(slim)?.[1] ?? "";
    for (const [, name, , value] of rootTag.matchAll(/([\w-]+)(="([^"]*)")?/g)) {
      if (name && name !== "lang") document.documentElement.setAttribute(name, value ?? "");
    }
    document.documentElement.innerHTML = slim
      .replace(/^[\s\S]*?<html[^>]*>/, "")
      .replace(/<\/html>[\s\S]*$/, "");
    for (const s of Array.from(document.querySelectorAll("script"))) {
      if (s.textContent?.includes("buildTree()")) (0, eval)(s.textContent);
    }
    return Array.from(document.querySelectorAll("#preview pre code.cs")).map((code) => ({
      text: code.textContent ?? "",
      badges: Array.from(code.querySelectorAll(".cs-b")).map((b) => ({
        cls: Array.from(b.classList).find((c) => c !== "cs-b") ?? "",
        text: b.textContent ?? "",
      })),
    }));
  } finally {
    await GlobalRegistrator.unregister();
  }
}

function gradeDoc(src: string, blocks: Painted[], evalName: string): Check[] {
  const fences = [...src.matchAll(CS_FENCE)].map((m) => m[1].replace(/^\n/, "").replace(/\n$/, ""));
  const lines = fences.flatMap((f) => f.split("\n"));
  const marked = lines.filter((l) => l.includes("←"));
  const badges = blocks.flatMap((b) => b.badges);
  const checks: Check[] = [];
  const add = (text: string, passed: boolean, evidence: string) => checks.push({ text, passed, evidence });

  if (evalName === "restraint-shape-not-path") {
    add("Does not reach for a call stack — this is system shape, not a call path",
      fences.length === 0,
      fences.length === 0 ? "no ```callstack fence in the note" : `${fences.length} callstack fence(s) present`);
    add("Uses a mermaid diagram for the shape of the system",
      MERMAID_FENCE.test(src), MERMAID_FENCE.test(src) ? "```mermaid fence present" : "no mermaid fence");
    return checks;
  }

  add("Tags the fence ```callstack so the viewer paints it", fences.length > 0,
    fences.length > 0 ? `${fences.length} fence(s)` : "no ```callstack fence — the tree renders as flat plain text");
  if (fences.length === 0) return checks;

  const ascii = lines.filter((l) => /\|--|\+--|`--|\|\s{2,}\S/.test(l));
  add("Draws with box-drawing guides, not ASCII art the painter cannot read",
    ascii.length === 0, ascii.slice(0, 2).join(" / ") || "guides are box-drawing chars");

  add("Every ← annotation actually renders as a badge", marked.length === badges.length,
    `${marked.length} ← line(s) in source, ${badges.length} badge(s) painted`);

  add("At most one ← note per line, at the end",
    !lines.some((l) => (l.match(/←/g) || []).length > 1),
    lines.filter((l) => (l.match(/←/g) || []).length > 1).slice(0, 2).join(" / ") || "no line carries two ←");

  const badSigil = marked.filter((l) => {
    const c = l.slice(l.lastIndexOf("←") + 1).trim()[0];
    return c !== undefined && /[^\w(]/.test(c) && !SIGILS.includes(c);
  });
  add("Sigils are drawn only from + - ~", badSigil.length === 0,
    badSigil.slice(0, 2).join(" / ") || "no out-of-grammar sigils");

  const kinds = new Set(badges.map((b) => b.cls));
  if (evalName === "change-path-with-sigils") {
    add("Marks the added gate green (+), the deleted path red (-) and the reworked call amber (~)",
      CHANGE_KINDS.every((k) => kinds.has(k)), `badge kinds painted: ${[...kinds].sort().join(", ") || "none"}`);
  }
  if (evalName === "plain-trace-no-changes") {
    const claimed = [...kinds].filter((k) => k !== "cs-neu");
    add("Uses no change sigils — nothing changed, so a trace claims nothing", claimed.length === 0,
      claimed.length ? `claimed change with: ${claimed.join(", ")}` : "no +/-/~ badges");
  }

  const wide = lines.filter((l) => l.length > 100);
  add("Keeps lines under ~100 chars so annotations do not scroll off-screen", wide.length === 0,
    wide.length ? `${wide.length} line(s), longest ${Math.max(...wide.map((l) => l.length))}` : "widest line fits");

  const exact = fences.length === blocks.length && fences.every((f, i) => blocks[i].text === f);
  add("Painting is lossless — the block copies back byte-for-byte", exact,
    exact ? "textContent matches source" : `${blocks.length} block(s) painted for ${fences.length} fence(s), or text differs`);

  return checks;
}

const iter = process.argv[2];
if (!iter) { console.error("usage: grade.ts <iteration-dir>"); process.exit(2); }

type Row = { eval: string; passed: number; total: number; failed: string[]; tokens: number; ms: number };
const rows: Row[] = [];

for (const evalDir of (await readdir(iter)).sort()) {
  const runDir = join(iter, evalDir);
  if (!(await stat(runDir)).isDirectory()) continue;
  const evalName = evalDir.replace(/^eval-\d+-/, "");
  const docs = await walkMd(join(runDir, "outputs"));
  let checks: Check[];
  if (!docs.length) {
    checks = [{ text: "Produced a note", passed: false, evidence: "no .md file under outputs/" }];
  } else {
    // Grade the union of the notes — a pad may split prose and diagram.
    const src = (await Promise.all(docs.map((d) => readFile(d, "utf8")))).join("\n\n");
    checks = gradeDoc(src, await paint(await renderPage(src)), evalName);
  }
  await writeFile(join(runDir, "grading.json"),
    JSON.stringify({ eval_name: evalName, files: docs.map((d) => basename(d)), expectations: checks }, null, 2) + "\n", "utf8");
  let timing = { total_tokens: 0, duration_ms: 0 };
  try { timing = JSON.parse(await readFile(join(runDir, "timing.json"), "utf8")); } catch {}
  rows.push({ eval: evalName, passed: checks.filter((c) => c.passed).length, total: checks.length,
    failed: checks.filter((c) => !c.passed).map((c) => c.text), tokens: timing.total_tokens, ms: timing.duration_ms });
  console.log(`\n${evalDir}: ${checks.filter((c) => c.passed).length}/${checks.length}`);
  for (const c of checks) console.log(`   ${c.passed ? "PASS" : "FAIL"}  ${c.text}\n         ${c.evidence}`);
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const summary = { evals: rows.length, evals_fully_passed: rows.filter((r) => r.passed === r.total).length,
  assertions_passed: sum(rows.map((r) => r.passed)), assertions_total: sum(rows.map((r) => r.total)),
  total_tokens: sum(rows.map((r) => r.tokens)), total_duration_s: +(sum(rows.map((r) => r.ms)) / 1000).toFixed(1) };
await writeFile(join(iter, "benchmark.json"), JSON.stringify({ skill_name: "scratch (callstack)", summary, runs: rows }, null, 2) + "\n", "utf8");

const md = ["# Callstack eval — " + basename(iter), "",
  `**${summary.evals_fully_passed}/${summary.evals} evals clean** · ${summary.assertions_passed}/${summary.assertions_total} assertions · ` +
  `${summary.total_tokens} tokens · ${summary.total_duration_s}s`, "",
  "| eval | score | failed |", "|---|---|---|",
  ...rows.map((r) => `| ${r.eval} | ${r.passed}/${r.total} | ${r.failed.join("; ") || "—"} |`), ""].join("\n");
await writeFile(join(iter, "benchmark.md"), md, "utf8");
console.log("\n" + md);
