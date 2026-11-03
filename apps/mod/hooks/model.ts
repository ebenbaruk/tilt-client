// Typed views over the mod's `$.state` (types/index.d.ts). The contract holds api-shaped values
// as `unknown`; these readers check them again with the protocol guards.
import type { TiltAgent, TiltAuth, TiltIntent, TiltLayout, TiltPrefs, TiltRemote } from "../types";
import { isGame, isKenoPicks, isPlayAction, isRouletteChip, isStateResponse } from "./guards";
import {
  clampFlips,
  clampHands,
  clampMines,
  DEFAULT_DICE_CHANCE,
  DEFAULT_KENO_PICKS,
  DEFAULT_LIMBO_TARGET,
  DEFAULT_MINES,
  DEFAULT_WHEEL_SEGMENTS,
  DICE_CHANCES,
  FLIP_SIDES,
  LIMBO_TARGETS,
  MAX_ROULETTE_CHIPS,
  MAX_ROULETTE_PLACED,
  optionOr,
  ROULETTE_CURSOR_CELLS,
  stackChips,
  TOWER_DIFFICULTIES,
  WHEEL_RISKS,
  WHEEL_SEGMENTS,
} from "./keys";
import type {
  BaccaratBet,
  FlipSide,
  Game,
  PlayAction,
  RouletteChip,
  StateResponse,
  TowerDifficulty,
  WheelRisk,
} from "./protocol";

export type AuthView = TiltAuth;
export type AgentView = TiltAgent;
export type LayoutView = TiltLayout;

export interface RemoteView {
  state: StateResponse | null;
  error: string | null;
  fetchedAt: number;
}

/** How fast the slots reels turn: turbo shows the draw as soon as the chain has it. */
export type SlotsSpeed = "normal" | "fast" | "turbo";

export interface Prefs {
  game: Game;
  betIndex: number;
  /** Blackjack hands per round, 1 to 6. */
  hands: number;
  /** Roulette chips in the order they were placed (a stack is several on one bet), kept between spins. */
  rouletteChips: RouletteChip[];
  /** The roulette cursor's cell, an index into ROULETTE_CURSOR_CELLS. */
  rouletteCursor: number;
  baccarat: BaccaratBet;
  slotsSpeed: SlotsSpeed;
  /** Mines per board, 1 to 24. */
  mines: number;
  /** Dice winning rolls in 10 000, one of DICE_CHANCES. */
  diceChance: number;
  diceOver: boolean;
  /** Limbo target × 100, one of LIMBO_TARGETS. */
  limboTarget: number;
  flipSide: FlipSide;
  /** Coins per flip, 1 to 10. */
  flips: number;
  /** 1 to 10 distinct numbers from 1 to 40, in order. */
  kenoPicks: number[];
  wheelSegments: number;
  wheelRisk: WheelRisk;
  towerDifficulty: TowerDifficulty;
}

export interface IntentView extends Omit<TiltIntent, "action"> {
  action: PlayAction;
}

/** Placed chips another plugin could have broken read as an empty table: each a bet and a stake,
 *  at most MAX_ROULETTE_PLACED of them on at most MAX_ROULETTE_CHIPS bets. */
function placedChips(value: unknown): RouletteChip[] {
  if (!Array.isArray(value) || value.length > MAX_ROULETTE_PLACED || !value.every(isRouletteChip)) {
    return [];
  }

  return stackChips(value).length <= MAX_ROULETTE_CHIPS ? value : [];
}

const isCursor = (value: unknown): value is number =>
  Number.isInteger(value) && typeof value === "number" && value >= 0 && value < ROULETTE_CURSOR_CELLS.length;

export const remoteView = (held: TiltRemote): RemoteView => ({
  ...held,
  state: isStateResponse(held.state) ? held.state : null,
});

export const prefsView = (held: TiltPrefs): Prefs => ({
  ...held,
  hands: clampHands(held.hands),
  mines: clampMines(held.mines ?? DEFAULT_MINES),
  rouletteChips: placedChips(held.rouletteChips),
  rouletteCursor: isCursor(held.rouletteCursor) ? held.rouletteCursor : 0,
  diceChance: optionOr(DICE_CHANCES, held.diceChance, DEFAULT_DICE_CHANCE),
  diceOver: held.diceOver === true,
  limboTarget: optionOr(LIMBO_TARGETS, held.limboTarget, DEFAULT_LIMBO_TARGET),
  flipSide: optionOr(FLIP_SIDES, held.flipSide, "heads"),
  flips: clampFlips(held.flips ?? 1),
  kenoPicks: isKenoPicks(held.kenoPicks) ? [...held.kenoPicks].sort((a, b) => a - b) : [...DEFAULT_KENO_PICKS],
  wheelSegments: optionOr(WHEEL_SEGMENTS, held.wheelSegments, DEFAULT_WHEEL_SEGMENTS),
  wheelRisk: optionOr(WHEEL_RISKS, held.wheelRisk, "low"),
  towerDifficulty: optionOr(TOWER_DIFFICULTIES, held.towerDifficulty, "easy"),
});

const SLOTS_SPEEDS: readonly SlotsSpeed[] = ["normal", "fast", "turbo"];
const BACCARAT_BETS: readonly BaccaratBet[] = ["player", "banker", "tie"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The choices a past session stored (`$.store`, which other plugins can write too): its own
 * fields only, the ones every read needs checked here, the rest checked by `prefsView` on each
 * read; null for anything else.
 */
export function storedPrefs(value: unknown): TiltPrefs | null {
  if (!isRecord(value) || !isGame(value.game) || !Number.isInteger(value.betIndex) || !Number.isInteger(value.hands)) {
    return null;
  }

  const number = (field: unknown): number | undefined => (typeof field === "number" ? field : undefined);

  return {
    game: value.game,
    betIndex: Math.max(0, Number(value.betIndex)),
    hands: Number(value.hands),
    rouletteChips: value.rouletteChips,
    rouletteCursor: number(value.rouletteCursor),
    baccarat: optionOr(BACCARAT_BETS, value.baccarat as BaccaratBet, "banker"),
    slotsSpeed: optionOr(SLOTS_SPEEDS, value.slotsSpeed as SlotsSpeed, "normal"),
    mines: number(value.mines),
    diceChance: number(value.diceChance),
    diceOver: value.diceOver === true,
    limboTarget: number(value.limboTarget),
    flipSide: optionOr(FLIP_SIDES, value.flipSide as FlipSide, "heads"),
    flips: number(value.flips),
    kenoPicks: value.kenoPicks,
    wheelSegments: number(value.wheelSegments),
    wheelRisk: optionOr(WHEEL_RISKS, value.wheelRisk as WheelRisk, "low"),
    towerDifficulty: optionOr(TOWER_DIFFICULTIES, value.towerDifficulty as TowerDifficulty, "easy"),
  };
}

export const intentView = (held: TiltIntent | null): IntentView | null =>
  held !== null && isPlayAction(held.action) ? { ...held, action: held.action } : null;
