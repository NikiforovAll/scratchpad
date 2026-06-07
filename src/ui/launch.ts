// Open the viewer. Preferred path = glimpse's native WebView host (on Windows
// its .NET 8 + WebView2 binary, built into node_modules at install/first use).
// We open it FRAMELESS on Windows so there is no system title bar — the page
// supplies its own chrome (a draggable top bar + a close button). If glimpse's
// backend is unavailable, fall back to serving the SAME HTML over a local
// server + the default browser, so `scratch ui` always works.

import { spawn } from "node:child_process";
import type { Pad } from "../discovery.ts";
import type { IO } from "../commands.ts";
import { createReloader, type Reloader } from "./reload.ts";

export interface LaunchOpts {
  title: string;
  forceBrowser?: boolean;
}

export async function launchViewer(
  pads: Pad[],
  rootLabel: string,
  io: IO,
  opts: LaunchOpts,
): Promise<number> {
  // The reloader builds the initial page too, so its bundle-needs baseline is
  // primed from exactly what the launched page inlined.
  const reloader = createReloader(pads, rootLabel);
  const snap = await reloader.rebuild();

  if (!opts.forceBrowser) {
    const ok = await tryGlimpse(snap.html, opts.title, io, reloader);
    if (ok) return 0;
  }
  return serveBrowser(snap.html, opts.title, io, reloader);
}

async function tryGlimpse(html: string, title: string, io: IO, reloader: Reloader): Promise<boolean> {
  let open: (html: string, options?: Record<string, unknown>) => any;
  try {
    ({ open } = (await import("glimpseui")) as any);
  } catch {
    return false;
  }

  let win: any;
  try {
    // Frameless on Windows → no system title bar; the page draws its own
    // draggable bar + close button (see render.ts).
    win = open(html, {
      width: 1280,
      height: 800,
      title,
      frameless: process.platform === "win32",
    });
  } catch (e) {
    io.err(`note: native window unavailable (${(e as Error).message.split("\n")[0]}); using browser.`);
    return false;
  }
  return new Promise<boolean>((resolve) => {
    let settled = false;

    // Hot reload: on file change, push a fresh payload into the live window. The
    // host swallows the 'ready' event when opened with initial HTML, so instead
    // the loaded page posts {__scratch_ready:true}; only then is it safe to send
    // an eval calling the page's __scratchReload (or re-load the whole page when
    // new vendor bundles are needed).
    let stopWatch: (() => void) | null = null;
    win.on("message", (d: any) => {
      if (!d || !d.__scratch_ready || stopWatch) return;
      stopWatch = reloader.watch(async () => {
        try {
          const s = await reloader.rebuild();
          if (s.full) win.setHTML(s.html);
          else win.send(`window.__scratchReload(${s.payloadJson})`);
        } catch (e) {
          io.err(`note: reload failed (${(e as Error).message.split("\n")[0]}).`);
        }
      });
    });

    win.on("error", (e: Error) => {
      if (!settled) {
        settled = true;
        stopWatch?.();
        io.err(`note: native window failed (${e.message.split("\n")[0]}); using browser.`);
        resolve(false);
      }
    });
    win.on("closed", () => {
      if (!settled) {
        settled = true;
        stopWatch?.();
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
  let currentHtml = html;
  // Live SSE subscribers. Each is the page's EventSource('/events') connection;
  // on a file change we push the new data payload (or a 'full' nudge to reload).
  const clients = new Set<ReadableStreamDefaultController>();
  const enc = new TextEncoder();

  const stopWatch = reloader.watch(async () => {
    try {
      const s = await reloader.rebuild();
      currentHtml = s.html;
      const frame = s.full
        ? "event: full\ndata: reload\n\n"
        : `data: ${s.payloadJson}\n\n`;
      for (const c of clients) {
        try {
          c.enqueue(enc.encode(frame));
        } catch {
          clients.delete(c);
        }
      }
    } catch (e) {
      io.err(`note: reload failed (${(e as Error).message.split("\n")[0]}).`);
    }
  });

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/events") {
        let self: ReadableStreamDefaultController;
        const stream = new ReadableStream({
          start(controller) {
            self = controller;
            clients.add(controller);
            controller.enqueue(enc.encode(": connected\n\n"));
          },
          cancel() {
            clients.delete(self);
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        });
      }
      return new Response(currentHtml, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  });
  const url = `http://localhost:${server.port}/`;
  io.out(title);
  io.out(`  serving viewer at ${url}`);
  io.out(`  (live reload on; Ctrl+C to stop)`);
  openBrowser(url);
  // Keep alive until interrupted.
  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      io.out("\nstopped.");
      stopWatch();
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
