// The contract between the hooks module and the table surface module (table.tsx): the props the
// pane hands it, the raw keys it turns into key presses, and the check on what it posts back.
// The surface module only names a key of the plan; the hooks module looks it up in its own plan,
// so a post can never do more than pressing that key would.
import type { ClientKeyEvent } from "claude-code";

import type { CardSize } from "./cards";
import type { Prefs } from "./model";
import type { RoundView, StateResponse } from "./protocol";

/** The Client's key: what `ui.message` matches its posts on. */
export const TABLE_KEY = "table";

export interface TableKey {
  key: string;
  hotkey: string;
  label: string;
}

export interface TableProps {
  state: StateResponse;
  prefs: Prefs;
  /** The plan's keys right now (planKeys), the game switches included. */
  keys: TableKey[];
  /** The cells the table is laid out in. */
  columns: number;
  /** The card size the pane chose for the room it has. */
  cards: CardSize;
  /** The Wheel's disc the pane chose for the room it has (`wheelDisc`); null: the strip. */
  wheel: number | null;
  /** The pane is short of rows (its keys come first): the result goes over the table, in view. */
  isResultFirst: boolean;
  /** Claude Code's theme is a light one: the surface module draws with the light accents. */
  isLight: boolean;
  /** The pane holds the keyboard. A click on the table then gives it the raw keys; without the
   *  pane's focus the table has none, whatever was clicked before. The band never says: false. */
  isPaneFocused: boolean;
  /** The hands of a blackjack deal sent and not on the table yet (`dealingHands`): drawn face down. */
  dealing: number | null;
  /** A one-draw round sent and not on the table yet (`sendingRound`): drawn as drawing. */
  sending: RoundView | null;
  /** The surface reports clicks: the fullscreen terminal does, its main screen neither clicks nor
   *  hands the table keys, so there the letters of the pane's key line play it. */
  isClickable: boolean;
  /** A still board (Mines, Tower) the pane draws: the table draws nothing, only keeps the keys a
   *  click gave it before the game switched, which the board's letters and Space then press. */
  isKeysOnly: boolean;
}

/** What the surface module posts: press the plan's key with this address. */
export interface TablePost {
  press: string;
}

/** Longer than any key address of the plan. */
const MAX_ADDRESS_LENGTH = 40;

/** `e.data` of a `ui.message` came from code: exactly `{ press: "<address>" }`, nothing else. */
export function isTablePost(data: unknown): data is TablePost {
  if (typeof data !== "object" || data === null || Array.isArray(data) || !("press" in data)) {
    return false;
  }

  const { press } = data;

  return (
    Object.keys(data).length === 1 &&
    typeof press === "string" &&
    press.length > 0 &&
    press.length <= MAX_ADDRESS_LENGTH
  );
}

const ARROWS: Record<string, string> = {
  left: "bet-down",
  right: "bet-up",
};

/** The game's own stepper among the keys (`hands`, `mines`, `dice`…): what ↑ and ↓ step; null when none. */
export function stepperOf(keys: readonly TableKey[]): string | null {
  const up = keys.find((key) => key.key.endsWith("-up") && key.key !== "bet-up");

  return up === undefined ? null : up.key.slice(0, -"-up".length);
}

/**
 * The plan key a raw key presses at the table, or null. Space and Enter play: a new round with the
 * same bet and choices, or in a blackjack turn Space hits and Enter stands. The arrows step the bet
 * and the game's choice (hands, mines, dice chance…); any other character is the plan's own hotkey
 * (`d` doubles, `p` splits, `a`–`y` reveal a Mines tile, `0`–`9` switch game). Click-only keys
 * (no hotkey) are never pressed by a key.
 */
export function pressFor(event: ClientKeyEvent, keys: readonly TableKey[]): string | null {
  if (event.ctrl === true || event.meta === true) {
    return null;
  }

  const has = (address: string) => keys.some((key) => key.key === address);
  const isTurn = has("bj-stand");
  const stepper = stepperOf(keys);
  const typed = event.key.toLowerCase();
  const named: Record<string, string | undefined> = {
    ...ARROWS,
    up: stepper === null ? undefined : `${stepper}-up`,
    down: stepper === null ? undefined : `${stepper}-down`,
    space: isTurn ? "bj-hit" : "start",
    " ": isTurn ? "bj-hit" : "start",
    return: isTurn ? "bj-stand" : "start",
  };
  const address = named[event.key] ?? keys.find((key) => key.hotkey !== "" && key.hotkey === typed)?.key ?? null;

  return address !== null && has(address) ? address : null;
}
