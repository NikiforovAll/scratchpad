// src/colors.ts — enablement is decided per call from the environment.

import { expect, test } from "bun:test";
import { bold, red } from "../src/colors.ts";

test("NO_COLOR yields plain strings", () => {
  process.env.NO_COLOR = "1";
  expect(red("x")).toBe("x");
  expect(bold("x")).toBe("x");
});

test("FORCE_COLOR wraps in SGR codes even when piped", () => {
  delete process.env.NO_COLOR;
  process.env.FORCE_COLOR = "1";
  try {
    expect(red("x")).toBe("[31mx[39m");
    expect(bold("x")).toBe("[1mx[22m");
  } finally {
    delete process.env.FORCE_COLOR;
    process.env.NO_COLOR = "1"; // restore the suite-wide default from test/setup.ts
  }
});
