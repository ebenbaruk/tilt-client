// Protocol between the Claude Code mod and `apps/api` (spec §5, §7).
// Pure types with no imports: the mod can only load files inside its own folder, and
// `apps/api` imports this file as `@tilt/mod/protocol` and checks its zod schemas against it.
// Amounts are integer USDC base units (6 decimals) as decimal strings, never floats.

export type Amount = string;
export type Game =
  | "blackjack"
  | "roulette"
  | "baccarat"
  | "slots"
  | "mines"
  | "dice"
  | "limbo"
  | "flip"
  | "keno"
  | "wheel"
  | "hilo"
  | "tower";

/** Same shape as `RouletteBet` in `@tilt/contract` (relay schema). */
export type RouletteBet =
  | { kind: "straight"; number: number }
  | { kind: "red" }
  | { kind: "black" }
  | { kind: "odd" }
  | { kind: "even" }
  | { kind: "low" }
  | { kind: "high" }
  | { kind: "dozen"; dozen: 1 | 2 | 3 }
  | { kind: "column"; column: 1 | 2 | 3 };

/** One chip on the roulette table: a bet and its stake. */
export interface RouletteChip {
  bet: RouletteBet;
  amount: Amount;
}

export type BaccaratBet = "player" | "banker" | "tie";

export type FlipSide = "heads" | "tails";
export type WheelRisk = "low" | "medium" | "high";
/** Higher: the next rank is ≥ the current one. Lower: ≤. Skip: a new card, the multiplier unchanged. */
export type HiloGuess = "higher" | "lower" | "skip";
/** Tiles per level and safe tiles among them: easy 4/3, medium 3/2, hard 2/1, expert 3/1, master 4/1. */
export type TowerDifficulty = "easy" | "medium" | "hard" | "expert" | "master";

/** Game moves only. Deposits, withdrawals and account opening are web-only (spec §10.5). */
export type PlayAction =
  /** `amount` is the bet on EACH hand; `hands` is 1 to 6, all against one dealer. */
  | { type: "blackjack_bet"; amount: Amount; hands: number }
  | { type: "blackjack_hit" }
  | { type: "blackjack_stand" }
  | { type: "blackjack_double" }
  /** Splits the active hand's pair into two hands; at most 4 splits per round. */
  | { type: "blackjack_split" }
  /** Old single-bet spin; the mod sends `roulette_chips` for every spin now. */
  | { type: "roulette_spin"; amount: Amount; bet: RouletteBet }
  /** 1 to 20 chips on distinct bets, each within the bet limits; the stake is their sum. */
  | { type: "roulette_chips"; chips: RouletteChip[] }
  | { type: "baccarat_deal"; amount: Amount; bet: BaccaratBet }
  | { type: "slots_spin"; amount: Amount }
  /** Opens a 5×5 Mines board hiding `mines` mines (1 to 24). */
  | { type: "mines_bet"; amount: Amount; mines: number }
  /** Reveals tile 0 to 24 (row × 5 + column), one not revealed yet. */
  | { type: "mines_reveal"; tile: number }
  /** Takes the current multiplier; needs at least one safe tile. */
  | { type: "mines_cashout" }
  /**
   * Rolls 00.00 to 99.99 (`roll` 0 to 9999). Under wins iff roll < target, over iff roll ≥ target;
   * the winning count (target, or 10000 − target) is 100 to 9800 (1 % to 98 %).
   */
  | { type: "dice_roll"; amount: Amount; target: number; over: boolean }
  /** `target` is the multiplier × 100, 101 to 1 000 000 (1.01× to 10 000×). */
  | { type: "limbo_play"; amount: Amount; target: number }
  /** Wins iff every one of `flips` coins (1 to 10) lands on `side`. */
  | { type: "flip_play"; amount: Amount; side: FlipSide; flips: number }
  /** 1 to 10 distinct numbers from 1 to 40; ten are drawn. */
  | { type: "keno_play"; amount: Amount; picks: number[] }
  /** `segments` is 10, 20, 30, 40 or 50. */
  | { type: "wheel_spin"; amount: Amount; segments: number; risk: WheelRisk }
  /** Starts a Hilo round and draws its first card. */
  | { type: "hilo_bet"; amount: Amount }
  /** A guess on the next card: higher or same, lower or same; strict higher on an ace, strict lower on a king. */
  | { type: "hilo_guess"; guess: HiloGuess }
  /** Takes the current multiplier; needs at least one right guess. */
  | { type: "hilo_cashout" }
  /** Opens a 9-level tower; no draw until the first climb. */
  | { type: "tower_bet"; amount: Amount; difficulty: TowerDifficulty }
  /** Picks tile 0 to tiles − 1 of the current level. */
  | { type: "tower_climb"; tile: number }
  /** Takes the current multiplier; needs at least one level climbed. */
  | { type: "tower_cashout" };

// ---- Auth: device-code login (`/tilt login`) ----

/** POST /v1/auth/device (no auth). */
export interface DeviceStartResponse {
  /** Secret the mod polls with; never shown. */
  deviceCode: string;
  /** Short code the player checks in the browser, e.g. "WDJB-MJHT". */
  userCode: string;
  /** Web page that approves this code, user code included. */
  verifyUrl: string;
  /** Seconds before the codes expire. */
  expiresIn: number;
  /** Minimum seconds between two polls. */
  interval: number;
}

/** POST /v1/auth/device/token { deviceCode } (no auth). */
export type DeviceTokenResponse =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "denied" }
  | { status: "approved"; token: string; expiresAt: string };

// ---- Game state (GET /v1/state, mod token) ----

/** A card as drawn on-chain: rank 1 (ace) to 13 (king). Suits are cosmetic, derived by the api. */
export interface Card {
  rank: number;
  suit: "♠" | "♥" | "♦" | "♣";
}

export type RoundPhase =
  /** No round, or the last one is settled. */
  | "idle"
  /** Waiting for the VRF draw; poll again shortly. */
  | "drawing"
  /** Blackjack: waiting for hit, stand, double or split. Mines, Hilo, Tower: waiting for a move or a cash-out. */
  | "player_turn";

/** How a blackjack hand ended against the dealer; null until the round is settled. */
export type BlackjackResult = "blackjack" | "win" | "push" | "lose";

export interface BlackjackHandView {
  cards: Card[];
  total: number;
  /** Totals with a usable ace are soft, e.g. "soft 17". */
  soft: boolean;
  doubled: boolean;
  /** Born from a split: a 21 on two cards pays 1:1, not 3:2. Split aces get one card each. */
  split: boolean;
  /** This hand's stake, the double included. */
  stake: Amount;
  result: BlackjackResult | null;
}

export interface BlackjackView {
  game: "blackjack";
  /** One to ten hands (up to six dealt, plus up to four splits), played left to right against the same dealer. */
  hands: BlackjackHandView[];
  /** The hand that hit, stand, double and split act on while the phase is player_turn; null otherwise. */
  activeHand: number | null;
  dealer: Card[];
  dealerTotal: number;
  /** For the active hand. */
  canHit: boolean;
  canDouble: boolean;
  canSplit: boolean;
}

export interface RouletteView {
  game: "roulette";
  /** The first chip's bet, for older clients. */
  bet: RouletteBet;
  /** Every chip of the spin, 1 to 20 on distinct bets; a single-bet round is one chip of the round's stake. */
  chips: RouletteChip[];
  /** Winning pocket once settled. */
  number: number | null;
}

export interface BaccaratView {
  game: "baccarat";
  bet: BaccaratBet;
  player: Card[];
  banker: Card[];
  playerPoints: number;
  bankerPoints: number;
}

export interface SlotsView {
  game: "slots";
  /** Symbol per reel once settled: "7" | "◆" | "★" | "♣" | "¤" | … ; null while drawing. */
  reels: [string, string, string] | null;
}

export interface MinesView {
  game: "mines";
  /** 1 to 24. */
  mines: number;
  /** Tiles revealed safe, in reveal order (0 to 24). */
  revealed: number[];
  /** Tile awaiting its draw, null when none. */
  pending: number | null;
  /** The mine that ended the round, null otherwise. */
  busted: number | null;
  /** Current multiplier as a decimal string with 4 decimals ("1.0312", floor); "1.0000" before any reveal. */
  multiplier: string;
  /** Multiplier the next safe tile would bring, null when no reveal is left (cap or board cleared). */
  nextMultiplier: string | null;
  canCashOut: boolean;
  canReveal: boolean;
}

export interface DiceView {
  game: "dice";
  /** 100 to 9900, in hundredths of the roll. */
  target: number;
  over: boolean;
  /** 0 to 9999 (shown as 00.00 to 99.99) once settled. */
  roll: number | null;
  /** Payout multiplier on a win, 4 decimals ("1.9600"). */
  multiplier: string;
}

export interface LimboView {
  game: "limbo";
  /** Multipliers with 2 decimals: "2.00". */
  target: string;
  result: string | null;
}

export interface FlipView {
  game: "flip";
  side: FlipSide;
  flips: number;
  /** One per coin once settled. */
  results: FlipSide[] | null;
  /** Payout multiplier on a win, 4 decimals. */
  multiplier: string;
}

export interface KenoView {
  game: "keno";
  /** 1 to 10 distinct numbers from 1 to 40. */
  picks: number[];
  /** The ten numbers drawn, once settled. */
  drawn: number[] | null;
  hits: number | null;
  /** Multiplier for 0 to picks.length hits, 2 decimals ("0.00", "3.50"). */
  paytable: string[];
}

export interface WheelView {
  game: "wheel";
  segments: number;
  risk: WheelRisk;
  /** One per segment, 2 decimals. */
  multipliers: string[];
  /** Landed segment once settled. */
  segment: number | null;
}

export interface HiloView {
  game: "hilo";
  /** Cards in draw order; empty while the first one is drawn. */
  cards: Card[];
  /** One per card after the first: the guess that drew it. */
  guesses: HiloGuess[];
  /** Guess awaiting its draw, null when none. */
  pending: HiloGuess | null;
  /** Current multiplier, 4 decimals; "0.9800" before any right guess. */
  multiplier: string;
  /** Multiplier after a right guess, null when that guess is refused. */
  higherMultiplier: string | null;
  lowerMultiplier: string | null;
  skipsLeft: number;
  canGuess: boolean;
  canCashOut: boolean;
  busted: boolean;
}

export interface TowerView {
  game: "tower";
  difficulty: TowerDifficulty;
  tiles: number;
  levels: 9;
  /** Tile picked on each safe level, bottom first. */
  climbed: number[];
  /** Tile awaiting its draw on the next level, null when none. */
  pending: number | null;
  /** Tile picked on the level that busted, null otherwise. */
  busted: number | null;
  /** Current multiplier, 4 decimals; "1.0000" before any level. */
  multiplier: string;
  /** Multiplier the next safe level would bring, null when no climb is left. */
  nextMultiplier: string | null;
  canClimb: boolean;
  canCashOut: boolean;
}

export interface RoundView {
  phase: RoundPhase;
  stake: Amount;
  /** Gross return of a settled round (0 when lost). */
  payout: Amount;
  /** Tilt's 1% fee on the gain of a winning round. */
  fee: Amount;
  /** payout − fee − stake, signed decimal string, e.g. "-500000". */
  net: string;
  /** Round number on-chain; also the key for /verify. */
  number: number;
  /** Signature of the settling transaction, once indexed. */
  settledSignature: string | null;
  detail:
    | BlackjackView
    | RouletteView
    | BaccaratView
    | SlotsView
    | MinesView
    | DiceView
    | LimboView
    | FlipView
    | KenoView
    | WheelView
    | HiloView
    | TowerView;
}

export interface SponsorView {
  name: string;
  tagline: string | null;
  /** Prize pool of the running competition, in USDC base units. */
  pool: Amount;
  /** ISO time the running competition ends. */
  endsAt: string;
}

export interface LeaderboardEntry {
  rank: number;
  handle: string;
  /** Net gain over the competition window, signed decimal string. */
  net: string;
  isYou: boolean;
}

export interface Limits {
  minBet: Amount;
  maxBet: Amount;
}

export interface StateResponse {
  /** False until the first deposit on the web; the mod then shows a "deposit on <web>" hint. */
  accountOpen: boolean;
  balance: Amount;
  /** Current or last round; null before the first round. */
  round: RoundView | null;
  /** Set while an intent of this player is in flight. */
  pendingIntentId: string | null;
  limits: Limits;
  /** RTP per game before Tilt's 1% (spec §4.3), as percent strings, e.g. "97.30". */
  rtp: Record<Game, string>;
  sponsor: SponsorView | null;
  leaderboard: LeaderboardEntry[];
  /** Player's rank in the running competition; null when not ranked. */
  rank: number | null;
  /** The entry ranked right above the player (rank − 1), to show what it takes to pass it; null
   *  when there is no running competition, the player is unranked or #1. Absent from older apis. */
  ahead?: LeaderboardEntry | null;
  /** Base URL of the web app (deposits, account). Absent from older apis; only shown or opened
   *  when it is on the api's own site. */
  webUrl?: string;
  /** Self-exclusion or a responsible-gaming limit blocks play; the reason is shown as is. */
  blocked: string | null;
}

// ---- Playing (POST /v1/play, mod token) ----

export interface PlayRequest {
  /** UUID generated by the mod; resend the same id to retry, never a new one. */
  intentId: string;
  action: PlayAction;
}

export type IntentStatus = "pending" | "submitted" | "failed";

/** POST /v1/play and GET /v1/intents/:intentId. */
export interface IntentResponse {
  intentId: string;
  status: IntentStatus;
  /** Machine code and a short message safe to show, e.g. "InsufficientBalance". */
  error: { code: string; message: string } | null;
}

/** POST /v1/impressions { sponsor, seconds } (mod token): sponsor panel time on screen. */
export interface ImpressionRequest {
  sponsor: string;
  /** Seconds the sponsor block was visible since the last report, 1–60. */
  seconds: number;
}

/** Every error response body. */
export interface ErrorBody {
  error: { code: ApiErrorCode; message: string };
}

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "PLAYER_BUSY"
  | "INTENT_CONFLICT"
  | "BLOCKED"
  | "GEO_BLOCKED"
  | "ACCOUNT_NOT_OPEN"
  | "UPSTREAM_ERROR"
  | "INTERNAL_ERROR";
