// Which keys a drawing offers, as data: the panel and the band render the same plan, and the
// tests check it is conflict-free without drawing anything.
import {
  cashOutPayout,
  chipsTotal,
  formatUsdc,
  hiloGuessName,
  hundredths,
  rouletteBetLabel,
  scaledDecimal,
  shortMultiplier,
} from "./format";
import type { Prefs, SlotsSpeed } from "./model";
import type {
  BaccaratBet,
  BlackjackView,
  FlipSide,
  Game,
  HiloGuess,
  HiloView,
  Limits,
  MinesView,
  PlayAction,
  RouletteBet,
  RouletteChip,
  RoundView,
  StateResponse,
  TowerDifficulty,
  TowerView,
  WheelRisk,
} from "./protocol";

export type Command =
  | { kind: "switch"; game: Game }
  /** Moves the bet one preset down (-1) or up (+1), held at the table's bounds. */
  | { kind: "bet"; step: -1 | 1 }
  /** One blackjack hand fewer (-1) or more (+1), held between one and six. */
  | { kind: "hands"; step: -1 | 1 }
  /** One Mines mine fewer (-1) or more (+1), held between 1 and 24. */
  | { kind: "mines"; step: -1 | 1 }
  /** A choice of the new games one preset down (-1) or up (+1), held at both ends. */
  | { kind: "step"; setting: Setting; step: -1 | 1 }
  /** Dice: rolls over the target instead of under it, or back. */
  | { kind: "dice-over" }
  | { kind: "flip-side"; side: FlipSide }
  /** Wheel: the next risk, low after high. */
  | { kind: "wheel-risk" }
  /** Keno: as many new picks, chosen at random on the player's side (a choice, not an outcome). */
  | { kind: "keno-random" }
  /** Keno: picks or unpicks one number, held between 1 and 10 picks. */
  | { kind: "keno-pick"; number: number }
  /** Roulette: a chip of the bet's size on `bet`, or on the cursor's cell when null. */
  | { kind: "roulette-add"; bet: RouletteBet | null }
  /** Roulette: the cursor one cell back (-1) or on (+1), around 0 to 36, the dozens, the columns. */
  | { kind: "roulette-cursor"; step: -1 | 1 }
  /** Roulette: the cursor one cell left (-1) or right (+1) across the felt (see crossCursor). */
  | { kind: "roulette-across"; step: -1 | 1 }
  /** Roulette: every chip off the cursor's cell. */
  | { kind: "roulette-remove" }
  /** Roulette: the last chip placed off the table. */
  | { kind: "roulette-undo" }
  /** Roulette: every chip off the table. */
  | { kind: "roulette-clear" }
  | { kind: "baccarat-bet"; bet: BaccaratBet }
  | { kind: "slots-speed"; speed: SlotsSpeed }
  /** Starts a round of the active game with the current bet, both read when the key is pressed. */
  | { kind: "start" }
  | { kind: "play"; action: PlayAction }
  /** Copies a line about the last big win, to paste where the person likes. */
  | { kind: "share" };

export interface KeyAction {
  /** The Button's address: stable across draws. */
  key: string;
  /** One digit or one lowercase letter; "" for a key only a click presses (see tableKeys). */
  hotkey: string;
  label: string;
  isSelected: boolean;
  command: Command;
}

/** The game switcher's order: digits 1 to 9 pick a game of the page shown, 0 turns the page. */
export const GAMES: readonly Game[] = [
  "blackjack",
  "roulette",
  "baccarat",
  "slots",
  "mines",
  "dice",
  "limbo",
  "flip",
  "keno",
  "wheel",
  "hilo",
  "tower",
];
const GAMES_PER_PAGE = 9;
const GAME_PAGES = Math.ceil(GAMES.length / GAMES_PER_PAGE);

export const GAME_LABELS: Record<Game, string> = {
  blackjack: "Blackjack",
  roulette: "Roulette",
  baccarat: "Baccarat",
  slots: "Slots",
  mines: "Mines",
  dice: "Dice",
  limbo: "Limbo",
  flip: "Flip",
  keno: "Keno",
  wheel: "Wheel",
  hilo: "Hilo",
  tower: "Tower",
};

/** The switcher page a game is on, from 0. */
export const gamePage = (game: Game): number => Math.floor(GAMES.indexOf(game) / GAMES_PER_PAGE);

const BASE_UNITS_PER_USDC = 1_000_000n;
const BET_PRESETS = [1n, 2n, 5n, 10n, 25n].map((usdc) => usdc * BASE_UNITS_PER_USDC);

/** The bets `v` and `b` step through: the table minimum, then the presets the limits allow. */
export function betOptions(limits: Limits): string[] {
  const min = BigInt(limits.minBet);
  const max = BigInt(limits.maxBet);
  const presets = BET_PRESETS.filter((amount) => amount > min && amount <= max);

  return [min, ...presets].map((amount) => amount.toString());
}

function clampBetIndex(limits: Limits, betIndex: number): number {
  return Math.max(0, Math.min(betIndex, betOptions(limits).length - 1));
}

export function currentBet(limits: Limits, betIndex: number): string {
  return betOptions(limits)[clampBetIndex(limits, betIndex)] ?? limits.minBet;
}

/** The bet index one step down or up, never past the lowest or highest bet the limits allow. */
export function stepBetIndex(limits: Limits, betIndex: number, step: -1 | 1): number {
  return clampBetIndex(limits, clampBetIndex(limits, betIndex) + step);
}

export const MIN_HANDS = 1;
export const MAX_HANDS = 6;
/** Splits per round, all hands together: each one adds a hand to the table. */
export const MAX_SPLITS = 4;
/** Hands a round can hold: the dealt ones plus every split. */
export const MAX_TABLE_HANDS = MAX_HANDS + MAX_SPLITS;

/** A hand count the table takes: whole, from one to six. */
export function clampHands(hands: number): number {
  return Number.isInteger(hands) ? Math.max(MIN_HANDS, Math.min(hands, MAX_HANDS)) : MIN_HANDS;
}

/** One blackjack hand fewer (-1) or more (+1), held between one and six. */
export function stepHands(hands: number, step: -1 | 1): number {
  return clampHands(clampHands(hands) + step);
}

/** A Mines board: 5 × 5 tiles, numbered row × 5 + column. */
export const MINES_COLUMNS = 5;
export const MINES_TILES = MINES_COLUMNS * MINES_COLUMNS;
export const MIN_MINES = 1;
export const MAX_MINES = MINES_TILES - 1;
export const DEFAULT_MINES = 3;

/** A mine count the board takes: whole, from 1 to 24. */
export function clampMines(mines: number): number {
  return Number.isInteger(mines) ? Math.max(MIN_MINES, Math.min(mines, MAX_MINES)) : DEFAULT_MINES;
}

/** One mine fewer (-1) or more (+1), held between 1 and 24. */
export function stepMines(mines: number, step: -1 | 1): number {
  return clampMines(clampMines(mines) + step);
}

/** Dice rolls 0 to 9999 (00.00 to 99.99); the winning count is 1 % to 98 % of them. */
export const DICE_ROLLS = 10_000;
export const MIN_DICE_CHANCE = 100;
export const MAX_DICE_CHANCE = 9_800;
/** Limbo targets are multipliers × 100: 1.01× to 10 000×. */
export const MIN_LIMBO_TARGET = 101;
export const MAX_LIMBO_TARGET = 1_000_000;
export const MIN_FLIPS = 1;
export const MAX_FLIPS = 10;
/** Keno: numbers 1 to 40, 1 to 10 picks, ten drawn. */
export const KENO_NUMBERS = 40;
export const MIN_KENO_PICKS = 1;
export const MAX_KENO_PICKS = 10;
export const KENO_DRAWN = 10;
/** Chips a roulette spin carries, each on its own bet. */
export const MAX_ROULETTE_CHIPS = 20;
/** Chips the table keeps placed one by one (stacks included), for undo; bounds the stored prefs too. */
export const MAX_ROULETTE_PLACED = 100;
export const WHEEL_SEGMENTS: readonly number[] = [10, 20, 30, 40, 50];
export const WHEEL_RISKS: readonly WheelRisk[] = ["low", "medium", "high"];
export const FLIP_SIDES: readonly FlipSide[] = ["heads", "tails"];
export const HILO_GUESSES: readonly HiloGuess[] = ["higher", "lower", "skip"];
export const MAX_HILO_SKIPS = 10;
/** Cards a Hilo board keeps: the first, then one per guess. */
export const MAX_HILO_CARDS = 64;
export const TOWER_LEVELS = 9;
export const TOWER_DIFFICULTIES: readonly TowerDifficulty[] = ["easy", "medium", "hard", "expert", "master"];
/** Tiles per level and safe tiles among them. */
export const TOWER_SHAPES: Record<TowerDifficulty, { tiles: number; safe: number }> = {
  easy: { tiles: 4, safe: 3 },
  medium: { tiles: 3, safe: 2 },
  hard: { tiles: 2, safe: 1 },
  expert: { tiles: 3, safe: 1 },
  master: { tiles: 4, safe: 1 },
};
export const MAX_TOWER_TILES = 4;

/** Dice win chances j and k step through, as winning rolls in 10 000: 49 % pays ×2. */
export const DICE_CHANCES: readonly number[] = [100, 500, 1_000, 2_500, 4_900, 6_600, 7_500, 9_000, 9_800];
export const DEFAULT_DICE_CHANCE = 4_900;
/** Limbo targets j and k step through, × 100. */
export const LIMBO_TARGETS: readonly number[] = [150, 200, 300, 500, 1_000, 2_500, 10_000, 100_000];
export const DEFAULT_LIMBO_TARGET = 200;
export const DEFAULT_KENO_PICKS: readonly number[] = [4, 12, 19, 27, 35];
export const DEFAULT_WHEEL_SEGMENTS = 10;

/** The choices `step` moves, by the address of their j and k keys (`dice-down`, `dice-up`). */
export type Setting = "dice" | "limbo" | "flips" | "keno" | "wheel" | "tower";

/** What each pair of stepper keys (j and k; s and d for the roulette cursor) steps, as the table's prompt names it: `↑/↓ chance`. */
export const STEPPER_NAMES: Record<string, string> = {
  hands: "hands",
  mines: "mines",
  dice: "chance",
  limbo: "target",
  flips: "coins",
  keno: "picks",
  wheel: "segments",
  tower: "difficulty",
  cursor: "cursor",
};

/** `value` when it is one of `options`, else `fallback`: a stored pref another plugin could have broken. */
export function optionOr<T>(options: readonly T[], value: T | undefined, fallback: T): T {
  return value !== undefined && options.includes(value) ? value : fallback;
}

/** The option one step down or up from `value`, held at both ends. */
function stepThrough<T>(options: readonly T[], value: T, step: -1 | 1): T {
  const index = Math.max(0, options.indexOf(value));

  return options[Math.max(0, Math.min(index + step, options.length - 1))] ?? value;
}

/** The option after `value`, the first after the last. */
export function cycle<T>(options: readonly T[], value: T): T {
  return options[(options.indexOf(value) + 1) % options.length] ?? value;
}

/** A coin count a flip takes: whole, from 1 to 10. */
export function clampFlips(flips: number): number {
  return Number.isInteger(flips) ? Math.max(MIN_FLIPS, Math.min(flips, MAX_FLIPS)) : MIN_FLIPS;
}

/** `random(bound)` is a whole number from 0 to bound − 1. */
export type RandomBelow = (bound: number) => number;

const byValue = (a: number, b: number): number => a - b;

/** `count` distinct Keno numbers chosen with `random`, in order. */
export function randomPicks(count: number, random: RandomBelow): number[] {
  const pool = Array.from({ length: KENO_NUMBERS }, (_, index) => index + 1);

  for (let index = 0; index < count; index++) {
    const other = index + random(KENO_NUMBERS - index);
    const picked = pool[other] ?? 0;

    pool[other] = pool[index] ?? 0;
    pool[index] = picked;
  }

  return pool.slice(0, count).sort(byValue);
}

/** Picks `number` or drops it, never below 1 pick or past 10. */
export function toggleKenoPick(picks: readonly number[], number: number): number[] {
  if (picks.includes(number)) {
    return picks.length > MIN_KENO_PICKS ? picks.filter((pick) => pick !== number) : [...picks];
  }

  return picks.length < MAX_KENO_PICKS ? [...picks, number].sort(byValue) : [...picks];
}

/** One pick fewer (the highest goes) or one more (a random free number), held between 1 and 10. */
function stepKenoPicks(picks: readonly number[], step: -1 | 1, random: RandomBelow): number[] {
  if (step < 0) {
    return picks.length > MIN_KENO_PICKS ? picks.slice(0, -1) : [...picks];
  }

  const free = Array.from({ length: KENO_NUMBERS }, (_, index) => index + 1).filter((n) => !picks.includes(n));
  const added = free[random(free.length)];

  return picks.length < MAX_KENO_PICKS && added !== undefined ? [...picks, added].sort(byValue) : [...picks];
}

/** The prefs after j (-1) or k (+1) on one of the new games' choices. */
export function stepSetting(prefs: Prefs, setting: Setting, step: -1 | 1, random: RandomBelow): Prefs {
  switch (setting) {
    case "dice":
      return { ...prefs, diceChance: stepThrough(DICE_CHANCES, prefs.diceChance, step) };
    case "limbo":
      return { ...prefs, limboTarget: stepThrough(LIMBO_TARGETS, prefs.limboTarget, step) };
    case "flips":
      return { ...prefs, flips: clampFlips(clampFlips(prefs.flips) + step) };
    case "keno":
      return { ...prefs, kenoPicks: stepKenoPicks(prefs.kenoPicks, step, random) };
    case "wheel":
      return { ...prefs, wheelSegments: stepThrough(WHEEL_SEGMENTS, prefs.wheelSegments, step) };
    case "tower":
      return { ...prefs, towerDifficulty: stepThrough(TOWER_DIFFICULTIES, prefs.towerDifficulty, step) };
  }
}

/** The roll a dice bet targets: the chance itself under, the rolls above the rest over. */
export const diceTarget = (chance: number, over: boolean): number => (over ? DICE_ROLLS - chance : chance);

/**
 * `prefs` with the choices a one-draw `round` was played with: a new session sets the table up as
 * the last round was, so that round shows on it and the next plays the same way.
 */
export function choicesOf(prefs: Prefs, round: RoundView): Prefs {
  const detail = round.detail;

  switch (detail.game) {
    case "dice":
      return { ...prefs, diceOver: detail.over, diceChance: detail.over ? DICE_ROLLS - detail.target : detail.target };
    case "limbo":
      return { ...prefs, limboTarget: Number(hundredths(detail.target)) };
    case "flip":
      return { ...prefs, flipSide: detail.side, flips: detail.flips };
    case "keno":
      return { ...prefs, kenoPicks: [...detail.picks].sort(byValue) };
    case "wheel":
      return { ...prefs, wheelSegments: detail.segments, wheelRisk: detail.risk };
    default:
      return prefs;
  }
}

/** The address of the key revealing a tile: `mines-tile-0` to `mines-tile-24`. */
export const MINES_TILE_KEY = "mines-tile-";
/** The address of the key climbing onto a tile of the next tower level: `tower-tile-0` to `tower-tile-3`. */
export const TOWER_TILE_KEY = "tower-tile-";
/** The address of a Keno number's click on the fullscreen table: `keno-pick-1` to `keno-pick-40`. */
export const KENO_PICK_KEY = "keno-pick-";
/** The addresses of the roulette layout's cells only a click on the fullscreen table bets on:
 *  `roulette-straight-0` to `roulette-straight-36`, `roulette-dozen-1`, `roulette-column-3`. */
export const ROULETTE_STRAIGHT_KEY = "roulette-straight-";
export const ROULETTE_DOZEN_KEY = "roulette-dozen-";
export const ROULETTE_COLUMN_KEY = "roulette-column-";
/** The wheel's pockets, 0 to 36. */
export const ROULETTE_POCKETS = 37;
const LETTER_A = "a".charCodeAt(0);
/** A hidden tile's key: drawn in the corner of its tile, where only its letter (`a:`) should show. */
const TILE_LABEL = " ";

/** A tile's hotkey: tile 0 is `a`, tile 24 is `y` (`z` cashes out). */
export function tileLetter(tile: number): string {
  return String.fromCharCode(LETTER_A + tile);
}

/** A round in flight pins the game it was started in. */
export function isRoundOpen(state: StateResponse | null): boolean {
  return state?.round != null && state.round.phase !== "idle";
}

export function activeGame(state: StateResponse | null, prefs: Prefs): Game {
  return isRoundOpen(state) && state?.round ? state.round.detail.game : prefs.game;
}

const THIRDS = [1, 2, 3] as const;

/** The cells the cursor moves over, in order: 0 to 36, the dozens, then the columns. */
export const ROULETTE_CURSOR_CELLS: readonly RouletteBet[] = [
  ...Array.from({ length: ROULETTE_POCKETS }, (_, number): RouletteBet => ({ kind: "straight", number })),
  ...THIRDS.map((dozen): RouletteBet => ({ kind: "dozen", dozen })),
  ...THIRDS.map((column): RouletteBet => ({ kind: "column", column })),
];

/** The cell under the cursor; 0 for a cursor out of range (a pref another plugin broke). */
export const cursorBet = (cursor: number): RouletteBet =>
  ROULETTE_CURSOR_CELLS[cursor] ?? { kind: "straight", number: 0 };

/** The cursor one cell back or on, around every cell. */
export function stepCursor(cursor: number, step: -1 | 1): number {
  const cells = ROULETTE_CURSOR_CELLS.length;

  return (((cursor + step) % cells) + cells) % cells;
}

/** A row of the felt steps three numbers at a time: 1 4 7 … 34. */
const FELT_ROW_STEP = 3;
const LAST_NUMBER = ROULETTE_POCKETS - 1;
/** Where the dozens and the columns start among the cursor's cells. */
const FIRST_DOZEN_CELL = ROULETTE_POCKETS;
const FIRST_COLUMN_CELL = FIRST_DOZEN_CELL + THIRDS.length;

/**
 * The cursor one cell left or right across the felt, as it is drawn: along a row of numbers three
 * at a time, 0 left of every row, the row's `2:1` right of its last number; a dozen to the next
 * dozen. Held at the felt's edges. Any cell is then a few presses away, where `s` and `d` alone
 * take up to 21.
 */
export function crossCursor(cursor: number, step: -1 | 1): number {
  const cell = cursorBet(cursor);

  switch (cell.kind) {
    case "straight": {
      const next = cell.number + step * FELT_ROW_STEP;

      // Past the row's last number (34, 35 or 36), its 2:1.
      if (next > LAST_NUMBER) {
        return FIRST_COLUMN_CELL + ((cell.number - 1) % FELT_ROW_STEP);
      }

      return Math.max(0, next);
    }
    case "column":
      return step > 0 ? cursor : LAST_NUMBER - FELT_ROW_STEP + cell.column;
    case "dozen":
      return FIRST_DOZEN_CELL + Math.min(THIRDS.length - 1, Math.max(0, cell.dozen - 1 + step));
    default:
      return cursor;
  }
}

export const sameBet = (a: RouletteBet, b: RouletteBet): boolean => rouletteBetLabel(a) === rouletteBetLabel(b);

/** What the chips among `chips` on `bet` add up to; 0 when none is on it. */
export const stakeOn = (chips: readonly RouletteChip[], bet: RouletteBet): bigint =>
  chipsTotal(chips.filter((chip) => sameBet(chip.bet, bet)));

/** The chips placed, stacked per bet in the order each bet got its first one: what a spin sends. */
export function stackChips(placed: readonly RouletteChip[]): RouletteChip[] {
  const stacks: RouletteChip[] = [];

  for (const chip of placed) {
    if (!stacks.some((stack) => sameBet(stack.bet, chip.bet))) {
      stacks.push({ bet: chip.bet, amount: stakeOn(placed, chip.bet).toString() });
    }
  }

  return stacks;
}

/**
 * `placed` with a chip of `amount` on `bet`, cut down to what the bet holds below the table
 * maximum; a sentence instead when nothing can go on: the table is full or the bet at its maximum.
 */
export function addChip(
  placed: readonly RouletteChip[],
  bet: RouletteBet,
  amount: string,
  limits: Limits,
): RouletteChip[] | string {
  const room = BigInt(limits.maxBet) - stakeOn(placed, bet);
  const stacks = stackChips(placed);

  if (placed.length >= MAX_ROULETTE_PLACED) {
    return `${MAX_ROULETTE_PLACED} chips at most on the table: undo or clear some.`;
  }

  if (!stacks.some((stack) => sameBet(stack.bet, bet)) && stacks.length >= MAX_ROULETTE_CHIPS) {
    return `${MAX_ROULETTE_CHIPS} bets at most on one spin.`;
  }

  if (room <= 0n) {
    return `The ${rouletteBetLabel(bet)} bet is at the table maximum (${formatUsdc(limits.maxBet)}).`;
  }

  const chip = BigInt(amount) < room ? amount : room.toString();

  return [...placed, { bet, amount: chip }];
}

const ROULETTE_SIMPLE: readonly { hotkey: string; bet: RouletteBet }[] = [
  { hotkey: "r", bet: { kind: "red" } },
  { hotkey: "k", bet: { kind: "black" } },
  { hotkey: "o", bet: { kind: "odd" } },
  { hotkey: "e", bet: { kind: "even" } },
  { hotkey: "l", bet: { kind: "low" } },
  { hotkey: "g", bet: { kind: "high" } },
];

const BACCARAT_KEYS: readonly { hotkey: string; bet: BaccaratBet }[] = [
  { hotkey: "p", bet: "player" },
  { hotkey: "y", bet: "banker" },
  { hotkey: "t", bet: "tie" },
];

export interface PlanInput {
  state: StateResponse;
  prefs: Prefs;
  /** A move is in flight: no new one until it settles. */
  isBusy: boolean;
}

/**
 * Always drawn: mid-round a press explains why it does not switch (see runCommand). Digits 1 to 9
 * pick the games of the shown game's page; 0 turns to the next page, on its first game.
 */
function switchKeys(state: StateResponse, prefs: Prefs): KeyAction[] {
  const shown = activeGame(state, prefs);
  const page = gamePage(shown);
  const nextPage = (page + 1) % GAME_PAGES;
  const games = GAMES.slice(page * GAMES_PER_PAGE, (page + 1) * GAMES_PER_PAGE);
  const turn: KeyAction = {
    key: "game-page",
    hotkey: "0",
    label: `more ${page + 1}/${GAME_PAGES}`,
    isSelected: false,
    command: { kind: "switch", game: GAMES[nextPage * GAMES_PER_PAGE] ?? shown },
  };

  return [
    ...games.map((game, index) => ({
      key: `game-${game}`,
      hotkey: String(index + 1),
      label: GAME_LABELS[game],
      isSelected: game === shown,
      command: { kind: "switch", game } as const,
    })),
    turn,
  ];
}

/** The band's key to the next game: a letter, never typed from the prompt. */
export const NEXT_GAME_HOTKEY = "m";

/**
 * The game keys of the band above the prompt. A bare digit typed first in an empty prompt presses a
 * band Button whether the band has the keys or not ("2 bugs" would switch to Roulette and lose its
 * 2), so there the tabs take clicks only, and `m`, which only a band with the keys gets, steps to
 * the next game. A round in play pins its game, and its board may hold `m` (Mines tile 12): `m` is
 * then the board's, and the next game takes a click only, saying why it does not switch.
 */
export function bandSwitchKeys(state: StateResponse, prefs: Prefs): KeyAction[] {
  const shown = activeGame(state, prefs);
  const next = GAMES[(GAMES.indexOf(shown) + 1) % GAMES.length] ?? shown;

  return [
    ...switchKeys(state, prefs).map((key) => ({ ...key, hotkey: "" })),
    {
      key: "game-next",
      hotkey: isRoundOpen(state) ? "" : NEXT_GAME_HOTKEY,
      label: "next game",
      isSelected: false,
      command: { kind: "switch", game: next },
    },
  ];
}

/** The band's table surface keys: the table's, with the band's game keys in place of the digits. */
export function bandTableKeys(input: PlanInput): KeyAction[] {
  return [
    ...tableKeys(input).filter((key) => key.command.kind !== "switch"),
    ...bandSwitchKeys(input.state, input.prefs),
  ];
}

/**
 * `r k o e l g` put a chip on an outside bet; `s` and `d` move the cursor over the numbers, dozens
 * and columns one at a time, `f` and `h` across the felt; `a` puts a chip under it and `x` takes its
 * chips off; `u` takes the last chip back, `q` clears the table.
 */
function rouletteKeys(prefs: Prefs): KeyAction[] {
  const stacks = stackChips(prefs.rouletteChips);
  const isOn = (bet: RouletteBet) => stacks.some((stack) => sameBet(stack.bet, bet));
  const cursor = cursorBet(prefs.rouletteCursor);
  const keys: KeyAction[] = [
    ...ROULETTE_SIMPLE.map(({ hotkey, bet }) => ({
      key: `roulette-${bet.kind}`,
      hotkey,
      label: bet.kind,
      isSelected: isOn(bet),
      command: { kind: "roulette-add", bet } as const,
    })),
    {
      key: "cursor-down",
      hotkey: "s",
      label: "cursor −",
      isSelected: false,
      command: { kind: "roulette-cursor", step: -1 },
    },
    {
      key: "cursor-up",
      hotkey: "d",
      label: "cursor +",
      isSelected: false,
      command: { kind: "roulette-cursor", step: 1 },
    },
    {
      key: "cursor-left",
      hotkey: "f",
      label: "cursor «",
      isSelected: false,
      command: { kind: "roulette-across", step: -1 },
    },
    {
      key: "cursor-right",
      hotkey: "h",
      label: "cursor »",
      isSelected: false,
      command: { kind: "roulette-across", step: 1 },
    },
    {
      key: "chip-add",
      hotkey: "a",
      label: `chip on ${rouletteBetLabel(cursor)}`,
      isSelected: false,
      command: { kind: "roulette-add", bet: null },
    },
  ];

  if (isOn(cursor)) {
    keys.push({
      key: "chip-remove",
      hotkey: "x",
      label: "take off",
      isSelected: false,
      command: { kind: "roulette-remove" },
    });
  }

  if (stacks.length > 0) {
    keys.push(
      { key: "chip-undo", hotkey: "u", label: "undo", isSelected: false, command: { kind: "roulette-undo" } },
      { key: "chip-clear", hotkey: "q", label: "clear", isSelected: false, command: { kind: "roulette-clear" } },
    );
  }

  return keys;
}

function baccaratKeys(prefs: Prefs): KeyAction[] {
  return BACCARAT_KEYS.map(({ hotkey, bet }) => ({
    key: `baccarat-${bet}`,
    hotkey,
    label: bet,
    isSelected: prefs.baccarat === bet,
    command: { kind: "baccarat-bet", bet },
  }));
}

/** The round `game` starts with the bet `amount`; at roulette the chips on the table are the stake instead. */
export function startAction(game: Game, amount: string, prefs: Prefs): PlayAction {
  switch (game) {
    case "blackjack":
      return { type: "blackjack_bet", amount, hands: clampHands(prefs.hands) };
    case "roulette":
      return { type: "roulette_chips", chips: stackChips(prefs.rouletteChips) };
    case "baccarat":
      return { type: "baccarat_deal", amount, bet: prefs.baccarat };
    case "slots":
      return { type: "slots_spin", amount };
    case "mines":
      return { type: "mines_bet", amount, mines: clampMines(prefs.mines) };
    case "dice":
      return {
        type: "dice_roll",
        amount,
        target: diceTarget(prefs.diceChance, prefs.diceOver),
        over: prefs.diceOver,
      };
    case "limbo":
      return { type: "limbo_play", amount, target: prefs.limboTarget };
    case "flip":
      return { type: "flip_play", amount, side: prefs.flipSide, flips: clampFlips(prefs.flips) };
    case "keno":
      return { type: "keno_play", amount, picks: [...prefs.kenoPicks] };
    case "wheel":
      return { type: "wheel_spin", amount, segments: prefs.wheelSegments, risk: prefs.wheelRisk };
    case "hilo":
      return { type: "hilo_bet", amount };
    case "tower":
      return { type: "tower_bet", amount, difficulty: prefs.towerDifficulty };
  }
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** What the start key adds after the bet: the choices the round is played with. */
function startDetail(game: Game, prefs: Prefs): string {
  switch (game) {
    case "mines":
      return ` · ${plural(clampMines(prefs.mines), "mine", "mines")}`;
    case "dice":
      return ` · ${prefs.diceOver ? "over" : "under"} ${scaledDecimal(BigInt(diceTarget(prefs.diceChance, prefs.diceOver)), 2)}`;
    case "limbo":
      return ` · ×${scaledDecimal(BigInt(prefs.limboTarget), 2)}`;
    case "flip":
      return ` · ${clampFlips(prefs.flips)} × ${prefs.flipSide}`;
    case "keno":
      return ` · ${plural(prefs.kenoPicks.length, "pick", "picks")}`;
    case "roulette":
      return ` · ${plural(stackChips(prefs.rouletteChips).length, "bet", "bets")}`;
    case "wheel":
      return ` · ${prefs.wheelSegments} segments · ${prefs.wheelRisk}`;
    case "tower":
      return ` · ${prefs.towerDifficulty}`;
    default:
      return "";
  }
}

/** "deal · 0.50", "deal · 3 × 0.50" for three blackjack hands, "play · 0.50 · 3 mines", "spin · 2.30 · 6 chips". */
function startLabel(game: Game, amount: string, prefs: Prefs): string {
  const hands = clampHands(prefs.hands);
  const stake =
    game === "blackjack" && hands > 1
      ? `${hands} × ${formatUsdc(amount)}`
      : formatUsdc(game === "roulette" ? chipsTotal(prefs.rouletteChips).toString() : amount);

  return `${START_VERB[game]} · ${stake}${startDetail(game, prefs)}`;
}

/** What `n` does at each game: "deal", "spin", "roll"… */
export const START_VERB: Record<Game, string> = {
  blackjack: "deal",
  roulette: "spin",
  baccarat: "deal",
  slots: "spin",
  mines: "play",
  dice: "roll",
  limbo: "play",
  flip: "flip",
  keno: "play",
  wheel: "spin",
  hilo: "play",
  tower: "play",
};

/** The key a Mines, Hilo or tower round is cashed out with, named on the table too. */
export const CASH_OUT_HOTKEY = "z";

/** A cash-out key on `z` at the current multiplier: what it returns before Tilt's fee. */
function cashOutKey(game: "mines" | "hilo" | "tower", stake: string, multiplier: string): KeyAction {
  const action: PlayAction = { type: `${game}_cashout` };

  return {
    key: `${game}-cashout`,
    hotkey: CASH_OUT_HOTKEY,
    label: `cash out · ${formatUsdc(cashOutPayout(stake, multiplier))}`,
    isSelected: false,
    command: { kind: "play", action },
  };
}

/** A tile key for every tile still hidden while the board takes a reveal, then `z` to cash out. */
function minesTurnKeys(detail: MinesView, stake: string): KeyAction[] {
  const shown = new Set<number | null>([...detail.revealed, detail.pending, detail.busted]);
  const tiles = detail.canReveal ? Array.from({ length: MINES_TILES }, (_, tile) => tile) : [];
  const keys: KeyAction[] = tiles
    .filter((tile) => !shown.has(tile))
    .map((tile) => ({
      key: `${MINES_TILE_KEY}${tile}`,
      hotkey: tileLetter(tile),
      label: TILE_LABEL,
      isSelected: false,
      command: { kind: "play", action: { type: "mines_reveal", tile } },
    }));

  if (detail.canCashOut) {
    keys.push(cashOutKey("mines", stake, detail.multiplier));
  }

  return keys;
}

/** A key per tile of the next level while the tower takes a climb (`a` to `d`), then `z` to cash out. */
function towerTurnKeys(detail: TowerView, stake: string): KeyAction[] {
  const tiles = detail.canClimb ? Array.from({ length: detail.tiles }, (_, tile) => tile) : [];
  const keys: KeyAction[] = tiles
    .filter((tile) => tile !== detail.pending)
    .map((tile) => ({
      key: `${TOWER_TILE_KEY}${tile}`,
      hotkey: tileLetter(tile),
      label: TILE_LABEL,
      isSelected: false,
      command: { kind: "play", action: { type: "tower_climb", tile } },
    }));

  if (detail.canCashOut) {
    keys.push(cashOutKey("tower", stake, detail.multiplier));
  }

  return keys;
}

const HILO_KEYS: Record<HiloGuess, string> = { higher: "h", lower: "l", skip: "s" };

/** Higher and lower, named as the table names them, at what a right guess brings, unless refused;
 * skip while skips are left; `z` cashes out. */
function hiloTurnKeys(detail: HiloView, stake: string): KeyAction[] {
  const rank = detail.cards.at(-1)?.rank ?? 0;
  const guess = (name: "higher" | "lower", multiplier: string | null) =>
    multiplier === null ? null : `${hiloGuessName(name, rank)} ×${shortMultiplier(multiplier)}`;
  const offers: { guess: HiloGuess; label: string | null }[] = [
    { guess: "higher", label: guess("higher", detail.higherMultiplier) },
    { guess: "lower", label: guess("lower", detail.lowerMultiplier) },
    { guess: "skip", label: detail.skipsLeft > 0 ? `skip · ${detail.skipsLeft} left` : null },
  ];
  const keys: KeyAction[] = detail.canGuess
    ? offers.flatMap(({ guess, label }) =>
        label === null
          ? []
          : [
              {
                key: `hilo-${guess}`,
                hotkey: HILO_KEYS[guess],
                label,
                isSelected: false,
                command: { kind: "play", action: { type: "hilo_guess", guess } } as const,
              },
            ],
      )
    : [];

  if (detail.canCashOut) {
    keys.push(cashOutKey("hilo", stake, detail.multiplier));
  }

  return keys;
}

function blackjackTurnKeys(detail: BlackjackView): KeyAction[] {
  const keys: KeyAction[] = [];
  const add = (hotkey: string, label: string, action: PlayAction) =>
    keys.push({ key: `bj-${label}`, hotkey, label, isSelected: false, command: { kind: "play", action } });

  if (detail.canHit) {
    add("h", "hit", { type: "blackjack_hit" });
  }

  add("s", "stand", { type: "blackjack_stand" });

  if (detail.canDouble) {
    add("d", "double", { type: "blackjack_double" });
  }

  if (detail.canSplit) {
    add("p", "split", { type: "blackjack_split" });
  }

  return keys;
}

function playerTurnKeys(state: StateResponse): KeyAction[] {
  const round = state.round;

  switch (round?.detail.game) {
    case "blackjack":
      return blackjackTurnKeys(round.detail);
    case "mines":
      return minesTurnKeys(round.detail, round.stake);
    case "hilo":
      return hiloTurnKeys(round.detail, round.stake);
    case "tower":
      return towerTurnKeys(round.detail, round.stake);
    default:
      return [];
  }
}

const SLOTS_SPEED_KEYS: readonly { hotkey: string; speed: SlotsSpeed }[] = [
  { hotkey: "x", speed: "normal" },
  { hotkey: "f", speed: "fast" },
  { hotkey: "t", speed: "turbo" },
];

/** `j` and `k` around a choice: `<address>-down` and `<address>-up`, labelled "mines −" and "mines +". */
function stepKeys(address: string, command: (step: -1 | 1) => Command): KeyAction[] {
  const name = STEPPER_NAMES[address] ?? address;

  return [
    { key: `${address}-down`, hotkey: "j", label: `${name} −`, isSelected: false, command: command(-1) },
    { key: `${address}-up`, hotkey: "k", label: `${name} +`, isSelected: false, command: command(1) },
  ];
}

const settingKeys = (setting: Setting): KeyAction[] => stepKeys(setting, (step) => ({ kind: "step", setting, step }));

function choiceKeys(game: Game, prefs: Prefs): KeyAction[] {
  switch (game) {
    case "blackjack":
      return stepKeys("hands", (step) => ({ kind: "hands", step }));
    case "roulette":
      return rouletteKeys(prefs);
    case "baccarat":
      return baccaratKeys(prefs);
    case "slots":
      return SLOTS_SPEED_KEYS.map(({ hotkey, speed }) => ({
        key: `slots-${speed}`,
        hotkey,
        label: speed,
        isSelected: prefs.slotsSpeed === speed,
        command: { kind: "slots-speed", speed },
      }));
    case "mines":
      return stepKeys("mines", (step) => ({ kind: "mines", step }));
    case "dice":
      return [
        ...settingKeys("dice"),
        {
          key: "dice-over",
          hotkey: "o",
          label: prefs.diceOver ? "roll over" : "roll under",
          isSelected: false,
          command: { kind: "dice-over" },
        },
      ];
    case "limbo":
      return settingKeys("limbo");
    case "flip":
      return [
        ...FLIP_SIDES.map((side) => ({
          key: `flip-${side}`,
          hotkey: side === "heads" ? "h" : "t",
          label: side,
          isSelected: prefs.flipSide === side,
          command: { kind: "flip-side", side } as const,
        })),
        ...settingKeys("flips"),
      ];
    case "keno":
      return [
        ...settingKeys("keno"),
        { key: "keno-random", hotkey: "r", label: "random picks", isSelected: false, command: { kind: "keno-random" } },
      ];
    case "wheel":
      return [
        ...settingKeys("wheel"),
        {
          key: "wheel-risk",
          hotkey: "r",
          label: `${prefs.wheelRisk} risk`,
          isSelected: false,
          command: { kind: "wheel-risk" },
        },
      ];
    case "hilo":
      return [];
    case "tower":
      return settingKeys("tower");
  }
}

/** The bet stepper and the start key after the game's choices; at roulette the bet is the chip size, and no spin without chips. */
function idleKeys(game: Game, state: StateResponse, prefs: Prefs): KeyAction[] {
  const amount = currentBet(state.limits, prefs.betIndex);
  const sized = game === "roulette" ? "chip" : "bet";
  const keys: KeyAction[] = [
    ...choiceKeys(game, prefs),
    { key: "bet-down", hotkey: "v", label: `${sized} −`, isSelected: false, command: { kind: "bet", step: -1 } },
    { key: "bet-up", hotkey: "b", label: `${sized} +`, isSelected: false, command: { kind: "bet", step: 1 } },
  ];

  if (game === "roulette" && prefs.rouletteChips.length === 0) {
    return keys;
  }

  return [
    ...keys,
    {
      key: "start",
      hotkey: "n",
      label: startLabel(game, amount, prefs),
      isSelected: false,
      command: { kind: "start" },
    },
  ];
}

/** Every key the drawing offers right now; empty play keys while blocked, busy or drawing. */
export function planKeys({ state, prefs, isBusy }: PlanInput): KeyAction[] {
  const switches = switchKeys(state, prefs);
  const canPlay = state.accountOpen && state.blocked === null && !isBusy && state.pendingIntentId === null;

  if (!canPlay) {
    return switches;
  }

  switch (state.round?.phase ?? "idle") {
    case "player_turn":
      return [...switches, ...playerTurnKeys(state)];
    case "drawing":
      return switches;
    case "idle":
      return [...switches, ...idleKeys(activeGame(state, prefs), state, prefs)];
  }
}

/** A key the key row always draws: live when the plan offers it, else dim and inert in its place. */
export interface RowKey {
  key: string;
  hotkey: string;
  label: string;
}

/**
 * The moves of a turn, by game, in plain words: on the key row in every phase, so a reflex press
 * of one is never typed into the prompt, and drawn dim they say nothing of the cards to come.
 */
const TURN_ROW: Partial<Record<Game, readonly RowKey[]>> = {
  blackjack: [
    { key: "bj-hit", hotkey: "h", label: "hit" },
    { key: "bj-stand", hotkey: "s", label: "stand" },
    { key: "bj-double", hotkey: "d", label: "double" },
    { key: "bj-split", hotkey: "p", label: "split" },
  ],
  hilo: [
    { key: "hilo-higher", hotkey: HILO_KEYS.higher, label: "higher" },
    { key: "hilo-lower", hotkey: HILO_KEYS.lower, label: "lower" },
    { key: "hilo-skip", hotkey: HILO_KEYS.skip, label: "skip" },
    { key: "hilo-cashout", hotkey: CASH_OUT_HOTKEY, label: "cash out" },
  ],
  mines: [{ key: "mines-cashout", hotkey: CASH_OUT_HOTKEY, label: "cash out" }],
  tower: [{ key: "tower-cashout", hotkey: CASH_OUT_HOTKEY, label: "cash out" }],
};

/**
 * The game's key row, in the order it is drawn whatever the phase: its turn's moves, then its
 * choices, the bet and the start key. The labels are the ones the next round is set up with (or plain words
 * for a turn's moves), never a round's own: drawn dim while a move is in flight or the cards turn,
 * they tell nothing of how it ends.
 */
export function keyRow(game: Game, state: StateResponse, prefs: Prefs): RowKey[] {
  return [...(TURN_ROW[game] ?? []), ...idleKeys(game, state, prefs)].map(({ key, hotkey, label }) => ({
    key,
    hotkey,
    label,
  }));
}

/** A click-only key: no hotkey, so no letter ever presses it. */
const clickKey = (key: string, label: string, isSelected: boolean, command: Command): KeyAction => ({
  key,
  hotkey: "",
  label,
  isSelected,
  command,
});

/** The address of a layout cell's click: `roulette-straight-17`, `roulette-dozen-2`, `roulette-column-3`, `roulette-red`. */
export function rouletteCellKey(bet: RouletteBet): string {
  switch (bet.kind) {
    case "straight":
      return `${ROULETTE_STRAIGHT_KEY}${bet.number}`;
    case "dozen":
      return `${ROULETTE_DOZEN_KEY}${bet.dozen}`;
    case "column":
      return `${ROULETTE_COLUMN_KEY}${bet.column}`;
    default:
      return `roulette-${bet.kind}`;
  }
}

/** The roulette layout's cells a click puts a chip on: every number, each dozen and each column. */
function rouletteLayoutKeys(placed: readonly RouletteChip[]): KeyAction[] {
  return ROULETTE_CURSOR_CELLS.map((bet) =>
    clickKey(rouletteCellKey(bet), rouletteBetLabel(bet), stakeOn(placed, bet) > 0n, { kind: "roulette-add", bet }),
  );
}

/**
 * The plan, and the keys only a click on the fullscreen table presses, while the next round's
 * choices can change: the forty Keno numbers, the roulette layout's numbers, dozens and columns.
 */
export function tableKeys(input: PlanInput): KeyAction[] {
  const keys = planKeys(input);

  if (keys.some((key) => key.key === "roulette-red")) {
    return [...keys, ...rouletteLayoutKeys(input.prefs.rouletteChips)];
  }

  if (!keys.some((key) => key.key === "keno-random")) {
    return keys;
  }

  const picks = input.prefs.kenoPicks;
  const numbers = Array.from({ length: KENO_NUMBERS }, (_, index) => index + 1);

  return [
    ...keys,
    ...numbers.map((number) =>
      clickKey(`${KENO_PICK_KEY}${number}`, String(number), picks.includes(number), { kind: "keno-pick", number }),
    ),
  ];
}

/**
 * The round as it will be once the draw in flight lands, for the keys it will offer: a Mines
 * reveal, a tower climb or a Hilo card lands back on the player's turn (unless it busts), any
 * other draw settles the round.
 */
function afterDraw(round: RoundView): RoundView {
  const detail = round.detail;
  const turn = { ...round, phase: "player_turn" as const };

  switch (detail.game) {
    case "mines":
      return {
        ...turn,
        detail: { ...detail, canReveal: detail.nextMultiplier !== null, canCashOut: detail.revealed.length > 0 },
      };
    case "tower":
      return {
        ...turn,
        detail: { ...detail, canClimb: detail.nextMultiplier !== null, canCashOut: detail.climbed.length > 0 },
      };
    case "hilo":
      // A round's first card being drawn: no guess before it shows.
      return { ...turn, detail: { ...detail, canGuess: detail.cards.length > 0 } };
    default:
      return { ...round, phase: "idle" };
  }
}

/**
 * The play keys a move in flight or a draw holds back, drawn dim and inert in their place: a key
 * no Button of the focused pane takes goes to the prompt, where a mashed Enter would then send
 * "nnnn" to the agent. Empty while play is open, blocked, or the account is not open.
 */
export function heldKeys({ state, prefs, isBusy }: PlanInput): KeyAction[] {
  const round = state.round;
  const isHeld = isBusy || state.pendingIntentId !== null || round?.phase === "drawing";

  if (!state.accountOpen || state.blocked !== null || !isHeld) {
    return [];
  }

  // A reveal, a climb or a card being drawn holds the board's keys, the ones mashed meanwhile
  // included: the keys the board offers once the draw lands, unless it busts.
  const settled = round?.phase !== "drawing" ? state : { ...state, round: afterDraw(round) };

  return planKeys({ state: { ...settled, pendingIntentId: null }, prefs, isBusy: false }).filter(
    (key) => key.command.kind !== "switch",
  );
}
