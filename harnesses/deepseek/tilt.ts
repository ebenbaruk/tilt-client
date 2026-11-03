// Tilt for DeepSeek Harness (dsh): a Cordis plugin. `agent/status` (running/idle, no content)
// drives the table's agent state and the companion's turn file; `/tilt` opens the table as a
// TUI overlay that takes the keys, or answers with the table as text where no TUI is mounted.
// No prompt, reply, tool call or session event is ever read.
import { TiltSession, fileStore, openInBrowser, renderPanel, writeAgentSignal } from "../../packages/play/src/index";
import type { Agent, CommandResult, DshContext, TuiService } from "./dsh";

export const name = "tilt";
export const inject = ["commands"];

// Command answers have no width to read: a width that fits most terminals and the web view.
const TEXT_WIDTH = 72;
// The overlay's columns; the TUI narrows it to the terminal.
const OVERLAY_WIDTH = 80;
const HOTKEY = /^[a-z0-9]$/;
const ESCAPE = "\u001b";
const CTRL_C = "\u0003";
const OVERLAY_HINT = "esc · back to the prompt";
const NO_TUI =
  "No live table in this front end: /tilt <key> plays a key, or run harnesses/companion/bin/tilt in a split.";
const NO_API_URL = "Tilt needs TILT_API_URL (or `apiUrl` in the tilt row's config). Set it, then restart dsh.";
const USAGE = "Usage: /tilt · /tilt table · /tilt login · /tilt logout · /tilt <key>";

export function apply(ctx: DshContext, config: unknown): void {
  const working = followAgents(ctx);
  // Fail closed: no host is ever guessed.
  const apiUrl = configuredApiUrl(config) ?? process.env.TILT_API_URL?.trim();
  if (!apiUrl) {
    registerTilt(ctx, () => ({ kind: "error", text: NO_API_URL }));
    return;
  }

  const tilt = new TiltSession({ apiUrl, store: fileStore(), openUrl: openInBrowser });
  // Sponsor time counts only while the overlay is open.
  tilt.setVisible(false);
  ctx.effect(() => {
    tilt.start();
    const stopFollowing = working.subscribe((isWorking) => tilt.setAgent(isWorking));
    return () => {
      stopFollowing();
      tilt.stop();
    };
  });
  registerTilt(ctx, (rawInput) => runCommand(ctx, tilt, working, rawInput));
}

function registerTilt(ctx: DshContext, handler: (rawInput: string) => CommandResult | Promise<CommandResult>): void {
  ctx.commands.register({
    name: "tilt",
    description: "Play Tilt while the agent works",
    input: { hint: "[table|login|logout|<key>]" },
    handler: ({ rawInput }) => handler(rawInput),
  });
}

async function runCommand(
  ctx: DshContext,
  tilt: TiltSession,
  working: Working,
  rawInput: string,
): Promise<CommandResult> {
  const result = await answer(ctx, tilt, rawInput.trim().toLowerCase());
  const error = working.lastError();
  if (error === null) return result;
  const text = `${result.text ?? ""}\n(could not write ~/.tilt/agent.json: ${error})`.trim();
  return result.kind === "error" ? { kind: "error", text } : { kind: "success", text };
}

async function answer(ctx: DshContext, tilt: TiltSession, word: string): Promise<CommandResult> {
  if (word === "login") return login(tilt);
  if (word === "logout") {
    await tilt.logout();
    return { kind: "success", text: "Signed out of Tilt." };
  }
  if (word === "table") return { kind: "success", text: tableText(tilt) };
  if (HOTKEY.test(word)) {
    return tilt.press(word)
      ? { kind: "success", text: `Pressed ${word}. /tilt table shows the result.` }
      : { kind: "error", text: `Key ${word} is not offered now. See /tilt table.` };
  }
  if (word !== "") return { kind: "error", text: USAGE };

  const tui = ctx.get("tui");
  if (tui === undefined) return { kind: "success", text: `${tableText(tilt)}\n${NO_TUI}` };
  openTable(tui, tilt);
  return { kind: "success" };
}

async function login(tilt: TiltSession): Promise<CommandResult> {
  if (tilt.snapshot().auth.status === "in") return { kind: "success", text: "Already signed in to Tilt." };
  await tilt.login();
  const { auth } = tilt.snapshot();
  if (auth.status === "pending") return { kind: "success", text: `Confirm code ${auth.userCode} at ${auth.verifyUrl}` };
  if (auth.status === "out") return { kind: "error", text: auth.message ?? "Tilt login did not start." };
  return { kind: "success", text: "Signed in to Tilt." };
}

/** The table as a modal overlay: it takes every key until Esc closes it. */
function openTable(tui: TuiService, tilt: TiltSession): void {
  tui.openOverlay({
    options: { anchor: "center", width: OVERLAY_WIDTH, maxHeight: "90%" },
    create: (host) => {
      tilt.setVisible(true);
      const stopDrawing = tilt.onChange(() => host.invalidate());
      host.signal.addEventListener(
        "abort",
        () => {
          stopDrawing();
          tilt.setVisible(false);
        },
        { once: true },
      );
      return {
        // The core cleans every API string it draws, so these lines carry only its own styling.
        render: (width) => [
          ...renderPanel(tilt.snapshot(), { color: true, width }),
          OVERLAY_HINT.padEnd(width).slice(0, width),
        ],
        handleInput: (data) => {
          if (data === ESCAPE || data === CTRL_C) host.close();
          else if (HOTKEY.test(data.toLowerCase())) tilt.press(data.toLowerCase());
        },
        invalidate: () => {},
      };
    },
  });
}

const tableText = (tilt: TiltSession): string =>
  renderPanel(tilt.snapshot(), { color: false, width: TEXT_WIDTH })
    .map((line) => line.trimEnd())
    .join("\n");

function configuredApiUrl(config: unknown): string | undefined {
  if (typeof config !== "object" || config === null || !("apiUrl" in config)) return undefined;
  const { apiUrl } = config;
  return typeof apiUrl === "string" && apiUrl.trim() !== "" ? apiUrl.trim() : undefined;
}

interface Working {
  subscribe(listener: (isWorking: boolean) => void): () => void;
  lastError(): string | null;
}

/**
 * Whether any agent (the main one or a subagent) is between `running` and `idle`. Also kept in
 * ~/.tilt/agent.json, so the companion (harnesses/companion) follows dsh where no TUI is mounted.
 */
function followAgents(ctx: DshContext): Working {
  const running = new Set<Agent>();
  const listeners = new Set<(isWorking: boolean) => void>();
  let isWorking = false;
  let lastError: string | null = null;

  const sync = (): void => {
    if (isWorking === running.size > 0) return;
    isWorking = running.size > 0;
    for (const listener of listeners) listener(isWorking);
    writeAgentSignal(isWorking ? "working" : "idle").then(
      () => (lastError = null),
      (error: unknown) => (lastError = error instanceof Error ? error.message : String(error)),
    );
  };

  ctx.on("agent/status", ({ agent, status }) => {
    if (status === "running") running.add(agent);
    else running.delete(agent);
    sync();
  });
  ctx.on("agent/disposed", ({ agent }) => {
    running.delete(agent);
    sync();
  });
  // Unloaded mid-turn, no idle will come: leave the companion idle rather than stuck working.
  ctx.effect(() => () => {
    running.clear();
    sync();
  });

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      listener(isWorking);
      return () => listeners.delete(listener);
    },
    lastError: () => lastError,
  };
}
