// Dice, Limbo and Flip as plain text: one draw each, shown at rest (a harness redraws on each
// snapshot, no tumbling). A settled round stays on the table while the next is set up with the
// same choices; once a choice changes, the table shows the next round's, as the mod's quick.tsx.
import {
  diceMultiplier,
  flipMultiplier,
  formatSigned,
  hundredths,
  scaledDecimal,
  shortMultiplier,
} from "../../../../apps/mod/hooks/format";
import { DICE_ROLLS, diceTarget } from "../../../../apps/mod/hooks/keys";
import type { DiceView, FlipSide, FlipView, LimboView, RoundView } from "../../../../apps/mod/hooks/protocol";
import type { RenderContext } from "../types";
import { bold, dim, fit, gold, green, pink, red, visibleWidth } from "./style";

/** The dice track: 40 cells of 250 rolls each, 0 at the left, 99.99 at the right. */
const DICE_CELLS = 40;
const ROLLS_PER_CELL = DICE_ROLLS / DICE_CELLS;
const DICE_SCALE = `0${" ".repeat(DICE_CELLS / 2 - 1)}50${" ".repeat(DICE_CELLS / 2 - 5)}100`;
/** The limbo multiplier's frame, as wide as "×10000.00" with its padding. */
const LIMBO_FRAME_COLUMNS = 15;
const SIDE_LETTER: Record<FlipSide, string> = { heads: "H", tails: "T" };

/** Lines cut to `width`: a safety net for extreme values. */
const clip = (lines: string[], width: number): string[] =>
  lines.map((line) => (visibleWidth(line) > width ? fit(line, width) : line));

/** Green won, red lost, dim even: the color a settled round's numbers take. */
function tone(round: RoundView, color: boolean, text: string): string {
  const net = BigInt(round.net);

  return net > 0n ? green(color, text) : net < 0n ? red(color, text) : dim(color, text);
}

/** A settled round's verdict and signed net, in its tone. */
function verdict(round: RoundView, color: boolean): string {
  const net = BigInt(round.net);

  return tone(round, color, bold(color, `${net > 0n ? "WIN" : net < 0n ? "LOSE" : "PUSH"} ${formatSigned(round.net)}`));
}

/** `round` when it is an open one of `detail`'s game, or a settled one played with the choices on the table. */
function shown<D extends RoundView["detail"]>(
  round: RoundView | null,
  detail: D | null,
  isSameChoice: boolean,
): (RoundView & { detail: D }) | null {
  return round !== null && detail !== null && (round.phase !== "idle" || isSameChoice) ? { ...round, detail } : null;
}

/** "37.42": a roll of 0 to 9999 as the roll 00.00 to 99.99. */
const rollText = (roll: number): string => scaledDecimal(BigInt(roll), 2);

/** The roll's track: winning cells `━`, losing `─`, the target `┃` and the roll `▼` over its cell. */
export function renderDice(round: RoundView | null, ctx: RenderContext): string[] {
  const { color, prefs } = ctx;
  const target = diceTarget(prefs.diceChance, prefs.diceOver);
  const detail: DiceView | null = round?.detail.game === "dice" ? round.detail : null;
  const played = shown(round, detail, detail?.over === prefs.diceOver && detail.target === target);
  const over = played?.detail.over ?? prefs.diceOver;
  const line = played?.detail.target ?? target;
  const chance = over ? DICE_ROLLS - line : line;
  const targetCell = Math.min(DICE_CELLS - 1, Math.round(line / ROLLS_PER_CELL));
  const track = Array.from({ length: DICE_CELLS }, (_, cell) => {
    const middle = cell * ROLLS_PER_CELL + ROLLS_PER_CELL / 2;

    if (cell === targetCell) {
      return bold(color, "┃");
    }

    return (over ? middle >= line : middle < line) ? green(color, "━") : red(color, "─");
  }).join("");
  const roll = played?.detail.roll ?? null;
  const isSettled = played !== null && played.phase === "idle" && roll !== null;
  const marker =
    roll === null
      ? ""
      : `${" ".repeat(Math.floor(roll / ROLLS_PER_CELL))}${isSettled ? tone(played, color, "▼") : "▼"}`;
  const multiplier = shortMultiplier(played?.detail.multiplier ?? diceMultiplier(chance));
  const result =
    played === null
      ? dim(color, "No roll yet.")
      : !isSettled
        ? dim(color, "rolling…")
        : `rolled ${tone(played, color, bold(color, rollText(roll)))}  ${verdict(played, color)}`;

  return clip(
    [
      marker,
      track,
      dim(color, DICE_SCALE),
      `roll ${over ? "over" : "under"} ${bold(color, rollText(line))} · ${bold(color, `×${multiplier}`)}`,
      `win chance ${scaledDecimal(BigInt(chance), 2)}%`,
      result,
    ],
    ctx.width,
  );
}

/** The result multiplier in a frame, green when it reaches the target, red when it stops short. */
export function renderLimbo(round: RoundView | null, ctx: RenderContext): string[] {
  const { color, prefs } = ctx;
  const nextTarget = scaledDecimal(BigInt(prefs.limboTarget), 2);
  const detail: LimboView | null = round?.detail.game === "limbo" ? round.detail : null;
  const played = shown(round, detail, detail?.target === nextTarget);
  const target = played?.detail.target ?? nextTarget;
  const result = played?.detail.result ?? null;
  const isSettled = played !== null && played.phase === "idle" && result !== null;
  const face = result === null ? (played === null ? "×—" : "×…") : `×${result}`;
  const padding = Math.max(0, LIMBO_FRAME_COLUMNS - visibleWidth(face));
  const centred = `${" ".repeat(Math.floor(padding / 2))}${face}${" ".repeat(Math.ceil(padding / 2))}`;
  const painted = !isSettled
    ? dim(color, centred)
    : bold(color, hundredths(result) >= hundredths(target) ? green(color, centred) : red(color, centred));
  // Limbo's win chance at a target × 100: 98 % / target, in hundredths of a percent.
  const chance = scaledDecimal(980_000n / hundredths(target), 2);
  const status =
    played === null
      ? dim(color, "The result has to reach the target.")
      : !isSettled
        ? dim(color, "drawing…")
        : verdict(played, color);

  return clip(
    [
      `╭${"─".repeat(LIMBO_FRAME_COLUMNS)}╮`,
      `│${painted}│`,
      `╰${"─".repeat(LIMBO_FRAME_COLUMNS)}╯`,
      `target ${bold(color, `×${target}`)} · win chance ${chance}%`,
      status,
    ],
    ctx.width,
  );
}

/** The coins that decide the round: every coin must land on the call, so up to the first one off it. */
function decidingCoins(detail: FlipView): number {
  const miss = detail.results?.findIndex((side) => side !== detail.side) ?? -1;

  return miss >= 0 ? miss + 1 : detail.flips;
}

/** The coins in a row: gold on the side called, red on the first off it, the ones after it dim. */
export function renderFlip(round: RoundView | null, ctx: RenderContext): string[] {
  const { color, prefs } = ctx;
  const detail: FlipView | null = round?.detail.game === "flip" ? round.detail : null;
  const played = shown(round, detail, detail?.side === prefs.flipSide && detail.flips === prefs.flips);
  const side = played?.detail.side ?? prefs.flipSide;
  const flips = played?.detail.flips ?? prefs.flips;
  const results = played?.phase === "idle" ? played.detail.results : null;
  const deciding = played === null ? flips : decidingCoins(played.detail);
  const coins = Array.from({ length: flips }, (_, index) => {
    const result = results?.[index];

    if (result === undefined) {
      return played === null ? dim(color, "( )") : pink(color, "(…)");
    }

    const face = `(${SIDE_LETTER[result]})`;

    return index >= deciding ? dim(color, face) : bold(color, result === side ? gold(color, face) : red(color, face));
  });
  const multiplier = shortMultiplier(played?.detail.multiplier ?? flipMultiplier(flips));
  const status =
    played === null
      ? dim(color, "every coin has to land on it")
      : results === null
        ? dim(color, "flipping…")
        : verdict(played, color);

  return clip(
    [
      coins.join(" "),
      `${flips} × ${bold(color, `${side} (${SIDE_LETTER[side]})`)} pays ${bold(color, `×${multiplier}`)}`,
      status,
    ],
    ctx.width,
  );
}
