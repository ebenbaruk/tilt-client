// The Tilt companion: the table as a full-screen terminal app, meant for a split pane next to any
// coding agent. It learns when the agent works only from ~/.tilt/agent.json (written by the
// harness's turn hooks through bin/tilt-signal) and never reads prompts, code or transcripts.
// It writes the one-line status to ~/.tilt/status.txt for harnesses that only have a status line.
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  TiltSession,
  fileStore,
  openInBrowser,
  renderPanel,
  renderStatusLine,
  watchAgentSignal,
  type Snapshot,
} from "../../packages/play/src/index";
import { decodeKeys, type KeyEvent } from "./keys";

const TILT_DIR = join(homedir(), ".tilt");
const STATUS_PATH = join(TILT_DIR, "status.txt");
const STATUS_WIDTH = 80;
const PRIVATE_FILE = 0o600;

const ENTER_SCREEN = "\x1b[?1049h\x1b[?25l";
const LEAVE_SCREEN = "\x1b[?25h\x1b[?1049l";
const HOME = "\x1b[H";
const CLEAR_LINE_END = "\x1b[K";
const CLEAR_BELOW = "\x1b[J";

const { stdin, stdout } = process;

let session: TiltSession | null = null;
let isScreenTaken = false;
let isLogoutArmed = false;
let note: string | null = null;
let lastStatus: string | null = null;
const cleanups: (() => void)[] = [];

function main(): void {
  const apiUrl = process.env.TILT_API_URL;
  if (!apiUrl) fail("Set TILT_API_URL to your Tilt API (https, or http on localhost).");
  if (!stdin.isTTY || !stdout.isTTY) fail("tilt needs an interactive terminal.");

  const created = new TiltSession({ apiUrl, store: fileStore(), openUrl: openInBrowser });
  // A fresh session only carries a message when it refused the API URL (not https, not loopback).
  const refusal = created.snapshot().auth;
  if (refusal.status === "out" && refusal.message) fail(refusal.message);
  session = created;
  takeScreen();
  cleanups.push(created.onChange(() => redraw(created)));
  cleanups.push(watchAgentSignal((isWorking) => created.setAgent(isWorking)));
  stdout.on("resize", () => redraw(created));
  stdin.on("data", (chunk: Buffer) => handleKeys(created, decodeKeys(chunk.toString("utf8"))));
  for (const signal of ["SIGTERM", "SIGHUP"] as const) process.on(signal, quit);
  created.setVisible(true);
  created.start();
  redraw(created);
}

function fail(message: string): never {
  process.stderr.write(`tilt: ${message}\n`);
  process.exit(1);
}

function takeScreen(): void {
  isScreenTaken = true;
  stdin.setRawMode(true);
  stdin.resume();
  stdout.write(ENTER_SCREEN);
}

/** Runs on every exit path (quit, crash, signal) so the terminal is never left in raw mode. */
function restoreScreen(): void {
  if (!isScreenTaken) return;
  isScreenTaken = false;
  stdin.setRawMode(false);
  stdin.pause();
  stdout.write(LEAVE_SCREEN);
}

function quit(): void {
  for (const cleanup of cleanups.splice(0)) cleanup();
  session?.setVisible(false);
  session?.stop();
  process.exit(0);
}

function handleKeys(current: TiltSession, events: KeyEvent[]): void {
  for (const event of events) {
    if (event.kind === "quit") return quit();
    note = null;
    if (event.kind === "account") handleAccount(current);
    else {
      isLogoutArmed = false;
      current.press(event.key);
    }
  }
  redraw(current);
}

/** Ctrl+L: log in when logged out; otherwise log out (or cancel a pending login) on a second press. */
function handleAccount(current: TiltSession): void {
  if (current.snapshot().auth.status === "out") {
    isLogoutArmed = false;
    current.login().catch(showError);
    return;
  }
  if (!isLogoutArmed) {
    isLogoutArmed = true;
    return;
  }
  isLogoutArmed = false;
  current.logout().catch(showError);
}

function showError(error: unknown): void {
  note = error instanceof Error ? error.message : String(error);
  if (session) redraw(session);
}

function redraw(current: TiltSession): void {
  const snapshot = current.snapshot();
  draw(snapshot);
  writeStatus(snapshot);
}

function draw(snapshot: Snapshot): void {
  const width = Math.max(1, stdout.columns ?? STATUS_WIDTH);
  const panel = renderPanel(snapshot, { color: Boolean(stdout.isTTY), width, loginHint: "ctrl+l" });
  const lines = [...panel, footer(snapshot).slice(0, width)];
  const rows = stdout.rows ?? lines.length;
  const visible = lines.slice(0, Math.max(1, rows));
  stdout.write(HOME + visible.join(`${CLEAR_LINE_END}\r\n`) + CLEAR_LINE_END + CLEAR_BELOW);
}

function footer(snapshot: Snapshot): string {
  if (note) return note;
  if (isLogoutArmed) {
    return snapshot.auth.status === "pending"
      ? "Ctrl+L again to cancel the login · any key to keep it"
      : "Ctrl+L again to log out · any key to stay";
  }
  const account = snapshot.auth.status === "out" ? "Ctrl+L log in" : "Ctrl+L log out";
  return `${account} · Ctrl+C quit`;
}

/** Atomic (temp file + rename) so a status line never reads half a line. */
function writeStatus(snapshot: Snapshot): void {
  const status = renderStatusLine(snapshot, {
    color: false,
    width: STATUS_WIDTH,
    loginHint: "ctrl+l in the Tilt pane",
  });
  if (status === lastStatus) return;
  lastStatus = status;
  const temp = `${STATUS_PATH}.${process.pid}.tmp`;
  try {
    mkdirSync(TILT_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(temp, `${status}\n`, { mode: PRIVATE_FILE });
    renameSync(temp, STATUS_PATH);
  } catch (error) {
    note = `Could not write ${STATUS_PATH}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** A stale status would claim a table that is gone; tilt-status falls back to its hint instead. */
function removeStatus(): void {
  if (lastStatus !== null) rmSync(STATUS_PATH, { force: true });
}

process.on("exit", () => {
  restoreScreen();
  removeStatus();
});
process.on("uncaughtException", (error) => {
  restoreScreen();
  process.stderr.write(`tilt: ${error.stack ?? error.message}\n`);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  restoreScreen();
  process.stderr.write(`tilt: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}\n`);
  process.exit(1);
});

main();
