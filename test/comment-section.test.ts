// Mapping a viewer comment anchor (rendered-text quote) back onto the SOURCE
// markdown and its enclosing section — what `scratch comments` reads.

import { expect, test } from "bun:test";
import { buildIndex, headingFor, locateComment, toCommentItems } from "../src/comments.ts";
import type { Comment } from "../src/manifest.ts";

const locate = (src: string, c: Comment) => locateComment(buildIndex(src), c);

const DOC = `# Title

Intro paragraph.

## Design

The **renderer** uses a [pinned CDN](https://x.com) for hljs.
Whitespace collapses across lines.

## Risks

There is a known Windows blink issue.

\`\`\`js
// # not a heading
const x = 1;
\`\`\`
`;

const cmt = (quote: string): Comment => ({
  id: "c1",
  body: "note",
  anchor: { quote, prefix: "", suffix: "" },
  created: "2026-06-12T00:00:00Z",
  updated: "2026-06-12T00:00:00Z",
});

test("matches a quote whose source had inline markdown stripped", () => {
  // "renderer" is **bold** and "pinned CDN" is a link in the source.
  const r = locate(DOC, cmt("renderer uses a pinned CDN for hljs"));
  expect(r.matched).toBe(true);
  expect(r.line).toBe(7);
  expect(r.heading).toBe("Design");
});

test("context is the enclosing block, not the whole heading section", () => {
  const r = locate(DOC, cmt("renderer uses a pinned CDN for hljs"));
  // The two-line paragraph, both lines, but NOT the "## Design" heading.
  expect(r.contextLines).toEqual([7, 8]);
  expect(r.context).toContain("renderer");
  expect(r.context).toContain("Whitespace collapses across lines.");
  expect(r.context).not.toContain("## Design");
});

test("matches a quote that spans two source lines (paragraph collapse)", () => {
  const r = locate(DOC, cmt("for hljs. Whitespace collapses across lines."));
  expect(r.matched).toBe(true);
  expect(r.line).toBe(7);
  expect(r.endLine).toBe(8);
  expect(r.heading).toBe("Design");
});

test("does not treat a '#' inside a fenced code block as a heading", () => {
  // The "// # not a heading" line belongs to the Risks section, not a new one.
  expect(headingFor(buildIndex(DOC), 16).heading).toBe("Risks");
});

test("wikilinks strip to their display text, matching what mdInline would render", () => {
  // [[name]] projects to "name"; [[name|Display]] projects to just "Display" —
  // so a viewer comment anchored across either form still re-finds its quote.
  const doc = "# H\n\nSee [[other-note]] and [[other-note|the other note]] here.\n";
  const bare: Comment = {
    id: "x", body: "n",
    anchor: { quote: "See other-note and", prefix: "", suffix: "" },
    created: "2026-06-12T00:00:00Z", updated: "2026-06-12T00:00:00Z",
  };
  expect(locate(doc, bare).matched).toBe(true);
  expect(locate(doc, bare).line).toBe(3);
  const aliased = { ...bare, anchor: { quote: "the other note here", prefix: "", suffix: "" } };
  expect(locate(doc, aliased).matched).toBe(true);
  expect(locate(doc, aliased).line).toBe(3);
});

test("prefix/suffix disambiguate a quote that occurs more than once", () => {
  // "cat" appears on line 3 and line 5; suffix " ran" must pick the line-5 one.
  const doc = "# H\n\nThe cat sat here.\n\nThe cat ran fast.\n";
  const c: Comment = {
    id: "x", body: "n",
    anchor: { quote: "cat", prefix: "The ", suffix: " ran" },
    created: "2026-06-12T00:00:00Z", updated: "2026-06-12T00:00:00Z",
  };
  expect(locate(doc, c).line).toBe(5);
  // With no distinguishing suffix it falls back to the first occurrence.
  expect(locate(doc, { ...c, anchor: { quote: "cat", prefix: "", suffix: "" } }).line).toBe(3);
});

test("a quote not present in the source is reported as orphaned", () => {
  const r = locate(DOC, cmt("this text never appears anywhere"));
  expect(r.matched).toBe(false);
  expect(r.line).toBeNull();
  expect(r.context).toBeNull();
  expect(r.heading).toBeNull();
});

test("content above a heading still reports its nearest heading for orientation", () => {
  const r = locate(DOC, cmt("Intro paragraph."));
  expect(r.matched).toBe(true);
  expect(r.heading).toBe("Title");
  expect(r.context).toBe("Intro paragraph.");
});

// toCommentItems is the shared flattener behind `scratch comments --json` AND the
// viewer's copy-comments shortcut — the shape both must emit identically.
test("toCommentItems flattens a matched comment into the CLI/viewer item shape", () => {
  const items = toCommentItems("notes.md", DOC, [cmt("renderer uses a pinned CDN for hljs")]);
  expect(items).toEqual([
    {
      id: "c1",
      file: "notes.md",
      comment: "note",
      quote: "renderer uses a pinned CDN for hljs",
      matched: true,
      line: 7,
      section_heading: "Design",
      context: "The **renderer** uses a [pinned CDN](https://x.com) for hljs.\nWhitespace collapses across lines.",
      context_lines: "7-8",
    },
  ]);
});

test("toCommentItems reports an orphaned comment with null locate fields", () => {
  const items = toCommentItems("notes.md", DOC, [cmt("this text never appears anywhere")]);
  expect(items[0]).toMatchObject({
    matched: false,
    line: null,
    section_heading: null,
    context: null,
    context_lines: null,
  });
});

test("toCommentItems collapses quote whitespace and preserves manifest order", () => {
  const items = toCommentItems("notes.md", DOC, [
    cmt("Risks"),
    { ...cmt("Intro\n   paragraph."), id: "c2" },
  ]);
  expect(items.map((i) => i.id)).toEqual(["c1", "c2"]);
  expect(items[1]!.quote).toBe("Intro paragraph."); // inner whitespace run collapsed
});

// --- HTML sources -------------------------------------------------------------
// A comment can also be anchored inside a standalone .html preview, where the
// viewer captured the quote from the AUTHOR's own document. Same anchor shape,
// different un-rendering: tags out, entities back to characters.

const PAGE = `<!doctype html>
<html><head><style>.a { content: "styled text"; }</style></head>
<body>
  <h2>Threat <em>model</em></h2>
  <p>The <b>token</b> is short-lived &amp; rotated hourly.</p>
  <!-- reviewer note: commented-out text -->
  <script>var generated = "script text";</script>
</body></html>
`;

test("locates an html-anchored quote with its element and nearest heading", () => {
  const items = toCommentItems("guide.html", PAGE, [cmt("short-lived & rotated hourly")]);
  expect(items[0]).toMatchObject({
    matched: true,
    line: 5,
    section_heading: "Threat model", // inner <em> stripped
    context: "<p>The <b>token</b> is short-lived &amp; rotated hourly.</p>",
    context_lines: "5-5",
  });
});

test("html quote matches across inline tags", () => {
  // In the rendered page "The token is" is one text run; in the source a <b> splits it.
  expect(toCommentItems("guide.html", PAGE, [cmt("The token is short-lived")])[0]!.matched).toBe(true);
});

test("html projection ignores script, style and comment text", () => {
  // None of these are displayed, so a quote can never legitimately come from them —
  // matching there would point an agent at the wrong line entirely.
  for (const quote of ["script text", "styled text", "commented-out text"]) {
    expect(toCommentItems("guide.html", PAGE, [cmt(quote)])[0]!.matched).toBe(false);
  }
});

test("markdown syntax is literal text in an html page, not stripped", () => {
  const src = "<body><p>use _snake_case_ and **stars**</p></body>";
  expect(toCommentItems("page.html", src, [cmt("use _snake_case_ and **stars**")])[0]!.matched).toBe(true);
});

test("an out-of-range numeric entity is left as written, not thrown on", () => {
  // fromCodePoint throws past 0x10FFFF, and this projection runs during `scratch ui`
  // / `export` render — one bad reference must not take the command down.
  const src = "<body><p>a &#1114112; b</p></body>";
  expect(() => toCommentItems("p.html", src, [cmt("x")])).not.toThrow();
  expect(toCommentItems("p.html", src, [cmt("a &#1114112; b")])[0]!.matched).toBe(true);
});

test("a heading pretty-printed across lines still orients its comments", () => {
  const src = "<body>\n  <h2>\n    Overview\n  </h2>\n  <p>body text here</p>\n</body>";
  const it = toCommentItems("p.html", src, [cmt("body text here")])[0]!;
  expect(it.section_heading).toBe("Overview");
  expect(it.line).toBe(5);
});

test("numeric and named entities decode to the rendered character", () => {
  const src = "<body><p>caf&#233;s &lt;3 &quot;quotes&quot;</p></body>";
  expect(toCommentItems("p.html", src, [cmt('cafés <3 "quotes"')])[0]!.matched).toBe(true);
});
