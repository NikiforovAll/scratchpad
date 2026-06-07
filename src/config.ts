// User-level configuration. Window/viewer preferences (not pad data) live here,
// so the same choice applies across every scratchpad on the machine.
//
// Resolution (first hit wins):
//   1. $SCRATCHPAD_CONFIG            — explicit file path override
//   2. $XDG_CONFIG_HOME/scratchpad/config.json
//   3. %APPDATA%\scratchpad\config.json    (Windows)
//   4. ~/.config/scratchpad/config.json
// The namespace dir is "scratchpad" to match the package/repo name.

import { homedir } from "node:os";
import { join } from "node:path";

export interface ScratchConfig {
  ui: {
    /** glimpse native window without OS title bar/border (page draws its own
     * close button + drag strip). Default true; set false to keep native chrome. */
    frameless: boolean;
  };
}

const DEFAULTS: ScratchConfig = { ui: { frameless: true } };

/** Absolute path of the config file `scratch` reads (whether or not it exists). */
export function configPath(): string {
  const explicit = process.env.SCRATCHPAD_CONFIG;
  if (explicit) return explicit;
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, "scratchpad", "config.json");
  if (process.platform === "win32" && process.env.APPDATA) {
    return join(process.env.APPDATA, "scratchpad", "config.json");
  }
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
      },
    };
  } catch {
    return DEFAULTS;
  }
}
