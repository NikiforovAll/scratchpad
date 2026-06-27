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
