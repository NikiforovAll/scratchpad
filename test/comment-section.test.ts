// Mapping a viewer comment anchor (rendered-text quote) back onto the SOURCE
// markdown and its enclosing section — what `scratch comments` reads.

import { expect, test } from "bun:test";
import { buildIndex, headingFor, locateComment } from "../src/comments.ts";
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
