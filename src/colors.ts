// Minimal ANSI styling for CLI output — no dependency, SGR codes only.
// Enabled only on a TTY; NO_COLOR always wins, FORCE_COLOR enables even when
// piped (https://no-color.org). Checked per call, not at import, so tests can
// set the env after modules load and still get plain strings.

import type { IO } from "./commands.ts";

const on = () =>
  !process.env.NO_COLOR && (!!process.env.FORCE_COLOR || !!process.stdout.isTTY);

const ESC = "\u001b";
const sgr = (open: number, close: number) => (s: string) =>
  on() ? ESC + "[" + open + "m" + s + ESC + "[" + close + "m" : s;

export const bold = sgr(1, 22);
export const dim = sgr(2, 22);
export const red = sgr(31, 39);
export const green = sgr(32, 39);
export const yellow = sgr(33, 39);
export const cyan = sgr(36, 39);

/** Uniform message prefixes, colorized once here so call sites stay plain. */
export const fail = (io: IO, msg: string) => io.err(`${red("error:")} ${msg}`);
export const warn = (io: IO, msg: string) => io.err(`${yellow("warning:")} ${msg}`);
export const note = (io: IO, msg: string) => io.err(`${dim("note:")} ${msg}`);
export const ok = (io: IO, msg: string) => io.out(`${green("✓")} ${msg}`);
