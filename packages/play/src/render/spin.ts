// Roulette, wheel and slots as plain text lines: what the mod's spinning tables show, without the
// animation. Shown only; the program draws and pays.
import {
  chipsTotal,
  cleanText,
  compactUsdc,
  formatSigned,
  formatUsdc,
  hundredths,
  pocketColor,
  rouletteBetLabel,
  rouletteMaxGain,
  rouletteWins,
  SEPARATOR,
} from "../../../../apps/mod/hooks/format";
import { cursorBet, sameBet, stackChips, stakeOn } from "../../../../apps/mod/hooks/keys";
import type { RouletteBet, RouletteChip, RoundView, WheelView } from "../../../../apps/mod/hooks/protocol";
import type { Prefs, RenderContext } from "../types";
import { bold, dim, fit, gold, green, inverse, pink, red, visibleWidth } from "./style";

type Paint = (color: boolean, text: string) => string;

const MAX_LINES = 12;
const ZERO_USDC = formatUsdc("0");
const plain: Paint = (_color, text) => text;

/** Every line within `width` columns and at most MAX_LINES of them: server text never overflows the panel. */
const clamp = (lines: readonly string[], width: number): string[] =>
  lines.slice(0, MAX_LINES).map((line) => (visibleWidth(line) > width ? fit(line, width) : line));

const centered = (text: string, width: number): string =>
  text.padStart(Math.floor((width + text.length) / 2)).padEnd(width);

/** `items` joined by `separator` into as few lines of `width` columns as they take. */
function wrap(items: readonly string[], width: number, separator: string): string[] {
  const lines: string[] = [];
  let line = "";

  for (const item of items) {
    const next = line === "" ? item : `${line}${separator}${item}`;

    if (line !== "" && visibleWidth(next) > width) {
      lines.push(line);
      line = item;
    } else {
      line = next;
    }
  }

  return line === "" ? lines : [...lines, line];
}

/** A settled round's sentence, its signed net (green won, red lost) and Tilt's fee when it reads as more than 0.00. */
function outcomeLine(color: boolean, round: RoundView, sentence: string): string {
  const net = BigInt(round.net);
  const signed = formatSigned(round.net);
  const shownNet = net > 0n ? bold(color, green(color, signed)) : net < 0n ? red(color, signed) : dim(color, signed);
  const fee = formatUsdc(round.fee) === ZERO_USDC ? "" : dim(color, `${SEPARATOR}fee ${formatUsdc(round.fee)}`);

  return `${sentence === "" ? "" : `${sentence} `}${shownNet}${fee}`;
}

const statusText = (color: boolean, isDrawing: boolean): string => dim(color, isDrawing ? "spinning…" : "No spin yet.");

// ── Roulette ────────────────────────────────────────────────────────────────────────────────────

/** Under this many columns the felt drops its `2:1` cells into a row of their own. */
const ROULETTE_COMPACT_BELOW = 64;
const CHIP = "●";
const NUMBERS_ACROSS = 12;
/** The felt's rows top first, each named by its column: 3 6 … 36, then 2 5 … 35, then 1 4 … 34. */
const FELT_COLUMNS = [3, 2, 1] as const;
const COLUMN_NAMES: Record<1 | 2 | 3, string> = { 3: "top", 2: "mid", 1: "low" };
const DOZENS = [1, 2, 3] as const;
const DOZEN_NAMES: Record<1 | 2 | 3, string> = { 1: "1st 12", 2: "2nd 12", 3: "3rd 12" };
const OUTSIDE_BETS: readonly RouletteBet[] = [
  { kind: "low" },
  { kind: "even" },
  { kind: "red" },
  { kind: "black" },
  { kind: "odd" },
  { kind: "high" },
];
const OUTSIDE_NAMES: Record<string, string> = { low: "1–18", high: "19–36" };
/** A column's cell at the end of its row, as on the felt. */
const COLUMN_LABEL = "2:1";
/** Columns per cell: a number (its digits and its chip mark), the 0 beside the rows, a `2:1`. */
const FELT_SIZES = {
  wide: { number: 4, zero: 4, column: 4 },
  compact: { number: 3, zero: 2, column: 0 },
} as const;
type FeltSize = (typeof FELT_SIZES)[keyof typeof FELT_SIZES];

interface Felt {
  color: boolean;
  chips: readonly RouletteChip[];
  /** The pocket the ball landed in, lit; null while it spins or before any spin. */
  pocket: number | null;
  /** The bets the last spin won on, lit with the pocket. */
  winners: readonly RouletteBet[];
  /** The cell the cursor is on, inverse; null while a spin is in play. */
  cursor: RouletteBet | null;
}

const NUMBER_PAINT: Record<"green" | "red" | "black", Paint> = { green, red, black: plain };
const OUTSIDE_PAINT: Record<string, Paint> = { red, black: plain };

function betName(bet: RouletteBet): string {
  switch (bet.kind) {
    case "straight":
      return String(bet.number);
    case "dozen":
      return DOZEN_NAMES[bet.dozen];
    case "column":
      return `${COLUMN_LABEL} ${COLUMN_NAMES[bet.column]}`;
    default:
      return (OUTSIDE_NAMES[bet.kind] ?? bet.kind).toUpperCase();
  }
}

/**
 * A cell `width` columns wide: its label, `●` right after it where chips are on it. The cursor's
 * cell is inverse, the landed pocket and the cells that won gold; otherwise the label in its felt's color.
 */
function cell(
  felt: Felt,
  bet: RouletteBet,
  label: string,
  width: number,
  paint: Paint,
  align: "end" | "center",
): string {
  const mark = stakeOn(felt.chips, bet) > 0n ? CHIP : " ";
  const room = Math.max(0, width - label.length - mark.length);
  const left = " ".repeat(align === "end" ? room : Math.floor(room / 2));
  const right = " ".repeat(align === "end" ? 0 : room - Math.floor(room / 2));
  const isLit =
    (bet.kind === "straight" && bet.number === felt.pocket) || felt.winners.some((won) => sameBet(won, bet));

  if (felt.cursor !== null && sameBet(felt.cursor, bet)) {
    return `${left}${inverse(felt.color, `${label}${mark}`)}${right}`;
  }

  if (isLit) {
    return `${left}${bold(felt.color, gold(felt.color, `${label}${mark}`))}${right}`;
  }

  return `${left}${paint(felt.color, label)}${mark === CHIP ? gold(felt.color, mark) : mark}${right}`;
}

/** The felt as on a casino table: 0 left of three rows of twelve numbers, the dozens, the outside bets. */
function feltLines(felt: Felt, size: FeltSize): string[] {
  const indent = " ".repeat(size.zero);
  const numberCell = (number: number, width: number): string =>
    cell(felt, { kind: "straight", number }, String(number), width, NUMBER_PAINT[pocketColor(number)], "end");
  const rows = FELT_COLUMNS.map((column, row) => {
    const zero = row === 1 ? numberCell(0, size.zero) : indent;
    const numbers = Array.from({ length: NUMBERS_ACROSS }, (_, index) =>
      numberCell(index * 3 + column, size.number),
    ).join("");
    const columnBet =
      size.column > 0 ? cell(felt, { kind: "column", column }, COLUMN_LABEL, size.column, plain, "end") : "";

    return `${zero}${numbers}${columnBet}`;
  });
  const sideCells = (bets: readonly RouletteBet[], width: number): string =>
    indent +
    bets.map((bet) => cell(felt, bet, betName(bet), width, OUTSIDE_PAINT[bet.kind] ?? plain, "center")).join("");
  const dozens = sideCells(
    DOZENS.map((dozen): RouletteBet => ({ kind: "dozen", dozen })),
    size.number * 4,
  );
  const outside = sideCells(OUTSIDE_BETS, size.number * 2);
  // Compact, the `2:1`s take a row under the dozens, as wide as them, top row's first.
  const columns =
    size.column > 0
      ? []
      : [
          sideCells(
            FELT_COLUMNS.map((column): RouletteBet => ({ kind: "column", column })),
            size.number * 4,
          ),
        ];

  return [...rows, dozens, ...columns, outside];
}

/** "on the table 2.30 · 3 bets · max win 31.50", then each bet's stake: "17 ●2 · RED ●.5". */
function chipsLines(color: boolean, chips: readonly RouletteChip[], width: number): string[] {
  if (chips.length === 0) {
    return [dim(color, "No chips on the table yet.")];
  }

  const summary = wrap(
    [
      `on the table ${bold(color, gold(color, formatUsdc(chipsTotal(chips).toString())))}`,
      `${chips.length} ${chips.length === 1 ? "bet" : "bets"}`,
      `max win ${bold(color, formatUsdc(rouletteMaxGain(chips).toString()))}`,
    ],
    width,
    SEPARATOR,
  );
  const stakes = chips.map((chip) => `${betName(chip.bet)} ${gold(color, `${CHIP}${compactUsdc(chip.amount)}`)}`);

  return [...summary, fit(stakes.join(SEPARATOR), width).trimEnd()];
}

/** The landed pocket on its color: "17 BLACK". */
function pocketText(color: boolean, pocket: number): string {
  const pocketKind = pocketColor(pocket);

  return bold(color, NUMBER_PAINT[pocketKind](color, `${pocket} ${pocketKind.toUpperCase()}`));
}

/** What a spin did to its chips, as the mod says it: "Red wins.", "2 of 3 bets win.", "No bet wins." */
function rouletteSentence(chips: readonly RouletteChip[], pocket: number, net: string): string {
  const [only] = chips;

  if (chips.length === 1 && only !== undefined) {
    const bet = rouletteBetLabel(only.bet);

    return `${bet.charAt(0).toUpperCase()}${bet.slice(1)} ${BigInt(net) > 0n ? "wins" : "loses"}.`;
  }

  const won = chips.filter((chip) => rouletteWins(chip.bet, pocket)).length;

  return won === 0 ? "No bet wins." : `${won} of ${chips.length} bets win.`;
}

/**
 * A spin in play shows its own chips; between spins the felt shows the chips placed for the next
 * one, with the last spin's pocket and winning cells still lit, and the cursor on its cell.
 */
export function renderRoulette(round: RoundView | null, ctx: RenderContext): string[] {
  const { color, width, prefs } = ctx;
  const detail = round?.detail.game === "roulette" ? round.detail : null;
  const isOpen = round !== null && detail !== null && round.phase !== "idle";
  // An older single-bet round may come without chips: its bet carries the whole stake.
  const spinChips =
    round === null || detail === null
      ? []
      : detail.chips.length > 0
        ? detail.chips
        : [{ bet: detail.bet, amount: round.stake }];
  const chips = isOpen ? spinChips : stackChips(prefs.rouletteChips);
  const landed = round !== null && round.phase === "idle" ? (detail?.number ?? null) : null;
  const felt: Felt = {
    color,
    chips,
    pocket: landed,
    winners: landed === null ? [] : spinChips.filter((chip) => rouletteWins(chip.bet, landed)).map((chip) => chip.bet),
    cursor: isOpen ? null : cursorBet(prefs.rouletteCursor),
  };
  const status = landed !== null ? pocketText(color, landed) : statusText(color, isOpen);
  const outcome =
    round !== null && landed !== null
      ? [outcomeLine(color, round, rouletteSentence(spinChips, landed, round.net))]
      : [];
  const size = width < ROULETTE_COMPACT_BELOW ? FELT_SIZES.compact : FELT_SIZES.wide;

  return clamp([status, ...outcome, ...feltLines(felt, size), ...chipsLines(color, chips, width)], width);
}

// ── Wheel ───────────────────────────────────────────────────────────────────────────────────────

/** A segment in the strip: ` ×1.50 `, the landed one `[×1.50]`. */
const WHEEL_CELL = 8;
const WHEEL_FACE = WHEEL_CELL - 2;
/** A multiplier of 1.00, in hundredths: below it the landing gives part of the stake back, at best. */
const STAKE_BACK = 100n;
const MAX_LEGEND_LINES = 3;

/**
 * The wheel round the table shows, as the mod's `isRoundShown`: an open one always; a settled one
 * only while the next spin is set up with the same segments and risk.
 */
function shownWheel(round: RoundView | null, prefs: Prefs): WheelView | null {
  if (round === null) {
    return null;
  }

  const detail = round.detail;

  if (detail.game !== "wheel") {
    return null;
  }

  const isSameSetup = detail.segments === prefs.wheelSegments && detail.risk === prefs.wheelRisk;

  return round.phase !== "idle" || isSameSetup ? detail : null;
}

/** The segments in a strip as many as fit, centered on the landed one (the pointer `▼` over it), all of them when they fit. */
function wheelStrip(color: boolean, pays: readonly string[], landed: number | null, width: number): string[] {
  const fitting = Math.floor(width / WHEEL_CELL);
  const isAll = pays.length <= fitting;
  const count = isAll ? pays.length : fitting - (fitting % 2 === 0 ? 1 : 0);
  const focus = landed ?? 0;
  const first = isAll ? 0 : focus - Math.floor(count / 2);
  const indices = Array.from(
    { length: count },
    (_, slot) => (((first + slot) % pays.length) + pays.length) % pays.length,
  );
  const best = pays.reduce((top, pay) => (hundredths(pay) > top ? hundredths(pay) : top), 0n);
  const strip = indices
    .map((index) => {
      const pay = pays[index] ?? "0.00";
      const face = centered(`×${pay}`, WHEEL_FACE);

      if (index === landed) {
        return inverse(color, bold(color, `[${face}]`));
      }

      const paint = hundredths(pay) < STAKE_BACK ? dim : hundredths(pay) === best ? gold : plain;

      return ` ${paint(color, face)} `;
    })
    .join("");

  if (landed === null) {
    return [strip];
  }

  const pointer = indices.indexOf(landed) * WHEEL_CELL + Math.floor(WHEEL_CELL / 2);

  return [gold(color, `${" ".repeat(pointer)}▼`), strip];
}

/** Each multiplier the wheel pays once, smallest first, with how many segments pay it: "×0.00 (5)". */
function wheelLegend(color: boolean, pays: readonly string[], width: number): string[] {
  const counts = new Map<string, number>();

  for (const pay of pays) {
    counts.set(pay, (counts.get(pay) ?? 0) + 1);
  }

  const values = [...counts].sort(([a], [b]) => Number(hundredths(a) - hundredths(b)));

  return wrap(
    values.map(([pay, count]) => `×${pay} ${dim(color, `(${count})`)}`),
    width,
    "  ",
  ).slice(0, MAX_LEGEND_LINES);
}

/** The segments and risk, the strip of multipliers around the pointer, what each pays, then the landing. */
export function renderWheel(round: RoundView | null, ctx: RenderContext): string[] {
  const { color, width, prefs } = ctx;
  const shown = shownWheel(round, prefs);
  const isDrawing = shown !== null && round?.phase === "drawing";
  const landed = shown !== null && round?.phase === "idle" ? shown.segment : null;
  const pays = shown?.multipliers ?? [];
  const about = [`${shown?.segments ?? prefs.wheelSegments} segments`, `${shown?.risk ?? prefs.wheelRisk} risk`];
  const head = wrap(landed === null ? [...about, statusText(color, isDrawing)] : about, width, SEPARATOR);
  const strip = pays.length === 0 ? [] : wheelStrip(color, pays, landed, width);
  const outcome =
    round !== null && landed !== null ? [outcomeLine(color, round, `Landed on ×${pays[landed] ?? "0.00"}.`)] : [];

  return clamp([...head, ...strip, ...wheelLegend(color, pays, width), ...outcome], width);
}

// ── Slots ───────────────────────────────────────────────────────────────────────────────────────

/** The pay table, gross times the bet, as `games/slots.rs` pays it. Mirrored to show; the program pays. */
const PAYS: readonly { line: string; times: number; symbol: string; pair?: true }[] = [
  { line: "777", times: 250, symbol: "7" },
  { line: "◆◆◆", times: 100, symbol: "◆" },
  { line: "★★★", times: 40, symbol: "★" },
  { line: "♣♣♣", times: 20, symbol: "♣" },
  { line: "¤¤¤", times: 12, symbol: "¤" },
  { line: "♥♥♥", times: 10, symbol: "♥" },
  { line: "◎◎◎", times: 5, symbol: "◎" },
  { line: "♥♥·", times: 4, symbol: "♥", pair: true },
];
const SYMBOL_PAINT: Record<string, Paint> = {
  "7": pink,
  "◆": bold,
  "★": gold,
  "♣": green,
  "¤": gold,
  "◎": dim,
  "♥": red,
};
/** The reels at rest before any spin, dimmed: mixed, never a line that reads as a win. */
const IDLE_REELS = ["♣", "7", "◆"] as const;
const UNDRAWN_REEL = "·";

/** The pay line the reels landed on, if they pay: three of a kind, or two hearts. */
function paidLine(reels: readonly string[]): (typeof PAYS)[number] | null {
  const [a, b, c] = reels;

  if (a === b && b === c) {
    return PAYS.find((pay) => pay.pair !== true && pay.symbol === a) ?? null;
  }

  return reels.filter((symbol) => symbol === "♥").length === 2 ? (PAYS.find((pay) => pay.pair) ?? null) : null;
}

/** A landed spin in a sentence: "7 7 7 pays ×250.", "Two ♥ pay ×4.", or "No line." */
function slotsSentence(reels: readonly string[]): string {
  const pay = paidLine(reels);

  if (pay === null) {
    return "No line.";
  }

  return pay.pair === true ? `Two ${pay.symbol} pay ×${pay.times}.` : `${[...pay.line].join(" ")} pays ×${pay.times}.`;
}

/** The reels in their window, `▸ [ 7 | ◆ | ★ ] ◂`, the window gold when they paid. */
function reelsLine(color: boolean, symbols: readonly string[], isDim: boolean, isPaid: boolean): string {
  const frame: Paint = isPaid ? (on, text) => bold(on, gold(on, text)) : dim;
  const reels = symbols
    .map((symbol) => (isDim ? dim(color, symbol) : (SYMBOL_PAINT[symbol] ?? plain)(color, symbol)))
    .join(frame(color, " | "));

  return `${gold(color, "▸")} ${frame(color, "[ ")}${reels}${frame(color, " ]")} ${gold(color, "◂")}`;
}

/** Three reels and the slots speed, then the landing or the status, then the pay table with the line hit lit. */
export function renderSlots(round: RoundView | null, ctx: RenderContext): string[] {
  const { color, width, prefs } = ctx;
  const detail = round?.detail.game === "slots" ? round.detail : null;
  const isDrawing = round !== null && detail !== null && round.phase !== "idle";
  // Server text reaches the terminal: no escape sequence in a symbol.
  const reels = detail?.reels?.map(cleanText) ?? null;
  const landed = round !== null && round.phase === "idle" ? reels : null;
  const shown = landed ?? (isDrawing ? [UNDRAWN_REEL, UNDRAWN_REEL, UNDRAWN_REEL] : IDLE_REELS);
  const lit = landed === null ? null : (paidLine(landed)?.line ?? null);
  const machine = `${reelsLine(color, shown, landed === null, lit !== null)}  ${dim(color, `speed ${prefs.slotsSpeed}`)}`;
  const status =
    round !== null && landed !== null ? outcomeLine(color, round, slotsSentence(landed)) : statusText(color, isDrawing);
  const pays = PAYS.map((pay) => {
    const text = `${pay.line} ×${pay.times}`;

    return pay.line === lit ? bold(color, gold(color, text)) : text;
  });

  return clamp([machine, status, ...wrap(pays, width, dim(color, SEPARATOR))], width);
}
