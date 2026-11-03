// The whole Tilt table as text lines, for any harness that can print lines: header and game tabs,
// the agent line, what the session says before there is a game, the table, then the keys.
import { cleanText, formatSigned, formatUsdc, SEPARATOR } from "../../../../apps/mod/hooks/format";
import { activeGame, GAME_LABELS, GAMES, gamePage } from "../../../../apps/mod/hooks/keys";
import type { Game, RoundView, StateResponse } from "../../../../apps/mod/hooks/protocol";
import type { RenderContext, Snapshot, Tone } from "../types";
import { renderKeno, renderMines, renderTower } from "./boards";
import { renderBaccarat, renderBlackjack, renderHilo } from "./cards";
import { renderDice, renderFlip, renderLimbo } from "./draws";
import { renderRoulette, renderSlots, renderWheel } from "./spin";
import { bold, dim, fit, gold, green, inverse, pink, red, visibleWidth } from "./style";

export interface PanelOptions {
  color: boolean;
  width: number;
  /** How this harness logs in, shown to a logged-out player: "/tilt login", "ctrl+l"… */
  loginHint?: string;
}

type GameRenderer = (round: RoundView | null, ctx: RenderContext) => string[];

const RENDERERS: Record<Game, GameRenderer> = {
  blackjack: renderBlackjack,
  roulette: renderRoulette,
  baccarat: renderBaccarat,
  slots: renderSlots,
  mines: renderMines,
  dice: renderDice,
  limbo: renderLimbo,
  flip: renderFlip,
  keno: renderKeno,
  wheel: renderWheel,
  hilo: renderHilo,
  tower: renderTower,
};

/** Digits 1 to 9 pick a game of the page, 0 turns it (keys.ts switchKeys). */
const GAMES_PER_PAGE = 9;
const PAGE_HOTKEY = "0";
/** The most lines a game renderer may take. */
const TABLE_ROWS = 12;
const CHIP_GAP = "  ";
/** Switch keys are drawn as the header's tabs, not again among the keys. */
const SWITCH_KEY_PREFIX = "game-";

const DEFAULT_LOGIN_HINT = "/tilt login";

/** Chips laid left to right, a new line when the next does not fit; a chip wider than the line gets its own (cut later). */
function wrapChips(chips: readonly string[], width: number): string[] {
  const lines: string[] = [];
  let line = "";

  for (const chip of chips) {
    if (line === "") {
      line = chip;
    } else if (visibleWidth(line) + CHIP_GAP.length + visibleWidth(chip) <= width) {
      line += CHIP_GAP + chip;
    } else {
      lines.push(line);
      line = chip;
    }
  }

  return line === "" ? lines : [...lines, line];
}

/** A long URL split across lines rather than cut: still readable and copyable in full. */
function wrapText(text: string, width: number): string[] {
  const characters = [...text];
  const lines: string[] = [];

  for (let start = 0; start < characters.length; start += width) {
    lines.push(characters.slice(start, start + width).join(""));
  }

  return lines;
}

function gameTabs(state: StateResponse, snapshot: Snapshot, color: boolean): string[] {
  const shown = activeGame(state, snapshot.prefs);
  const page = gamePage(shown);
  const pages = Math.ceil(GAMES.length / GAMES_PER_PAGE);
  const tabs = GAMES.slice(page * GAMES_PER_PAGE, (page + 1) * GAMES_PER_PAGE).map((game, index) => {
    const tab = `[${index + 1}] ${GAME_LABELS[game]}`;
    return game === shown ? inverse(color, pink(color, tab)) : dim(color, tab);
  });

  return pages > 1 ? [...tabs, dim(color, `[${PAGE_HOTKEY}] more ${page + 1}/${pages}`)] : tabs;
}

function balanceSide(state: StateResponse, color: boolean): string {
  const balance = `balance ${gold(color, formatUsdc(state.balance))}`;
  return state.rank === null ? balance : `${balance}${SEPARATOR}rank ${gold(color, `#${state.rank}`)}`;
}

/** "TILT  tabs…  balance 12.40" on one line when it fits; else TILT and the balance, the tabs wrapped under. */
function header(snapshot: Snapshot, color: boolean, width: number): string[] {
  const brand = pink(color, bold(color, "TILT"));
  const state = snapshot.state;

  if (state === null) return [brand];

  const right = balanceSide(state, color);
  const tabs = gameTabs(state, snapshot, color);
  const oneLine = [brand, ...tabs].join(CHIP_GAP);
  const room = width - visibleWidth(oneLine) - visibleWidth(right);

  if (room >= CHIP_GAP.length) return [`${oneLine}${" ".repeat(room)}${right}`];

  const gap = Math.max(1, width - visibleWidth(brand) - visibleWidth(right));
  return [`${brand}${" ".repeat(gap)}${right}`, ...wrapChips(tabs, width)];
}

function agentLine(snapshot: Snapshot, color: boolean): string {
  if (snapshot.agent.isWorking) return green(color, "● agent working · your keys go to Tilt");
  return dim(color, snapshot.agent.notice ?? "○ agent idle");
}

/** What the panel says before there is a table to show; null once there is one. */
function preamble(snapshot: Snapshot, color: boolean, width: number, loginHint: string): string[] | null {
  const { auth, state } = snapshot;

  if (auth.status === "out") {
    const invite = `Run ${gold(color, loginHint)} to play while your agent works.`;
    return auth.message === null ? [invite] : [invite, dim(color, cleanText(auth.message))];
  }

  if (auth.status === "pending") {
    return [
      `Confirm code ${gold(color, bold(color, cleanText(auth.userCode)))} in your browser · waiting`,
      ...wrapText(cleanText(auth.verifyUrl), width),
      // login() sets a notice here (e.g. the browser could not be opened): the only place it shows before the table.
      ...(snapshot.message === null ? [] : [dim(color, cleanText(snapshot.message.text))]),
    ];
  }

  if (state === null) return [dim(color, snapshot.error === null ? "connecting…" : cleanText(snapshot.error))];

  if (!state.accountOpen) {
    const hint = "No Tilt account yet · make a first deposit on the web to open one.";
    return snapshot.depositUrl === null ? [hint] : [hint, ...wrapText(snapshot.depositUrl, width)];
  }

  return null;
}

function table(state: StateResponse, snapshot: Snapshot, color: boolean, width: number): string[] {
  const game = activeGame(state, snapshot.prefs);
  const round = state.round !== null && state.round.detail.game === game ? state.round : null;
  const ctx: RenderContext = { color, width, prefs: snapshot.prefs, now: snapshot.now };

  return RENDERERS[game](round, ctx).slice(0, TABLE_ROWS);
}

const TONE_PAINT: Record<Tone, (color: boolean, text: string) => string> = {
  success: green,
  neutral: (_color, text) => text,
  loss: red,
};

function notices(snapshot: Snapshot, state: StateResponse, color: boolean): string[] {
  const lines: string[] = [];

  if (snapshot.message !== null) lines.push(TONE_PAINT[snapshot.message.tone](color, cleanText(snapshot.message.text)));
  if (snapshot.error !== null) lines.push(dim(color, cleanText(snapshot.error)));
  if (state.sponsor !== null) {
    const { name, pool } = state.sponsor;
    lines.push(
      `${dim(color, "presented by ")}${bold(color, cleanText(name))}${dim(color, `${SEPARATOR}pool `)}${gold(color, formatUsdc(pool))}`,
    );
  }

  return lines;
}

function keyChips(snapshot: Snapshot, color: boolean): string[] {
  return snapshot.keys
    .filter((action) => action.hotkey !== "" && !action.key.startsWith(SWITCH_KEY_PREFIX))
    .map((action) => {
      const label = snapshot.isBusy
        ? dim(color, action.label)
        : action.isSelected
          ? bold(color, action.label)
          : action.label;
      return `${gold(color, bold(color, action.hotkey))} ${label}`;
    });
}

/** The whole table, every line exactly `width` columns. */
export function renderPanel(
  snapshot: Snapshot,
  { color, width, loginHint = DEFAULT_LOGIN_HINT }: PanelOptions,
): string[] {
  const top = [...header(snapshot, color, width), agentLine(snapshot, color)];
  const before = preamble(snapshot, color, width, loginHint);
  const state = snapshot.state;
  const body =
    before !== null || state === null
      ? (before ?? [])
      : [
          ...(state.blocked === null ? [] : [red(color, cleanText(state.blocked))]),
          ...table(state, snapshot, color, width),
          ...notices(snapshot, state, color),
          ...wrapChips(keyChips(snapshot, color), width),
        ];

  return [...top, ...body].map((line) => fit(line, width));
}

function lastResult(round: RoundView | null, color: boolean): string | null {
  if (round === null) return null;
  if (round.phase !== "idle") return "in play";

  const net = BigInt(round.net);
  const text = formatSigned(round.net);
  return net > 0n ? green(color, text) : net < 0n ? red(color, text) : dim(color, text);
}

/** One line for a harness's status bar: "TILT 12.40 · Blackjack · +1.00 · agent working". */
export function renderStatusLine(
  snapshot: Snapshot,
  { color, width, loginHint = DEFAULT_LOGIN_HINT }: PanelOptions,
): string {
  const brand = pink(color, bold(color, "TILT"));
  const { auth, state } = snapshot;

  if (auth.status === "out") return fit(`${brand}${SEPARATOR}${gold(color, loginHint)}`, width);
  if (auth.status === "pending")
    return fit(`${brand}${SEPARATOR}confirm code ${gold(color, cleanText(auth.userCode))}`, width);
  if (state === null) return fit(`${brand}${SEPARATOR}${dim(color, "connecting…")}`, width);

  const parts = [
    `${brand} ${gold(color, formatUsdc(state.balance))}`,
    GAME_LABELS[activeGame(state, snapshot.prefs)],
    lastResult(state.round, color),
    snapshot.agent.isWorking ? green(color, "agent working") : dim(color, "agent idle"),
  ].filter((part): part is string => part !== null);

  return fit(parts.join(SEPARATOR), width);
}
