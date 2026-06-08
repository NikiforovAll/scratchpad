// pi extension for scratchpad. The `scratch` CLI owns all real logic; this only
// adds the bits the agent can't do over a plain shell call:
//   /scratch ui [pad] [--browser]   launch the (blocking) viewer, detached
//   /scratch export [pad] [-o file] write the standalone HTML, await, report path
//   /scratch stop                   kill viewers this session launched
// Pad selection is shared: bare → interactive picker; typing → tab-completion.
// The CLI is assumed on PATH (install: `bun add -g @nikiforovall/scratchpad`).

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CLI = "scratch";
const IS_WIN = process.platform === "win32";
const INSTALL_HINT =
  "scratch CLI not found on PATH. Install it with `bun add -g @nikiforovall/scratchpad` (needs Bun).";

// Viewers launched this session — kept so /scratch stop can kill them. They're
// detached, so they outlive the command; refs do NOT survive a pi restart.
const viewers = new Set<{ child: ChildProcess; pad: string }>();

const SUBCOMMANDS = ["ui", "export", "stop", "help"] as const;
// Flags that consume the following token as a value — so it isn't mistaken for
// the pad name when we pick the first bare token as the pad.
const VALUE_FLAGS = new Set(["-o", "--out", "--dir"]);

// `shell` resolves the `scratch.cmd`/`.exe` shim on Windows; `windowsHide`
// suppresses the cmd console window that would otherwise flash/stay open.
const SPAWN_OPTS = { shell: IS_WIN, windowsHide: true } as const;

function cliAvailable(): boolean {
  const r = spawnSync(CLI, ["--version"], { encoding: "utf8", ...SPAWN_OPTS });
  return !r.error && r.status === 0;
}

function listPads(): string[] {
  const r = spawnSync(CLI, ["ls"], { encoding: "utf8", ...SPAWN_OPTS });
  if (r.error || r.status !== 0 || !r.stdout) return [];
  // `scratch ls` prints indented "  <name>  (N files)  <path>" rows.
  const pads: string[] = [];
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = line.match(/^\s{2,}(\S+)\s+\(\d+\s+file/);
    if (m) pads.push(m[1]);
  }
  return pads;
}

// Split a subcommand's args into the pad (first bare token, skipping flag
// values) and everything else passed through to the CLI verbatim.
function splitPadAndRest(tokens: string[]): { pad?: string; rest: string[] } {
  let pad: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (VALUE_FLAGS.has(t)) {
      rest.push(t);
      if (tokens[i + 1] !== undefined) rest.push(tokens[++i]);
      continue;
    }
    if (!pad && !t.startsWith("-")) {
      pad = t;
      continue;
    }
    rest.push(t);
  }
  return { pad, rest };
}

// Resolve the target pad: an explicit arg, else an interactive picker (only when
// pi has a UI — print/JSON mode has none, so the pad arg is required there).
async function resolvePad(
  pad: string | undefined,
  ctx: any,
): Promise<string | null> {
  if (pad) return pad;
  if (!ctx.hasUI) {
    ctx.ui.notify("a pad name is required here (no interactive picker in this mode).", "error");
    return null;
  }
  const pads = listPads();
  if (!pads.length) {
    ctx.ui.notify("no scratchpads found under the current root.", "error");
    return null;
  }
  const choice = await ctx.ui.select("Pick a scratchpad:", pads);
  return choice ?? null;
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (IS_WIN) {
    // `scratch ui` spawns children (bun → glimpse host / Bun.serve); /T kills
    // the whole tree so none are orphaned.
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
  } else {
    try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
  }
}

async function launchUi(pad: string, rest: string[], ctx: any): Promise<void> {
  // The viewer is a long-running server/window; we don't await it (unref'd) so
  // pi keeps moving, and keep the ref for /scratch stop. We deliberately do NOT
  // use `detached` on Windows — it forces the child into its own console window
  // (the stray console you'd otherwise see). `windowsHide` hides the cmd shim.
  const child = spawn(CLI, ["ui", pad, ...rest], {
    stdio: ["ignore", "pipe", "pipe"],
    ...SPAWN_OPTS,
  });
  const entry = { child, pad };
  viewers.add(entry);
  child.on("exit", () => viewers.delete(entry));
  child.on("error", () => {
    viewers.delete(entry);
    ctx.ui.notify(INSTALL_HINT, "error");
  });

  // Browser-fallback mode prints a localhost URL; surface it if it appears.
  let urlShown = false;
  child.stdout?.on("data", (b: Buffer) => {
    const m = b.toString().match(/https?:\/\/\S+/);
    if (m && !urlShown) {
      urlShown = true;
      ctx.ui.notify(`scratch viewer: ${m[0]}`, "info");
    }
  });
  child.unref();
  ctx.ui.notify(`opened scratch viewer for "${pad}" — /scratch stop to close it.`, "info");
}

function runExport(pad: string, rest: string[], ctx: any): void {
  // Short-lived: write the HTML and exit, so we await it synchronously.
  const r = spawnSync(CLI, ["export", pad, ...rest], { encoding: "utf8", ...SPAWN_OPTS });
  if (r.error || r.status !== 0) {
    const last = (r.stderr || r.stdout || "").trim().split(/\r?\n/).pop() ?? "unknown error";
    ctx.ui.notify(`export failed: ${last}`, "error");
    return;
  }
  const out = (r.stdout || "").match(/(\S+\.html)\b/i);
  ctx.ui.notify(out ? `exported → ${out[1]}` : `exported "${pad}".`, "info");
}

function stopViewers(ctx: any): void {
  if (!viewers.size) {
    ctx.ui.notify("no scratch viewers running (launched this session).", "info");
    return;
  }
  let n = 0;
  for (const v of [...viewers]) {
    killTree(v.child.pid);
    viewers.delete(v);
    n++;
  }
  ctx.ui.notify(`stopped ${n} scratch viewer(s).`, "info");
}

function showHelp(ctx: any): void {
  ctx.ui.notify(
    "/scratch ui [pad] [--browser]   open the viewer (picker if no pad)\n" +
      "/scratch export [pad] [-o f]    write standalone HTML\n" +
      "/scratch stop                   close viewers opened this session",
    "info",
  );
}

export default function scratchExtension(pi: ExtensionAPI) {
  pi.registerCommand("scratch", {
    description:
      "scratchpad viewer: ui | export | stop. Bare `ui`/`export` show a pad picker; type a pad to target it.",
    getArgumentCompletions: (prefix: string) => {
      const tokens = prefix.split(/\s+/);
      // Completing the subcommand itself.
      if (tokens.length <= 1) {
        return SUBCOMMANDS.filter((s) => s.startsWith(prefix)).map((s) => ({ value: s, label: s }));
      }
      // Completing a pad name for ui/export.
      const sub = tokens[0];
      if (sub === "ui" || sub === "export") {
        const padPrefix = tokens[1] ?? "";
        return listPads()
          .filter((p) => p.startsWith(padPrefix))
          .map((p) => ({ value: `${sub} ${p}`, label: p }));
      }
      return [];
    },
    handler: async (args: string, ctx: any) => {
      const tokens = args.trim().split(/\s+/).filter(Boolean);
      const sub = tokens[0] ?? "help";

      if (sub === "help" || sub === "--help" || sub === "-h") return showHelp(ctx);
      if (sub === "stop") return stopViewers(ctx);
      if (sub !== "ui" && sub !== "export") {
        ctx.ui.notify(`unknown subcommand "${sub}". Try: ui | export | stop`, "error");
        return;
      }

      if (!cliAvailable()) {
        ctx.ui.notify(INSTALL_HINT, "error");
        return;
      }

      const { pad: padArg, rest } = splitPadAndRest(tokens.slice(1));
      const pad = await resolvePad(padArg, ctx);
      if (!pad) return; // cancelled / unavailable — resolvePad already notified

      if (sub === "ui") await launchUi(pad, rest, ctx);
      else runExport(pad, rest, ctx);
    },
  });
}
