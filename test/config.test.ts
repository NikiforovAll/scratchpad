// Config resolution: path precedence + tolerant loading with defaults.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPath, loadConfig } from "../src/config.ts";

let dir: string;
const SAVED = { ...process.env };
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "scratch-cfg-"));
});
afterEach(async () => {
  process.env = { ...SAVED };
  await rm(dir, { recursive: true, force: true });
});

describe("configPath", () => {
  test("SCRATCHPAD_CONFIG wins outright", () => {
    process.env.SCRATCHPAD_CONFIG = join(dir, "custom.json");
    expect(configPath()).toBe(join(dir, "custom.json"));
  });
  test("falls back to XDG_CONFIG_HOME/scratchpad/config.json", () => {
    delete process.env.SCRATCHPAD_CONFIG;
    process.env.XDG_CONFIG_HOME = dir;
    expect(configPath()).toBe(join(dir, "scratchpad", "config.json"));
  });
});

describe("loadConfig", () => {
  test("defaults to frameless:true when no file", async () => {
    process.env.SCRATCHPAD_CONFIG = join(dir, "missing.json");
    expect((await loadConfig()).ui.frameless).toBe(true);
  });
  test("reads ui.frameless override", async () => {
    const f = join(dir, "config.json");
    await writeFile(f, JSON.stringify({ ui: { frameless: false } }), "utf8");
    process.env.SCRATCHPAD_CONFIG = f;
    expect((await loadConfig()).ui.frameless).toBe(false);
  });
  test("malformed file falls back to defaults", async () => {
    const f = join(dir, "config.json");
    await writeFile(f, "{ not json", "utf8");
    process.env.SCRATCHPAD_CONFIG = f;
    expect((await loadConfig()).ui.frameless).toBe(true);
  });
});
