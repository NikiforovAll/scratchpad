// Config resolution: path precedence + tolerant loading with defaults.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { configPath, loadConfig, saveConfig } from "../src/config.ts";

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
  test("with no env overrides, resolves to ~/.config (no %APPDATA% branch)", () => {
    delete process.env.SCRATCHPAD_CONFIG;
    delete process.env.XDG_CONFIG_HOME;
    process.env.APPDATA = join(dir, "roaming"); // must be IGNORED for determinism
    expect(configPath()).toBe(join(homedir(), ".config", "scratchpad", "config.json"));
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

  test("theme defaults: system mode + ember when no file", async () => {
    process.env.SCRATCHPAD_CONFIG = join(dir, "missing.json");
    const cfg = await loadConfig();
    expect(cfg.ui.themeMode).toBe("system");
    expect(cfg.ui.colorTheme).toBe("ember");
  });

  test("reads valid theme overrides", async () => {
    const f = join(dir, "config.json");
    await writeFile(f, JSON.stringify({ ui: { themeMode: "light", colorTheme: "gruvbox" } }), "utf8");
    process.env.SCRATCHPAD_CONFIG = f;
    const cfg = await loadConfig();
    expect(cfg.ui.themeMode).toBe("light");
    expect(cfg.ui.colorTheme).toBe("gruvbox");
  });

  test("invalid themeMode / unknown colorTheme fall back to defaults", async () => {
    const f = join(dir, "config.json");
    await writeFile(f, JSON.stringify({ ui: { themeMode: "neon", colorTheme: "no-such" } }), "utf8");
    process.env.SCRATCHPAD_CONFIG = f;
    const cfg = await loadConfig();
    expect(cfg.ui.themeMode).toBe("system");
    expect(cfg.ui.colorTheme).toBe("ember");
  });

  test("gridStyle: defaults to dots; reads valid value; rejects garbage", async () => {
    process.env.SCRATCHPAD_CONFIG = join(dir, "missing.json");
    expect((await loadConfig()).ui.gridStyle).toBe("dots");
    const f = join(dir, "config.json");
    process.env.SCRATCHPAD_CONFIG = f;
    await writeFile(f, JSON.stringify({ ui: { gridStyle: "lines" } }), "utf8");
    expect((await loadConfig()).ui.gridStyle).toBe("lines");
    await writeFile(f, JSON.stringify({ ui: { gridStyle: "waffle" } }), "utf8");
    expect((await loadConfig()).ui.gridStyle).toBe("dots"); // unknown → default
  });

  test("zoom: defaults to 1; reads valid value; rejects out-of-range/garbage", async () => {
    process.env.SCRATCHPAD_CONFIG = join(dir, "missing.json");
    expect((await loadConfig()).ui.zoom).toBe(1);
    const f = join(dir, "config.json");
    process.env.SCRATCHPAD_CONFIG = f;
    await writeFile(f, JSON.stringify({ ui: { zoom: 1.3 } }), "utf8");
    expect((await loadConfig()).ui.zoom).toBe(1.3);
    await writeFile(f, JSON.stringify({ ui: { zoom: 9 } }), "utf8");
    expect((await loadConfig()).ui.zoom).toBe(1); // out of 0.5–2
    await writeFile(f, JSON.stringify({ ui: { zoom: "big" } }), "utf8");
    expect((await loadConfig()).ui.zoom).toBe(1);
  });
});

describe("saveConfig", () => {
  test("creates dir + file and round-trips through loadConfig", async () => {
    const f = join(dir, "nested", "config.json"); // parent doesn't exist yet
    process.env.SCRATCHPAD_CONFIG = f;
    await saveConfig({ themeMode: "dark", colorTheme: "tokyo-night", gridStyle: "lines" });
    const cfg = await loadConfig();
    expect(cfg.ui.themeMode).toBe("dark");
    expect(cfg.ui.colorTheme).toBe("tokyo-night");
    expect(cfg.ui.gridStyle).toBe("lines");
    expect(cfg.ui.frameless).toBe(true); // untouched → default
  });

  test("preserves unknown keys and existing ui fields", async () => {
    const f = join(dir, "config.json");
    await writeFile(
      f,
      JSON.stringify({ custom: 1, ui: { frameless: false, future: true } }),
      "utf8",
    );
    process.env.SCRATCHPAD_CONFIG = f;
    await saveConfig({ themeMode: "light" });
    const raw = await Bun.file(f).json();
    expect(raw.custom).toBe(1); // unknown top-level key survives
    expect(raw.ui.future).toBe(true); // unknown ui key survives
    expect(raw.ui.frameless).toBe(false); // untouched existing field survives
    expect(raw.ui.themeMode).toBe("light");
  });

  test("rejects invalid values (payload comes from the viewer page)", async () => {
    const f = join(dir, "config.json");
    process.env.SCRATCHPAD_CONFIG = f;
    await saveConfig({ themeMode: "neon" as any, colorTheme: "no-such" });
    const raw = await Bun.file(f).json();
    expect(raw.ui.themeMode).toBeUndefined();
    expect(raw.ui.colorTheme).toBeUndefined();
  });

  test("zoom round-trips; invalid zoom is dropped", async () => {
    const f = join(dir, "config.json");
    process.env.SCRATCHPAD_CONFIG = f;
    await saveConfig({ zoom: 1.2 });
    expect((await loadConfig()).ui.zoom).toBe(1.2);
    await saveConfig({ zoom: 99 as any });
    expect((await loadConfig()).ui.zoom).toBe(1.2); // bad patch leaves last good value
  });

  test("malformed existing file is replaced, not fatal", async () => {
    const f = join(dir, "config.json");
    await writeFile(f, "{ not json", "utf8");
    process.env.SCRATCHPAD_CONFIG = f;
    await saveConfig({ colorTheme: "solarized" });
    expect((await loadConfig()).ui.colorTheme).toBe("solarized");
  });
});
