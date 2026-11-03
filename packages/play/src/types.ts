// What every Tilt client outside Claude Code shares: the session a harness drives and the text
// the table draws. The game data, the keys and the checks are the Claude Code mod's own pure
// modules, imported by relative path so a harness can load this folder straight from a clone
// (no install step, no node_modules): apps/mod/hooks/{protocol,guards,keys,format,model}.
import type { KeyAction } from "../../../apps/mod/hooks/keys";
import type { Prefs } from "../../../apps/mod/hooks/model";
import type { StateResponse } from "../../../apps/mod/hooks/protocol";

export type { Command, KeyAction } from "../../../apps/mod/hooks/keys";
export type { Prefs } from "../../../apps/mod/hooks/model";
export type { Game, PlayAction, RoundView, StateResponse } from "../../../apps/mod/hooks/protocol";

export type Auth =
  | { status: "out"; message: string | null }
  /** Device login started: the person confirms `userCode` at `verifyUrl` in a browser. */
  | { status: "pending"; userCode: string; verifyUrl: string }
  | { status: "in" };

export type Tone = "success" | "neutral" | "loss";

/** Everything a harness needs to draw Tilt, read at once. Shown only, never trusted. */
export interface Snapshot {
  auth: Auth;
  /** The last good GET /v1/state; null before the first one. */
  state: StateResponse | null;
  /** One line when the last refresh failed; the last good state stays on screen. */
  error: string | null;
  prefs: Prefs;
  /** A move is in flight: its keys do nothing until the table shows it. */
  isBusy: boolean;
  /** The last refusal or notice, e.g. "Not enough balance." */
  message: { text: string; tone: Tone } | null;
  /** Whether the coding agent works, from the harness's turn start/end events only. */
  agent: { isWorking: boolean; notice: string | null };
  /** The keys the table offers now (apps/mod/hooks/keys.ts planKeys). */
  keys: KeyAction[];
  /** Deposit page on the API's own site; null when there is none to trust. */
  depositUrl: string | null;
  /** Clock of this snapshot, in ms. */
  now: number;
}

/** Where a session keeps its token and the player's table choices between runs. */
export interface Saved {
  token: string | null;
  /** The API the token was issued by: it is never sent anywhere else. */
  apiBase: string | null;
  prefs: unknown;
}

export interface Store {
  read(): Promise<Saved>;
  write(saved: Saved): Promise<void>;
}

/** How text is drawn: ANSI colors on or off, and the columns available. */
export interface RenderContext {
  color: boolean;
  width: number;
  prefs: Prefs;
  now: number;
}
