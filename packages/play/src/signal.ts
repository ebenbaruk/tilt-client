// The turn signal a harness's hook scripts share with the table: whether the coding agent works,
// and since when. Nothing else about the turn (prompt, code, tools) is ever written here.
import { type FSWatcher, watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import { writeJsonAtomic } from "./store";

export const AGENT_SIGNAL_PATH = join(homedir(), ".tilt", "agent.json");

export type AgentState = "working" | "idle";

export interface AgentSignal {
  state: AgentState;
  /** Unix seconds of the write. */
  at: number;
}

/** A `working` older than this was left by a harness that died mid-turn: it reads as idle. */
const STALE_WORKING_S = 6 * 60 * 60;
/** fs.watch misses events on some file systems (network mounts, some containers): the file is read this often anyway. */
const POLL_MS = 2_000;

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

export async function readAgentSignal(path: string = AGENT_SIGNAL_PATH): Promise<AgentSignal | null> {
  let value: unknown;

  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }

  if (typeof value !== "object" || value === null || !("state" in value) || !("at" in value)) {
    return null;
  }

  const { state, at } = value;

  return (state === "working" || state === "idle") && typeof at === "number" && Number.isFinite(at)
    ? { state, at }
    : null;
}

export function writeAgentSignal(state: AgentState, path: string = AGENT_SIGNAL_PATH): Promise<void> {
  return writeJsonAtomic(path, { state, at: nowSeconds() } satisfies AgentSignal);
}

/**
 * Calls `listener` with whether the agent works now, then on every change, until the returned
 * function is called.
 */
export function watchAgentSignal(listener: (isWorking: boolean) => void, path: string = AGENT_SIGNAL_PATH): () => void {
  let last: boolean | null = null;
  let isClosed = false;
  let isChecking = false;
  let isCheckAgain = false;

  const check = async (): Promise<void> => {
    if (isChecking) {
      isCheckAgain = true;

      return;
    }

    isChecking = true;

    try {
      do {
        isCheckAgain = false;
        const signal = await readAgentSignal(path);
        const isWorking = signal?.state === "working" && nowSeconds() - signal.at < STALE_WORKING_S;

        if (!isClosed && isWorking !== last) {
          last = isWorking;
          listener(isWorking);
        }
      } while (isCheckAgain && !isClosed);
    } finally {
      isChecking = false;
    }
  };

  const name = basename(path);
  let watcher: FSWatcher | null = null;

  // The directory, not the file: an atomic write replaces the file, which a file watch loses.
  try {
    watcher = watch(dirname(path), (_event, file) => {
      if (file === null || file === name) {
        void check();
      }
    });
    watcher.on("error", () => {
      watcher?.close();
      watcher = null;
    });
  } catch {
    // No directory yet (no hook ran), or no watch support: the poll alone follows the file.
    watcher = null;
  }

  const poll = setInterval(() => void check(), POLL_MS);

  poll.unref();
  void check();

  return () => {
    isClosed = true;
    clearInterval(poll);
    watcher?.close();
  };
}
