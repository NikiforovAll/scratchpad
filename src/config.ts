// User-level configuration. Window/viewer preferences (not pad data) live here,
// so the same choice applies across every scratchpad on the machine.
//
// Resolution (first hit wins):
//   1. $SCRATCHPAD_CONFIG            — explicit file path override
//   2. $XDG_CONFIG_HOME/scratchpad/config.json
//   3. ~/.config/scratchpad/config.json
// Deterministic per machine: ~/.config is the canonical home on every platform
// (Windows included). We deliberately do NOT branch to %APPDATA% — that made the
// path depend on which env a launch inherited (a shell with XDG_CONFIG_HOME set
// vs. a bare Windows process), so settings saved from one launch went missing in
// another. The namespace dir is "scratchpad" to match the package/repo name.

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { COLOR_THEME_IDS, DEFAULT_COLOR_THEME } from "./ui/theme.ts";

export type ThemeMode = "dark" | "light" | "system";
export type GridStyle = "off" | "dots" | "lines";

export interface ScratchConfig {
  ui: {
    /** glimpse native window without OS title bar/border (page draws its own
     * close button + drag strip). Default true; set false to keep native chrome. */
    frameless: boolean;
    /** Viewer light/dark resolution. "system" follows prefers-color-scheme. */
    themeMode: ThemeMode;
    /** Color theme id from COLOR_THEMES (settings > theme). */
    colorTheme: string;
    /** Background grid drawn in the preview margins around the reading card. */
    gridStyle: GridStyle;
    /** Wide reading column: roomier card that still leaves a margin (default false). */
    wideMode: boolean;
    /** Viewer zoom factor (CSS zoom on the root), 0.5–2. Neither WebView2 nor a
     * random-port browser origin remembers zoom across launches, so we own it. */
    zoom: number;
  };
}

const DEFAULTS: ScratchConfig = {
  ui: {
    frameless: true,
    themeMode: "system",
    colorTheme: DEFAULT_COLOR_THEME,
    gridStyle: "dots",
    wideMode: false,
    zoom: 1,
  },
};

function validThemeMode(v: unknown): v is ThemeMode {
  return v === "dark" || v === "light" || v === "system";
}
function validColorTheme(v: unknown): v is string {
  return typeof v === "string" && COLOR_THEME_IDS.includes(v);
}
function validGridStyle(v: unknown): v is GridStyle {
  return v === "off" || v === "dots" || v === "lines";
}
function validZoom(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0.5 && v <= 2;
}

/** Absolute path of the config file `scratch` reads (whether or not it exists). */
export function configPath(): string {
  const explicit = process.env.SCRATCHPAD_CONFIG;
  if (explicit) return explicit;
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, "scratchpad", "config.json");
  return join(homedir(), ".config", "scratchpad", "config.json");
}

/** Load + merge over defaults. A missing or malformed file is non-fatal (defaults). */
export async function loadConfig(): Promise<ScratchConfig> {
  try {
    const raw = await Bun.file(configPath()).json();
    return {
      ui: {
        frameless:
          typeof raw?.ui?.frameless === "boolean" ? raw.ui.frameless : DEFAULTS.ui.frameless,
        themeMode: validThemeMode(raw?.ui?.themeMode) ? raw.ui.themeMode : DEFAULTS.ui.themeMode,
        colorTheme: validColorTheme(raw?.ui?.colorTheme)
          ? raw.ui.colorTheme
          : DEFAULTS.ui.colorTheme,
        gridStyle: validGridStyle(raw?.ui?.gridStyle)
          ? raw.ui.gridStyle
          : DEFAULTS.ui.gridStyle,
        wideMode:
          typeof raw?.ui?.wideMode === "boolean" ? raw.ui.wideMode : DEFAULTS.ui.wideMode,
        zoom: validZoom(raw?.ui?.zoom) ? raw.ui.zoom : DEFAULTS.ui.zoom,
      },
    };
  } catch {
    return DEFAULTS;
  }
}

/** Persist a partial ui update. The patch arrives from the viewer page (webview
 * postMessage / POST /settings), so it's sanitized field-by-field: only known
 * keys with valid values are written. Unknown keys already in the file — both
 * top-level and under ui — are preserved (hand-edited config survives). */
export async function saveConfig(patch: Partial<ScratchConfig["ui"]>): Promise<void> {
  const file = configPath();
  let raw: Record<string, unknown> = {};
  try {
    const parsed = await Bun.file(file).json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed;
  } catch {
    // missing/malformed → start fresh
  }
  const ui =
    raw.ui && typeof raw.ui === "object" && !Array.isArray(raw.ui)
      ? (raw.ui as Record<string, unknown>)
      : {};
  if (typeof patch.frameless === "boolean") ui.frameless = patch.frameless;
  if (validThemeMode(patch.themeMode)) ui.themeMode = patch.themeMode;
  if (validColorTheme(patch.colorTheme)) ui.colorTheme = patch.colorTheme;
  if (validGridStyle(patch.gridStyle)) ui.gridStyle = patch.gridStyle;
  if (typeof patch.wideMode === "boolean") ui.wideMode = patch.wideMode;
  if (validZoom(patch.zoom)) ui.zoom = patch.zoom;
  raw.ui = ui;
  await mkdir(dirname(file), { recursive: true });
  await Bun.write(file, JSON.stringify(raw, null, 2) + "\n");
}
