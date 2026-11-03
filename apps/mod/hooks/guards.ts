// Shape checks for what the api sends. The mod cannot import zod, so these small guards are the
// boundary: anything that fails them is shown as a one-line error instead of being drawn.
import { rouletteBetLabel } from "./format";
import {
  DICE_ROLLS,
  FLIP_SIDES,
  HILO_GUESSES,
  KENO_DRAWN,
  KENO_NUMBERS,
  MAX_DICE_CHANCE,
  MAX_FLIPS,
  MAX_HANDS,
  MAX_HILO_CARDS,
  MAX_HILO_SKIPS,
  MAX_KENO_PICKS,
  MAX_LIMBO_TARGET,
  MAX_MINES,
  MAX_ROULETTE_CHIPS,
  MAX_TABLE_HANDS,
  MAX_TOWER_TILES,
  MIN_DICE_CHANCE,
  MIN_FLIPS,
  MIN_HANDS,
  MIN_KENO_PICKS,
  MIN_LIMBO_TARGET,
  MIN_MINES,
  MINES_TILES,
  TOWER_DIFFICULTIES,
  TOWER_LEVELS,
  TOWER_SHAPES,
  WHEEL_RISKS,
  WHEEL_SEGMENTS,
} from "./keys";
import type {
  BaccaratBet,
  BlackjackHandView,
  Card,
  DeviceStartResponse,
  DeviceTokenResponse,
  FlipSide,
  Game,
  HiloGuess,
  IntentResponse,
  LeaderboardEntry,
  PlayAction,
  RouletteBet,
  RouletteChip,
  RoundView,
  SponsorView,
  StateResponse,
  TowerDifficulty,
} from "./protocol";

type Json = Record<string, unknown>;

const GAMES: readonly string[] = [
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
const SUITS: readonly string[] = ["♠", "♥", "♦", "♣"];
const PHASES: readonly string[] = ["idle", "drawing", "player_turn"];
const BACCARAT_BETS: readonly string[] = ["player", "banker", "tie"];
const INTENT_STATUSES: readonly string[] = ["pending", "submitted", "failed"];
const PLAIN_ROULETTE_BETS: readonly string[] = ["red", "black", "odd", "even", "low", "high"];
const BLACKJACK_RESULTS: readonly string[] = ["blackjack", "win", "push", "lose"];

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isInt = (value: unknown): value is number => Number.isInteger(value);
const isBool = (value: unknown): value is boolean => typeof value === "boolean";
const isNullable = <T>(value: unknown, guard: (item: unknown) => item is T): value is T | null =>
  value === null || guard(value);
const isArrayOf = <T>(value: unknown, guard: (item: unknown) => item is T): value is T[] =>
  Array.isArray(value) && value.every(guard);

/** Unsigned integer base units as a decimal string. */
const isAmount = (value: unknown): value is string => isString(value) && /^\d{1,30}$/.test(value);
/** Signed integer base units, e.g. "-500000". */
const isSignedAmount = (value: unknown): value is string => isString(value) && /^-?\d{1,30}$/.test(value);
const isOneOf = (value: unknown, allowed: readonly string[]): value is string =>
  isString(value) && allowed.includes(value);
const isThird = (value: unknown): value is 1 | 2 | 3 => value === 1 || value === 2 || value === 3;

export const isGame = (value: unknown): value is Game => isOneOf(value, GAMES);

const ROULETTE_POCKETS = 37;
const isPocket = (value: unknown): value is number => isInt(value) && value >= 0 && value < ROULETTE_POCKETS;

const isCard = (value: unknown): value is Card =>
  isRecord(value) && isInt(value.rank) && value.rank >= 1 && value.rank <= 13 && isOneOf(value.suit, SUITS);

export const isRouletteBet = (value: unknown): value is RouletteBet => {
  if (!isRecord(value)) {
    return false;
  }

  switch (value.kind) {
    case "straight":
      return isInt(value.number) && value.number >= 0 && value.number <= 36;
    case "dozen":
      return isThird(value.dozen);
    case "column":
      return isThird(value.column);
    default:
      return isOneOf(value.kind, PLAIN_ROULETTE_BETS);
  }
};

const isBaccaratBet = (value: unknown): value is BaccaratBet => isOneOf(value, BACCARAT_BETS);

/** Base units greater than zero: a stake. */
const isStake = (value: unknown): value is string => isAmount(value) && BigInt(value) > 0n;
export const isRouletteChip = (value: unknown): value is RouletteChip =>
  isRecord(value) && isRouletteBet(value.bet) && isStake(value.amount);
/** 1 to 20 chips, no two on the same bet. */
export const isRouletteChips = (value: unknown): value is RouletteChip[] =>
  isArrayOf(value, isRouletteChip) &&
  value.length >= 1 &&
  value.length <= MAX_ROULETTE_CHIPS &&
  new Set(value.map((chip) => rouletteBetLabel(chip.bet))).size === value.length;
const isHandCount = (value: unknown): value is number => isInt(value) && value >= MIN_HANDS && value <= MAX_HANDS;
/** Hands on the table: the dealt ones plus the splits. */
const isTableHandCount = (value: unknown): value is number =>
  isInt(value) && value >= MIN_HANDS && value <= MAX_TABLE_HANDS;
const isMineCount = (value: unknown): value is number => isInt(value) && value >= MIN_MINES && value <= MAX_MINES;
const isTile = (value: unknown): value is number => isInt(value) && value >= 0 && value < MINES_TILES;
/** "1.0312": the api floors multipliers to 4 decimals. */
const isMultiplier = (value: unknown): value is string => isString(value) && /^\d{1,12}\.\d{4}$/.test(value);
/** "2.00": chosen targets and payout tables come with 2 decimals. */
const isShortMultiplier = (value: unknown): value is string => isString(value) && /^\d{1,12}\.\d{2}$/.test(value);

/** A dice target whose winning count is 1 % to 98 % of the rolls. */
const isDiceTarget = (target: unknown, over: unknown): target is number => {
  if (!isInt(target) || !isBool(over)) {
    return false;
  }

  const chance = over ? DICE_ROLLS - target : target;

  return chance >= MIN_DICE_CHANCE && chance <= MAX_DICE_CHANCE;
};
const isLimboTarget = (value: unknown): value is number =>
  isInt(value) && value >= MIN_LIMBO_TARGET && value <= MAX_LIMBO_TARGET;
const isFlipSide = (value: unknown): value is FlipSide => isOneOf(value, FLIP_SIDES);
const isFlipCount = (value: unknown): value is number => isInt(value) && value >= MIN_FLIPS && value <= MAX_FLIPS;
const isKenoNumber = (value: unknown): value is number => isInt(value) && value >= 1 && value <= KENO_NUMBERS;
const isDistinct = (values: readonly number[]): boolean => new Set(values).size === values.length;
export const isKenoPicks = (value: unknown): value is number[] =>
  isArrayOf(value, isKenoNumber) &&
  value.length >= MIN_KENO_PICKS &&
  value.length <= MAX_KENO_PICKS &&
  isDistinct(value);
const isWheelSegments = (value: unknown): value is number => isInt(value) && WHEEL_SEGMENTS.includes(value);
const isHiloGuess = (value: unknown): value is HiloGuess => isOneOf(value, HILO_GUESSES);
const isTowerDifficulty = (value: unknown): value is TowerDifficulty => isOneOf(value, TOWER_DIFFICULTIES);
const isTowerTile = (value: unknown): value is number => isInt(value) && value >= 0 && value < MAX_TOWER_TILES;

export const isPlayAction = (value: unknown): value is PlayAction => {
  if (!isRecord(value)) {
    return false;
  }

  switch (value.type) {
    case "blackjack_hit":
    case "blackjack_stand":
    case "blackjack_double":
    case "blackjack_split":
      return true;
    case "blackjack_bet":
      return isStake(value.amount) && isHandCount(value.hands);
    case "slots_spin":
      return isStake(value.amount);
    case "roulette_spin":
      return isStake(value.amount) && isRouletteBet(value.bet);
    case "roulette_chips":
      return isRouletteChips(value.chips);
    case "baccarat_deal":
      return isStake(value.amount) && isBaccaratBet(value.bet);
    case "mines_bet":
      return isStake(value.amount) && isMineCount(value.mines);
    case "mines_reveal":
      return isTile(value.tile);
    case "mines_cashout":
    case "hilo_cashout":
    case "tower_cashout":
      return true;
    case "dice_roll":
      return isStake(value.amount) && isDiceTarget(value.target, value.over);
    case "limbo_play":
      return isStake(value.amount) && isLimboTarget(value.target);
    case "flip_play":
      return isStake(value.amount) && isFlipSide(value.side) && isFlipCount(value.flips);
    case "keno_play":
      return isStake(value.amount) && isKenoPicks(value.picks);
    case "wheel_spin":
      return isStake(value.amount) && isWheelSegments(value.segments) && isOneOf(value.risk, WHEEL_RISKS);
    case "hilo_bet":
      return isStake(value.amount);
    case "hilo_guess":
      return isHiloGuess(value.guess);
    case "tower_bet":
      return isStake(value.amount) && isTowerDifficulty(value.difficulty);
    case "tower_climb":
      return isTowerTile(value.tile);
    default:
      return false;
  }
};

const isReels = (value: unknown): value is [string, string, string] =>
  Array.isArray(value) && value.length === 3 && value.every(isString);

const isBlackjackHand = (value: unknown): value is BlackjackHandView =>
  isRecord(value) &&
  isArrayOf(value.cards, isCard) &&
  isInt(value.total) &&
  isBool(value.soft) &&
  isBool(value.doubled) &&
  isBool(value.split) &&
  isAmount(value.stake) &&
  (value.result === null || isOneOf(value.result, BLACKJACK_RESULTS));

const isBlackjack = (value: Json): boolean =>
  isArrayOf(value.hands, isBlackjackHand) &&
  isTableHandCount(value.hands.length) &&
  (value.activeHand === null ||
    (isInt(value.activeHand) && value.activeHand >= 0 && value.activeHand < value.hands.length)) &&
  isArrayOf(value.dealer, isCard) &&
  isInt(value.dealerTotal) &&
  isBool(value.canHit) &&
  isBool(value.canDouble) &&
  isBool(value.canSplit);

/** A board the mod can draw: distinct safe tiles, at most the 25 − mines there are, none of them pending or the mine. */
const isMines = (value: Json): boolean => {
  if (!isMineCount(value.mines) || !isArrayOf(value.revealed, isTile)) {
    return false;
  }

  const revealed = new Set(value.revealed);
  const isFreeTile = (tile: unknown) => tile === null || (isTile(tile) && !revealed.has(tile));

  return (
    revealed.size === value.revealed.length &&
    revealed.size <= MINES_TILES - value.mines &&
    isFreeTile(value.pending) &&
    isFreeTile(value.busted) &&
    isMultiplier(value.multiplier) &&
    isNullable(value.nextMultiplier, isMultiplier) &&
    isBool(value.canCashOut) &&
    isBool(value.canReveal)
  );
};

const isDice = (value: Json): boolean =>
  isDiceTarget(value.target, value.over) &&
  isNullable(value.roll, isInt) &&
  (value.roll === null || (value.roll >= 0 && value.roll < DICE_ROLLS)) &&
  isMultiplier(value.multiplier);

const isFlip = (value: Json): boolean =>
  isFlipSide(value.side) &&
  isFlipCount(value.flips) &&
  (value.results === null || (isArrayOf(value.results, isFlipSide) && value.results.length === value.flips)) &&
  isMultiplier(value.multiplier);

/** Ten distinct numbers drawn, and the hits they make with the picks. */
const isKeno = (value: Json): boolean => {
  if (!isKenoPicks(value.picks) || !isArrayOf(value.paytable, isShortMultiplier)) {
    return false;
  }

  if (value.paytable.length !== value.picks.length + 1) {
    return false;
  }

  if (value.drawn === null) {
    return value.hits === null;
  }

  if (!isArrayOf(value.drawn, isKenoNumber) || value.drawn.length !== KENO_DRAWN || !isDistinct(value.drawn)) {
    return false;
  }

  const drawn = new Set(value.drawn);

  return value.hits === value.picks.filter((pick) => drawn.has(pick)).length;
};

const isWheel = (value: Json): boolean =>
  isWheelSegments(value.segments) &&
  isOneOf(value.risk, WHEEL_RISKS) &&
  isArrayOf(value.multipliers, isShortMultiplier) &&
  value.multipliers.length === value.segments &&
  isNullable(value.segment, isInt) &&
  (value.segment === null || (value.segment >= 0 && value.segment < value.segments));

/** The first card, then one card per guess; a pending guess waits on a board that has a card. */
const isHilo = (value: Json): boolean =>
  isArrayOf(value.cards, isCard) &&
  value.cards.length <= MAX_HILO_CARDS &&
  isArrayOf(value.guesses, isHiloGuess) &&
  value.guesses.length === Math.max(0, value.cards.length - 1) &&
  isNullable(value.pending, isHiloGuess) &&
  (value.pending === null || value.cards.length > 0) &&
  isMultiplier(value.multiplier) &&
  isNullable(value.higherMultiplier, isMultiplier) &&
  isNullable(value.lowerMultiplier, isMultiplier) &&
  isInt(value.skipsLeft) &&
  value.skipsLeft >= 0 &&
  value.skipsLeft <= MAX_HILO_SKIPS &&
  isBool(value.canGuess) &&
  isBool(value.canCashOut) &&
  isBool(value.busted);

/** A tower the mod can draw: its shape matches the difficulty, at most nine levels, every tile on the board. */
const isTower = (value: Json): boolean => {
  if (!isTowerDifficulty(value.difficulty) || value.tiles !== TOWER_SHAPES[value.difficulty].tiles) {
    return false;
  }

  const tiles = value.tiles;
  const isLevelTile = (tile: unknown): tile is number => isInt(tile) && tile >= 0 && tile < tiles;

  return (
    value.levels === TOWER_LEVELS &&
    isArrayOf(value.climbed, isLevelTile) &&
    value.climbed.length <= TOWER_LEVELS &&
    isNullable(value.pending, isLevelTile) &&
    isNullable(value.busted, isLevelTile) &&
    (value.pending === null || value.busted === null) &&
    ((value.pending === null && value.busted === null) || value.climbed.length < TOWER_LEVELS) &&
    isMultiplier(value.multiplier) &&
    isNullable(value.nextMultiplier, isMultiplier) &&
    isBool(value.canClimb) &&
    isBool(value.canCashOut)
  );
};

const isDetail = (value: unknown): value is RoundView["detail"] => {
  if (!isRecord(value)) {
    return false;
  }

  switch (value.game) {
    case "blackjack":
      return isBlackjack(value);
    case "roulette":
      return isRouletteBet(value.bet) && isRouletteChips(value.chips) && isNullable(value.number, isPocket);
    case "baccarat":
      return (
        isBaccaratBet(value.bet) &&
        isArrayOf(value.player, isCard) &&
        isArrayOf(value.banker, isCard) &&
        isInt(value.playerPoints) &&
        isInt(value.bankerPoints)
      );
    case "slots":
      return isNullable(value.reels, isReels);
    case "mines":
      return isMines(value);
    case "dice":
      return isDice(value);
    case "limbo":
      return isShortMultiplier(value.target) && isNullable(value.result, isShortMultiplier);
    case "flip":
      return isFlip(value);
    case "keno":
      return isKeno(value);
    case "wheel":
      return isWheel(value);
    case "hilo":
      return isHilo(value);
    case "tower":
      return isTower(value);
    default:
      return false;
  }
};

const isRound = (value: unknown): value is RoundView =>
  isRecord(value) &&
  isOneOf(value.phase, PHASES) &&
  isAmount(value.stake) &&
  isAmount(value.payout) &&
  isAmount(value.fee) &&
  isSignedAmount(value.net) &&
  isInt(value.number) &&
  isNullable(value.settledSignature, isString) &&
  isDetail(value.detail);

const isSponsor = (value: unknown): value is SponsorView =>
  isRecord(value) &&
  isString(value.name) &&
  isNullable(value.tagline, isString) &&
  isAmount(value.pool) &&
  isString(value.endsAt) &&
  !Number.isNaN(Date.parse(value.endsAt));

const isLeaderboardEntry = (value: unknown): value is LeaderboardEntry =>
  isRecord(value) && isInt(value.rank) && isString(value.handle) && isSignedAmount(value.net) && isBool(value.isYou);

const isRtp = (value: unknown): value is Record<Game, string> =>
  isRecord(value) && GAMES.every((game) => isString(value[game]));

export function isStateResponse(value: unknown): value is StateResponse {
  return (
    isRecord(value) &&
    isBool(value.accountOpen) &&
    isAmount(value.balance) &&
    isNullable(value.round, isRound) &&
    isNullable(value.pendingIntentId, isString) &&
    isRecord(value.limits) &&
    isAmount(value.limits.minBet) &&
    isAmount(value.limits.maxBet) &&
    isRtp(value.rtp) &&
    isNullable(value.sponsor, isSponsor) &&
    isArrayOf(value.leaderboard, isLeaderboardEntry) &&
    isNullable(value.rank, isInt) &&
    (value.ahead === undefined || isNullable(value.ahead, isLeaderboardEntry)) &&
    (value.webUrl === undefined || isString(value.webUrl)) &&
    isNullable(value.blocked, isString)
  );
}

export function isIntentResponse(value: unknown): value is IntentResponse {
  return (
    isRecord(value) &&
    isString(value.intentId) &&
    isOneOf(value.status, INTENT_STATUSES) &&
    (value.error === null || (isRecord(value.error) && isString(value.error.code) && isString(value.error.message)))
  );
}

export function isDeviceStart(value: unknown): value is DeviceStartResponse {
  return (
    isRecord(value) &&
    isString(value.deviceCode) &&
    isString(value.userCode) &&
    isString(value.verifyUrl) &&
    /^https?:\/\//.test(value.verifyUrl) &&
    typeof value.expiresIn === "number" &&
    value.expiresIn > 0 &&
    typeof value.interval === "number" &&
    value.interval > 0
  );
}

export function isDeviceToken(value: unknown): value is DeviceTokenResponse {
  if (!isRecord(value)) {
    return false;
  }

  if (value.status === "approved") {
    return isString(value.token) && value.token.length > 0 && isString(value.expiresAt);
  }

  return value.status === "pending" || value.status === "expired" || value.status === "denied";
}

/** The `{ error: { code, message } }` body of a failed call, when it has one. */
export function errorOf(value: unknown): { code: string; message: string } | null {
  if (isRecord(value) && isRecord(value.error) && isString(value.error.code) && isString(value.error.message)) {
    return { code: value.error.code, message: value.error.message };
  }

  return null;
}
