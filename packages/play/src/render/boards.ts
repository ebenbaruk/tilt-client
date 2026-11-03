// Mines, Tower and Keno as plain text: the board on the left, the round's state beside it (Keno
// stacks, its 40 numbers take the whole width). Same content as the mod's games.tsx, climb.tsx
// and quick.tsx tables, without their animations: a harness redraws on each snapshot.
import {
  cashOutPayout,
  formatSigned,
  formatUsdc,
  hundredths,
  shortMultiplier,
  towerMultiplier,
} from "../../../../apps/mod/hooks/format";
import {
  CASH_OUT_HOTKEY,
  clampMines,
  KENO_NUMBERS,
  MINES_COLUMNS,
  TOWER_LEVELS,
  TOWER_SHAPES,
  tileLetter,
} from "../../../../apps/mod/hooks/keys";
import type { KenoView, MinesView, RoundView, TowerView } from "../../../../apps/mod/hooks/protocol";
import type { RenderContext } from "../types";
import { bold, dim, fit, gold, green, inverse, pink, red, visibleWidth } from "./style";

const SAFE_GLYPH = "◆";
const MINE_GLYPH = "✸";
const PENDING_GLYPH = "◐";
const HIDDEN_GLYPH = "·";
const SIDE_GAP = 2;
const KENO_COLUMNS = 10;

/** Lines cut to `width`: a safety net for extreme values (huge stakes, master multipliers). */
const clip = (lines: string[], width: number): string[] =>
  lines.map((line) => (visibleWidth(line) > width ? fit(line, width) : line));

/** `text` in the color of a settled round's net: green won, red lost, dim even. */
function toned(color: boolean, net: string, text: string): string {
  const value = BigInt(net);

  return value > 0n ? green(color, text) : value < 0n ? red(color, text) : dim(color, text);
}

/** `left` (all `leftWidth` wide) with `right` beside it, each side line cut to the room left. */
function besides(left: string[], leftWidth: number, right: string[], width: number): string[] {
  const sideWidth = width - leftWidth - SIDE_GAP;
  const rows = Math.max(left.length, right.length);

  return Array.from({ length: rows }, (_, row) => {
    const side = right[row];
    const board = left[row] ?? "";

    if (side === undefined) {
      return board;
    }

    const cut = visibleWidth(side) > sideWidth ? fit(side, sideWidth) : side;

    return `${board}${" ".repeat(leftWidth - visibleWidth(board) + SIDE_GAP)}${cut}`;
  });
}

/** A Mines or tower round as its side tells it. */
interface BoardProgress {
  multiplier: string;
  nextMultiplier: string | null;
  canCashOut: boolean;
  isBusted: boolean;
  /** Safe tiles or levels so far: a cash-out is offered from the first. */
  safe: number;
  /** "2 safe", "2 levels". */
  safeLabel: string;
}

/** The multiplier, whose move it is or how the round ended, the next step and the cash-out on its key. */
function boardSide(round: RoundView, progress: BoardProgress, color: boolean): string[] {
  const isOpen = round.phase !== "idle";
  const isLost = progress.isBusted && !isOpen;
  const state =
    round.phase === "drawing"
      ? dim(color, "drawing…")
      : isOpen
        ? pink(color, bold(color, "YOUR TURN"))
        : isLost
          ? red(color, bold(color, `BUST ${formatSigned(round.net)}`))
          : toned(color, round.net, bold(color, `CASHED OUT ${formatSigned(round.net)}`));
  // A bust pays nothing: its multiplier would read as a payout.
  const now = isLost ? red(color, bold(color, "×0")) : bold(color, `×${progress.multiplier}`);
  const lines = [`now ${now}`, state];

  if (isOpen && progress.nextMultiplier !== null) {
    lines.push(`next ×${progress.nextMultiplier}`);
  }

  if (isOpen && progress.safe > 0) {
    const paint = progress.canCashOut ? gold : dim;
    const payout = formatUsdc(cashOutPayout(round.stake, progress.multiplier));

    lines.push(`${paint(color, bold(color, CASH_OUT_HOTKEY))} cash out ${paint(color, payout)}`);
  }

  lines.push(dim(color, progress.safeLabel));

  return lines;
}

function minesTile(tile: number, detail: MinesView | null, isOpen: boolean, color: boolean): string {
  if (detail?.revealed.includes(tile)) {
    return green(color, SAFE_GLYPH);
  }

  if (detail?.busted === tile) {
    return red(color, MINE_GLYPH);
  }

  if (detail?.pending === tile) {
    return pink(color, PENDING_GLYPH);
  }

  // Only an open board takes reveals: a settled one hides nothing more (each reveal draws).
  if (!isOpen) {
    return dim(color, HIDDEN_GLYPH);
  }

  return detail?.canReveal ? gold(color, tileLetter(tile)) : dim(color, tileLetter(tile));
}

/** The 5 × 5 board, hidden tiles on their key letter, beside the mines and the round's progress. */
export function renderMines(round: RoundView | null, ctx: RenderContext): string[] {
  const { color } = ctx;
  const detail = round?.detail.game === "mines" ? round.detail : null;
  const isOpen = round !== null && detail !== null && round.phase !== "idle";
  const grid = Array.from({ length: MINES_COLUMNS }, (_, row) =>
    Array.from({ length: MINES_COLUMNS }, (_, column) =>
      minesTile(row * MINES_COLUMNS + column, detail, isOpen, color),
    ).join(" "),
  );
  // The round's own while it plays, else the one the next round is played with.
  const mines = isOpen ? detail.mines : clampMines(ctx.prefs.mines);
  const heading = `${pink(color, bold(color, String(mines)))} ${mines === 1 ? "mine" : "mines"}`;
  const side =
    round === null || detail === null
      ? [heading, dim(color, "Find gems, dodge mines.")]
      : [
          heading,
          ...boardSide(
            round,
            {
              multiplier: detail.multiplier,
              nextMultiplier: detail.nextMultiplier,
              canCashOut: detail.canCashOut,
              isBusted: detail.busted !== null,
              safe: detail.revealed.length,
              safeLabel: `${detail.revealed.length} safe`,
            },
            color,
          ),
        ];

  return clip(besides(grid, MINES_COLUMNS * 2 - 1, side, ctx.width), ctx.width);
}

/** The tower round to show: the open one, or the last one while the next is played at its difficulty. */
function shownTower(round: RoundView | null, ctx: RenderContext): TowerView | null {
  const detail = round?.detail.game === "tower" ? round.detail : null;

  return round !== null &&
    detail !== null &&
    (round.phase !== "idle" || detail.difficulty === ctx.prefs.towerDifficulty)
    ? detail
    : null;
}

function towerTile(level: number, tile: number, detail: TowerView | null, isOpen: boolean, color: boolean): string {
  const climbed = detail?.climbed ?? [];

  if (level < climbed.length) {
    return climbed[level] === tile ? green(color, SAFE_GLYPH) : dim(color, HIDDEN_GLYPH);
  }

  if (detail === null || level > climbed.length) {
    return dim(color, HIDDEN_GLYPH);
  }

  if (detail.busted === tile) {
    return red(color, MINE_GLYPH);
  }

  if (detail.pending === tile) {
    return pink(color, PENDING_GLYPH);
  }

  if (!isOpen) {
    return dim(color, HIDDEN_GLYPH);
  }

  return detail.canClimb ? gold(color, tileLetter(tile)) : dim(color, tileLetter(tile));
}

/** Nine levels, the top first, each with what reaching it pays; the level in play lit with its keys. */
export function renderTower(round: RoundView | null, ctx: RenderContext): string[] {
  const { color } = ctx;
  const detail = shownTower(round, ctx);
  const difficulty = detail?.difficulty ?? ctx.prefs.towerDifficulty;
  const { tiles, safe } = TOWER_SHAPES[difficulty];
  const climbed = detail?.climbed.length ?? 0;
  const isOpen = round !== null && detail !== null && round.phase !== "idle";
  const pays = Array.from(
    { length: TOWER_LEVELS },
    (_, level) => `×${shortMultiplier(towerMultiplier(tiles, safe, level + 1))}`,
  );
  const paysWidth = Math.max(...pays.map((pay) => pay.length));
  const rows = Array.from({ length: TOWER_LEVELS }, (_, index) => {
    const level = TOWER_LEVELS - 1 - index;
    const pay = (pays[level] ?? "").padStart(paysWidth);
    const isCurrent = isOpen && level === climbed;
    const label = isCurrent
      ? pink(color, bold(color, pay))
      : level < climbed
        ? gold(color, bold(color, pay))
        : dim(color, pay);
    const cells = Array.from({ length: tiles }, (_, tile) => towerTile(level, tile, detail, isOpen, color));

    return `${label} ${cells.join(" ")}`;
  });
  const heading = `${pink(color, bold(color, difficulty))} · ${safe} of ${tiles} safe`;
  const side =
    round === null || detail === null
      ? [heading, dim(color, "Climb: one safe tile")]
      : [
          heading,
          ...boardSide(
            round,
            {
              multiplier: detail.multiplier,
              nextMultiplier: detail.nextMultiplier,
              canCashOut: detail.canCashOut,
              isBusted: detail.busted !== null,
              safe: climbed,
              safeLabel: `${climbed} ${climbed === 1 ? "level" : "levels"}`,
            },
            color,
          ),
        ];

  return clip(besides(rows, paysWidth + tiles * 2, side, ctx.width), ctx.width);
}

/** The keno round to show: the open one, or the last one while the next is played with its picks. */
function shownKeno(round: RoundView | null, ctx: RenderContext): (RoundView & { detail: KenoView }) | null {
  if (round === null || round.detail.game !== "keno") {
    return null;
  }

  const detail = round.detail;
  const isShown =
    round.phase !== "idle" || [...detail.picks].sort((a, b) => a - b).join(",") === ctx.prefs.kenoPicks.join(",");

  return isShown ? { ...round, detail } : null;
}

/** A number's cell: picks in brackets, drawn ones in parentheses, hits in angles (and lit). */
function kenoCell(number: number, picks: Set<number>, drawn: Set<number>, color: boolean): string {
  const text = String(number).padStart(2);
  const isPick = picks.has(number);
  const isDrawn = drawn.has(number);

  if (isPick && isDrawn) {
    return inverse(color, gold(color, bold(color, `<${text}>`)));
  }

  if (isPick) {
    return pink(color, bold(color, `[${text}]`));
  }

  return isDrawn ? bold(color, `(${text})`) : dim(color, ` ${text} `);
}

/** `words` joined two spaces apart, wrapped to `width`. */
function wrap(words: string[], width: number): string[] {
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const joined = line === "" ? word : `${line}  ${word}`;

    if (line !== "" && visibleWidth(joined) > width) {
      lines.push(line);
      line = word;
    } else {
      line = joined;
    }
  }

  return line === "" ? lines : [...lines, line];
}

/** What each hit count pays, the landed count marked; counts that pay nothing dim. */
function kenoPays(paytable: readonly string[], hits: number | null, width: number, color: boolean): string[] {
  const words = paytable.map((pays, count) => {
    const label = `${count} ×${pays}`;

    if (count === hits) {
      return inverse(color, bold(color, `▸${label}`));
    }

    return hundredths(pays) > 0n ? label : dim(color, label);
  });

  return wrap([dim(color, "pays"), ...words], width);
}

function kenoStatus(round: (RoundView & { detail: KenoView }) | null, hits: number, color: boolean): string {
  if (round === null) {
    return dim(color, "ten numbers are drawn");
  }

  if (round.detail.drawn === null || round.phase !== "idle") {
    return dim(color, "drawing…");
  }

  const net = BigInt(round.net);
  const verdict = net > 0n ? "WIN" : net < 0n ? "LOSE" : "PUSH";

  return toned(
    color,
    round.net,
    bold(color, `${hits} ${hits === 1 ? "hit" : "hits"} ${verdict} ${formatSigned(round.net)}`),
  );
}

/** The 40 numbers ten a row, the picks, the draw and its hits, then what each hit count pays. */
export function renderKeno(round: RoundView | null, ctx: RenderContext): string[] {
  const { color } = ctx;
  const shown = shownKeno(round, ctx);
  const detail = shown?.detail ?? null;
  const picks = new Set(detail?.picks ?? ctx.prefs.kenoPicks);
  const drawn = new Set(detail?.drawn ?? []);
  const hits = [...drawn].filter((number) => picks.has(number)).length;
  const grid = Array.from({ length: KENO_NUMBERS / KENO_COLUMNS }, (_, row) =>
    Array.from({ length: KENO_COLUMNS }, (_, column) =>
      kenoCell(row * KENO_COLUMNS + column + 1, picks, drawn, color),
    ).join(""),
  );
  const count = picks.size;
  const lines = [
    ...grid,
    `${pink(color, bold(color, String(count)))} ${count === 1 ? "pick" : "picks"} · ${kenoStatus(shown, hits, color)}`,
  ];

  if (detail?.drawn) {
    lines.push(dim(color, "[n] pick  (n) drawn  <n> hit"));
  }

  if (detail !== null && detail.paytable.length > 0) {
    const landed = detail.drawn === null || shown?.phase !== "idle" ? null : hits;

    lines.push(...kenoPays(detail.paytable, landed, ctx.width, color));
  }

  return clip(lines, ctx.width);
}
