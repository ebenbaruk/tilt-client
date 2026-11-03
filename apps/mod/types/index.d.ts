// `$.state` contract of the tilt mod: what its pane and band draw from. The engine requires this
// file to be self-contained, so values shaped by the api protocol (hooks/protocol.ts) are declared
// `unknown` here and checked with the guards in hooks/guards.ts on every read: any plugin can read
// this state and hook its writes, so the mod does not trust it blindly either.

export type TiltGame =
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

export type TiltAuth =
  | { status: "out"; message: string | null }
  | { status: "pending"; userCode: string; verifyUrl: string }
  | { status: "in" };

export type TiltRemote = {
  /** The last `StateResponse` from GET /v1/state. */
  state: unknown;
  /** One line shown when the last refresh failed; the last good state stays on screen. */
  error: string | null;
  /** `$.clock.now()` of the last refresh, so countdowns render without reading the clock. */
  fetchedAt: number;
};

export type TiltPrefs = {
  game: TiltGame;
  betIndex: number;
  /** Blackjack hands per round, 1 to 6, each at the bet. */
  hands: number;
  /** Roulette chips placed, in order: `RouletteChip`s (a bet and a stake); absent from prefs stored before the chips. */
  rouletteChips?: unknown;
  /** The roulette cursor's cell, an index into the cursor's cells. */
  rouletteCursor?: number;
  baccarat: "player" | "banker" | "tie";
  /** How fast the slots reels turn: turbo shows the draw at once. */
  slotsSpeed: "normal" | "fast" | "turbo";
  /** Mines per board, 1 to 24; absent from prefs stored before Mines. */
  mines?: number;
  // The games below were added after Mines: absent from prefs stored before them.
  /** Dice winning count, 100 to 9800 (1 % to 98 % of the rolls). */
  diceChance?: number;
  /** Dice wins over the target (true) or under it. */
  diceOver?: boolean;
  /** Limbo target multiplier × 100, 101 to 1 000 000. */
  limboTarget?: number;
  flipSide?: "heads" | "tails";
  /** Coins per flip, 1 to 10. */
  flips?: number;
  /** Keno numbers picked, 1 to 10 distinct numbers from 1 to 40. */
  kenoPicks?: unknown;
  /** Wheel segments: 10, 20, 30, 40 or 50. */
  wheelSegments?: number;
  wheelRisk?: "low" | "medium" | "high";
  towerDifficulty?: "easy" | "medium" | "hard" | "expert" | "master";
};

/** A move sent to the api and not drawn yet; resent with the same id until it settles. */
export type TiltIntent = {
  id: string;
  /** A `PlayAction`. */
  action: unknown;
  /** `submitted`: on-chain, held until the state shows it, so a stale table offers no second move. */
  status: "sending" | "pending" | "retrying" | "submitted";
  /** The round on screen when the move was sent, as JSON: any other round in the state shows the move. */
  roundSeen: string;
  /** `$.clock.now()` when the api answered `submitted`; null before. */
  submittedAt: number | null;
};

export type TiltAgent = {
  isWorking: boolean;
  frame: number;
  notice: { text: string; tone: "success" | "neutral" } | null;
};

export type TiltLayout = {
  /** The pane is placed and the one its surface shows; the band yields to it. */
  paneShown: boolean;
  /** The person closed the pane: turn starts no longer reopen it until `/tilt`. */
  paneDismissed: boolean;
  /** Claude Code's theme is a light one: the accents switch to their light set. */
  isLight: boolean;
  /** The person has made a first move: the first-hand guide is not shown again. */
  isOnboarded: boolean;
};

/** What this Claude Code session played, as the mod saw it settle. Shown only, never trusted. */
export type TiltSession = {
  /** Signed decimal string of base units. */
  net: string;
  rounds: number;
  /** `$.clock.now()` of the first round counted; null before one. */
  startedAt: number | null;
  /** The last round counted, by number, so a redraw or a poll never counts it twice. */
  lastRound: number | null;
};

/** The roulette or slots round whose spin the table is playing, and when it started. */
export type TiltSpin = {
  round: number | null;
  /** `$.clock.now()` when the round first showed on the table. */
  startedAt: number;
  /** The balance before the round, shown until it lands so the header does not tell the result first. */
  balance: string;
};

/** The blackjack cards the table is turning over one by one, as the fullscreen table deals them. */
export type TiltDeal = {
  round: number | null;
  /** Cards of the round already shown when these came (a hit brings one more). */
  from: number;
  /** `$.clock.now()` when they came. */
  startedAt: number;
  /** The balance before them, shown until the last card so the header does not tell the result first. */
  balance: string;
};

/** The settled round whose result the table plays (a win counted up and its sparkles, a loss
 * shaken), once its last card shows or its spin lands. */
export type TiltResult = {
  round: number | null;
  /** `$.clock.now()` when its result shows. */
  startsAt: number;
  /** The balance before its result, shown until then so the header does not tell it first. */
  balance: string;
};

declare module "claude-code" {
  interface PluginState {
    tilt: {
      auth: TiltAuth;
      remote: TiltRemote;
      prefs: TiltPrefs;
      intent: TiltIntent | null;
      /** Last move's error, cleared by the next move. */
      message: string | null;
      agent: TiltAgent;
      layout: TiltLayout;
      session: TiltSession;
      spin: TiltSpin;
      deal: TiltDeal;
      result: TiltResult;
    };
  }
}
