// `scratch ui --json`: the browser viewer run by a parent process (cck's pane).

import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "../src/cli.ts";
import { toPosix } from "../src/discovery.ts";

const CLI = resolve(import.meta.dir, "../src/cli.ts");
const quiet = { out: () => {}, err: () => {} };

let root: string;
let child: ChildProcess;
let ready: { url: string; port: number; token: string; pid: number; pads: string[] };

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "scratch-serve-"));
  expect(await run(["new", "p", "--dir", root], quiet)).toBe(0);
  child = spawn(process.execPath, [CLI, "ui", "p", "--dir", root, "--json"], { stdio: ["pipe", "pipe", "pipe"] });
  ready = await new Promise((res, rej) => {
    let buf = "";
    child.stdout!.on("data", (b) => {
      buf += b;
      const nl = buf.indexOf("\n");
      if (nl >= 0) res(JSON.parse(buf.slice(0, nl)));
    });
    child.on("exit", (code) => rej(new Error(`exited ${code}`)));
  });
});

afterAll(async () => {
  child?.kill();
  await rm(root, { recursive: true, force: true });
});

const base = () => `http://127.0.0.1:${ready.port}`;

function rawGet(path: string, host: string): Promise<number> {
  return new Promise((res, rej) => {
    const s = connect(ready.port, "127.0.0.1", () => {
      s.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
    });
    let data = "";
    s.on("data", (b) => (data += b));
    s.on("end", () => res(Number(data.split(" ")[1])));
    s.on("error", rej);
  });
}

test("prints one JSON ready line with a tokened URL", () => {
  expect(ready.url).toBe(`${base()}/?t=${ready.token}`);
  expect(ready.pid).toBe(child.pid!);
  expect(ready.pads).toEqual([toPosix(join(root, "p"))]);
});

test("health answers the pads and pid with the token", async () => {
  const r = await fetch(`${base()}/__scratch/health?t=${ready.token}`);
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ pads: ready.pads, pid: ready.pid });
});

test("the page is served with the token and no referrer", async () => {
  const r = await fetch(ready.url);
  expect(r.status).toBe(200);
  expect(r.headers.get("referrer-policy")).toBe("no-referrer");
});

test("every route rejects a missing or wrong token", async () => {
  for (const path of ["/", "/__scratch/health", "/data", "/events"]) {
    expect((await fetch(`${base()}${path}`)).status).toBe(401);
  }
  expect((await fetch(`${base()}/data?t=nope`)).status).toBe(401);
  const post = await fetch(`${base()}/comments`, { method: "POST", body: "{}", headers: { "content-type": "text/plain" } });
  expect(post.status).toBe(401);
});

test("a non-loopback Host is refused even with the token", async () => {
  expect(await rawGet(`/__scratch/health?t=${ready.token}`, `evil.example:${ready.port}`)).toBe(403);
  expect(await rawGet(`/__scratch/health?t=${ready.token}`, `localhost:${ready.port}`)).toBe(200);
});

test("exits when stdin closes", async () => {
  const exited = new Promise<number | null>((res) => child.on("exit", (code) => res(code)));
  child.stdin!.end();
  expect(await exited).toBe(0);
});
