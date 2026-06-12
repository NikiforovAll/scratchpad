// Open the viewer. Preferred path = glimpse's native WebView host (on Windows
// its .NET 8 + WebView2 binary, built into node_modules at install/first use).
// We keep native window chrome (resizable/maximizable) and deliver the page via
// NavigateToString (setHTML) when it fits, falling back to a file:// temp file
// (loadFile) only for oversized pages — see present() for the why. If glimpse's
// backend is unavailable, fall back to serving the SAME HTML over a local
// server + the default browser, so `scratch ui` always works.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Pad, resolveEntryPath } from "../discovery.ts";
import type { IO } from "../commands.ts";
import { bold, cyan, dim, note } from "../colors.ts";
import { loadConfig, saveConfig } from "../config.ts";
import { readManifest, sanitizeComments, writeManifest } from "../manifest.ts";
import { createReloader, type Reloader } from "./reload.ts";

// Persist a settings payload posted by the viewer page (WebView2 postMessage or
// POST /settings). saveConfig sanitizes field-by-field, so untrusted/extra keys
// in the payload are simply dropped.
async function persistViewerSettings(payload: unknown, io: IO): Promise<void> {
  if (!payload || typeof payload !== "object") return;
  try {
    const p = payload as {
      themeMode?: unknown;
      colorTheme?: unknown;
      starredThemes?: unknown;
      gridStyle?: unknown;
      wideMode?: unknown;
      zoom?: unknown;
    };
    await saveConfig({
      themeMode: p.themeMode as any,
      colorTheme: p.colorTheme as any,
      starredThemes: p.starredThemes as any,
      gridStyle: p.gridStyle as any,
      wideMode: p.wideMode as any,
      zoom: p.zoom as any,
    });
  } catch (e) {
    note(io, `saving settings failed (${(e as Error).message.split("\n")[0]}).`);
  }
}

// Persist a file's inline comments posted by the viewer page (WebView2
// postMessage or POST /comments) — the manifest-writeback mirror of
// persistViewerSettings. The pad is identified by its dir (a pad's identity),
// the file by its manifest path; the comment array replaces the entry's
// wholesale. Comments are sanitized with the same rules the parser applies, so
// a hostile/buggy page can't write malformed entries. The manifest is re-read
// from disk first so we never clobber metadata edited while the viewer is open
// (last write wins only on the comments themselves).
export async function persistFileComments(pads: Pad[], payload: unknown, io: IO): Promise<void> {
  if (!payload || typeof payload !== "object") return;
  const p = payload as { padDir?: unknown; filePath?: unknown; comments?: unknown };
  if (typeof p.padDir !== "string" || typeof p.filePath !== "string") return;
  const pad = pads.find((x) => x.dir === p.padDir);
  if (!pad) return;
  try {
    const m = await readManifest(pad.dir);
    const entry = m.files.find((f) => f.path === p.filePath);
    if (!entry) return;
    const comments = sanitizeComments(p.comments);
    if (comments.length > 0) entry.comments = comments;
    else delete entry.comments;
    await writeManifest(pad.dir, m);
  } catch (e) {
    note(io, `saving comments failed (${(e as Error).message.split("\n")[0]}).`);
  }
}

// Toggle a GFM task checkbox in a file's CONTENT, posted by the viewer page
// (WebView2 __scratch_checkbox / POST /checkbox). This is the ONE place the CLI
// writes file content rather than just metadata — a deliberate exception to the
// read-only/never-author invariant, scoped to flipping a single "[ ]"/"[x]"
// marker. The edit is line-addressed: the page sends the source line index it
// rendered; we re-read the file from disk, verify that line still IS a task
// marker (the same regex the renderer used), and flip just that char — so a
// drifted line is skipped rather than corrupted, and unrelated content (incl.
// line endings elsewhere) is untouched. The file is resolved via the manifest
// (linked `src` honored), so writes stay scoped to pad-registered files.
const TASK_MARKER = /^(\s*[-*+]\s+\[)([ xX])(\].*)$/;
export async function persistFileCheckbox(pads: Pad[], payload: unknown, io: IO): Promise<void> {
  if (!payload || typeof payload !== "object") return;
  const p = payload as { padDir?: unknown; filePath?: unknown; line?: unknown; checked?: unknown };
  if (
    typeof p.padDir !== "string" || typeof p.filePath !== "string" ||
    typeof p.line !== "number" || !Number.isInteger(p.line) || p.line < 0 ||
    typeof p.checked !== "boolean"
  ) return;
  const pad = pads.find((x) => x.dir === p.padDir);
  if (!pad) return;
  try {
    const m = await readManifest(pad.dir);
    const entry = m.files.find((f) => f.path === p.filePath);
    if (!entry) return;
    const abs = resolveEntryPath(pad.dir, entry);
    const raw = await readFile(abs, "utf8");
    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    const lines = raw.split(/\r?\n/);
    const target = lines[p.line];
    const mt = typeof target === "string" ? target.match(TASK_MARKER) : null;
    if (!mt) return; // line drifted since render — skip rather than corrupt
    lines[p.line] = mt[1] + (p.checked ? "x" : " ") + mt[3];
    await writeFile(abs, lines.join(eol), "utf8");
  } catch (e) {
    note(io, `saving checkbox failed (${(e as Error).message.split("\n")[0]}).`);
  }
}

// Quit from the terminal with 'q', pager-style. Raw mode swallows Ctrl+C as
// \x03, which we route through the same graceful quit — that also stops the
// console from delivering CTRL_C_EVENT to the console-attached WebView2 host
// (abrupt kill mid-teardown is what spews Chromium errors onto our stderr).
// No-op when stdin isn't a TTY (piped/CI). Returns a cleanup function.
function watchQuitKey(quit: () => void): () => void {
  const stdin = process.stdin;
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") return () => {};
  const onData = (b: Buffer) => {
    const s = b.toString();
    if (s === "q" || s === "\x03") quit();
  };
  stdin.setRawMode(true);
  stdin.resume();
  stdin.on("data", onData);
  // Idempotent: quit paths can overlap (q + window close), and re-pausing or
  // un-raw-ing stdin twice must not throw mid-shutdown.
  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    stdin.off("data", onData);
    try {
      stdin.setRawMode(false);
    } catch {}
    stdin.pause();
  };
}

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
  // Writeback handlers shared by both transports.
  const persistComments = (payload: unknown) => persistFileComments(pads, payload, io);
  const persistCheckbox = (payload: unknown) => persistFileCheckbox(pads, payload, io);

  // Native glimpse is the default; --browser forces the browser viewer. When the
  // native host isn't built, tryGlimpse prints how to install it and we fall back.
  if (!opts.forceBrowser) {
    const ok = await tryGlimpse(
      snap.html, opts.title, io, reloader, opts.frameless !== false, !!opts.installNative,
      persistComments, persistCheckbox,
    );
    if (ok) return 0;
    io.err("falling back to the browser viewer.");
  }
  return serveBrowser(snap.html, opts.title, io, reloader, persistComments, persistCheckbox);
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
    note(
      io,
      "the native window isn't installed (its WebView2 host isn't built).\n" +
        "  Build it once with `scratch ui --install-native` (needs the .NET 8 SDK),\n" +
        "  or use `scratch ui --browser` for the browser viewer.",
    );
    return false;
  }

  const sdk = spawnSync("dotnet", ["--list-sdks"], { encoding: "utf8" });
  if (sdk.error || sdk.status !== 0 || !sdk.stdout?.trim()) {
    note(
      io,
      "--install-native needs the .NET 8 SDK + WebView2 runtime.\n" +
        "  Install the SDK (https://dotnet.microsoft.com/download/dotnet/8.0), then rerun.",
    );
    return false;
  }

  io.out(`${dim("note:")} building the native viewer host (one-time; takes a moment)…`);
  // Reuse glimpse's own build script so its publish flags stay authoritative.
  const build = spawnSync(process.execPath, [buildScript, "win32"], { cwd: root, stdio: "inherit" });
  if (build.status !== 0 || !existsSync(hostBin)) {
    note(io, "native host build failed — check the .NET output above.");
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
  persistComments: (payload: unknown) => Promise<void>,
  persistCheckbox: (payload: unknown) => Promise<void>,
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

  // The host inherits our stderr, and on an abrupt shutdown (Ctrl+C in the
  // terminal kills the console-attached host mid-teardown) Chromium logs e.g.
  // "Failed to unregister class Chrome_WidgetWin_0" onto it. WebView2 honors
  // this env var, so silence Chromium's logging in the host we spawn.
  const flag = "--disable-logging";
  const extra = process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS;
  if (!extra?.includes(flag))
    process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = extra ? `${extra} ${flag}` : flag;

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
    note(io, `native window unavailable (${(e as Error).message.split("\n")[0]}); using browser.`);
    return false;
  }

  // The native window has no address bar / terminal output of its own, so echo
  // what was opened — otherwise `scratch ui` looks like it did nothing.
  io.out(bold(title));
  io.out(dim("  opened in a native window — press 'r' or the ⟳ button to reload; 'q' here (or close the window) to exit."));

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
    const stopKeys = watchQuitKey(() => {
      try {
        win.close(); // graceful: host disposes WebView2, then 'closed' fires below
      } catch {}
    });

    // Manual reload: the page posts {__scratch_reload:true} (its reload button /
    // 'r' key). We rebuild from disk and push a fresh payload — an in-place data
    // patch via __scratchReload (which only re-renders the open file if it
    // actually changed), or, when new vendor bundles are needed, a full re-render
    // delivered through present() (setHTML, or loadFile if oversized).
    win.on("message", async (d: any) => {
      if (d && d.__scratch_settings) {
        await persistViewerSettings(d.__scratch_settings, io);
        return;
      }
      // Comment mutations from the page (add/edit/delete) — write the file's
      // comment array back into its pad manifest.
      if (d && d.__scratch_comments) {
        await persistComments(d.__scratch_comments);
        return;
      }
      // Task-checkbox toggle from the page — flip the "[ ]"/"[x]" in the file.
      if (d && d.__scratch_checkbox) {
        await persistCheckbox(d.__scratch_checkbox);
        return;
      }
      // A native WebView2 reload (Ctrl+R/F5) re-renders the HTML string we
      // presented at launch, whose embedded #settings island is frozen at
      // launch-time config. The reloaded page asks us for the authoritative
      // config so it can re-apply settings saved since — keeping the config file
      // the single source of truth (no client-side shadow store).
      if (d && d.__scratch_get_settings) {
        try {
          const cfg = await loadConfig();
          win.send(`window.__scratchSettings(${JSON.stringify(cfg.ui)})`);
        } catch (e) {
          note(io, `settings sync failed (${(e as Error).message.split("\n")[0]}).`);
        }
        return;
      }
      if (!d || !d.__scratch_reload) return;
      try {
        const s = await reloader.rebuild();
        if (s.full) await present(s.html);
        else win.send(`window.__scratchReload(${s.payloadJson})`);
      } catch (e) {
        note(io, `reload failed (${(e as Error).message.split("\n")[0]}).`);
      }
    });

    win.on("error", (e: Error) => {
      if (!settled) {
        settled = true;
        stopKeys();
        cleanupTmp();
        note(io, `native window failed (${e.message.split("\n")[0]}); using browser.`);
        resolve(false);
      }
    });
    win.on("closed", () => {
      if (!settled) {
        settled = true;
        stopKeys();
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
  persistComments: (payload: unknown) => Promise<void>,
  persistCheckbox: (payload: unknown) => Promise<void>,
): Promise<number> {
  // Reload is on-demand (the page's reload button / 'r' just does location.reload),
  // so we rebuild from disk on each page request — every load is fresh, no SSE.
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      // Settings write-back from the page's settings panel (no webview here).
      if (req.method === "POST" && new URL(req.url).pathname === "/settings") {
        await persistViewerSettings(await req.json().catch(() => null), io);
        return new Response(null, { status: 204 });
      }
      // Comment write-back — browser mirror of the WebView2 __scratch_comments path.
      if (req.method === "POST" && new URL(req.url).pathname === "/comments") {
        await persistComments(await req.json().catch(() => null));
        return new Response(null, { status: 204 });
      }
      // Checkbox toggle write-back — browser mirror of __scratch_checkbox.
      if (req.method === "POST" && new URL(req.url).pathname === "/checkbox") {
        await persistCheckbox(await req.json().catch(() => null));
        return new Response(null, { status: 204 });
      }
      let body = html; // first paint uses the prebuilt page; reloads rebuild
      try {
        body = (await reloader.rebuild()).html;
      } catch (e) {
        note(io, `rebuild failed (${(e as Error).message.split("\n")[0]}); serving last good page.`);
      }
      // no-store: the server rebuilds per request (picking up settings just
      // POSTed to /settings), but a cached document would let the browser serve
      // the launch-time page on reload — losing those changes. Force a re-fetch.
      return new Response(body, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store, must-revalidate",
        },
      });
    },
  });
  const url = `http://localhost:${server.port}/`;
  io.out(bold(title));
  io.out(`  serving viewer at ${cyan(url)}`);
  io.out(dim(`  (reload the page to refresh from disk; 'q' or Ctrl+C to stop)`));
  openBrowser(url);
  // Keep alive until quit from the terminal ('q'/Ctrl+C via watchQuitKey when
  // stdin is a TTY, plain SIGINT otherwise).
  await new Promise<void>((resolve) => {
    // stop only ever runs after stopKeys is assigned (event-driven), so the
    // forward reference is safe; the cleanup itself is idempotent.
    const stop = () => {
      stopKeys();
      io.out("\nstopped.");
      server.stop();
      resolve();
    };
    const stopKeys = watchQuitKey(stop);
    process.on("SIGINT", stop);
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
