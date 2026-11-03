// Roulette, baccarat, slots and Mines tables, drawn still by the pane and the table surface module alike.
import type { RenderElement } from "claude-code";

import { type CardSize, faceDownCards, faceDownOf, handCards } from "./cards";
import {
  cashOutPayout,
  chipsTotal,
  cleanText,
  compactUsdc,
  formatUsdc,
  pocketColor,
  rouletteMaxGain,
  rouletteWins,
} from "./format";
import {
  CASH_OUT_HOTKEY,
  cursorBet,
  MINES_COLUMNS,
  MINES_TILE_KEY,
  rouletteCellKey,
  sameBet,
  stackChips,
  stakeOn,
  tileLetter,
} from "./keys";
import type { Prefs } from "./model";
import type { BaccaratBet, BaccaratView, Card, RouletteBet, RouletteChip, RoundView } from "./protocol";
import {
  FELT,
  FELT_INK,
  FELT_INK_DIM,
  FG1,
  FG4,
  FG6,
  GOLD,
  GREEN,
  INK,
  LINE3,
  LINE4,
  PINK,
  RED,
  toneOf,
  type Ui,
} from "./theme";

/** The European wheel's pockets in their order around it, from 0. */
const WHEEL = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7,
  28, 12, 35, 3, 26,
];
/** A pocket's tile: its number centered on its felt, three rows tall; the next one starts a column after. */
const POCKET_COLUMNS = 4;
const TILE_STEP = POCKET_COLUMNS + 1;
/** How long the wheel takes to slow from full speed into the drawn pocket, and how many pockets it turns by meanwhile. */
export const ROULETTE_SPIN_MS = 1_200;
const SPIN_POCKETS = 18;
/** Full speed, in pockets a ms: the slope of the slowing's cubic ease-out at its start, so a wheel
 *  turning at it while the chain draws slows down on landing without a change of pace. */
const FULL_SPEED = (3 * SPIN_POCKETS) / ROULETTE_SPIN_MS;

const wheelAt = (index: number): number => WHEEL[((index % WHEEL.length) + WHEEL.length) % WHEEL.length] ?? 0;

/** The pocket under the marker with the wheel at `position` (`wheelPosition`). */
export const pocketUnder = (position: number): number => wheelAt(Math.round(position));

/**
 * Where the wheel stands under the marker, in pockets around it from 0 (a fraction is part way to
 * the next), `elapsed` into a spin: at full speed, steadily, while the chain draws; once it has,
 * slowing on a cubic ease-out, fast then creeping, to rest exactly on the drawn pocket.
 */
export function wheelPosition(pocket: number | null, elapsed: number | null, isDrawing: boolean): number {
  const rest = pocket === null ? 0 : WHEEL.indexOf(pocket);

  if (isDrawing) {
    return rest + FULL_SPEED * (elapsed ?? 0);
  }

  if (elapsed === null || elapsed >= ROULETTE_SPIN_MS) {
    return rest;
  }

  const left = 1 - elapsed / ROULETTE_SPIN_MS;

  return rest - SPIN_POCKETS * left ** 3;
}

/**
 * The wheel unrolled around `position`, as the design system's RouletteStrip: tiles on their felt,
 * the marker `▼` over the pocket under it and the ball `●` in it once `hasBall`. `isIdle` dims the
 * wheel: at rest before any spin, or turning while the pocket is not drawn yet. Small, where the
 * room is short: the tiles' middle row alone under the marker, the ball beside the number.
 */
function rouletteWheel(
  ui: Ui,
  position: number,
  reach: number,
  look: { hasBall: boolean; isIdle: boolean; size: CardSize },
): RenderElement {
  const { Box, Text } = ui;
  // The strip moves a column at a time, not a pocket: the wheel creeps into its pocket at the end
  // instead of jumping there.
  const column = Math.round(position * TILE_STEP);
  const shift = ((column % TILE_STEP) + TILE_STEP) % TILE_STEP;
  const first = (column - shift) / TILE_STEP - reach;
  // The marker stands over a tile's second column.
  const center = Math.floor((column + 1) / TILE_STEP);
  const width = TILE_STEP * (reach * 2 + 1) - 1;
  const slots = Array.from({ length: reach * 2 + 2 }, (_, slot) => slot);
  const row = (line: 0 | 1 | 2) =>
    slots.flatMap((slot) => {
      const index = first + slot;
      const number = wheelAt(index);
      const isCenter = index === center;
      const start = slot * TILE_STEP - shift;
      const ball = isCenter && look.hasBall ? "●" : " ";
      const label =
        line !== 1
          ? ` ${line === 0 ? ball : " "}  `
          : `${look.size === "small" ? ball : " "}${String(number).padStart(2)} `;
      const shown = label.slice(Math.max(0, -start), Math.max(0, width - start));
      const gap = start + POCKET_COLUMNS;

      return [
        shown.length > 0 && (
          <Text
            backgroundColor={FELT[pocketColor(number)]}
            color={isCenter ? FELT_INK : FELT_INK_DIM}
            bold={isCenter}
            dimColor={look.isIdle && !isCenter}
          >
            {shown}
          </Text>
        ),
        gap >= 0 && gap < width && <Text> </Text>,
      ];
    });
  const marker = `${" ".repeat(TILE_STEP * reach + 2)}▼`;
  const under = marker.replace("▼", "▲");

  if (look.size === "small") {
    return (
      <Box flexDirection="column">
        <Text color={GOLD} bold>
          {marker.slice(1)}
        </Text>
        <Box flexDirection="row">{row(1)}</Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color={GOLD} bold>
        {marker}
      </Text>
      <Box flexDirection="column" borderStyle="round" borderColor={LINE3} alignSelf="flex-start">
        {([0, 1, 2] as const).map((line) => (
          <Box flexDirection="row">{row(line)}</Box>
        ))}
      </Box>
      <Text color={GOLD} bold>
        {under}
      </Text>
    </Box>
  );
}

/** What each outside bet pays, by the kind in its key (`roulette-<kind>`). */
const BET_PAYS: Record<string, string> = {
  red: "1:1",
  black: "1:1",
  odd: "1:1",
  even: "1:1",
  low: "1:1",
  high: "1:1",
};
const BET_NAMES: Record<string, string> = { low: "1–18", high: "19–36" };

/**
 * An outside bet's key, as a chip on its felt: red and black on their own colors, the rest on the
 * green of the table; a bet with chips on it marked `●` in gold. "RED 1:1", "1–18 1:1".
 */
export function rouletteChip(ui: Ui, kind: string, label: string, isSelected: boolean): RenderElement {
  const { Text } = ui;
  const felt = kind === "red" ? FELT.red : kind === "black" ? FELT.black : FELT.green;
  const name = (BET_NAMES[kind] ?? label).toUpperCase();

  return (
    <Text backgroundColor={felt} color={isSelected ? GOLD : FELT_INK} bold>
      {` ${isSelected ? "● " : ""}${name} `}
      <Text color={FELT_INK_DIM} bold={false}>{`${BET_PAYS[kind] ?? ""} `}</Text>
    </Text>
  );
}

/** The landed pocket on its own felt: "17 BLACK". */
function pocketChip(ui: Ui, pocket: number): RenderElement {
  const { Text } = ui;
  const color = pocketColor(pocket);

  return (
    <Text backgroundColor={FELT[color]} color={FELT_INK} bold>
      {` ${pocket} ${color.toUpperCase()} `}
    </Text>
  );
}

/** The layout's number grid as on the felt, top row first: 3 6 … 36, 2 5 … 35, 1 4 … 34; each
 *  row's `2:1` at its end bets on its column, numbered by its first number. */
const LAYOUT_NUMBERS_ACROSS = 12;
const LAYOUT_ROWS = ([3, 2, 1] as const).map((column) => ({
  column,
  numbers: Array.from({ length: LAYOUT_NUMBERS_ACROSS }, (_, index) => index * 3 + column),
}));
const DOZENS = [
  { dozen: 1, label: "1st 12" },
  { dozen: 2, label: "2nd 12" },
  { dozen: 3, label: "3rd 12" },
] as const;
const OUTSIDE_BETS: readonly RouletteBet[] = [
  { kind: "low" },
  { kind: "even" },
  { kind: "red" },
  { kind: "black" },
  { kind: "odd" },
  { kind: "high" },
];
/** A number's cell: the widest of these that fits; a `2:1` cell is as wide as the widest, for its chip. */
const NUMBER_CELLS = [4, 3] as const;
const COLUMN_CELL = 4;
/** The cells a layout with numbers `cell` wide takes: the 0, a row of twelve numbers, its `2:1`. */
const layoutColumns = (cell: number): number => cell * (LAYOUT_NUMBERS_ACROSS + 1) + COLUMN_CELL;
/** The wheel's tiles either side of the marker, at most. */
const MAX_REACH = 6;
/** The wheel strip's frame: a column each side. */
const WHEEL_FRAME = 2;
/** The wheel strip's rows: the marker, the tiles' three rows in their frame, the marker under them;
 *  small, the marker over the tiles' middle row. */
const WHEEL_ROWS: Record<CardSize, number> = { large: 7, small: 2 };
/** The rows the roulette table takes with its wheel at `size`: the wheel, the pocket line, the
 *  layout (its rows of numbers, the dozens, the outside bets), a row between each. */
export const rouletteRows = (size: CardSize): number => WHEEL_ROWS[size] + 1 + 1 + 1 + LAYOUT_ROWS.length + 2;
/** A chip on a cell: its stake beside it, in gold. */
const CHIP = "●";

const centered = (text: string, width: number): string =>
  text.padStart(Math.floor((width + text.length) / 2)).padEnd(width);

/** A cell's line, `width` wide: its label, or with chips on it the chip and their stake beside the
 *  label where both fit and leave a blank column before the next cell (`EVEN ●.5`, else `EVEN●.5`),
 *  else the chip on the label: a number is never hidden by its chip. */
function cellFace(label: string, stake: bigint, width: number): string {
  if (stake === 0n) {
    return ` ${centered(label, width - 1)}`;
  }

  const chip = `${CHIP}${compactUsdc(stake.toString())}`;
  const full = [`${label} ${chip}`, `${label}${chip}`].find((face) => face.length < width);

  return centered(full ?? `${CHIP}${label}`, width);
}

interface LayoutMarks {
  /** The pocket the ball landed in, lit; null while it spins or before any spin. */
  pocket: number | null;
  /** The bets the last spin's chips won on, lit with the pocket. */
  winners: readonly RouletteBet[];
  /** The cell the cursor is on, drawn inverse; null while a spin is in play. */
  cursor: RouletteBet | null;
}

/**
 * The betting layout, as on a casino table: 0 on the left, the numbers in three rows of twelve,
 * each row's `2:1`, then the dozens and the outside bets. A cell with chips shows `●` and their
 * stake in gold; the pocket the ball landed in and the cells that won are lit gold. A cell the
 * drawing has a Button for (a click where the terminal reports them) takes a chip. Numbers are
 * `width` cells wide.
 */
function rouletteLayout(
  ui: Ui,
  chips: readonly RouletteChip[],
  marks: LayoutMarks,
  width: number,
  cellButton: TileButton,
): RenderElement {
  const { Box, Text } = ui;
  const cell = (cellBet: RouletteBet, lines: readonly string[], felt: string, cellWidth: number) => {
    const stake = stakeOn(chips, cellBet);
    const isLit =
      (cellBet.kind === "straight" && cellBet.number === marks.pocket) ||
      marks.winners.some((bet) => sameBet(bet, cellBet));
    const middle = Math.floor(lines.length / 2);
    // One Text, its lines joined: a Button holds only text, and the 0 is three rows tall.
    const text = lines.map((line, index) => cellFace(line, index === middle ? stake : 0n, cellWidth)).join("\n");
    const face = (
      <Text
        backgroundColor={isLit ? GOLD : felt}
        color={isLit ? INK : stake > 0n ? GOLD : FELT_INK}
        inverse={marks.cursor !== null && sameBet(marks.cursor, cellBet)}
        bold
      >
        {text}
      </Text>
    );

    return cellButton(rouletteCellKey(cellBet), face) ?? face;
  };
  const numberCell = (number: number, lines: readonly string[]) =>
    cell({ kind: "straight", number }, lines, FELT[pocketColor(number)], width);

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        {numberCell(0, ["", "0", ""])}
        <Box flexDirection="column">
          {LAYOUT_ROWS.map(({ column, numbers }) => (
            <Box flexDirection="row">
              {numbers.map((number) => numberCell(number, [String(number)]))}
              {cell({ kind: "column", column }, ["2:1"], FELT.green, COLUMN_CELL)}
            </Box>
          ))}
        </Box>
      </Box>
      <Box flexDirection="row" marginLeft={width}>
        {DOZENS.map(({ dozen, label }) => cell({ kind: "dozen", dozen }, [label], FELT.green, width * 4))}
      </Box>
      <Box flexDirection="row" marginLeft={width}>
        {OUTSIDE_BETS.map((outside) =>
          cell(
            outside,
            [(BET_NAMES[outside.kind] ?? outside.kind).toUpperCase()],
            outside.kind === "red" ? FELT.red : outside.kind === "black" ? FELT.black : FELT.green,
            width * 2,
          ),
        )}
      </Box>
    </Box>
  );
}

/** "on the table 2.30 · 6 chips · max win 31.50": the stake, the bets and the best a pocket pays over it, before the fee. */
function chipsLine(ui: Ui, chips: readonly RouletteChip[]): RenderElement {
  const { Text } = ui;

  if (chips.length === 0) {
    return <Text color={FG6}>No chips on the table yet.</Text>;
  }

  return (
    <Text color={FG4}>
      {"on the table "}
      <Text color={GOLD} bold>
        {formatUsdc(chipsTotal(chips).toString())}
      </Text>
      {` · ${chips.length} ${chips.length === 1 ? "bet" : "bets"} · max win `}
      <Text color={FG1} bold>
        {formatUsdc(rouletteMaxGain(chips).toString())}
      </Text>
    </Text>
  );
}

/**
 * `columns`: the cells the table has; the wheel and the layout take the widest that fits, and under
 * the narrowest layout the keys alone place chips. `size`: small draws the wheel on one row, where
 * the room is short. `spinElapsed`: how far into its spin the round on the table is; null draws it
 * at rest. `cellButton`: the Button a cell of the layout takes a chip with, where the drawing has
 * one. A spin in play shows its own chips; between spins the table shows the chips placed, which
 * stay for the next spin, and the last spin's pocket and winning cells stay lit.
 */
export function rouletteTable(
  ui: Ui,
  round: RoundView | null,
  prefs: Prefs,
  columns: number,
  size: CardSize,
  spinElapsed: number | null,
  cellButton: TileButton,
): RenderElement {
  const { Box, Text } = ui;
  const detail = round?.detail.game === "roulette" ? round.detail : null;
  const isOpen = round !== null && round.phase !== "idle";
  const chips = isOpen && detail !== null ? detail.chips : stackChips(prefs.rouletteChips);
  const pocket = detail?.number ?? null;
  const isDrawing = round?.phase === "drawing";
  const isSpinning = spinElapsed !== null || isDrawing;
  const landed = isSpinning ? null : pocket;
  const position = wheelPosition(pocket, spinElapsed, isDrawing);
  const winners =
    landed === null || detail === null
      ? []
      : detail.chips.filter((chip) => rouletteWins(chip.bet, landed)).map((chip) => chip.bet);
  // The strip is a tile per pocket shown, less the last gap, in its frame.
  const reach = Math.floor(((columns - WHEEL_FRAME + 1) / TILE_STEP - 1) / 2);
  const cell = NUMBER_CELLS.find((width) => layoutColumns(width) <= columns);

  return (
    <Box flexDirection="column" gap={1}>
      {rouletteWheel(ui, position, Math.max(1, Math.min(MAX_REACH, reach)), {
        hasBall: landed !== null,
        isIdle: pocket === null,
        size,
      })}
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {landed !== null ? (
          pocketChip(ui, landed)
        ) : (
          <Text color={FG6}>{isSpinning ? "spinning…" : "No spin yet."}</Text>
        )}
        {chipsLine(ui, chips)}
      </Box>
      {cell !== undefined &&
        rouletteLayout(
          ui,
          chips,
          { pocket: landed, winners, cursor: isOpen ? null : cursorBet(prefs.rouletteCursor) },
          cell,
          cellButton,
        )}
    </Box>
  );
}

/** The two cards each side gets before either may draw a third. */
const BACCARAT_FIRST_CARDS = 2;
/** What each bet returns, times the stake, when its side wins, as `games/baccarat.rs` pays it. Mirrored here to show; the program pays. */
const BACCARAT_PAYS: Record<BaccaratBet, string> = { player: "2", banker: "1.95", tie: "9" };

/** Where each baccarat card falls in the deal: player, banker, player, banker, then the player's
 *  third card and the banker's, the order the rules draw them in. */
function baccaratDealOrder(detail: BaccaratView): { player: number[]; banker: number[] } {
  const thirds = BACCARAT_FIRST_CARDS * 2;
  const bankerThird = thirds + (detail.player.length > BACCARAT_FIRST_CARDS ? 1 : 0);

  return {
    player: detail.player.map((_, card) => (card < BACCARAT_FIRST_CARDS ? card * 2 : thirds)),
    banker: detail.banker.map((_, card) => (card < BACCARAT_FIRST_CARDS ? card * 2 + 1 : bankerThird)),
  };
}

/** A two-card 8 or 9: the coup ends there. */
const NATURAL_POINTS = 8;
/** Each side's column, as blackjack's hands: room for "BANKER 9 WINS NATURAL" and for three large
 *  cards, so nothing moves when the points and the tags show. */
const BACCARAT_COLUMNS = 22;

/** "WIN 1.00", "LOSE 1.00", or "PUSH 1.00" for a player or banker bet on a tie, as blackjack tags a hand. */
function baccaratVerdict(ui: Ui, round: RoundView): RenderElement {
  const { Text } = ui;
  const net = BigInt(round.net);

  return (
    <Text color={FG6}>
      <Text color={toneOf(round.net)} bold>
        {net > 0n ? "WIN" : net < 0n ? "LOSE" : "PUSH"}
      </Text>
      {` ${formatUsdc(round.stake)}`}
    </Text>
  );
}

/** `revealed`: cards turned over so far, in deal order (baccaratDealOrder); null when all are. */
export function baccaratTable(
  ui: Ui,
  round: RoundView | null,
  prefs: Prefs,
  size: CardSize,
  revealed: number | null,
): RenderElement {
  const { Box, Text } = ui;
  const detail = round?.detail.game === "baccarat" ? round.detail : null;
  const bet = round !== null && round.phase !== "idle" && detail !== null ? detail.bet : prefs.baccarat;

  if (detail === null) {
    return (
      <Box flexDirection="column" gap={1}>
        {baccaratBetLine(ui, bet)}
        <Text color={FG6}>Pick player, banker or tie, then deal with n.</Text>
      </Box>
    );
  }

  // A coup being drawn: two cards each, face down, until the chain's come in.
  const isDrawing = detail.player.length === 0;
  const order = baccaratDealOrder(detail);
  const side = (cards: Card[], dealtAt: number[]) =>
    isDrawing
      ? { cards: faceDownCards(BACCARAT_FIRST_CARDS), faceDown: BACCARAT_FIRST_CARDS }
      : { cards, faceDown: faceDownOf(dealtAt, revealed) };
  const player = side(detail.player, order.player);
  const banker = side(detail.banker, order.banker);
  const isShown = !isDrawing && player.faceDown === 0 && banker.faceDown === 0;
  const winner = isShown ? baccaratWinner(detail) : null;
  const tag = (name: BaccaratBet, cards: readonly Card[], points: number) => (
    <Text>
      {winner !== null && (winner === name || winner === "tie") && (
        <Text color={winner === "tie" ? FG1 : GOLD} bold>
          {winner === "tie" ? " TIE" : " WINS"}
        </Text>
      )}
      {isShown && cards.length === BACCARAT_FIRST_CARDS && points >= NATURAL_POINTS && (
        <Text color={GOLD} bold>
          {" NATURAL"}
        </Text>
      )}
    </Text>
  );
  const column = (label: string, points: number, cards: Card[], faceDown: number, name: BaccaratBet) => (
    <Box flexDirection={size === "large" ? "column" : "row"} width={BACCARAT_COLUMNS * (size === "large" ? 1 : 2)}>
      <Box width={size === "large" ? undefined : BACCARAT_COLUMNS} flexShrink={0}>
        <Text color={FG4}>
          {label} <Text color={FG1}>{isShown ? String(points) : ""}</Text>
          {tag(name, cards, points)}
        </Text>
      </Box>
      {handCards(ui, cards, size, { faceDown })}
    </Box>
  );

  return (
    <Box flexDirection="column" gap={1}>
      {/* Once the cards show, what the coup did to the bet, as blackjack tags its hands. */}
      {isShown && round !== null && round.phase === "idle" ? (
        <Text color={FG4}>
          bet{" "}
          <Text color={FG1} bold>
            {detail.bet}
          </Text>{" "}
          {baccaratVerdict(ui, round)}
        </Text>
      ) : (
        baccaratBetLine(ui, bet)
      )}
      <Box flexDirection={size === "large" ? "row" : "column"} columnGap={2}>
        {column("PLAYER", detail.playerPoints, player.cards, player.faceDown, "player")}
        {column("BANKER", detail.bankerPoints, banker.cards, banker.faceDown, "banker")}
      </Box>
    </Box>
  );
}

/** "bet banker · pays ×1.95": the side backed and what it returns when it wins. */
function baccaratBetLine(ui: Ui, bet: BaccaratBet): RenderElement {
  const { Text } = ui;

  return (
    <Text color={FG4}>
      bet{" "}
      <Text color={FG1} bold>
        {bet}
      </Text>
      {` · pays ×${BACCARAT_PAYS[bet]}`}
    </Text>
  );
}

/** Which side the coup went to, on its points. */
function baccaratWinner(detail: BaccaratView): BaccaratBet {
  const { playerPoints, bankerPoints } = detail;

  return playerPoints === bankerPoints ? "tie" : playerPoints > bankerPoints ? "player" : "banker";
}

/**
 * A settled coup in a sentence, short enough for the side pane: who won and what it did to the
 * bet. "Banker wins 7 to 5: pays ×1.95.", "Player wins 6 to 3: banker bet loses.", "Tie at 5: player
 * bet returned." (a player or banker bet pushes on a tie).
 */
export function baccaratOutcome(detail: BaccaratView): string {
  const winner = baccaratWinner(detail);
  const high = Math.max(detail.playerPoints, detail.bankerPoints);
  const low = Math.min(detail.playerPoints, detail.bankerPoints);
  const head =
    winner === "tie" ? `Tie at ${high}` : `${winner === "player" ? "Player" : "Banker"} wins ${high} to ${low}`;
  const result =
    detail.bet === winner
      ? `pays ×${BACCARAT_PAYS[winner]}`
      : winner === "tie"
        ? `${detail.bet} bet returned`
        : `${detail.bet} bet loses`;

  return `${head}: ${result}.`;
}

/**
 * The slot symbols drawn large, three rows of blocks each, in the glyphs the api sends (apps/api
 * src/games/slots.ts: 7, bar, bell, plum, orange, lemon, cherry), each in its own color.
 */
const SYMBOL_ART: Record<string, { rows: readonly [string, string, string]; color: () => string }> = {
  "7": { rows: ["▀▀▀▀█", "  ▄▀ ", " █   "], color: () => PINK },
  "◆": { rows: [" ▗█▖ ", "▐███▌", " ▝█▘ "], color: () => FG1 },
  "★": { rows: ["  ▄  ", "▀███▀", "▄▀ ▀▄"], color: () => GOLD },
  "♣": { rows: [" ▄█▄ ", "█▀█▀█", "  █  "], color: () => GREEN },
  "¤": { rows: ["▄▀▀▀▄", "█ ¤ █", "▀▄▄▄▀"], color: () => GOLD },
  "◎": { rows: [" ▄▄▄ ", "█ ◎ █", " ▀▀▀ "], color: () => FG4 },
  "♥": { rows: ["▄█▄█▄", "▀███▀", "  ▀  "], color: () => RED },
};
const SYMBOLS = Object.keys(SYMBOL_ART);
/** The reels at rest before any spin, dimmed: mixed, never a line that reads as a win. */
const IDLE_REELS = ["♣", "7", "◆"] as const;

/** The pay table, gross times the bet per spin, as `games/slots.rs` pays it. Mirrored here to show; the program pays. */
const PAYS: readonly { line: string; times: number; symbol: string; pair?: true }[] = [
  { line: "7 7 7", times: 250, symbol: "7" },
  { line: "◆ ◆ ◆", times: 100, symbol: "◆" },
  { line: "★ ★ ★", times: 40, symbol: "★" },
  { line: "♣ ♣ ♣", times: 20, symbol: "♣" },
  { line: "¤ ¤ ¤", times: 12, symbol: "¤" },
  { line: "♥ ♥ ♥", times: 10, symbol: "♥" },
  { line: "◎ ◎ ◎", times: 5, symbol: "◎" },
  { line: "♥ ♥ ·", times: 4, symbol: "♥", pair: true },
];

/** When each reel stops, from the start of the spin. */
const REEL_STOPS_MS = [600, 900, 1_200] as const;
export const SLOTS_SPIN_MS = REEL_STOPS_MS[REEL_STOPS_MS.length - 1] ?? 0;
const REEL_FRAME_MS = 80;

/** What a reel shows `elapsed` into a spin: a passing symbol until it stops, then its own. */
function reelSymbol(symbol: string, reel: number, elapsed: number | null): { symbol: string; isMoving: boolean } {
  const stopsAt = REEL_STOPS_MS[reel] ?? 0;

  if (elapsed === null || elapsed >= stopsAt) {
    return { symbol, isMoving: false };
  }

  const passing = SYMBOLS[(Math.floor(elapsed / REEL_FRAME_MS) + reel * 3) % SYMBOLS.length] ?? symbol;

  return { symbol: passing, isMoving: true };
}

/** The symbols the reels show `elapsed` into a spin onto `reels`. */
export const reelsAt = (reels: readonly string[], elapsed: number | null): string[] =>
  reels.map((symbol, reel) => reelSymbol(symbol, reel, elapsed).symbol);

/** The pay line the reels landed on, if they pay: three of a kind, or two cherries. */
function paidLine(reels: readonly string[]): (typeof PAYS)[number] | null {
  const [a, b, c] = reels;

  if (a === b && b === c) {
    return PAYS.find((pay) => !pay.pair && pay.symbol === a) ?? null;
  }

  return reels.filter((symbol) => symbol === "♥").length === 2 ? (PAYS.find((pay) => pay.pair) ?? null) : null;
}

/** A landed spin in a sentence: the line it hit and what that pays, "7 7 7 pays ×250.", "Two ♥ pay ×4.", or "No line." */
export function slotsOutcome(reels: readonly string[]): string {
  const pay = paidLine(reels);

  if (pay === null) {
    return "No line.";
  }

  return pay.pair === true ? `Two ${pay.symbol} pay ×${pay.times}.` : `${pay.line} pays ×${pay.times}.`;
}

function reelWindow(ui: Ui, symbol: string, isLit: boolean, isMoving: boolean, isIdle: boolean): RenderElement {
  const { Box, Text } = ui;
  const art = SYMBOL_ART[symbol];
  const rows = art?.rows ?? ["     ", `  ${cleanText(symbol)}  `, "     "];
  const color = isIdle || isMoving ? LINE4 : (art?.color() ?? FG1);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={isLit ? GOLD : LINE4} paddingX={1}>
      {rows.map((row) => (
        <Text color={color} bold={!isIdle && !isMoving}>
          {row}
        </Text>
      ))}
    </Box>
  );
}

function payTable(ui: Ui, lit: string | null): RenderElement {
  const { Box, Text } = ui;

  return (
    <Box flexDirection="column">
      <Text color={FG6}>PAYS × BET</Text>
      {PAYS.map((pay) => (
        <Box flexDirection="row" columnGap={2}>
          <Text color={pay.line === lit ? GOLD : FG4} bold={pay.line === lit}>
            {pay.line}
          </Text>
          <Text color={pay.line === lit ? GOLD : FG6} bold={pay.line === lit}>
            {String(pay.times).padStart(3)}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

/** Three reels in a machine, the payline marked on both sides, the pay table beside it, as the design system's SlotMachine. */
export function slotsTable(ui: Ui, round: RoundView | null, size: CardSize, spinElapsed: number | null): RenderElement {
  const { Box, Text } = ui;
  const reels = round?.detail.game === "slots" ? round.detail.reels : null;
  const isIdle = reels === null;
  const shown = (reels ?? IDLE_REELS).map((symbol, reel) => reelSymbol(symbol, reel, spinElapsed));
  const isSpinning = shown.some((reel) => reel.isMoving);
  const lit = isIdle || isSpinning ? null : (paidLine(reels)?.line ?? null);

  if (size === "small") {
    return (
      <Box flexDirection="row" columnGap={1}>
        {shown.map((reel) => (
          <Box borderStyle="round" borderColor={lit === null ? LINE4 : GOLD} paddingX={1}>
            <Text bold color={isIdle || reel.isMoving ? LINE4 : (SYMBOL_ART[reel.symbol]?.color() ?? FG1)}>
              {cleanText(reel.symbol)}
            </Text>
          </Box>
        ))}
      </Box>
    );
  }

  // The pay table drops under the machine where both do not fit side by side (a narrow side pane).
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={3} rowGap={1}>
      <Box flexDirection="row" alignItems="center" columnGap={1}>
        <Text color={GOLD} bold>
          ▸
        </Text>
        <Box
          flexDirection="row"
          columnGap={1}
          borderStyle="round"
          borderColor={lit === null ? LINE3 : GOLD}
          paddingX={1}
        >
          {shown.map((reel) => reelWindow(ui, reel.symbol, lit !== null, reel.isMoving, isIdle))}
        </Box>
        <Text color={GOLD} bold>
          ◂
        </Text>
      </Box>
      {payTable(ui, lit)}
    </Box>
  );
}

/** `z cash out 1.53`: what a cash-out returns now, on its key; dim while it is not offered (a draw on its way). */
export function cashOutLine(ui: Ui, stake: string, multiplier: string, isOffered: boolean): RenderElement {
  const { Text } = ui;
  const color = isOffered ? GOLD : FG6;

  return (
    <Text color={FG4}>
      <Text color={color} bold>
        {CASH_OUT_HOTKEY}
      </Text>
      {" cash out "}
      <Text color={color} bold>
        {formatUsdc(cashOutPayout(stake, multiplier))}
      </Text>
    </Text>
  );
}

/** A Mines or tower round as its side tells it, under the mines or the difficulty. */
interface BoardProgress {
  multiplier: string;
  nextMultiplier: string | null;
  canCashOut: boolean;
  isBusted: boolean;
  /** Safe tiles or levels so far: a cash-out is offered from the first. */
  safe: number;
  /** "next tile", "next level". */
  nextLabel: string;
  /** "2 safe", "2 levels". */
  safeLabel: string;
}

/**
 * The side of a Mines or tower board, as blackjack tags its hands: the multiplier, whose move it
 * is (a tile on its way, or how the round ended: BUST in red, CASHED OUT in gold), what the next
 * tile or level brings, and the cash-out on its key.
 */
export function boardSide(ui: Ui, round: RoundView, progress: BoardProgress): RenderElement[] {
  const { Text } = ui;
  const isOpen = round.phase !== "idle";
  const state =
    round.phase === "drawing" ? (
      <Text color={FG4}>drawing…</Text>
    ) : isOpen ? (
      <Text color={PINK} bold>
        YOUR TURN
      </Text>
    ) : progress.isBusted ? (
      <Text color={RED} bold>
        BUST
      </Text>
    ) : (
      <Text color={GOLD} bold>
        {`CASHED OUT ×${progress.multiplier}`}
      </Text>
    );

  return [
    <Text color={FG4}>
      multiplier {/* A bust pays nothing: its multiplier would read as a payout. */}
      <Text color={progress.isBusted && !isOpen ? RED : FG1} bold>
        {progress.isBusted && !isOpen ? "×0" : `×${progress.multiplier}`}
      </Text>
    </Text>,
    state,
    isOpen && progress.nextMultiplier !== null && (
      <Text color={FG4}>
        {`${progress.nextLabel} `}
        <Text color={FG1}>{`×${progress.nextMultiplier}`}</Text>
      </Text>
    ),
    isOpen && progress.safe > 0 && cashOutLine(ui, round.stake, progress.multiplier, progress.canCashOut),
    <Text color={FG6}>{progress.safeLabel}</Text>,
  ].filter((row): row is RenderElement => row !== false);
}

/** The side of a Mines or tower board, as wide in every state ("CASHED OUT ×12.9933" the widest
 *  line), so the centred board never moves sideways when it changes. */
export const BOARD_SIDE_COLUMNS = 22;

/** A tile's glyphs: a gem found, the mine that ended the round, a tile awaiting its draw turning through these. */
export const SAFE_GLYPH = "◆";
export const MINE_GLYPH = "✸";
const PENDING_GLYPHS = ["◐", "◓", "◑", "◒"];
/** Spinner frames a tile awaiting its draw keeps each shade of its pulse. */
const PULSE_FRAMES = 2;

/**
 * The tiles' fills, as Stake's: they stay dark on any ground, as the roulette felt does. A hidden
 * tile on slate (lit on the tower's level in play, dark where a climbed level was passed by), a gem
 * on a lighter fill, the mine on red, the tile being drawn pulsing between two shades. All found as
 * is in the 256-color palette, so a terminal (or tmux) without true color draws them the same.
 */
export const TILE_FILL = {
  hidden: "#444444",
  /** The second shade of compact hidden tiles: their rows touch, alternate rows tell them apart. */
  hiddenAlt: "#3a3a3a",
  lit: "#5f8787",
  /** A shade over the fullscreen pane's own ground (#262626), so a passed tile still shows. */
  dark: "#303030",
  safe: "#626262",
  pending: ["#4e4e4e", "#767676"],
  mine: "#af0000",
} as const;
export const TILE_INK = { letter: "#767676", gem: "#00ff87", mine: FELT_INK, pending: FELT_INK } as const;

/**
 * A tile's size: cells across, and whether the upper half of a row under it (`▀` in its fill) ends
 * it, half a row above the next row of tiles. Compact tiles have none: their rows touch.
 */
export interface TileSize {
  columns: number;
  hasEdge: boolean;
}

/** A row and a half under 5 cells; compact, a row of 4, still wide enough for the main screen's `a: ` key. */
const MINES_TILE: Record<CardSize, TileSize> = {
  large: { columns: 5, hasEdge: true },
  small: { columns: 4, hasEdge: false },
};

/** The rows a Mines board takes at a card size. */
export const minesBoardRows = (size: CardSize): number => MINES_COLUMNS * (MINES_TILE[size].hasEdge ? 2 : 1);

/** What a tile shows: its fill and, centred on it, a glyph in its ink. */
export interface TileLook {
  fill: string;
  glyph: string | null;
  ink: string;
}

/** A tile awaiting its draw at this frame: the spinner on a pulsing fill. */
export const pendingLook = (frame: number): TileLook => ({
  fill: TILE_FILL.pending[Math.floor(frame / PULSE_FRAMES) % TILE_FILL.pending.length] ?? TILE_FILL.hidden,
  glyph: PENDING_GLYPHS[frame % PENDING_GLYPHS.length] ?? null,
  ink: TILE_INK.pending,
});

/**
 * A Stake tile: a block of its fill with its glyph. Where `key` (`mines-tile-3`) has a Button, the
 * tile is it: on the main screen the Button of its hotkey in the corner (`a:`, the engine's own
 * drawing of a key), on the fullscreen table the whole tile, its letter dim in the corner, a click
 * anywhere on it pressing.
 */
export function stakeTile(
  ui: Ui,
  size: TileSize,
  look: TileLook,
  key: { address: string; letter: string } | null,
  tileButton: TileButton,
): RenderElement {
  const { Box, Text } = ui;
  const button =
    key === null
      ? null
      : tileButton(key.address, <Text color={TILE_INK.letter}>{key.letter.padEnd(size.columns)}</Text>);

  return (
    <Box flexDirection="column">
      <Box backgroundColor={look.fill} width={size.columns}>
        {button ?? (
          <Text color={look.ink} bold>
            {look.glyph === null ? " ".repeat(size.columns) : centered(look.glyph, size.columns)}
          </Text>
        )}
      </Box>
      {size.hasEdge && <Text color={look.fill}>{"▀".repeat(size.columns)}</Text>}
    </Box>
  );
}

/**
 * The Button a tile, a Keno number or a roulette cell is pressed with where the drawing has one for
 * the key at `address` (`mines-tile-3`, `keno-pick-12`, `roulette-red`), live or held; null draws it
 * still. `face` is what the drawing shows there: a Button made for it wraps it.
 */
export type TileButton = (address: string, face: RenderElement) => RenderElement | null;

/**
 * The 5 × 5 Mines board as Stake's, centred, its multipliers beside it. In play a hidden tile is a
 * slate block and its key, a safe tile a gem on a lighter fill, the tile being drawn pulsing; a
 * settled board shows the safe tiles and the mine that ended it, if one did (no other mine exists:
 * each reveal draws). Every state takes the same rows: nothing jumps on a reveal.
 */
export function minesTable(
  ui: Ui,
  round: RoundView | null,
  prefs: Prefs,
  frame: number,
  size: CardSize,
  tileButton: TileButton,
): RenderElement {
  const { Box, Text } = ui;
  const detail = round?.detail.game === "mines" ? round.detail : null;
  const isOpen = round !== null && round.phase !== "idle";
  const safe = new Set(detail?.revealed ?? []);
  const tileSize = MINES_TILE[size];
  const tileCell = (tile: number): RenderElement => {
    if (safe.has(tile)) {
      return stakeTile(ui, tileSize, { fill: TILE_FILL.safe, glyph: SAFE_GLYPH, ink: TILE_INK.gem }, null, tileButton);
    }

    if (detail?.busted === tile) {
      return stakeTile(ui, tileSize, { fill: TILE_FILL.mine, glyph: MINE_GLYPH, ink: TILE_INK.mine }, null, tileButton);
    }

    if (detail?.pending === tile) {
      return stakeTile(ui, tileSize, pendingLook(frame), null, tileButton);
    }

    const isAltRow = !tileSize.hasEdge && Math.floor(tile / MINES_COLUMNS) % 2 === 1;
    const look = { fill: isAltRow ? TILE_FILL.hiddenAlt : TILE_FILL.hidden, glyph: null, ink: TILE_INK.letter };
    const key = isOpen ? { address: `${MINES_TILE_KEY}${tile}`, letter: tileLetter(tile) } : null;

    return stakeTile(ui, tileSize, look, key, tileButton);
  };
  const board = (
    <Box flexDirection="column">
      {Array.from({ length: MINES_COLUMNS }, (_, row) => (
        <Box flexDirection="row" columnGap={1}>
          {Array.from({ length: MINES_COLUMNS }, (_, column) => tileCell(row * MINES_COLUMNS + column))}
        </Box>
      ))}
    </Box>
  );
  // As the roulette bet: the round's own while it plays, else the one the next round is played with.
  const mines = isOpen && detail !== null ? detail.mines : prefs.mines;
  const count = (
    <Text color={FG4}>
      <Text color={PINK} bold>
        {String(mines)}
      </Text>
      {` ${mines === 1 ? "mine" : "mines"}`}
    </Text>
  );
  const table = (side: RenderElement) => (
    <Box flexDirection="row" flexWrap="wrap" columnGap={4} justifyContent="center">
      {board}
      {side}
    </Box>
  );

  if (detail === null || round === null) {
    return table(
      <Box flexDirection="column" width={BOARD_SIDE_COLUMNS}>
        {count}
        <Text color={FG6}>Pick the mines with j and k, then play with n.</Text>
      </Box>,
    );
  }

  return table(
    <Box flexDirection="column" width={BOARD_SIDE_COLUMNS}>
      {count}
      {boardSide(ui, round, {
        multiplier: detail.multiplier,
        nextMultiplier: detail.nextMultiplier,
        canCashOut: detail.canCashOut,
        isBusted: detail.busted !== null,
        safe: detail.revealed.length,
        nextLabel: "next tile",
        safeLabel: `${detail.revealed.length} safe`,
      })}
    </Box>,
  );
}
