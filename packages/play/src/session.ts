// One player's Tilt session for any harness: device login, the polled table state, the moves and
// the table choices. It ports the non-UI logic of apps/mod/hooks/register.tsx (no sounds, no
// animations, no clipboard, no shell). Privacy (spec §10): it learns only "agent working / idle"
// from `setAgent`, never a prompt, a file or a tool call.
import {
  apiBase,
  type ApiFailure,
  type ApiResult,
  type Fetch,
  fetchIntent,
  fetchState,
  play,
  pollDevice,
  reportImpression,
  startDevice,
  trustedVerifyUrl,
} from "./api";
import { cleanText, formatDuration, formatUsdc, moveFailure, SEPARATOR } from "../../../apps/mod/hooks/format";
import { isPlayAction } from "../../../apps/mod/hooks/guards";
import {
  activeGame,
  addChip,
  choicesOf,
  type Command,
  crossCursor,
  currentBet,
  cursorBet,
  cycle,
  DEFAULT_DICE_CHANCE,
  DEFAULT_KENO_PICKS,
  DEFAULT_LIMBO_TARGET,
  DEFAULT_MINES,
  DEFAULT_WHEEL_SEGMENTS,
  GAME_LABELS,
  isRoundOpen,
  planKeys,
  randomPicks,
  type RandomBelow,
  sameBet,
  startAction,
  stepBetIndex,
  stepCursor,
  stepHands,
  stepMines,
  stepSetting,
  toggleKenoPick,
  WHEEL_RISKS,
} from "../../../apps/mod/hooks/keys";
import { type IntentView, type Prefs, prefsView, storedPrefs } from "../../../apps/mod/hooks/model";
import type { IntentResponse, PlayAction, RouletteBet, StateResponse } from "../../../apps/mod/hooks/protocol";
import type { Auth, Snapshot, Store, Tone } from "./types";

const TICK_MS = 100;
const FAST_POLL_MS = 300;
const SLOW_POLL_MS = 5_000;
const RETRY_MS = 1_000;
const IMPRESSION_FLUSH_MS = 60_000;
const RATE_LIMIT_BACKOFF_MS = 5_000;
/** A submitted move whose state never shows frees the keys after this long rather than never. */
const SETTLE_TIMEOUT_MS = 15_000;
const MS_PER_MINUTE = 60_000;
/** A round worth this many times its stake is a big win, the one a share line is about (apps/mod/hooks/view.tsx). */
const BIG_WIN_MULTIPLE = 10n;

const INVALID_API_URL = "The tilt apiUrl is not a valid https url (plain http only for localhost).";
const UNTRUSTED_LOGIN_PAGE = "the login page the API sent is not on its own site.";
const LOGGED_OUT = "Session expired · log in to tilt again.";
const LOGIN_EXPIRED = "Login code expired · log in to tilt again.";
const PLAYER_BUSY = "Previous move still settling.";
const UNPLAYABLE_BET = "This table's limits allow no bet · try again later.";
const ALREADY_IN = "Already logged in to tilt · log out first to switch accounts.";
const NO_BIG_WIN = "No big win on the table to share.";

const DEFAULT_PREFS: Prefs = {
  game: "blackjack",
  betIndex: 0,
  hands: 1,
  rouletteChips: [],
  rouletteCursor: 0,
  baccarat: "banker",
  slotsSpeed: "normal",
  mines: DEFAULT_MINES,
  diceChance: DEFAULT_DICE_CHANCE,
  diceOver: false,
  limboTarget: DEFAULT_LIMBO_TARGET,
  flipSide: "heads",
  flips: 1,
  kenoPicks: [...DEFAULT_KENO_PICKS],
  wheelSegments: DEFAULT_WHEEL_SEGMENTS,
  wheelRisk: "low",
  towerDifficulty: "easy",
};

export interface SessionOptions {
  apiUrl: string;
  store: Store;
  /** Opens the login page in a browser; resolves false (or is absent) where none can be opened. */
  openUrl?: (url: string) => Promise<boolean>;
  fetch?: typeof fetch;
  /** The clock, in ms. */
  now?: () => number;
  /** Keno's random picks: the player's own choice of numbers, not an outcome. */
  random?: RandomBelow;
}

interface Device {
  deviceCode: string;
  expiresAt: number;
  intervalMs: number;
}

interface Remote {
  state: StateResponse | null;
  error: string | null;
  fetchedAt: number;
}

const EMPTY_REMOTE: Remote = { state: null, error: null, fetchedAt: 0 };

// A 5xx message is the server's own (a stack, a query) and never one meant for the player.
const failureText = (failure: ApiFailure): string =>
  failure.kind === "network"
    ? "couldn't reach tilt"
    : failure.status !== null && failure.status >= 500
      ? "tilt is having trouble"
      : cleanText(failure.message);

// `String` itself throws on a value with no prototype: the text of an error never throws.
function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  try {
    return String(error);
  } catch {
    return "unknown error";
  }
}

const needsFastPoll = (state: StateResponse | null, current: IntentView | null): boolean =>
  current !== null || state?.round?.phase === "drawing" || state?.pendingIntentId != null;

/** The line to paste about the last big win; nothing about the person's work is in it. */
function shareLine(state: StateResponse): string | null {
  const round = state.round;

  if (round === null || round.phase !== "idle") {
    return null;
  }

  const net = BigInt(round.net);

  if (net <= 0n || net < BigInt(round.stake) * BIG_WIN_MULTIPLE) {
    return null;
  }

  const sponsor = state.sponsor === null ? "" : `${SEPARATOR}presented by ${cleanText(state.sponsor.name)}`;

  return `Won ${formatUsdc(round.net)} USDC on ${GAME_LABELS[round.detail.game].toLowerCase()} with Tilt while my agent worked${sponsor}`;
}

export class TiltSession {
  private readonly base: string | null;
  private readonly store: Store;
  private readonly openUrl: ((url: string) => Promise<boolean>) | null;
  private readonly http: Fetch;
  private readonly now: () => number;
  private readonly random: RandomBelow;
  private readonly listeners = new Set<() => void>();

  private auth: Auth;
  private remote: Remote = EMPTY_REMOTE;
  private prefs: Prefs = DEFAULT_PREFS;
  private intent: IntentView | null = null;
  private message: { text: string; tone: Tone } | null = null;
  private agent: { isWorking: boolean; notice: string | null } = { isWorking: false, notice: null };
  private workStartedAt: number | null = null;
  private isVisible = true;

  private token: string | null = null;
  private device: Device | null = null;
  private loaded: Promise<void> | null = null;
  private saving: Promise<void> = Promise.resolve();
  private ticker: NodeJS.Timeout | null = null;
  private isTicking = false;
  /** The ticker does nothing before this time; anything that needs work sooner sets it to 0. */
  private wakeAt = 0;
  private lastTickAt: number | null = null;
  private lastPollAt = -Infinity;
  private lastIntentAt = -Infinity;
  private nextLoginPollAt = 0;
  private sponsorMs = 0;
  private sponsorName: string | null = null;
  /** The move whose POST /v1/play has no answer yet: it is not sent again meanwhile. */
  private sendingId: string | null = null;
  /** The api answered 429: no poll or resend before this time. */
  private rateLimitedUntil = 0;
  /** The session started with the choices a past one stored. */
  private isPrefsRestored = false;

  constructor(options: SessionOptions) {
    this.base = apiBase(options.apiUrl);
    this.store = options.store;
    this.openUrl = options.openUrl ?? null;
    this.http = options.fetch ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? Date.now;
    this.random = options.random ?? ((bound) => Math.floor(Math.random() * bound));
    this.auth = { status: "out", message: this.base === null ? INVALID_API_URL : null };
  }

  // ---- public API ----

  start(): void {
    void this.ensureLoaded().catch((error: unknown) =>
      this.setMessage(`Could not read the tilt session: ${errorText(error)}`, "loss"),
    );
    this.ensureTicker();
  }

  stop(): void {
    if (this.ticker !== null) {
      clearInterval(this.ticker);
      this.ticker = null;
    }

    // Impressions are best effort: the time counted so far is reported once, never retried, and a
    // failure has no session left to show it on.
    if (this.token !== null) {
      this.flushImpressions(this.token).catch(() => undefined);
    }
  }

  async login(): Promise<void> {
    await this.ensureLoaded();
    this.ensureTicker();

    if (this.base === null) {
      this.setAuth({ status: "out", message: INVALID_API_URL });

      return;
    }

    // A second login would stop the polls and the resend of a move in flight until it is approved,
    // and an abandoned one would read as logged out while the session still holds.
    if (this.token !== null) {
      this.setMessage(ALREADY_IN, "neutral");

      return;
    }

    const started = await startDevice(this.http, this.base);

    if (!started.ok) {
      this.setAuth({ status: "out", message: `Login failed · ${failureText(started.failure)}` });

      return;
    }

    const { deviceCode, userCode, expiresIn, interval } = started.value;
    // Opened and shown only on the API's own site: a hostile or compromised API cannot send the
    // player anywhere else, nor draw escape sequences in the terminal.
    const verifyUrl = trustedVerifyUrl(started.value.verifyUrl, this.base);

    if (verifyUrl === null) {
      this.setAuth({ status: "out", message: `Login failed · ${UNTRUSTED_LOGIN_PAGE}` });

      return;
    }

    const now = this.now();
    const code = cleanText(userCode);

    this.device = { deviceCode, expiresAt: now + expiresIn * 1000, intervalMs: interval * 1000 };
    this.nextLoginPollAt = now + this.device.intervalMs;
    this.wakeAt = 0;
    this.setAuth({ status: "pending", userCode: code, verifyUrl });

    let isOpened = false;

    // A harness opener that throws or rejects only means the browser stayed closed: the code and link are shown either way.
    try {
      isOpened = this.openUrl !== null && (await this.openUrl(verifyUrl)) === true;
    } catch {
      isOpened = false;
    }

    const link = cleanText(verifyUrl);

    this.setMessage(
      isOpened ? `Opened ${link} · confirm code ${code} there.` : `Open ${link} and confirm code ${code}.`,
      "neutral",
    );
  }

  async logout(): Promise<void> {
    await this.ensureLoaded();
    this.endSession(null);
  }

  /** Runs the key of the current plan bound to `hotkey`; false when the plan has none (a move in flight offers no play key). */
  press(hotkey: string): boolean {
    const action = hotkey === "" ? undefined : this.snapshot().keys.find((key) => key.hotkey === hotkey);

    if (action === undefined) {
      return false;
    }

    this.run(action.command).catch((error: unknown) => this.setMessage(`Key failed: ${errorText(error)}`, "loss"));

    return true;
  }

  async run(command: Command): Promise<void> {
    await this.ensureLoaded();
    await this.runCommand(command);
  }

  setAgent(isWorking: boolean): void {
    if (isWorking === this.agent.isWorking) {
      return;
    }

    const now = this.now();

    if (isWorking) {
      this.workStartedAt = now;
      this.agent = { isWorking: true, notice: null };
    } else {
      // After 6 hours without a move the relay closes the round (stand or cash-out).
      const notice =
        this.workStartedAt === null
          ? null
          : `✓ agent finished in ${formatDuration(now - this.workStartedAt)}${SEPARATOR}your hand is saved for 6 hours`;

      this.workStartedAt = null;
      this.agent = { isWorking: false, notice };
    }

    this.emit();
  }

  /** Sponsor time counts only while the table is on screen. */
  setVisible(visible: boolean): void {
    this.isVisible = visible;
  }

  snapshot(): Snapshot {
    const state = this.remote.state;
    const isBusy = this.intent !== null;

    return {
      auth: this.auth,
      state,
      error: this.remote.error,
      prefs: this.prefs,
      isBusy,
      message: this.message,
      agent: this.agent,
      keys: state === null ? [] : planKeys({ state, prefs: this.prefs, isBusy }),
      // The web page to deposit on, only when the api named one on its own site.
      depositUrl: state?.webUrl === undefined || this.base === null ? null : trustedVerifyUrl(state.webUrl, this.base),
      now: this.now(),
    };
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  // ---- state ----

  private emit(): void {
    // A harness's listener that throws must not stop the others nor the session's own work (some
    // hosts end the whole session on an error thrown from a timer): it misses this change only.
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        continue;
      }
    }
  }

  private setAuth(auth: Auth): void {
    this.auth = auth;
    this.emit();
  }

  private setMessage(text: string | null, tone: Tone): void {
    this.message = text === null ? null : { text, tone };
    this.emit();
  }

  private ensureLoaded(): Promise<void> {
    this.loaded ??= this.load();

    return this.loaded;
  }

  private async load(): Promise<void> {
    const saved = await this.store.read();
    const kept = storedPrefs(saved.prefs);

    // Every client shares the file and takes its API from TILT_API_URL: a token from another
    // API (a repo's .envrc pointing elsewhere) must not reach this one.
    this.token = saved.apiBase === this.base ? saved.token : null;

    if (kept !== null) {
      this.prefs = prefsView(kept);
      this.isPrefsRestored = true;
    }

    if (this.token !== null && this.auth.status === "out") {
      this.auth = { status: "in" };
    }

    this.emit();
  }

  /** Writes the token and the choices, one write after the other so the last one wins. */
  private save(): void {
    const saved = { token: this.token, apiBase: this.base, prefs: this.prefs };

    this.saving = this.saving
      .then(() => this.store.write(saved))
      .catch((error: unknown) => this.setMessage(`Could not save the tilt session: ${errorText(error)}`, "loss"));
  }

  private endSession(reason: string | null): void {
    this.token = null;
    this.device = null;
    this.remote = EMPTY_REMOTE;
    this.intent = null;
    // The next account's sponsor time starts from zero.
    this.sponsorMs = 0;
    this.sponsorName = null;
    this.save();
    this.setAuth({ status: "out", message: reason });
  }

  /** Changes the choices, and keeps them for the next sessions: the bet, the game, its settings. */
  private setPrefs(change: (value: Prefs) => Prefs): void {
    this.prefs = prefsView(change(this.prefs));
    this.save();
    this.emit();
  }

  // ---- login ----

  private finishLogin(token: string): void {
    this.token = token;
    this.device = null;
    this.lastPollAt = -Infinity;
    this.message = null;
    this.save();
    this.setAuth({ status: "in" });
  }

  private endLogin(text: string): void {
    this.device = null;
    this.setAuth({ status: "out", message: text });
  }

  /** Polls the device code at the interval the api asked for; returns when to look again. */
  private async loginStep(now: number): Promise<number> {
    if (now < this.nextLoginPollAt || this.base === null) {
      return this.nextLoginPollAt - now;
    }

    const device = this.device;

    if (device === null || now >= device.expiresAt) {
      this.endLogin(LOGIN_EXPIRED);

      return SLOW_POLL_MS;
    }

    const polled = await pollDevice(this.http, this.base, device.deviceCode);

    // A logout or a new login came while this was in flight: its answer is not for them.
    if (this.device !== device) {
      return 0;
    }

    this.nextLoginPollAt = now + device.intervalMs;

    if (!polled.ok) {
      if (polled.failure.status === 429) {
        this.device = { ...device, intervalMs: device.intervalMs + RATE_LIMIT_BACKOFF_MS };
      } else if (polled.failure.kind !== "network") {
        this.endLogin(`Login failed · ${failureText(polled.failure)}`);
      }

      return device.intervalMs;
    }

    const answer = polled.value;

    if (answer.status === "approved") {
      this.finishLogin(answer.token);

      return 0;
    }

    if (answer.status !== "pending") {
      this.endLogin(`Login ${answer.status} · log in to tilt again.`);
    }

    return device.intervalMs;
  }

  // ---- moves ----

  /** Drops the move `id` if it is still the one in flight. */
  private dropIntent(id: string): void {
    if (this.intent?.id === id) {
      this.intent = null;
      this.emit();
    }
  }

  private settleAnswer(sent: IntentView, answer: IntentResponse): void {
    if (answer.status === "pending") {
      this.intent = { ...sent, status: "pending" };
      this.emit();

      return;
    }

    this.lastPollAt = -Infinity;
    this.wakeAt = 0;

    if (answer.status === "submitted") {
      // The state polled until now still shows the table before the move: the keys stay off until
      // a state shows it, or a mashed key would play the old table a second time.
      this.intent = { ...sent, status: "submitted", submittedAt: this.now() };
      this.emit();

      return;
    }

    this.intent = null;
    this.setMessage(moveFailure(answer.error?.message ?? "Move failed."), "loss");
  }

  private settleIntent(sent: IntentView, result: ApiResult<IntentResponse>): void {
    if (this.intent?.id !== sent.id) {
      return;
    }

    if (result.ok) {
      this.settleAnswer(sent, result.value);

      return;
    }

    const { failure } = result;
    const isRateLimited = failure.status === 429;
    const isTransient =
      failure.kind === "network" || isRateLimited || (failure.status !== null && failure.status >= 500);

    if (isRateLimited) {
      this.rateLimitedUntil = this.now() + RATE_LIMIT_BACKOFF_MS;
    }

    if (isTransient) {
      // Nothing is known about the move: it is resent later with the same id, never a new one.
      this.intent = { ...sent, status: "retrying" };
      this.emit();

      return;
    }

    this.intent = null;

    if (failure.status === 401) {
      this.endSession(LOGGED_OUT);

      return;
    }

    this.setMessage(failure.code === "PLAYER_BUSY" ? PLAYER_BUSY : failureText(failure), "loss");
  }

  /** Sends, or resends with the same id, the move in flight; never while its last send has no answer. */
  private async submit(sent: IntentView): Promise<void> {
    const token = this.token;

    if (token === null || this.base === null || this.sendingId === sent.id) {
      return;
    }

    this.sendingId = sent.id;
    this.lastIntentAt = this.now();

    try {
      this.settleIntent(sent, await play(this.http, this.base, token, { intentId: sent.id, action: sent.action }));
    } finally {
      this.sendingId = null;
    }
  }

  private async sendMove(action: PlayAction): Promise<void> {
    // A move the guards refuse (a zero stake from odd limits) would not read back as in flight, so
    // nothing would hold the next key press: it is never sent.
    if (!isPlayAction(action)) {
      this.setMessage(UNPLAYABLE_BET, "loss");

      return;
    }

    // Set before any await: a second key press finds this move in flight and sends nothing.
    if (this.intent !== null) {
      return;
    }

    const sent: IntentView = {
      id: crypto.randomUUID(),
      action,
      status: "sending",
      roundSeen: JSON.stringify(this.remote.state?.round ?? null),
      submittedAt: null,
    };

    this.intent = sent;
    this.wakeAt = 0;
    this.setMessage(null, "neutral");
    await this.submit(sent);
  }

  private async intentStep(token: string, now: number): Promise<void> {
    const current = this.intent;

    if (current === null || this.base === null) {
      return;
    }

    if (current.status === "submitted") {
      if (now - (current.submittedAt ?? now) >= SETTLE_TIMEOUT_MS) {
        this.dropIntent(current.id);
      }

      return;
    }

    if (current.status !== "pending") {
      if (now - this.lastIntentAt >= RETRY_MS) {
        await this.submit(current);
      }

      return;
    }

    if (now - this.lastIntentAt >= FAST_POLL_MS) {
      this.lastIntentAt = now;
      this.settleIntent(current, await fetchIntent(this.http, this.base, token, current.id));
    }
  }

  // ---- commands ----

  private async startRound(): Promise<void> {
    const state = this.remote.state;

    if (state === null) {
      return;
    }

    await this.sendMove(
      startAction(activeGame(state, this.prefs), currentBet(state.limits, this.prefs.betIndex), this.prefs),
    );
  }

  /** A chip of the bet's size on `bet`, or on the cursor's cell; a full table or bet says why instead. */
  private addRouletteChip(bet: RouletteBet | null): void {
    const state = this.remote.state;

    if (state === null) {
      return;
    }

    const value = this.prefs;
    const placed = addChip(
      value.rouletteChips,
      bet ?? cursorBet(value.rouletteCursor),
      currentBet(state.limits, value.betIndex),
      state.limits,
    );

    if (typeof placed === "string") {
      this.setMessage(placed, "neutral");

      return;
    }

    this.setPrefs(() => ({ ...value, rouletteChips: placed }));
    this.setMessage(null, "neutral");
  }

  private share(): void {
    const state = this.remote.state;
    const line = state === null ? null : shareLine(state);

    this.setMessage(line ?? NO_BIG_WIN, line === null ? "neutral" : "success");
  }

  private async runCommand(command: Command): Promise<void> {
    switch (command.kind) {
      case "switch": {
        const state = this.remote.state;

        // A round in play pins its game: the press says so rather than doing nothing.
        if (isRoundOpen(state) && state?.round) {
          this.setMessage(
            `Finish this ${GAME_LABELS[state.round.detail.game]} round before switching game.`,
            "neutral",
          );

          return;
        }

        this.message = null;
        this.setPrefs((value) => ({ ...value, game: command.game }));

        return;
      }
      case "bet": {
        const state = this.remote.state;

        if (state !== null) {
          this.setPrefs((value) => ({ ...value, betIndex: stepBetIndex(state.limits, value.betIndex, command.step) }));
        }

        return;
      }
      case "hands":
        this.setPrefs((value) => ({ ...value, hands: stepHands(value.hands, command.step) }));

        return;
      case "mines":
        this.setPrefs((value) => ({ ...value, mines: stepMines(value.mines, command.step) }));

        return;
      case "step":
        this.setPrefs((value) => stepSetting(value, command.setting, command.step, this.random));

        return;
      case "dice-over":
        this.setPrefs((value) => ({ ...value, diceOver: !value.diceOver }));

        return;
      case "flip-side":
        this.setPrefs((value) => ({ ...value, flipSide: command.side }));

        return;
      case "wheel-risk":
        this.setPrefs((value) => ({ ...value, wheelRisk: cycle(WHEEL_RISKS, value.wheelRisk) }));

        return;
      case "keno-random":
        this.setPrefs((value) => ({ ...value, kenoPicks: randomPicks(value.kenoPicks.length, this.random) }));

        return;
      case "keno-pick":
        this.setPrefs((value) => ({ ...value, kenoPicks: toggleKenoPick(value.kenoPicks, command.number) }));

        return;
      case "roulette-add":
        this.addRouletteChip(command.bet);

        return;
      case "roulette-cursor":
        this.setPrefs((value) => ({ ...value, rouletteCursor: stepCursor(value.rouletteCursor, command.step) }));

        return;
      case "roulette-across":
        this.setPrefs((value) => ({ ...value, rouletteCursor: crossCursor(value.rouletteCursor, command.step) }));

        return;
      case "roulette-remove":
        this.setPrefs((value) => {
          const cell = cursorBet(value.rouletteCursor);

          return { ...value, rouletteChips: value.rouletteChips.filter((chip) => !sameBet(chip.bet, cell)) };
        });

        return;
      case "roulette-undo":
        this.setPrefs((value) => ({ ...value, rouletteChips: value.rouletteChips.slice(0, -1) }));

        return;
      case "roulette-clear":
        this.setPrefs((value) => ({ ...value, rouletteChips: [] }));

        return;
      case "baccarat-bet":
        this.setPrefs((value) => ({ ...value, baccarat: command.bet }));

        return;
      case "slots-speed":
        this.setPrefs((value) => ({ ...value, slotsSpeed: command.speed }));

        return;
      case "start":
        await this.startRound();

        return;
      case "play":
        await this.sendMove(command.action);

        return;
      case "share":
        this.share();
    }
  }

  // ---- background work ----

  private async pollStep(token: string, now: number): Promise<number> {
    const held = this.remote;
    const interval = needsFastPoll(held.state, this.intent) ? FAST_POLL_MS : SLOW_POLL_MS;

    if (now - this.lastPollAt < interval || this.base === null) {
      return interval - (now - this.lastPollAt);
    }

    this.lastPollAt = now;
    const fetched = await fetchState(this.http, this.base, token);

    // A logout, or a login as someone else, came while this was in flight: its answer is not theirs.
    if (this.token !== token) {
      return 0;
    }

    if (!fetched.ok) {
      if (fetched.failure.status === 401) {
        this.endSession(LOGGED_OUT);
      } else {
        if (fetched.failure.status === 429) {
          this.rateLimitedUntil = now + RATE_LIMIT_BACKOFF_MS;
        }

        // The poll runs again on its own, whatever went wrong; the last good state stays.
        this.remote = { ...this.remote, error: `${failureText(fetched.failure)} · retrying` };
        this.emit();
      }

      return interval;
    }

    const minute = (ms: number) => Math.floor(ms / MS_PER_MINUTE);
    const isSame =
      held.error === null &&
      minute(held.fetchedAt) === minute(now) &&
      JSON.stringify(held.state) === JSON.stringify(fetched.value);

    // An unchanged state is not announced, so the table is not redrawn on every poll.
    if (!isSame) {
      this.remote = { state: fetched.value, error: null, fetchedAt: now };
      this.emit();
    }

    const current = this.intent;

    if (current?.status === "submitted" && JSON.stringify(fetched.value.round) !== current.roundSeen) {
      this.dropIntent(current.id);
    }

    // A session with no stored choices opens on the game last played, set up as it was played.
    const last = fetched.value.round;

    if (held.state === null && last !== null && !this.isPrefsRestored) {
      this.setPrefs((value) => choicesOf({ ...value, game: last.detail.game }, last));
    }

    return needsFastPoll(fetched.value, this.intent) ? FAST_POLL_MS : SLOW_POLL_MS;
  }

  private async flushImpressions(token: string): Promise<void> {
    const seconds = Math.min(IMPRESSION_FLUSH_MS / 1000, Math.floor(this.sponsorMs / 1000));

    this.sponsorMs = 0;

    if (this.sponsorName === null || seconds < 1 || this.base === null) {
      return;
    }

    // Impressions are best effort: a lost report is never shown or retried.
    await reportImpression(this.http, this.base, token, { sponsor: this.sponsorName, seconds });
  }

  /** Counts the time the sponsor block is on screen and reports it at most every 60 s. */
  private async impressionStep(token: string, elapsedMs: number): Promise<void> {
    const name = this.remote.state?.sponsor?.name ?? null;

    if (name !== this.sponsorName) {
      await this.flushImpressions(token);
      this.sponsorName = name;
    }

    if (name === null || !this.isVisible) {
      return;
    }

    this.sponsorMs += elapsedMs;

    if (this.sponsorMs >= IMPRESSION_FLUSH_MS) {
      await this.flushImpressions(token);
    }
  }

  /** One pass of the background work; returns how long nothing needs doing. */
  private async step(now: number): Promise<number> {
    const elapsed = this.lastTickAt === null ? 0 : now - this.lastTickAt;
    const delays: number[] = [SLOW_POLL_MS];

    this.lastTickAt = now;

    if (this.auth.status === "pending") {
      delays.push(await this.loginStep(now));
    }

    const token = this.token;

    if (this.auth.status !== "in" || token === null) {
      return Math.max(0, Math.min(...delays));
    }

    if (now < this.rateLimitedUntil) {
      delays.push(this.rateLimitedUntil - now);
    } else {
      await this.intentStep(token, now);
      delays.push(await this.pollStep(token, now));
    }

    // A move or a poll may have logged out meanwhile: no sponsor time is reported for nobody.
    if (this.token === token) {
      await this.impressionStep(token, elapsed);
    }

    return Math.max(0, Math.min(...delays));
  }

  private async tick(): Promise<void> {
    if (this.isTicking) {
      return;
    }

    this.isTicking = true;

    try {
      await this.ensureLoaded();
      const now = this.now();

      if (now >= this.wakeAt) {
        this.wakeAt = now + (await this.step(now));
      }
    } catch (error) {
      // The loop keeps running: the next try waits a little rather than failing every tick.
      this.wakeAt = this.now() + RETRY_MS;
      this.remote = { ...this.remote, error: `tilt failed: ${cleanText(errorText(error))}` };
      this.emit();
    } finally {
      this.isTicking = false;
    }
  }

  private ensureTicker(): void {
    if (this.ticker === null) {
      this.ticker = setInterval(() => void this.tick(), TICK_MS);
      // A harness that is done may exit with the session still started.
      this.ticker.unref();
    }
  }
}
