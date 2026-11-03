// The tilt mod: a game pane (or a band above the prompt) that plays against apps/api while the
// agent works. Privacy (spec §4.4, §10.6): it hooks only the session's start, the turn's start and
// end, its own command, pane and band. It never reads prompts, code, tool calls or files, and runs
// one host command, `open <login url>`.
//
// Every function that takes `$` is declared at the top of this file: the engine follows `$` only
// here, so the other modules are plain functions over data.
import { atom, read, update } from "claude-code";
import type { EngineInterface, Register, RenderElement, RenderInput, Timer } from "claude-code";

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
import { type CardSize, dealMs, dealtCards, revealedAt } from "./cards";
import { cleanText, formatDuration, formatUsdc, moveFailure, SEPARATOR } from "./format";
import { isPlayAction } from "./guards";
import {
  activeGame,
  addChip,
  bandTableKeys,
  choicesOf,
  type Command,
  currentBet,
  crossCursor,
  cursorBet,
  cycle,
  DEFAULT_DICE_CHANCE,
  DEFAULT_KENO_PICKS,
  DEFAULT_LIMBO_TARGET,
  DEFAULT_MINES,
  DEFAULT_WHEEL_SEGMENTS,
  GAME_LABELS,
  isRoundOpen,
  type KeyAction,
  type PlanInput,
  randomPicks,
  type RandomBelow,
  sameBet,
  startAction,
  stepBetIndex,
  stepCursor,
  stepHands,
  stepMines,
  stepSetting,
  tableKeys,
  toggleKenoPick,
  WHEEL_RISKS,
} from "./keys";
import {
  type AgentView,
  type AuthView,
  intentView,
  type IntentView,
  type LayoutView,
  type Prefs,
  prefsView,
  storedPrefs,
  remoteView,
  type RemoteView,
} from "./model";
import type { Game, IntentResponse, PlayAction, RouletteBet, RoundView, StateResponse } from "./protocol";
import { type Settings, SETTING_FIELDS, settingsOf } from "./settings";
import { renderSetup, SETUP_ROWS } from "./setup";
import { isTablePost, TABLE_KEY, type TableProps } from "./table-input";
import { applyTheme, isLightTheme, type Ui } from "./theme";
import {
  bigWinOf,
  celebrationMs,
  dealingHands,
  fitsRows,
  isPlayHeld,
  PANE_ROWS,
  type PaneLayout,
  renderBand,
  renderPane,
  RESULT_MS,
  sendingRound,
  type Snapshot,
  spinMs,
  spinProgress,
  SURFACE_LAG_MS,
} from "./view";

const PANE = "tilt";
const PANE_TITLE = "tilt";
const SETUP_PANE = "tilt-setup";
const SETUP_TITLE = "tilt setup";
const PLUGIN = "tilt";

const auth = atom({ plugin: "tilt", key: "auth" } as const, { status: "out", message: null });
const remote = atom({ plugin: "tilt", key: "remote" } as const, { state: null, error: null, fetchedAt: 0 });
const prefs = atom({ plugin: "tilt", key: "prefs" } as const, {
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
});
const intent = atom({ plugin: "tilt", key: "intent" } as const, null);
const message = atom({ plugin: "tilt", key: "message" } as const, null);
const agent = atom({ plugin: "tilt", key: "agent" } as const, { isWorking: false, frame: 0, notice: null });
const layout = atom({ plugin: "tilt", key: "layout" } as const, {
  paneShown: false,
  paneDismissed: false,
  isLight: false,
  isOnboarded: false,
});
const spin = atom({ plugin: "tilt", key: "spin" } as const, { round: null, startedAt: 0, balance: "0" });
const deal = atom({ plugin: "tilt", key: "deal" } as const, { round: null, from: 0, startedAt: 0, balance: "0" });
const result = atom({ plugin: "tilt", key: "result" } as const, { round: null, startsAt: 0, balance: "0" });
const session = atom({ plugin: "tilt", key: "session" } as const, {
  net: "0",
  rounds: 0,
  startedAt: null,
  lastRound: null,
});

/** `$.store` keys: the mod token, the device code of a login in progress, and whether the
 * person has made a first move (the first-hand guide then stays hidden in later sessions). */
const STORE_SESSION = "session";
const STORE_DEVICE = "device";
const STORE_ONBOARDED = "onboarded";
/** The choices last made (the game shown, the bet, each game's settings), restored by the next session. */
const STORE_PREFS = "prefs";

/** The mod's own sound files, played only with the `sound` setting on. */
const SOUND_DEAL = "sounds/deal.wav";
const SOUND_WIN = "sounds/win.wav";
/** The pane is open: a session that starts over (back from the agents view, a relaunch) reopens it. */
const STORE_PANE = "pane";
/** Where the surface last seated the pane, `dock` or `inline`: how the person plays. */
const STORE_PLACEMENT = "placement";

const TICK_MS = 100;
const SPINNER_FRAME_MS = 200;
/** A wheel or the reels move a step every tick while they spin. */
const SPIN_FRAME_MS = 100;
const FAST_POLL_MS = 300;
const SLOW_POLL_MS = 5_000;
const RETRY_MS = 1_000;
const PANE_SYNC_MS = 2_000;
const IMPRESSION_FLUSH_MS = 60_000;
const RATE_LIMIT_BACKOFF_MS = 5_000;
const OPEN_TIMEOUT_MS = 10_000;
/** A submitted move whose state never shows frees the keys after this long rather than never. */
const SETTLE_TIMEOUT_MS = 15_000;
const MS_PER_MINUTE = 60_000;

const UNTRUSTED_LOGIN_PAGE = "the login page the API sent is not on its own site.";
const INVALID_API_URL = "The tilt apiUrl setting is not a valid https url (plain http only for localhost).";
const LOGGED_OUT = "Session expired · run /tilt login again.";
const PLAYER_BUSY = "Previous move still settling.";
const UNPLAYABLE_BET = "This table's limits allow no bet · try again later.";
const ALREADY_IN = "Already logged in to tilt · run /tilt logout first to switch accounts.";

/** Background bookkeeping of one loaded copy of the module: a reload starts it afresh. */
interface Runtime {
  base: string | null;
  settings: Settings;
  ticker: Timer | null;
  isTicking: boolean;
  /** The ticker does nothing before this time; anything that needs work sooner sets it to 0. */
  wakeAt: number;
  lastTickAt: number | null;
  lastPollAt: number;
  lastIntentAt: number;
  lastPaneSyncAt: number;
  /** The pane was listed open at the last sync. */
  isPaneOpen: boolean;
  nextLoginPollAt: number;
  sponsorMs: number;
  sponsorName: string | null;
  /** undefined until read from `$.store`; null when logged out. */
  token: string | null | undefined;
  /** A spin or a deal was playing at the last tick: its end draws the table once more. */
  wasMoving: boolean;
  /** Where the surface last seated the pane, which the restore after the agents view goes by. */
  panePlacement: "dock" | "inline" | null;
  /** The table's `Client` failed on this terminal: the pane draws the still table. */
  isTableBroken: boolean;
  /** The move whose POST /v1/play has no answer yet: it is not sent again meanwhile. */
  sendingId: string | null;
  /** The api answered 429: no poll or resend before this time. */
  rateLimitedUntil: number;
  /** The pane was open when the session started over: reopened once a drawing has said what the screen is. */
  isRestorePending: boolean;
  /** What the last drawing said: the fullscreen layout, where a pane docks. Null before any. */
  isFullscreen: boolean | null;
  /** The session started with the choices a past one stored. */
  isPrefsRestored: boolean;
}

interface StoredSession {
  token: string;
  expiresAt: string;
}

interface StoredDevice {
  deviceCode: string;
  expiresAt: number;
  intervalMs: number;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isStoredSession = (value: unknown): value is StoredSession =>
  isObject(value) && typeof value.token === "string" && typeof value.expiresAt === "string";

const isStoredDevice = (value: unknown): value is StoredDevice =>
  isObject(value) &&
  typeof value.deviceCode === "string" &&
  typeof value.expiresAt === "number" &&
  typeof value.intervalMs === "number";

/** "✓ agent finished in 6m 14s · your hand is saved for 6 hours" (after 6 hours without a move,
 *  the relay closes the round: stand or cash-out); interrupted or failed turns get neutral words. */
export function finishNotice(reason: string, durationMs: number): AgentView["notice"] {
  const saved = `${SEPARATOR}your hand is saved for 6 hours`;

  if (reason === "answer") {
    return { text: `✓ agent finished in ${formatDuration(durationMs)}${saved}`, tone: "success" };
  }

  if (reason === "aborted") {
    return { text: `agent stopped after ${formatDuration(durationMs)}${saved}`, tone: "neutral" };
  }

  return { text: `agent turn ended after ${formatDuration(durationMs)}${saved}`, tone: "neutral" };
}

// A 5xx message is the server's own (a stack, a query) and never one meant for the player.
const failureText = (failure: ApiFailure): string =>
  failure.kind === "network"
    ? "couldn't reach tilt"
    : failure.status !== null && failure.status >= 500
      ? "tilt is having trouble"
      : cleanText(failure.message);

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const needsFastPoll = (state: StateResponse | null, current: IntentView | null): boolean =>
  current !== null || state?.round?.phase === "drawing" || state?.pendingIntentId != null;

function httpOf($: EngineInterface): Fetch {
  return (url, init) => $.http.fetch(url, init);
}

function logDebug($: EngineInterface, text: string): void {
  $.ui.log(`tilt: ${text}`, { to: "debug" });
}

async function readRemote($: EngineInterface): Promise<RemoteView> {
  return remoteView(await read($, remote));
}

async function readIntent($: EngineInterface): Promise<IntentView | null> {
  return intentView(await read($, intent));
}

async function readPrefs($: EngineInterface): Promise<Prefs> {
  return prefsView(await read($, prefs));
}

function setAuth($: EngineInterface, view: AuthView): Promise<AuthView> {
  return update($, auth, () => view);
}

// ---- session ----

async function readToken($: EngineInterface, rt: Runtime): Promise<string | null> {
  if (rt.token !== undefined) {
    return rt.token;
  }

  const stored = await $.store.get(STORE_SESSION);
  const isLive = isStoredSession(stored) && Date.parse(stored.expiresAt) > (await $.clock.now());

  rt.token = isLive ? stored.token : null;

  return rt.token;
}

async function logout($: EngineInterface, rt: Runtime, reason: string | null): Promise<void> {
  rt.token = null;
  await $.store.delete(STORE_SESSION);
  await $.store.delete(STORE_DEVICE);
  await setAuth($, { status: "out", message: reason });
  await update($, remote, () => ({ state: null, error: null, fetchedAt: 0 }));
  await update($, intent, () => null);
  // The next account's session starts from its own table.
  await update($, session, () => ({ net: "0", rounds: 0, startedAt: null, lastRound: null }));
}

// ---- login ----

async function openBrowser($: EngineInterface, url: string): Promise<boolean> {
  try {
    const opened = await $.process.run(["open", url], { timeoutMs: OPEN_TIMEOUT_MS });

    return opened.exitCode === 0;
  } catch (error) {
    // No `open` here (not macOS, or refused): the pane shows the link and the code instead.
    logDebug($, `could not open the browser: ${errorText(error)}`);

    return false;
  }
}

async function login($: EngineInterface, rt: Runtime): Promise<string> {
  if (rt.base === null) {
    return INVALID_API_URL;
  }

  // A second login would stop the polls and the resend of a move in flight until it is approved,
  // and an abandoned one would read as logged out while the session still holds.
  if ((await readToken($, rt)) !== null) {
    return ALREADY_IN;
  }

  const started = await startDevice(httpOf($), rt.base);

  if (!started.ok) {
    await setAuth($, { status: "out", message: `Login failed · ${failureText(started.failure)}` });

    return `Login failed: ${failureText(started.failure)}`;
  }

  const { deviceCode, userCode, expiresIn, interval } = started.value;
  // Opened and shown only on the API's own site: a hostile or compromised API cannot send the
  // player anywhere else, nor draw escape sequences in the terminal.
  const verifyUrl = trustedVerifyUrl(started.value.verifyUrl, rt.base);

  if (verifyUrl === null) {
    await setAuth($, { status: "out", message: `Login failed · ${UNTRUSTED_LOGIN_PAGE}` });

    return `Login failed: ${UNTRUSTED_LOGIN_PAGE}`;
  }

  const now = await $.clock.now();
  const device: StoredDevice = { deviceCode, expiresAt: now + expiresIn * 1000, intervalMs: interval * 1000 };

  await $.store.set(STORE_DEVICE, device);
  rt.nextLoginPollAt = now + device.intervalMs;
  rt.wakeAt = 0;
  await setAuth($, { status: "pending", userCode, verifyUrl });
  ensureTicker($, rt);

  const code = cleanText(userCode);

  const link = cleanText(verifyUrl);

  return (await openBrowser($, verifyUrl))
    ? `Opened ${link} · confirm code ${code} there.`
    : `Open ${link} and confirm code ${code}.`;
}

async function finishLogin($: EngineInterface, rt: Runtime, session: StoredSession): Promise<void> {
  await $.store.set(STORE_SESSION, session);
  await $.store.delete(STORE_DEVICE);
  rt.token = session.token;
  rt.lastPollAt = -Infinity;
  await setAuth($, { status: "in" });
}

async function endLogin($: EngineInterface, text: string): Promise<void> {
  await $.store.delete(STORE_DEVICE);
  await setAuth($, { status: "out", message: text });
}

/** Polls the device code at the interval the api asked for; returns when to look again. */
async function loginStep($: EngineInterface, rt: Runtime, now: number): Promise<number> {
  if (now < rt.nextLoginPollAt || rt.base === null) {
    return rt.nextLoginPollAt - now;
  }

  const device = await $.store.get(STORE_DEVICE);

  if (!isStoredDevice(device) || now >= device.expiresAt) {
    await endLogin($, "Login code expired · run /tilt login again.");

    return SLOW_POLL_MS;
  }

  const polled = await pollDevice(httpOf($), rt.base, device.deviceCode);

  rt.nextLoginPollAt = now + device.intervalMs;

  if (!polled.ok) {
    if (polled.failure.status === 429) {
      await $.store.set(STORE_DEVICE, { ...device, intervalMs: device.intervalMs + RATE_LIMIT_BACKOFF_MS });
    } else if (polled.failure.kind !== "network") {
      await endLogin($, `Login failed · ${failureText(polled.failure)}`);
    }

    return device.intervalMs;
  }

  const answer = polled.value;

  if (answer.status === "approved") {
    await finishLogin($, rt, { token: answer.token, expiresAt: answer.expiresAt });

    return 0;
  }

  if (answer.status !== "pending") {
    await endLogin($, `Login ${answer.status} · run /tilt login again.`);
  }

  return device.intervalMs;
}

// ---- moves ----

/** Drops the move `id` if it is still the one in flight. */
async function dropIntent($: EngineInterface, id: string): Promise<void> {
  await update($, intent, (held) => (intentView(held)?.id === id ? null : held));
}

async function settleAnswer($: EngineInterface, rt: Runtime, sent: IntentView, answer: IntentResponse): Promise<void> {
  if (answer.status === "pending") {
    await update($, intent, () => ({ ...sent, status: "pending" as const }));

    return;
  }

  rt.lastPollAt = -Infinity;
  rt.wakeAt = 0;

  if (answer.status === "submitted") {
    // The state polled until now still shows the table before the move: the keys stay off until
    // a state shows it, or a mashed key would play the old table a second time.
    const submittedAt = await $.clock.now();

    await update($, intent, () => ({ ...sent, status: "submitted" as const, submittedAt }));

    return;
  }

  await update($, intent, () => null);
  await update($, message, () => moveFailure(answer.error?.message ?? "Move failed."));
}

async function settleIntent(
  $: EngineInterface,
  rt: Runtime,
  sent: IntentView,
  result: ApiResult<IntentResponse>,
): Promise<void> {
  if ((await readIntent($))?.id !== sent.id) {
    return;
  }

  if (result.ok) {
    await settleAnswer($, rt, sent, result.value);

    return;
  }

  const { failure } = result;
  const isRateLimited = failure.status === 429;
  const isTransient = failure.kind === "network" || isRateLimited || (failure.status !== null && failure.status >= 500);

  if (isRateLimited) {
    rt.rateLimitedUntil = (await $.clock.now()) + RATE_LIMIT_BACKOFF_MS;
  }

  if (isTransient) {
    // Nothing is known about the move: it is resent later with the same id, never a new one.
    await update($, intent, () => ({ ...sent, status: "retrying" as const }));

    return;
  }

  await update($, intent, () => null);

  if (failure.status === 401) {
    await logout($, rt, LOGGED_OUT);

    return;
  }

  await update($, message, () => (failure.code === "PLAYER_BUSY" ? PLAYER_BUSY : failureText(failure)));
}

/** Sends, or resends with the same id, the move in flight; never while its last send has no answer. */
async function submit($: EngineInterface, rt: Runtime, sent: IntentView): Promise<void> {
  const token = await readToken($, rt);

  if (token === null || rt.base === null || rt.sendingId === sent.id) {
    return;
  }

  rt.sendingId = sent.id;
  rt.lastIntentAt = await $.clock.now();

  try {
    const answer = await play(httpOf($), rt.base, token, { intentId: sent.id, action: sent.action });

    await settleIntent($, rt, sent, answer);
  } finally {
    rt.sendingId = null;
  }
}

async function sendMove($: EngineInterface, rt: Runtime, action: PlayAction): Promise<void> {
  // A move the guards refuse (a zero stake from odd limits) would not read back as in flight, so
  // nothing would hold the next key press: it is never sent.
  if (!isPlayAction(action)) {
    await update($, message, () => UNPLAYABLE_BET);

    return;
  }

  const state = (await readRemote($)).state;
  const sent: IntentView = {
    id: crypto.randomUUID(),
    action,
    status: "sending",
    roundSeen: JSON.stringify(state?.round ?? null),
    submittedAt: null,
  };
  // Two key presses can run side by side: only the one that finds no move in flight sends.
  const held = await update($, intent, (value) => (intentView(value) === null ? sent : value));

  if (held?.id !== sent.id) {
    return;
  }

  await markOnboarded($);
  await update($, message, () => null);
  rt.wakeAt = 0;
  await submit($, rt, sent);
}

async function intentStep($: EngineInterface, rt: Runtime, token: string, now: number): Promise<void> {
  const current = await readIntent($);

  if (current === null || rt.base === null) {
    return;
  }

  if (current.status === "submitted") {
    if (now - (current.submittedAt ?? now) >= SETTLE_TIMEOUT_MS) {
      await dropIntent($, current.id);
    }

    return;
  }

  if (current.status !== "pending") {
    if (now - rt.lastIntentAt >= RETRY_MS) {
      await submit($, rt, current);
    }

    return;
  }

  if (now - rt.lastIntentAt >= FAST_POLL_MS) {
    rt.lastIntentAt = now;
    await settleIntent($, rt, current, await fetchIntent(httpOf($), rt.base, token, current.id));
  }
}

/** Changes the choices, and keeps them for the next sessions: the bet, the game, its settings. */
async function setPrefs($: EngineInterface, change: (value: Prefs) => Prefs): Promise<void> {
  await $.store.set(STORE_PREFS, await update($, prefs, (held) => change(prefsView(held))));
}

/** Keno's random picks: the player's own choice of numbers, not an outcome, so Math.random does. */
const randomBelow: RandomBelow = (bound) => Math.floor(Math.random() * bound);

async function startRound($: EngineInterface, rt: Runtime): Promise<void> {
  const state = (await readRemote($)).state;

  if (state === null) {
    return;
  }

  const chosen = await readPrefs($);
  const amount = currentBet(state.limits, chosen.betIndex);

  await sendMove($, rt, startAction(activeGame(state, chosen), amount, chosen));
}

/** A chip of the bet's size on `bet`, or on the cursor's cell; a full table or bet says why instead. */
async function addRouletteChip($: EngineInterface, bet: RouletteBet | null): Promise<void> {
  const state = (await readRemote($)).state;

  if (state === null) {
    return;
  }

  const outcome: { refusal: string | null } = { refusal: null };

  await setPrefs($, (value) => {
    const placed = addChip(
      value.rouletteChips,
      bet ?? cursorBet(value.rouletteCursor),
      currentBet(state.limits, value.betIndex),
      state.limits,
    );

    outcome.refusal = typeof placed === "string" ? placed : null;

    return typeof placed === "string" ? value : { ...value, rouletteChips: placed };
  });
  await update($, message, () => outcome.refusal);
}

async function runCommand($: EngineInterface, rt: Runtime, command: Command): Promise<void> {
  switch (command.kind) {
    case "switch": {
      const state = (await readRemote($)).state;

      // A round in play pins its game: the press says so rather than doing nothing.
      if (isRoundOpen(state) && state?.round) {
        const game = GAME_LABELS[state.round.detail.game];

        await update($, message, () => `Finish this ${game} round before switching game.`);

        return;
      }

      await update($, message, () => null);
      await setPrefs($, (value) => ({ ...value, game: command.game }));

      return;
    }
    case "bet": {
      const state = (await readRemote($)).state;

      if (state === null) {
        return;
      }

      await setPrefs($, (value) => ({
        ...value,
        betIndex: stepBetIndex(state.limits, value.betIndex, command.step),
      }));

      return;
    }
    case "hands":
      await setPrefs($, (value) => ({ ...value, hands: stepHands(value.hands, command.step) }));

      return;
    case "mines":
      await setPrefs($, (value) => ({ ...value, mines: stepMines(value.mines, command.step) }));

      return;
    case "step":
      await setPrefs($, (value) => stepSetting(value, command.setting, command.step, randomBelow));

      return;
    case "dice-over":
      await setPrefs($, (value) => ({ ...value, diceOver: !value.diceOver }));

      return;
    case "flip-side":
      await setPrefs($, (value) => ({ ...value, flipSide: command.side }));

      return;
    case "wheel-risk":
      await setPrefs($, (value) => ({ ...value, wheelRisk: cycle(WHEEL_RISKS, value.wheelRisk) }));

      return;
    case "keno-random":
      await setPrefs($, (value) => ({ ...value, kenoPicks: randomPicks(value.kenoPicks.length, randomBelow) }));

      return;
    case "keno-pick":
      await setPrefs($, (value) => ({ ...value, kenoPicks: toggleKenoPick(value.kenoPicks, command.number) }));

      return;
    case "roulette-add":
      await addRouletteChip($, command.bet);

      return;
    case "roulette-cursor":
      await setPrefs($, (value) => ({ ...value, rouletteCursor: stepCursor(value.rouletteCursor, command.step) }));

      return;
    case "roulette-across":
      await setPrefs($, (value) => ({ ...value, rouletteCursor: crossCursor(value.rouletteCursor, command.step) }));

      return;
    case "roulette-remove":
      await setPrefs($, (value) => {
        const cell = cursorBet(value.rouletteCursor);

        return { ...value, rouletteChips: value.rouletteChips.filter((chip) => !sameBet(chip.bet, cell)) };
      });

      return;
    case "roulette-undo":
      await setPrefs($, (value) => ({ ...value, rouletteChips: value.rouletteChips.slice(0, -1) }));

      return;
    case "roulette-clear":
      await setPrefs($, (value) => ({ ...value, rouletteChips: [] }));

      return;
    case "baccarat-bet":
      await setPrefs($, (value) => ({ ...value, baccarat: command.bet }));

      return;
    case "slots-speed":
      await setPrefs($, (value) => ({ ...value, slotsSpeed: command.speed }));

      return;
    case "start":
      await startRound($, rt);

      return;
    case "play":
      await sendMove($, rt, command.action);

      return;
    case "share":
      await shareWin($);
  }
}

/** A key press runs on its own: a failure is logged, never thrown into the surface. */
function commandRunner($: EngineInterface, rt: Runtime): (command: Command) => void {
  return (command) => {
    runCommand($, rt, command).catch((error: unknown) => logDebug($, `key failed: ${errorText(error)}`));
  };
}

/** The table surface module's keys where it is drawn: the band's game keys there (`bandTableKeys`). */
const tableKeysIn = (isBand: boolean, input: PlanInput): KeyAction[] =>
  isBand ? bandTableKeys(input) : tableKeys(input);

/** A key the table surface module pressed: checked, then run as that key of the plan, if it has it now. */
async function onTablePost($: EngineInterface, rt: Runtime, data: unknown, isBand: boolean): Promise<void> {
  if (!isTablePost(data)) {
    logDebug($, "ignored a malformed post from the table");

    return;
  }

  const snap = await snapshot($, rt);
  const state = snap.remote.state;
  const action =
    state === null
      ? undefined
      : tableKeysIn(isBand, { state, prefs: snap.prefs, isBusy: isPlayHeld(snap) }).find(
          (key) => key.key === data.press,
        );

  if (action !== undefined) {
    commandRunner($, rt)(action.command);
  }
}

// ---- background work ----

async function pollStep($: EngineInterface, rt: Runtime, token: string, now: number): Promise<number> {
  const held = await readRemote($);
  const interval = needsFastPoll(held.state, await readIntent($)) ? FAST_POLL_MS : SLOW_POLL_MS;

  if (now - rt.lastPollAt < interval || rt.base === null) {
    return interval - (now - rt.lastPollAt);
  }

  rt.lastPollAt = now;
  const fetched = await fetchState(httpOf($), rt.base, token);

  // A logout, or a login as someone else, came while this was in flight: its answer is not theirs.
  if (rt.token !== token) {
    return 0;
  }

  if (!fetched.ok) {
    if (fetched.failure.status === 401) {
      await logout($, rt, LOGGED_OUT);
    } else {
      if (fetched.failure.status === 429) {
        rt.rateLimitedUntil = now + RATE_LIMIT_BACKOFF_MS;
      }

      // The poll runs again on its own, whatever went wrong.
      await update($, remote, (value) => ({ ...value, error: `${failureText(fetched.failure)} · retrying` }));
    }

    return interval;
  }

  const minute = (ms: number) => Math.floor(ms / MS_PER_MINUTE);
  const isSame =
    held.error === null &&
    minute(held.fetchedAt) === minute(now) &&
    JSON.stringify(held.state) === JSON.stringify(fetched.value);

  // The deal, the spin and the result it holds back are set before the state can be drawn: a
  // drawing in between would show the settled round with nothing held, its balance first.
  await countRound($, rt, held.state, fetched.value, now);

  // An unchanged state is not written, so the pane is not redrawn on every poll.
  if (!isSame) {
    await update($, remote, () => ({ state: fetched.value, error: null, fetchedAt: now }));
  }

  const current = await readIntent($);

  if (current?.status === "submitted" && JSON.stringify(fetched.value.round) !== current.roundSeen) {
    await dropIntent($, current.id);
  }

  // A session with no stored choices opens on the game last played, set up as it was played.
  const last = fetched.value.round;

  if (held.state === null && last !== null && !rt.isPrefsRestored) {
    await setPrefs($, (value) => choicesOf({ ...value, game: last.detail.game }, last));
  }

  return needsFastPoll(fetched.value, await readIntent($)) ? FAST_POLL_MS : SLOW_POLL_MS;
}

async function flushImpressions($: EngineInterface, rt: Runtime, token: string): Promise<void> {
  const seconds = Math.min(IMPRESSION_FLUSH_MS / 1000, Math.floor(rt.sponsorMs / 1000));

  rt.sponsorMs = 0;

  if (rt.sponsorName === null || seconds < 1 || rt.base === null) {
    return;
  }

  const sent = await reportImpression(httpOf($), rt.base, token, { sponsor: rt.sponsorName, seconds });

  if (!sent.ok) {
    // Impressions are best effort: a lost report is logged, never shown or retried.
    logDebug($, `impression report failed: ${sent.failure.code}`);
  }
}

/** Counts the time the sponsor block is on screen and reports it at most every 60 s. */
async function impressionStep($: EngineInterface, rt: Runtime, token: string, elapsedMs: number): Promise<void> {
  const name = (await readRemote($)).state?.sponsor?.name ?? null;

  if (name !== rt.sponsorName) {
    await flushImpressions($, rt, token);
    rt.sponsorName = name;
  }

  if (name === null) {
    return;
  }

  rt.sponsorMs += elapsedMs;

  if (rt.sponsorMs >= IMPRESSION_FLUSH_MS) {
    await flushImpressions($, rt, token);
  }
}

async function paneSyncStep($: EngineInterface, rt: Runtime, now: number): Promise<void> {
  if (now - rt.lastPaneSyncAt < PANE_SYNC_MS) {
    return;
  }

  rt.lastPaneSyncAt = now;
  const pane = (await $.ui.panes()).find((each) => each.id === PANE);
  const isShown = pane !== undefined && pane.isPlaced && pane.isShown;
  // One that was open and is gone, the person closed.
  const isClosedByPerson = rt.isPaneOpen && pane === undefined;
  const held = await read($, layout);

  if (rt.isPaneOpen !== (pane !== undefined)) {
    await $.store.set(STORE_PANE, pane !== undefined);
  }

  // Written here, not while drawing: a render may not change state.
  if (rt.panePlacement !== null && (await $.store.get(STORE_PLACEMENT)) !== rt.panePlacement) {
    await $.store.set(STORE_PLACEMENT, rt.panePlacement);
  }

  rt.isPaneOpen = pane !== undefined;

  if (held.paneShown !== isShown || isClosedByPerson) {
    await update($, layout, (value: LayoutView) => ({
      ...value,
      paneShown: isShown,
      paneDismissed: value.paneDismissed || isClosedByPerson,
    }));
  }
}

/** How far into its spin the round on the table is; null when no spin is playing. */
async function spinElapsed($: EngineInterface, state: StateResponse | null, now: number): Promise<number | null> {
  const playing = await read($, spin);
  const round = state?.round;

  if (round === undefined || round === null || playing.round !== round.number) {
    return null;
  }

  return spinProgress(round, now - playing.startedAt, (await readPrefs($)).slotsSpeed);
}

/**
 * Blackjack, baccarat or Hilo cards turned over so far on the table; null when none is being dealt.
 * The deal lasts SURFACE_LAG_MS past its last card, the table surface module's own lag.
 */
async function dealRevealed($: EngineInterface, state: StateResponse | null, now: number): Promise<number | null> {
  const playing = await read($, deal);
  const round = state?.round;

  if (round === undefined || round === null || playing.round !== round.number) {
    return null;
  }

  const total = dealtCards(round);
  const elapsed = now - playing.startedAt;

  if (elapsed >= dealMs(playing.from, total) + SURFACE_LAG_MS) {
    return null;
  }

  return revealedAt(playing.from, total, elapsed) ?? total;
}

/** How far into its result's effects (and a win's celebration) the round on the table is; null when none plays. */
async function resultElapsed($: EngineInterface, state: StateResponse | null, now: number): Promise<number | null> {
  const playing = await read($, result);
  const round = state?.round;

  if (round === undefined || round === null || playing.round !== round.number) {
    return null;
  }

  const elapsed = now - playing.startsAt;

  return elapsed >= 0 && elapsed < Math.max(RESULT_MS, celebrationMs(round)) ? elapsed : null;
}

/** Whether the round on the table has a result still to show: it waits for the table to catch up. */
async function isResultAhead($: EngineInterface, state: StateResponse | null, now: number): Promise<boolean> {
  const playing = await read($, result);

  return playing.round !== null && playing.round === state?.round?.number && now < playing.startsAt;
}

/** The spin, the deal or the result playing on the table, and the balance held back until the round shows. */
async function motionView(
  $: EngineInterface,
): Promise<Pick<Snapshot, "spinElapsed" | "revealed" | "heldBalance" | "resultElapsed">> {
  const state = (await readRemote($)).state;
  const now = await $.clock.now();
  const elapsed = await spinElapsed($, state, now);
  const revealed = await dealRevealed($, state, now);
  const held =
    elapsed !== null
      ? (await read($, spin)).balance
      : revealed !== null
        ? (await read($, deal)).balance
        : (await isResultAhead($, state, now))
          ? (await read($, result)).balance
          : null;

  return {
    spinElapsed: elapsed,
    revealed,
    heldBalance: held,
    resultElapsed: await resultElapsed($, state, now),
  };
}

/** Whether a spin, a deal or a result is playing on the table. */
async function isMoving($: EngineInterface, state: StateResponse | null, now: number): Promise<boolean> {
  return (
    (await spinElapsed($, state, now)) !== null ||
    (await dealRevealed($, state, now)) !== null ||
    (await isResultAhead($, state, now)) ||
    (await resultElapsed($, state, now)) !== null
  );
}

/** Moves the spinner, a spin or a deal while something is in motion; says whether anything is. */
async function animate($: EngineInterface, rt: Runtime, now: number): Promise<boolean> {
  const state = (await readRemote($)).state;
  const view = await read($, agent);
  const moving = await isMoving($, state, now);
  const isAnimating = moving || view.isWorking || needsFastPoll(state, await readIntent($));
  // The end of a spin or a deal needs one more drawing: nothing else moves then to draw the table at rest.
  const hasStopped = rt.wasMoving && !moving;
  const frame = hasStopped ? view.frame + 1 : Math.floor(now / (moving ? SPIN_FRAME_MS : SPINNER_FRAME_MS));

  rt.wasMoving = moving;

  if ((isAnimating || hasStopped) && frame !== view.frame) {
    await update($, agent, (value) => ({ ...value, frame }));
  }

  return isAnimating;
}

/** One pass of the background work; returns how long nothing needs doing. */
async function step($: EngineInterface, rt: Runtime, now: number): Promise<number> {
  const elapsed = rt.lastTickAt === null ? 0 : now - rt.lastTickAt;
  const delays: number[] = [PANE_SYNC_MS];

  rt.lastTickAt = now;
  if (rt.isRestorePending && rt.isFullscreen !== null) {
    rt.isRestorePending = false;
    await restorePane($, rt, rt.isFullscreen);
  }

  await paneSyncStep($, rt, now);

  if (await animate($, rt, now)) {
    delays.push(rt.wasMoving ? SPIN_FRAME_MS : SPINNER_FRAME_MS);
  }

  const { status } = await read($, auth);

  if (status === "pending") {
    delays.push(await loginStep($, rt, now));
  }

  if (status !== "in") {
    return Math.max(0, Math.min(...delays));
  }

  const token = await readToken($, rt);

  if (token === null) {
    await logout($, rt, LOGGED_OUT);

    return 0;
  }

  if (now < rt.rateLimitedUntil) {
    delays.push(rt.rateLimitedUntil - now);
  } else {
    await intentStep($, rt, token, now);
    delays.push(await pollStep($, rt, token, now));

    // A poll that brought a spin or cards starts its frames now, not at the next tick.
    if (await isMoving($, (await readRemote($)).state, now)) {
      delays.push(SPIN_FRAME_MS);
    }
  }

  await impressionStep($, rt, token, elapsed);

  return Math.max(0, Math.min(...delays));
}

async function tick($: EngineInterface, rt: Runtime): Promise<void> {
  if (rt.isTicking) {
    return;
  }

  rt.isTicking = true;

  try {
    const now = await $.clock.now();

    if (now >= rt.wakeAt) {
      rt.wakeAt = now + (await step($, rt, now));
    }
  } catch (error) {
    logDebug($, `background step failed: ${errorText(error)}`);
  } finally {
    rt.isTicking = false;
  }
}

/** Timers die with the module, so every entry point makes sure the loop runs. */
function ensureTicker($: EngineInterface, rt: Runtime): void {
  if (rt.ticker === null) {
    rt.ticker = $.clock.every(TICK_MS, () => void tick($, rt));
  }
}

/** Plays one of the mod's sounds when the person turned them on; a terminal without a player plays nothing. */
function playSound($: EngineInterface, rt: Runtime, asset: string): void {
  if (rt.settings.sound) {
    $.audio.play({ asset }).catch((error: unknown) => logDebug($, `sound failed: ${errorText(error)}`));
  }
}

/** Counts a round once it settles, for the session line, and sounds a new round or a win. */
async function countRound(
  $: EngineInterface,
  rt: Runtime,
  before: StateResponse | null,
  after: StateResponse,
  now: number,
): Promise<void> {
  const round = after.round;
  const seen = await read($, session);

  const isNew = round !== null && before !== null && round.number !== before.round?.number;
  const hasLanded =
    round !== null &&
    round.phase === "idle" &&
    before?.round?.number === round.number &&
    before.round.phase === "drawing";

  if (isNew) {
    playSound($, rt, SOUND_DEAL);
  }

  // A roulette, wheel, slots or one-draw round spins on the table while it draws, and from its
  // landing until the wheel, the last reel, the roll or the last number stops; the result shows after.
  const speed = (await readPrefs($)).slotsSpeed;

  if ((isNew || hasLanded) && round !== null && before !== null && spinMs(round.detail, speed) > 0) {
    // On a landing the balance before the spin is the one already held.
    const balance = isNew ? before.balance : (await read($, spin)).balance;

    await update($, spin, () => ({ round: round.number, startedAt: now, balance }));
  }

  // New blackjack or baccarat cards (a deal, a card drawn, the dealer's turn, a draw landing) are
  // turned over one at a time, as the fullscreen table deals them; the balance waits for the last one.
  const cards = dealtCards(round);
  const shown = isNew ? 0 : dealtCards(before?.round ?? null);

  if (round !== null && before !== null && cards > shown) {
    await update($, deal, () => ({ round: round.number, from: shown, startedAt: now, balance: before.balance }));
  }

  // The first look at the table: what is on it was played before this session.
  if (before === null && seen.lastRound === null) {
    if (round !== null) {
      await update($, session, (value) => ({ ...value, lastRound: round.number }));
    }

    return;
  }

  if (round === null || round.phase !== "idle" || round.number === seen.lastRound) {
    return;
  }

  await update($, session, (value) => ({
    net: (BigInt(value.net) + BigInt(round.net)).toString(),
    rounds: value.rounds + 1,
    startedAt: value.startedAt ?? now,
    lastRound: round.number,
  }));

  if (BigInt(round.net) > 0n) {
    playSound($, rt, SOUND_WIN);
  }

  // A still table (the main screen's Mines and Tower boards) plays the result as the moving one does.
  const spinning = await read($, spin);
  const dealing = await read($, deal);
  // The balance shown until then: the one held while it spun or was dealt, else the one before it settled.
  const balance =
    spinning.round === round.number
      ? spinning.balance
      : dealing.round === round.number
        ? dealing.balance
        : (before?.balance ?? after.balance);
  const startsAt = await resultShowsAt($, round, now);

  await update($, result, () => ({ round: round.number, startsAt, balance }));
}

/**
 * When `round`'s result shows: after its spin lands and its last card is turned over, on the table
 * surface module too, which starts them when its props come (SURFACE_LAG_MS later).
 */
async function resultShowsAt($: EngineInterface, round: RoundView, now: number): Promise<number> {
  const spinning = await read($, spin);
  const dealing = await read($, deal);
  const speed = (await readPrefs($)).slotsSpeed;
  const spinEnd = spinning.round === round.number ? spinning.startedAt + spinMs(round.detail, speed) : now;
  const dealEnd = dealing.round === round.number ? dealing.startedAt + dealMs(dealing.from, dealtCards(round)) : now;

  return Math.max(now, spinEnd, dealEnd) + SURFACE_LAG_MS;
}

/** Copies a line about the last big win for the person to paste; nothing about their work is in it. */
async function shareWin($: EngineInterface): Promise<void> {
  const state = (await readRemote($)).state;
  const win = state === null ? null : bigWinOf(state);

  if (state === null || win === null) {
    return;
  }

  const sponsor = state.sponsor === null ? "" : `${SEPARATOR}presented by ${cleanText(state.sponsor.name)}`;
  const text = `Won ${formatUsdc(win.net)} USDC on ${GAME_LABELS[win.game].toLowerCase()} with Tilt while my agent worked${sponsor}`;
  const copied = await $.ui.copy({ text });

  await $.ui.toast(copied.isCopied ? "Copied · paste it anywhere." : `Could not copy: ${copied.reason}`);
}

/** A turn start opens the pane: the person wants it, placed at the side. */
const opensOnTurn = (rt: Runtime): boolean => rt.settings.autoOpen && rt.settings.layout === "side";

/** The first move made: the first-hand guide is done, in this session and the next ones. */
async function markOnboarded($: EngineInterface): Promise<void> {
  if (!(await read($, layout)).isOnboarded) {
    await update($, layout, (value) => ({ ...value, isOnboarded: true }));
    await $.store.set(STORE_ONBOARDED, true);
  }
}

/** Follows Claude Code's theme: the accents switch for a light terminal. */
async function readTheme($: EngineInterface): Promise<void> {
  const row = (await $.config.list()).find((each) => each.key === "theme");
  const isLight = isLightTheme(row?.value);

  if ((await read($, layout)).isLight !== isLight) {
    await update($, layout, (value) => ({ ...value, isLight }));
  }
}

/** Opens the game pane at the height its cards want. */
async function openPane($: EngineInterface, rt: Runtime, focus: boolean): Promise<boolean> {
  const rows = PANE_ROWS[rt.settings.cards];

  const opened = await $.ui.open(
    focus ? { id: PANE, title: PANE_TITLE, focus, rows } : { id: PANE, title: PANE_TITLE, rows },
  );

  return opened.isPlaced;
}

/** The `/config` row of one of the mod's own fields: `tilt.<field>`, or `tilt@<source>.<field>`. */
function isOwnRow(key: string, field: string): boolean {
  const dot = key.lastIndexOf(".");
  const plugin = key.slice(0, dot);

  return key.slice(dot + 1) === field && (plugin === PLUGIN || plugin.startsWith(`${PLUGIN}@`));
}

/** Saves the choices made in `/tilt setup` to the mod's own `/config` rows; the engine then reloads the mod with them. */
async function saveSettings($: EngineInterface, change: Partial<Settings>): Promise<void> {
  const rows = await $.config.list();

  for (const [name, value] of Object.entries(change) as [keyof Settings, Settings[keyof Settings]][]) {
    const row = rows.find((each) => isOwnRow(each.key, SETTING_FIELDS[name]));
    const deny = row === undefined ? "no such setting" : (await $.config.set({ key: row.key, value })).deny;

    if (deny !== undefined) {
      await $.ui.toast(`Tilt could not save ${name}: ${cleanText(deny)}`);
    }
  }
}

async function snapshot($: EngineInterface, rt: Runtime): Promise<Snapshot> {
  return {
    auth: await read($, auth),
    remote: await readRemote($),
    prefs: await readPrefs($),
    intent: await readIntent($),
    message: await read($, message),
    agent: await read($, agent),
    session: await read($, session),
    isOnboarded: (await read($, layout)).isOnboarded,
    depositUrl: depositUrlOf(rt, (await readRemote($)).state),
    ...(await motionView($)),
  };
}

/** The web page to deposit on, when the api named one on its own site. */
function depositUrlOf(rt: Runtime, state: StateResponse | null): string | null {
  return state?.webUrl === undefined || rt.base === null ? null : trustedVerifyUrl(state.webUrl, rt.base);
}

/** Games whose board is its keys: each hidden tile is the letter Button of its key, a click on it in fullscreen. */
const KEYED_BOARDS: ReadonlySet<Game> = new Set(["mines", "tower"]);

/** The table drawn by its surface module, at a card size, `columns` wide, the Wheel drawn as `wheel`,
 *  its result over the table where `isResultFirst`. */
type TableRegion = (cards: CardSize, columns: number, wheel: number | null, isResultFirst: boolean) => RenderElement;

/**
 * The table surface module in the pane or the band: the animated table (`region`), or null where
 * the still one is drawn. Beside a still board where clicks land, `keeper`: a `Client` under the
 * same key drawing nothing, so the keys a click gave the table before the game switched stay with
 * it, and press the board's keys.
 */
interface TableSite {
  region: TableRegion | null;
  keeper: RenderElement | null;
}

const NO_TABLE: TableSite = { region: null, keeper: null };

/**
 * The table surface module's site (TableSite). The fullscreen terminal hands raw keys (Space,
 * Enter, arrows) to a clicked `Client`; the main screen hands it neither clicks nor keys, but runs
 * its frame clock: there it deals, spins and counts up, and the letters play it.
 * `site.isPaneFocused`: the band never says, so false there.
 */
function tableOf(
  $: EngineInterface,
  e: RenderInput<"Pane" | "AbovePrompt">,
  rt: Runtime,
  snap: Snapshot,
  isLight: boolean,
  site: Pick<TableProps, "isPaneFocused" | "isClickable">,
): TableSite {
  const state = snap.remote.state;

  if (e.surface !== "terminal" || state === null || rt.isTableBroken) {
    return NO_TABLE;
  }

  const { Client } = $.ui.resolve(e);
  const keys = tableKeysIn(e.component === "AbovePrompt", { state, prefs: snap.prefs, isBusy: isPlayHeld(snap) });
  const client = (
    cards: CardSize,
    columns: number,
    wheel: number | null,
    isResultFirst: boolean,
    isKeysOnly = false,
  ) => {
    const props: TableProps = {
      state,
      prefs: snap.prefs,
      keys: keys.map(({ key, hotkey, label }) => ({ key, hotkey, label })),
      columns,
      cards,
      wheel,
      isResultFirst,
      isLight,
      ...site,
      dealing: dealingHands(snap),
      sending: sendingRound(snap),
      isKeysOnly,
    };

    return <Client key={TABLE_KEY} module="./table.tsx" props={props} />;
  };

  // A `Client` arms no hotkey: a board whose tiles are its keys is drawn still, its tiles the
  // Buttons of their letters (clicked too, in fullscreen), so the key line needs none of them.
  if (KEYED_BOARDS.has(activeGame(state, snap.prefs))) {
    return { region: null, keeper: site.isClickable ? client("small", 0, null, false, true) : null };
  }

  return { region: client, keeper: null };
}

// ---- hooks ----

async function onSessionStart($: EngineInterface, rt: Runtime, isInteractive: boolean): Promise<void> {
  await $.command.register({
    name: "tilt",
    description: "Tilt: open the game pane, or `login` / `logout` / `setup`",
    argumentHint: "[login|logout|setup]",
  });

  if ((await readToken($, rt)) !== null && (await read($, auth)).status === "out") {
    await setAuth($, { status: "in" });
  }

  // The colors are cosmetic: a theme that cannot be read leaves the dark set, never a dead session.
  await readTheme($).catch((error: unknown) => logDebug($, `theme not read: ${errorText(error)}`));

  if ((await $.store.get(STORE_ONBOARDED)) === true) {
    await update($, layout, (value) => ({ ...value, isOnboarded: true }));
  }

  const kept = storedPrefs(await $.store.get(STORE_PREFS));

  if (kept !== null) {
    await update($, prefs, () => kept);
    rt.isPrefsRestored = true;
  }

  if (!isInteractive) {
    return;
  }

  ensureTicker($, rt);

  // Claude Code's agents view (←, then Esc) runs the session on in a new process, where the mod
  // starts over: the pane it had comes back (restorePane), once a drawing says what the screen is.
  const wasOpen = (await $.store.get(STORE_PANE)) === true;

  rt.isRestorePending = wasOpen && rt.settings.layout !== "bottom" && !(await read($, layout)).paneDismissed;
}

/**
 * Reopens the pane a session that started over had, without the keyboard. Back from the agents
 * view Claude Code draws the session fullscreen, where a pane docks beside the transcript: a
 * person who played with it under the transcript gets the table above the prompt instead
 * (`/tilt` still opens the pane; played docked once, it comes back docked). The new process's
 * start time cannot tell such a return from a launch: only where the pane sat decides.
 */
async function restorePane($: EngineInterface, rt: Runtime, isFullscreen: boolean): Promise<void> {
  if (isFullscreen && (await $.store.get(STORE_PLACEMENT)) === "inline") {
    rt.settings = { ...rt.settings, layout: "bottom" };
    // Drawn again with the table in it.
    await update($, layout, (value) => ({ ...value, paneShown: false }));

    return;
  }

  const isPlaced = await openPane($, rt, false);

  await update($, layout, (value) => ({ ...value, paneShown: isPlaced }));
}

async function onTiltCommand($: EngineInterface, rt: Runtime, args: string): Promise<{ text: string }> {
  ensureTicker($, rt);
  const verb = args.trim();

  if (verb === "logout") {
    await logout($, rt, null);

    return { text: "Logged out of tilt." };
  }

  if (verb === "setup") {
    await $.ui.open({ id: SETUP_PANE, title: SETUP_TITLE, focus: true, rows: SETUP_ROWS });

    return { text: "Tilt setup opened: pick where the table sits and how big the cards are." };
  }

  if (verb === "login") {
    const text = await login($, rt);
    const isPlaced = rt.settings.layout === "bottom" ? false : await openPane($, rt, false);

    await update($, layout, (value) => ({ ...value, paneShown: isPlaced, paneDismissed: false }));

    return { text };
  }

  if (verb !== "") {
    return { text: "Usage: /tilt [login|logout|setup]" };
  }

  rt.wakeAt = 0;
  // Remembered at once (see STORE_PANE): the agents view may be one keypress away.
  rt.lastPaneSyncAt = -Infinity;

  // Placed at the bottom, the band is the table: there is no pane to open.
  if (rt.settings.layout === "bottom") {
    await update($, layout, (value) => ({ ...value, paneDismissed: false }));

    return { text: "Tilt is above the prompt · ctrl+x tab for the keys · /tilt setup to move it." };
  }

  const isPlaced = await openPane($, rt, true);

  await update($, layout, (value) => ({ ...value, paneShown: isPlaced, paneDismissed: false }));

  return { text: isPlaced ? "Tilt pane opened." : "Tilt is in the band above the prompt." };
}

async function onTurnStart($: EngineInterface, rt: Runtime): Promise<void> {
  ensureTicker($, rt);
  await update($, agent, (value) => ({ ...value, isWorking: true, notice: null }));
  rt.wakeAt = 0;

  // The agent comes first: the pane opens without the keyboard, and never again once the person
  // closed it. Placed at the bottom or compact, the band above the prompt is Tilt's place instead.
  if (opensOnTurn(rt) && !(await read($, layout)).paneDismissed) {
    const isPlaced = await openPane($, rt, false);

    await update($, layout, (value) => ({ ...value, paneShown: isPlaced }));
    rt.lastPaneSyncAt = -Infinity;
  }
}

/** The terminal reports clicks only on its fullscreen screen; a desktop always does. */
const isClickable = (surface: string, isFullscreen: boolean): boolean => surface !== "terminal" || isFullscreen;

export const register: Register = (on, options) => {
  const rt: Runtime = {
    base: apiBase(options.apiUrl),
    settings: settingsOf(options),
    ticker: null,
    isTicking: false,
    wakeAt: 0,
    lastTickAt: null,
    lastPollAt: -Infinity,
    lastIntentAt: -Infinity,
    lastPaneSyncAt: -Infinity,
    isPaneOpen: false,
    nextLoginPollAt: 0,
    sponsorMs: 0,
    sponsorName: null,
    token: undefined,
    wasMoving: false,
    panePlacement: null,
    isTableBroken: false,
    sendingId: null,
    rateLimitedUntil: 0,
    isRestorePending: false,
    isFullscreen: null,
    isPrefsRestored: false,
  };

  on("session.start", async ($, e, next) => {
    await onSessionStart($, rt, e.isInteractive);

    return next(e);
  });

  on("command.run", { command: "tilt" }, ($, e) => onTiltCommand($, rt, e.args));

  on("config.set", { key: "theme" }, async ($, e, next) => {
    const result = await next(e);

    if (result.value !== undefined) {
      await update($, layout, (value) => ({ ...value, isLight: isLightTheme(result.value) }));
    }

    return result;
  });

  on("turn.start", async ($, e, next) => {
    await onTurnStart($, rt);

    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    // A subagent's turn is not the agent finishing.
    if (e.agentId === undefined) {
      const notice = finishNotice(e.reason, e.durationMs);

      await update($, agent, (value) => ({ ...value, isWorking: false, notice }));
    }

    return next(e);
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const ui: Ui = $.ui.resolve(e);
    const look = await read($, layout);

    applyTheme(look.isLight);
    rt.panePlacement = e.props.placement;
    rt.isFullscreen = e.viewport?.isFullscreen === true;
    const pane: PaneLayout = {
      bodyColumns: e.props.bodyColumns,
      bodyRows: e.props.scroll.bodyRows,
      isFocused: e.props.isFocused,
      cards: rt.settings.cards,
      isClickable: isClickable(e.surface, e.viewport?.isFullscreen === true),
      isBand: false,
    };
    const snap = await snapshot($, rt);
    const table = tableOf($, e, rt, snap, look.isLight, {
      isPaneFocused: e.props.isFocused,
      isClickable: pane.isClickable,
    });

    return renderPane(ui, snap, pane, commandRunner($, rt), table.region, table.keeper);
  });

  on("ui.message", { element: TABLE_KEY }, async ($, e) => {
    await onTablePost($, rt, e.data, e.component === "AbovePrompt");

    return {};
  });

  on("ui.fault", { element: TABLE_KEY }, ($, e, next) => {
    // The engine draws the pane or the band again: without the table's `Client` from now on, the still table instead.
    rt.isTableBroken = true;
    logDebug($, `table failed (${e.phase}): ${e.reason}`);

    return next(e);
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    rt.isFullscreen = e.viewport?.isFullscreen === true;

    if (rt.isRestorePending) {
      rt.wakeAt = 0;
    }

    const look = await read($, layout);

    if (e.props.hasSurvey || look.paneShown) {
      return next(e);
    }

    applyTheme(look.isLight);
    const ui: Ui = $.ui.resolve(e);
    const snap = await snapshot($, rt);

    // The band shows a tree of at most `maxRows` whole and scrolls a taller one, the sponsor out of
    // view with it. Off fullscreen it may take the terminal's whole height: there it keeps to half,
    // the agent's answer in view. The table takes its smallest form (small cards, the Wheel's strip)
    // where that is what fits; where nothing does, the compact band stands in for it.
    const rows =
      e.viewport === undefined || e.viewport.isFullscreen
        ? e.props.maxRows
        : Math.min(e.props.maxRows, Math.floor(e.viewport.rows / 2));
    const band: PaneLayout = {
      bodyColumns: e.props.bodyColumns,
      bodyRows: rows,
      isFocused: false,
      cards: rt.settings.cards,
      isClickable: isClickable(e.surface, e.viewport?.isFullscreen === true),
      isBand: true,
    };

    if (rt.settings.layout === "bottom" && fitsRows(snap, band, rows)) {
      const table = tableOf($, e, rt, snap, look.isLight, { isPaneFocused: false, isClickable: band.isClickable });

      return renderPane(ui, snap, band, commandRunner($, rt), table.region, table.keeper);
    }

    return renderBand(ui, snap, { bodyColumns: e.props.bodyColumns }, commandRunner($, rt));
  });

  on("ui.render", { component: "Pane", requestId: SETUP_PANE }, async ($, e) => {
    applyTheme((await read($, layout)).isLight);

    return renderSetup(
      $.ui.resolve(e),
      rt.settings,
      e.props.bodyColumns,
      (change) =>
        void saveSettings($, change).catch((error: unknown) => logDebug($, `setting not saved: ${errorText(error)}`)),
    );
  });
};
