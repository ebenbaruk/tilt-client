// Pure formatting: money, durations, cards. No `$`, so it is unit-tested directly.
import type { Card, RouletteBet, RouletteChip } from "./protocol";

export const MINUS = "−";
export const SEPARATOR = " · ";

/** USDC has 6 decimals; the mod shows cents, so 10,000 base units per cent. */
const BASE_UNITS_PER_CENT = 10_000n;
const CENTS_PER_USDC = 100n;

export function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Base units ("12400000") to "12.40", en-US grouping; sub-cent dust is truncated toward zero. */
export function formatUsdc(amount: string): string {
  const value = BigInt(amount);
  const cents = (value < 0n ? -value : value) / BASE_UNITS_PER_CENT;
  const whole = groupDigits((cents / CENTS_PER_USDC).toString());
  const fraction = (cents % CENTS_PER_USDC).toString().padStart(2, "0");
  const sign = value < 0n && cents > 0n ? MINUS : "";

  return `${sign}${whole}.${fraction}`;
}

/** A delta with its sign always shown: "+1.25", "−0.50", "0.00". */
export function formatSigned(net: string): string {
  const text = formatUsdc(net);

  return BigInt(net) > 0n && text !== "0.00" ? `+${text}` : text;
}

const THOUSAND = 1_000n;

/** A chip's stake in as few characters as the felt has: "2", "2.5", ".5", "1k". Sub-cent dust is truncated. */
export function compactUsdc(amount: string): string {
  const cents = BigInt(amount) / BASE_UNITS_PER_CENT;
  const whole = cents / CENTS_PER_USDC;
  const fraction = (cents % CENTS_PER_USDC).toString().padStart(2, "0").replace(/0+$/, "");

  if (fraction !== "") {
    return `${whole === 0n ? "" : whole.toString()}.${fraction}`;
  }

  return whole >= THOUSAND && whole % THOUSAND === 0n ? `${whole / THOUSAND}k` : whole.toString();
}

/** Cash-out multipliers (Mines, Hilo, Tower) come with exactly 4 decimals ("1.0312"). */
const MULTIPLIER_DECIMALS = 4;
const MULTIPLIER_SCALE = 10n ** BigInt(MULTIPLIER_DECIMALS);

/**
 * What a cash-out at `multiplier` returns on `stake`, in base units, before Tilt's fee:
 * stake × multiplier, floored (the multiplier is floored too, so both only round down). Integer
 * math on the decimal string, never a float; the program computes the real payout.
 */
export function cashOutPayout(stake: string, multiplier: string): string {
  const [whole = "0", fraction = ""] = multiplier.split(".");
  const scaled = BigInt(`${whole}${fraction.padEnd(MULTIPLIER_DECIMALS, "0").slice(0, MULTIPLIER_DECIMALS)}`);

  return ((BigInt(stake) * scaled) / MULTIPLIER_SCALE).toString();
}

/** "1.53" (2 decimals, as the api sends multipliers) in hundredths: 153n. */
export const hundredths = (multiplier: string): bigint => BigInt(multiplier.replace(".", ""));

/** A multiplier as the table shows it, cut to 2 decimals: "×2.2151" reads "×2.21", as the other
 *  games' "×1.95". Cut, never rounded up: it never shows more than the round pays. */
export function shortMultiplier(multiplier: string): string {
  const [whole, fraction = ""] = multiplier.split(".");

  return `${whole ?? multiplier}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

/** A whole number of 10^-decimals as a decimal string: (19600n, 4) → "1.9600", (742n, 2) → "7.42". */
export function scaledDecimal(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const fraction = (value % scale).toString().padStart(decimals, "0");

  return `${value / scale}.${fraction}`;
}

/** What a dice win pays on a winning count of `chance` rolls in 10 000: 98 % / chance, 4 decimals, floored. */
export function diceMultiplier(chance: number): string {
  return scaledDecimal((9_800n * MULTIPLIER_SCALE) / BigInt(chance), MULTIPLIER_DECIMALS);
}

/** What a flip of `flips` coins pays when all land on the side: 0.98 × 2^flips, 4 decimals. */
export function flipMultiplier(flips: number): string {
  return scaledDecimal((98n * 2n ** BigInt(flips) * MULTIPLIER_SCALE) / 100n, MULTIPLIER_DECIMALS);
}

/** Tower after `levels` safe levels: 0.98 × (tiles / safe)^levels, 4 decimals, floored, before the round's cap. */
export function towerMultiplier(tiles: number, safe: number, levels: number): string {
  const scaled = (98n * BigInt(tiles) ** BigInt(levels) * MULTIPLIER_SCALE) / (100n * BigInt(safe) ** BigInt(levels));

  return scaledDecimal(scaled, MULTIPLIER_DECIMALS);
}

/** 31_400 → "31s", 374_000 → "6m 14s", 3_720_000 → "1h 2m". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`;
  }

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Time left in a competition: "12m", "14h 3m", "2d 4h", or "ended". */
export function formatCountdown(ms: number): string {
  if (ms <= 0) {
    return "ended";
  }

  const minutes = Math.max(1, Math.floor(ms / 60_000));

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ${minutes % 60}m`;
  }

  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

const FACES: Record<number, string> = { 1: "A", 11: "J", 12: "Q", 13: "K" };

export function rankLabel(rank: number): string {
  return FACES[rank] ?? String(rank);
}

export function isRedSuit(suit: Card["suit"]): boolean {
  return suit === "♥" || suit === "♦";
}

/** "A♠", "10♥": a card's rank and suit, as the table and the summaries draw it. */
export function cardFace(card: Card): string {
  return `${rankLabel(card.rank)}${card.suit}`;
}

/** The ranks the api sends for an ace and a king, and how many ranks there are. */
const ACE_RANK = 1;
const KING_RANK = 13;
const RANKS = 13;

/**
 * A Hilo guess as the program plays it on the current card's rank: "higher or same" and "lower or
 * same", but a strict "higher" on an ace and a strict "lower" on a king (chain/…/games/hilo.rs).
 */
export function hiloGuessName(guess: "higher" | "lower", rank: number): string {
  const isStrict = guess === "higher" ? rank === ACE_RANK : rank === KING_RANK;

  return isStrict ? guess : `${guess} or same`;
}

/** The chance a Hilo guess is right on the current card's rank, in whole percent: the ranks that win of the 13. */
export function hiloChance(guess: "higher" | "lower", rank: number): number {
  const winning =
    guess === "higher" ? (rank === ACE_RANK ? RANKS - 1 : RANKS + 1 - rank) : rank === KING_RANK ? RANKS - 1 : rank;

  return Math.round((winning * 100) / RANKS);
}

const RED_POCKETS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export function pocketColor(pocket: number): "green" | "red" | "black" {
  if (pocket === 0) {
    return "green";
  }

  return RED_POCKETS.has(pocket) ? "red" : "black";
}

export function rouletteBetLabel(bet: RouletteBet): string {
  switch (bet.kind) {
    case "straight":
      return `number ${bet.number}`;
    case "dozen":
      return `dozen ${bet.dozen}`;
    case "column":
      return `column ${bet.column}`;
    default:
      return bet.kind;
  }
}

/** Whether `bet` wins when the ball lands in `pocket`; 0 loses every bet but a straight on it. */
export function rouletteWins(bet: RouletteBet, pocket: number): boolean {
  if (bet.kind === "straight") {
    return bet.number === pocket;
  }

  if (pocket === 0) {
    return false;
  }

  switch (bet.kind) {
    case "red":
      return RED_POCKETS.has(pocket);
    case "black":
      return !RED_POCKETS.has(pocket);
    case "odd":
      return pocket % 2 === 1;
    case "even":
      return pocket % 2 === 0;
    case "low":
      return pocket <= 18;
    case "high":
      return pocket >= 19;
    case "dozen":
      return Math.floor((pocket - 1) / 12) + 1 === bet.dozen;
    case "column":
      return ((pocket - 1) % 3) + 1 === bet.column;
  }
}

/** What a winning chip returns per unit staked, the stake included: 36 on a number, 3 on a dozen or a column, 2 on the rest. */
function rouletteReturn(bet: RouletteBet): bigint {
  switch (bet.kind) {
    case "straight":
      return 36n;
    case "dozen":
    case "column":
      return 3n;
    default:
      return 2n;
  }
}

export const chipsTotal = (chips: readonly RouletteChip[]): bigint =>
  chips.reduce((total, chip) => total + BigInt(chip.amount), 0n);

/** What the chips return when the ball lands in `pocket`, before Tilt's fee, as the program pays it. */
export const rouletteGross = (chips: readonly RouletteChip[], pocket: number): bigint =>
  chips.reduce(
    (gross, chip) => gross + (rouletteWins(chip.bet, pocket) ? BigInt(chip.amount) * rouletteReturn(chip.bet) : 0n),
    0n,
  );

const ROULETTE_POCKETS = 37;

/** The most the chips can win over their stake on one pocket, before Tilt's fee; 0 when no pocket gains. */
export function rouletteMaxGain(chips: readonly RouletteChip[]): bigint {
  const total = chipsTotal(chips);
  let best = 0n;

  for (let pocket = 0; pocket < ROULETTE_POCKETS; pocket++) {
    const gain = rouletteGross(chips, pocket) - total;

    best = gain > best ? gain : best;
  }

  return best;
}

/** Control characters (escape sequences) and format characters (bidi overrides, zero-width joiners). */
const UNSHOWN_CHARACTERS = /[\p{Cc}\p{Cf}]/gu;
const MAX_SHOWN_TEXT = 200;

/** Server text is drawn in the person's terminal: no escape sequence reaches it, no bidi override
 * reorders what follows, and the cut never splits an emoji into a lone surrogate. */
export function cleanText(text: string): string {
  return Array.from(text.replace(UNSHOWN_CHARACTERS, "")).slice(0, MAX_SHOWN_TEXT).join("");
}

/** The program's refusals a player can meet, in words; the api sends their Anchor names. */
const REFUSALS: Record<string, string> = {
  VaultTooSmall: "The casino cannot cover a bet this size right now: try a smaller one.",
  RiskPoolFull: "The casino is busy covering other tables: try again in a moment, or bet smaller.",
  RoundGainTooHigh: "This bet could win more than one round allows: lower it.",
  InsufficientBalance: "Not enough balance for this bet.",
  AmountOutOfRange: "This bet is outside the table limits.",
  Paused: "Play is paused for now.",
};

/** Why a move failed, as the pane says it. */
export function moveFailure(message: string): string {
  return REFUSALS[message] ?? cleanText(message);
}
