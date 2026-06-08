// Open the viewer. Preferred path = glimpse's native WebView host (on Windows
// its .NET 8 + WebView2 binary, built into node_modules at install/first use).
// We keep native window chrome (resizable/maximizable) and deliver the page via
// NavigateToString (setHTML) when it fits, falling back to a file:// temp file
// (loadFile) only for oversized pages — see present() for the why. If glimpse's
// backend is unavailable, fall back to serving the SAME HTML over a local
// server + the default browser, so `scratch ui` always works.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pad } from "../discovery.ts";
import type { IO } from "../commands.ts";
import { createReloader, type Reloader } from "./reload.ts";

export interface LaunchOpts {
  title: string;
  /** Force the browser viewer instead of the default glimpse native window. */
  forceBrowser?: boolean;
  /** Build the native host on demand if it's missing (never automatic). */
  installNative?: boolean;
  /** Native window without OS chrome (title bar/border). Default true. */
  frameless?: boolean;
}

export async function launchViewer(
  pads: Pad[],
  rootLabel: string,
  io: IO,
  opts: LaunchOpts,
): Promise<number> {
  // The reloader builds the initial page too, so its vendor-needs baseline is
  // primed from exactly what the launched page loaded.
  const reloader = createReloader(pads, rootLabel);
  const snap = await reloader.rebuild();

  // Native glimpse is the default; --browser forces the browser viewer. When the
  // native host isn't built, tryGlimpse prints how to install it and we fall back.
  if (!opts.forceBrowser) {
    const ok = await tryGlimpse(
      snap.html, opts.title, io, reloader, opts.frameless !== false, !!opts.installNative,
    );
    if (ok) return 0;
    io.err("falling back to the browser viewer.");
  }
  return serveBrowser(snap.html, opts.title, io, reloader);
}

// glimpse's WebView2 host is a compiled .NET binary. On a global `bun add -g`
// install Bun blocks glimpseui's postinstall (lifecycle scripts of untrusted —
// and transitive — deps don't run), so the host is never built. We do NOT build
// it automatically: on a plain `scratch ui` we point the user at how to install
// it. `--install-native` builds it on demand (needs the .NET 8 SDK), landing it
// in glimpseui's own native/windows/bin/ where it resolves the host from.
// Returns true when the host is ready to use.
function prepareWindowsHost(io: IO, install: boolean): boolean {
  let root: string;
  try {
    // glimpseui's main is src/glimpse.mjs → its package root is two dirs up.
    root = dirname(dirname(fileURLToPath((import.meta as any).resolve("glimpseui"))));
  } catch {
    return false; // unresolvable (e.g. compiled-binary VFS)
  }
  const hostBin = join(root, "native", "windows", "bin", "glimpse.exe");
  if (existsSync(hostBin)) return true; // already built
  const buildScript = join(root, "scripts", "build.mjs");
  if (!existsSync(buildScript)) return false; // not a real on-disk glimpseui

  if (!install) {
    io.err(
      "note: the native window isn't installed (its WebView2 host isn't built).\n" +
        "  Build it once with `scratch ui --install-native` (needs the .NET 8 SDK),\n" +
        "  or use `scratch ui --browser` for the browser viewer.",
    );
    return false;
  }

  const sdk = spawnSync("dotnet", ["--list-sdks"], { encoding: "utf8" });
  if (sdk.error || sdk.status !== 0 || !sdk.stdout?.trim()) {
    io.err(
      "note: --install-native needs the .NET 8 SDK + WebView2 runtime.\n" +
        "  Install the SDK (https://dotnet.microsoft.com/download/dotnet/8.0), then rerun.",
    );
    return false;
  }

  io.out("note: building the native viewer host (one-time; takes a moment)…");
  // Reuse glimpse's own build script so its publish flags stay authoritative.
  const build = spawnSync(process.execPath, [buildScript, "win32"], { cwd: root, stdio: "inherit" });
  if (build.status !== 0 || !existsSync(hostBin)) {
    io.err("note: native host build failed — check the .NET output above.");
    return false;
  }
  return true;
}

async function tryGlimpse(
  html: string,
  title: string,
  io: IO,
  reloader: Reloader,
  frameless: boolean,
  install: boolean,
): Promise<boolean> {
  // glimpseui resolves its native host relative to its own module file. Inside a
  // `bun build --compile` standalone that module lives in the virtual `B:\~BUN\`
  // FS, so the host path points nowhere and native silently falls back to the
  // browser. Fix: if a host is staged next to the executable (dist/glimpse/, put
  // there by `bun scripts/build-host.ts`), point glimpse at it via the env
  // override it honors (GLIMPSE_BINARY_PATH). In dev (execPath = bun.exe) there's
  // no sibling, so this is a no-op and glimpse resolves from node_modules.
  if (process.platform === "win32" && !process.env.GLIMPSE_BINARY_PATH) {
    const sibling = join(dirname(process.execPath), "glimpse", "glimpse.exe");
    if (existsSync(sibling)) process.env.GLIMPSE_BINARY_PATH = sibling;
    // No staged host (npm/bun install): the host must be built. Never automatic —
    // recommend `--install-native`, or build now if that flag was passed.
    else if (!prepareWindowsHost(io, install)) return false;
  }

  let open: (html: string, options?: Record<string, unknown>) => any;
  try {
    ({ open } = (await import("glimpseui")) as any);
  } catch {
    return false;
  }

  let win: any;
  try {
    // Open with NO initial HTML so the host emits 'ready' (instead of doing its
    // own NavigateToString); we then deliver the page ourselves via present().
    // frameless (config-driven): drop the native title bar/border — the page
    // draws its own close affordance (#closeBtn) + drag strip. Override via the
    // user config file (ui.frameless=false) to keep native chrome.
    win = open("", {
      width: 1280,
      height: 800,
      title,
      frameless,
    });
  } catch (e) {
    io.err(`note: native window unavailable (${(e as Error).message.split("\n")[0]}); using browser.`);
    return false;
  }

  // A temp file is only needed for the loadFile fallback below, so stage it
  // lazily — most pages (CDN-vendored) go the setHTML path and never touch disk.
  let dir: string | null = null;
  let htmlPath = "";
  const cleanupTmp = () => {
    if (dir) void rm(dir, { recursive: true, force: true }).catch(() => {});
  };

  // Prefer setHTML (NavigateToString): renders at the correct monitor DPI and
  // needs no temp file. But it throws past ~2MB and crashes the host (unhandled
  // at Program.cs:233), so cap conservatively and fall back to a file:// load
  // (no size limit) for oversized pages. CDN vendoring keeps pages small.
  const NAV_LIMIT = 1_800_000;
  const present = async (h: string) => {
    if (Buffer.byteLength(h, "utf8") < NAV_LIMIT) {
      win.setHTML(h);
      return;
    }
    if (!dir) {
      dir = await mkdtemp(join(tmpdir(), "scratch-ui-"));
      htmlPath = join(dir, "viewer.html");
    }
    await writeFile(htmlPath, h, "utf8");
    win.loadFile(htmlPath);
  };

  // The host re-emits 'ready' on EVERY navigation (glimpse.mjs case 'ready'), so
  // present exactly once — otherwise each setHTML/loadFile retriggers ready →
  // present → an infinite reload loop.
  let presented = false;
  win.on("ready", () => {
    if (presented) return;
    presented = true;
    void present(html);
  });

  return new Promise<boolean>((resolve) => {
    let settled = false;

    // Manual reload: the page posts {__scratch_reload:true} (its reload button /
    // 'r' key). We rebuild from disk and push a fresh payload — an in-place data
    // patch via __scratchReload (which only re-renders the open file if it
    // actually changed), or, when new vendor bundles are needed, a full re-render
    // delivered through present() (setHTML, or loadFile if oversized).
    win.on("message", async (d: any) => {
      if (!d || !d.__scratch_reload) return;
      try {
        const s = await reloader.rebuild();
        if (s.full) await present(s.html);
        else win.send(`window.__scratchReload(${s.payloadJson})`);
      } catch (e) {
        io.err(`note: reload failed (${(e as Error).message.split("\n")[0]}).`);
      }
    });

    win.on("error", (e: Error) => {
      if (!settled) {
        settled = true;
        cleanupTmp();
        io.err(`note: native window failed (${e.message.split("\n")[0]}); using browser.`);
        resolve(false);
      }
    });
    win.on("closed", () => {
      if (!settled) {
        settled = true;
        cleanupTmp();
        resolve(true);
      }
    });
  });
}

async function serveBrowser(
  html: string,
  title: string,
  io: IO,
  reloader: Reloader,
): Promise<number> {
  // Reload is on-demand (the page's reload button / 'r' just does location.reload),
  // so we rebuild from disk on each page request — every load is fresh, no SSE.
  const server = Bun.serve({
    port: 0,
    async fetch() {
      let body = html; // first paint uses the prebuilt page; reloads rebuild
      try {
        body = (await reloader.rebuild()).html;
      } catch (e) {
        io.err(`note: rebuild failed (${(e as Error).message.split("\n")[0]}); serving last good page.`);
      }
      return new Response(body, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  });
  const url = `http://localhost:${server.port}/`;
  io.out(title);
  io.out(`  serving viewer at ${url}`);
  io.out(`  (reload the page to refresh from disk; Ctrl+C to stop)`);
  openBrowser(url);
  // Keep alive until interrupted.
  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      io.out("\nstopped.");
      server.stop();
      resolve();
    });
  });
  return 0;
}

function openBrowser(url: string): void {
  const p = process.platform;
  const [cmd, args] =
    p === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : p === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // Best-effort; URL was already printed.
  }
}
