// Dice, Limbo, Flip, Keno and Wheel: one draw each, drawn by the pane and the table surface module
// alike. Each draw plays out on the spin clock (view.tsx `spinMs`): the roll tumbles, the
// multiplier rises, the coins land and the numbers light one by one before the result shows. A
// settled round stays on the table while the next one is set up with the same choices; once a
// choice changes, the table shows the next round's instead.
import type { RenderElement } from "claude-code";

import { diceMultiplier, flipMultiplier, hundredths, scaledDecimal, shortMultiplier } from "./format";
import type { TileButton } from "./games";
import { diceTarget, DICE_ROLLS, KENO_NUMBERS, KENO_PICK_KEY } from "./keys";
import type { Prefs } from "./model";
import type { FlipView, PlayAction, RoundView, WheelView } from "./protocol";
import {
  BLUE,
  CARD_FACE,
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
  TEAL,
  toneOf,
  type Ui,
} from "./theme";

const isOpen = (round: RoundView | null): boolean => round !== null && round.phase !== "idle";

/**
 * Whether the table shows `round`: an open one always; a settled one of these games while the
 * next is set up with its choices. Once a choice changes, the table shows the next round's.
 */
export function isRoundShown(round: RoundView, prefs: Prefs): boolean {
  const detail = round.detail;

  if (isOpen(round)) {
    return true;
  }

  switch (detail.game) {
    case "dice":
      return detail.over === prefs.diceOver && detail.target === diceTarget(prefs.diceChance, prefs.diceOver);
    case "limbo":
      return detail.target === scaledDecimal(BigInt(prefs.limboTarget), 2);
    case "flip":
      return detail.side === prefs.flipSide && detail.flips === prefs.flips;
    case "keno":
      return [...detail.picks].sort((a, b) => a - b).join(",") === prefs.kenoPicks.join(",");
    case "wheel":
      return detail.segments === prefs.wheelSegments && detail.risk === prefs.wheelRisk;
    default:
      return true;
  }
}

/** The round of `game` on the table, as `isRoundShown` says; null when there is none. */
function shownRound<G extends RoundView["detail"]["game"]>(
  round: RoundView | null,
  prefs: Prefs,
  game: G,
): (RoundView & { detail: Extract<RoundView["detail"], { game: G }> }) | null {
  return round !== null && round.detail.game === game && isRoundShown(round, prefs)
    ? (round as RoundView & { detail: Extract<RoundView["detail"], { game: G }> })
    : null;
}

/** Hilo's multiplier before any right guess: the 98% the round returns. */
const HILO_FIRST_MULTIPLIER = "0.9800";

/**
 * The round a start in flight opens, or a draw in flight leaves, drawn as drawing until the
 * chain's shows, as a blackjack deal in flight is drawn face down: the choices sent, nothing
 * drawn. Keno's paytable and the wheel's segments come with the round: the `last` one's, when it
 * was played the same way. A Hilo guess lays its card face down, a Mines reveal or a tower climb
 * turns its tile. Null for any other move, and for a wheel spun another way than the last.
 */
export function sentRound(action: PlayAction, last: RoundView | null): RoundView | null {
  if (last?.phase === "player_turn") {
    const detail = sentMove(action, last.detail);

    if (detail !== null) {
      return { ...last, phase: "drawing", detail };
    }
  }

  const detail = sentDetail(action, last?.detail ?? null);

  if (detail === null || !("amount" in action)) {
    return null;
  }

  return {
    phase: "drawing",
    stake: action.amount,
    payout: "0",
    fee: "0",
    net: "0",
    number: (last?.number ?? 0) + 1,
    settledSignature: null,
    detail,
  };
}

/** A turn's board once its move is sent: the guess or the tile awaiting its draw, nothing else to play meanwhile. */
function sentMove(action: PlayAction, board: RoundView["detail"]): RoundView["detail"] | null {
  if (action.type === "hilo_guess" && board.game === "hilo") {
    return { ...board, pending: action.guess, canGuess: false, canCashOut: false };
  }

  if (action.type === "mines_reveal" && board.game === "mines") {
    return { ...board, pending: action.tile, canReveal: false, canCashOut: false };
  }

  if (action.type === "tower_climb" && board.game === "tower") {
    return { ...board, pending: action.tile, canClimb: false, canCashOut: false };
  }

  return null;
}

function sentDetail(action: PlayAction, last: RoundView["detail"] | null): RoundView["detail"] | null {
  switch (action.type) {
    case "dice_roll": {
      const chance = action.over ? DICE_ROLLS - action.target : action.target;

      return { game: "dice", target: action.target, over: action.over, roll: null, multiplier: diceMultiplier(chance) };
    }
    case "limbo_play":
      return { game: "limbo", target: scaledDecimal(BigInt(action.target), 2), result: null };
    case "flip_play":
      return {
        game: "flip",
        side: action.side,
        flips: action.flips,
        results: null,
        multiplier: flipMultiplier(action.flips),
      };
    case "keno_play": {
      const isSame = last?.game === "keno" && last.picks.length === action.picks.length;

      return { game: "keno", picks: action.picks, drawn: null, hits: null, paytable: isSame ? last.paytable : [] };
    }
    case "wheel_spin":
      return last?.game === "wheel" && last.segments === action.segments && last.risk === action.risk
        ? { ...last, segment: null }
        : null;
    case "slots_spin":
      return { game: "slots", reels: null };
    case "baccarat_deal":
      return { game: "baccarat", bet: action.bet, player: [], banker: [], playerPoints: 0, bankerPoints: 0 };
    case "hilo_bet":
      return {
        game: "hilo",
        cards: [],
        guesses: [],
        pending: null,
        multiplier: HILO_FIRST_MULTIPLIER,
        higherMultiplier: null,
        lowerMultiplier: null,
        skipsLeft: 0,
        canGuess: false,
        canCashOut: false,
        busted: false,
      };
    default:
      return null;
  }
}

/** A settled round's verdict, as blackjack tags its hands: WIN in gold, LOSE in red, PUSH in grey. */
function verdict(ui: Ui, round: RoundView): RenderElement {
  const { Text } = ui;
  const net = BigInt(round.net);

  return (
    <Text color={toneOf(round.net)} bold>
      {net > 0n ? "WIN" : net < 0n ? "LOSE" : "PUSH"}
    </Text>
  );
}

/** The dice track: 40 cells of 250 rolls each, 0 at the left, 99.99 at the right. */
const DICE_CELLS = 40;
const ROLLS_PER_CELL = DICE_ROLLS / DICE_CELLS;

/** How long a roll tumbles once drawn before it rests on the roll: about a blackjack deal. */
export const DICE_ROLL_MS = 1_000;
/** The tumbling roll changes this often. */
const TUMBLE_FRAME_MS = 60;
/** Steps the tumbling roll across the track: prime to the rolls, so it visits all of them. */
const TUMBLE_STRIDE = 6_133;

/** "37.42": a roll of 0 to 9999 as the roll 00.00 to 99.99. */
export const rollText = (roll: number): string => scaledDecimal(BigInt(roll), 2);

/**
 * The roll shown `elapsed` into a roll: tumbling while the chain draws (`roll` null), then closing
 * in on the drawn `roll` until it rests on it at DICE_ROLL_MS. A null `elapsed` is the roll at rest.
 */
export function rollAt(roll: number | null, elapsed: number | null): number | null {
  if (elapsed === null || (roll !== null && elapsed >= DICE_ROLL_MS)) {
    return roll;
  }

  const tumbling = ((Math.floor(elapsed / TUMBLE_FRAME_MS) + 1) * TUMBLE_STRIDE) % DICE_ROLLS;

  if (roll === null) {
    return tumbling;
  }

  const settled = 1 - (1 - elapsed / DICE_ROLL_MS) ** 3;

  return Math.round(tumbling + (roll - tumbling) * settled);
}

/**
 * The roll's track, as Stake's slider: the winning side green, the losing side red, the target
 * `┃` between them and the roll `▼` over its cell, moving while it tumbles. Beside it, the roll
 * and once it rests, its verdict. `spinElapsed`: how far into its roll the round on the table is.
 */
export function diceTable(ui: Ui, round: RoundView | null, prefs: Prefs, spinElapsed: number | null): RenderElement {
  const { Box, Text } = ui;
  const shown = shownRound(round, prefs, "dice");
  const detail = shown?.detail ?? null;
  const over = detail?.over ?? prefs.diceOver;
  const target = detail?.target ?? diceTarget(prefs.diceChance, prefs.diceOver);
  const chance = over ? DICE_ROLLS - target : target;
  const targetCell = Math.min(DICE_CELLS - 1, Math.round(target / ROLLS_PER_CELL));
  const cells = Array.from({ length: DICE_CELLS }, (_, cell) => {
    const middle = cell * ROLLS_PER_CELL + ROLLS_PER_CELL / 2;

    return over ? middle >= target : middle < target;
  });
  const isRolling = shown !== null && (spinElapsed !== null || isOpen(shown));
  const roll = rollAt(detail?.roll ?? null, isRolling ? spinElapsed : null);
  const marker = roll === null ? " " : `${" ".repeat(Math.floor(roll / ROLLS_PER_CELL))}▼`;
  const half = DICE_CELLS / 2;
  const scale = `0${" ".repeat(half - 1)}50${" ".repeat(half - 5)}100`;
  const result =
    shown === null ? (
      <Text color={FG6}>No roll yet.</Text>
    ) : roll === null ? (
      <Text color={FG6}>rolling…</Text>
    ) : isRolling ? (
      <Text color={FG1} bold>{`rolling ${rollText(roll)}`}</Text>
    ) : (
      <Text color={FG4}>
        {"rolled "}
        <Text color={toneOf(shown.net)} bold>
          {rollText(roll)}
        </Text>{" "}
        {verdict(ui, shown)}
      </Text>
    );

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
      <Box flexDirection="column">
        <Text color={isRolling || shown === null ? FG1 : toneOf(shown.net)} bold>
          {marker}
        </Text>
        <Text>
          {cells.map((wins, cell) =>
            cell === targetCell ? (
              <Text color={FG1} bold>
                ┃
              </Text>
            ) : (
              <Text color={wins ? GREEN : RED}>━</Text>
            ),
          )}
        </Text>
        <Text color={FG6}>{scale}</Text>
      </Box>
      <Box flexDirection="column">
        <Text color={FG4}>
          {`roll ${over ? "over" : "under"} `}
          <Text color={FG1} bold>
            {rollText(target)}
          </Text>
        </Text>
        <Text color={FG4}>{`win chance ${scaledDecimal(BigInt(chance), 2)}%`}</Text>
        <Text color={FG4}>
          multiplier{" "}
          <Text color={FG1} bold>
            {`×${shortMultiplier(detail?.multiplier ?? diceMultiplier(chance))}`}
          </Text>
        </Text>
        {result}
      </Box>
    </Box>
  );
}

/** How long the multiplier takes to rise from ×1.00 to the drawn one. */
export const LIMBO_RISE_MS = 1_000;

/**
 * The multiplier shown `elapsed` into its rise to `result`: from ×1.00, fast at first, slowing
 * onto it at LIMBO_RISE_MS. It rises by ratios, so a ×1.20 and a ×500 take as long. A null
 * `elapsed` is the result at rest.
 */
export function limboAt(result: string, elapsed: number | null): string {
  if (elapsed === null || elapsed >= LIMBO_RISE_MS) {
    return result;
  }

  const eased = 1 - (1 - elapsed / LIMBO_RISE_MS) ** 3;
  const top = Number(hundredths(result));
  // A display value, not money: a float only sets where the count is on its way.
  const shown = Math.min(top, Math.floor(100 * (top / 100) ** eased));

  return scaledDecimal(BigInt(shown), 2);
}

/** The multiplier's frame, as wide as "×10000.00" with its padding: it never grows as the value rises. */
const LIMBO_FRAME_COLUMNS = 17;

/** Limbo's win chance at a target × 100: 98 % / target, in hundredths of a percent. */
const limboChance = (target: bigint): string => scaledDecimal(980_000n / target, 2);

/**
 * The multiplier in a frame, rising from ×1.00 once drawn: gold from the moment it reaches the
 * target, red when it stops short. Beside it, the target, its chance and the verdict.
 */
export function limboTable(ui: Ui, round: RoundView | null, prefs: Prefs, spinElapsed: number | null): RenderElement {
  const { Box, Text } = ui;
  const shown = shownRound(round, prefs, "limbo");
  const target = shown?.detail.target ?? scaledDecimal(BigInt(prefs.limboTarget), 2);
  const result = shown?.detail.result ?? null;
  const isRising = shown !== null && (spinElapsed !== null || isOpen(shown));
  const current = result === null ? null : limboAt(result, isRising ? spinElapsed : null);
  const reached = current !== null && hundredths(current) >= hundredths(target);
  const color = current === null ? FG6 : reached ? GOLD : isRising ? FG1 : RED;

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={3} alignItems="center">
      <Box
        borderStyle="round"
        borderColor={current === null || isRising ? LINE3 : color}
        minWidth={LIMBO_FRAME_COLUMNS}
        justifyContent="center"
      >
        <Text color={color} bold={current !== null}>
          {current === null ? (isRising ? "×1.00" : "×—") : `×${current}`}
        </Text>
      </Box>
      <Box flexDirection="column">
        <Text color={FG4}>
          target{" "}
          <Text color={FG1} bold>
            {`×${target}`}
          </Text>
        </Text>
        <Text color={FG4}>{`win chance ${limboChance(hundredths(target))}%`}</Text>
        {shown === null ? (
          <Text color={FG6}>The result has to reach the target.</Text>
        ) : isRising ? (
          <Text color={FG6}>{current === null ? "drawing…" : "rising…"}</Text>
        ) : (
          verdict(ui, shown)
        )}
      </Box>
    </Box>
  );
}

const SIDE_LETTER: Record<FlipView["side"], string> = { heads: "H", tails: "T" };
/** A coin in the air, turning over; no face shows before it lands. */
const SPINNING_COIN = ["(|)", "(/)", "(-)", "(\\)"];
/** A frame of the main screen's spin clock: each one shows the coin a step on, none skipped. */
const COIN_TURN_MS = 100;
/** The first coin turns this long before it lands; each next one lands this much later. */
const FLIP_FIRST_MS = 450;
const FLIP_STEP_MS = 150;

/** The coins that land one by one: every coin must land on the call, so up to the first one off it. */
function decidingCoins(detail: FlipView): number {
  const miss = detail.results?.findIndex((side) => side !== detail.side) ?? -1;

  return miss >= 0 ? miss + 1 : detail.flips;
}

/** How long the coins take to land, one after another, up to the one that decides the round. */
export const flipMs = (detail: FlipView): number => FLIP_FIRST_MS + (decidingCoins(detail) - 1) * FLIP_STEP_MS;

/** The coins landed `elapsed` into the flip; a null `elapsed` lands them all. */
function coinsLandedAt(detail: FlipView, elapsed: number | null): number {
  if (detail.results === null) {
    return 0;
  }

  if (elapsed === null) {
    return detail.flips;
  }

  return elapsed < FLIP_FIRST_MS
    ? 0
    : Math.min(decidingCoins(detail), 1 + Math.floor((elapsed - FLIP_FIRST_MS) / FLIP_STEP_MS));
}

/**
 * The coins in a row, landing one by one: gold on the side called, red on the first off it. The
 * coins after that one decide nothing: they show once it lands, dim.
 */
export function flipTable(ui: Ui, round: RoundView | null, prefs: Prefs, spinElapsed: number | null): RenderElement {
  const { Box, Text } = ui;
  const shown = shownRound(round, prefs, "flip");
  const detail = shown?.detail ?? null;
  const side = detail?.side ?? prefs.flipSide;
  const flips = detail?.flips ?? prefs.flips;
  const isFlipping = shown !== null && (spinElapsed !== null || isOpen(shown));
  const landed = detail === null ? 0 : coinsLandedAt(detail, isFlipping ? spinElapsed : null);
  const deciding = detail === null ? flips : decidingCoins(detail);
  const coins = Array.from({ length: flips }, (_, index) => {
    const result = detail?.results?.[index];

    if (result === undefined || index >= landed) {
      const turn = Math.floor((spinElapsed ?? 0) / COIN_TURN_MS) + index;

      return isFlipping ? (
        <Text color={FG4} bold>
          {SPINNING_COIN[turn % SPINNING_COIN.length]}
        </Text>
      ) : (
        <Text color={LINE4} bold>
          ( )
        </Text>
      );
    }

    return (
      <Text color={index >= deciding ? FG6 : result === side ? GOLD : RED} bold={index < deciding}>
        {`(${SIDE_LETTER[result]})`}
      </Text>
    );
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {coins}
      </Box>
      <Text color={FG4}>
        {`${flips} × `}
        <Text color={FG1} bold>
          {side}
        </Text>
        {" pays "}
        <Text color={FG1} bold>
          {`×${shortMultiplier(detail?.multiplier ?? flipMultiplier(flips))}`}
        </Text>
        {shown === null && <Text color={FG6}>{" · every coin has to land on it"}</Text>}
        {shown !== null && !isFlipping && (
          <Text>
            {"  "}
            {verdict(ui, shown)}
          </Text>
        )}
      </Text>
    </Box>
  );
}

const KENO_COLUMNS = 8;
const KENO_CELL = 4;
/** Ten numbers are drawn, lit one after another this often. */
const KENO_DRAWN = 10;
const KENO_STEP_MS = 80;
/** How long the draw takes to light its numbers. */
export const KENO_DRAW_MS = KENO_DRAWN * KENO_STEP_MS;

/** The drawn numbers lit `elapsed` into the draw, in the order drawn; a null `elapsed` lights them all. */
export function litAt(drawn: readonly number[] | null, elapsed: number | null): readonly number[] {
  if (drawn === null) {
    return [];
  }

  return elapsed === null ? drawn : drawn.slice(0, 1 + Math.floor(elapsed / KENO_STEP_MS));
}

/** What each hit count pays: the hits so far bright while the numbers light, the landed count on a chip. */
function kenoPays(ui: Ui, paytable: readonly string[], hits: number | null, isLanded: boolean): RenderElement {
  const { Box, Text } = ui;

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      <Text color={FG6}>HITS</Text>
      {paytable.map((pays, count) => {
        const label = `${count} ×${pays}`;
        const isPaying = hundredths(pays) > 0n;

        if (count !== hits) {
          return <Text color={isPaying ? FG4 : FG6}>{label}</Text>;
        }

        return isLanded ? (
          <Text backgroundColor={isPaying ? GOLD : LINE4} color={isPaying ? INK : FG1} bold>
            {` ${label} `}
          </Text>
        ) : (
          <Text color={FG1} bold>
            {label}
          </Text>
        );
      })}
    </Box>
  );
}

/**
 * The 40 numbers, eight a row: picks in brackets, gold once drawn (a hit), the other drawn numbers
 * bright. Drawn, the ten light one by one, the newest on a chip, while the hits count up and the
 * paytable follows them; the hit count's row lands on a chip with the verdict. On the fullscreen
 * table each number is a Button: a click picks or unpicks it.
 */
export function kenoTable(
  ui: Ui,
  round: RoundView | null,
  prefs: Prefs,
  spinElapsed: number | null,
  numberButton: TileButton,
): RenderElement {
  const { Box, Text } = ui;
  const shown = shownRound(round, prefs, "keno");
  const detail = shown?.detail ?? null;
  const isDrawing = shown !== null && (spinElapsed !== null || isOpen(shown));
  const picks = new Set(detail?.picks ?? prefs.kenoPicks);
  const lit = litAt(detail?.drawn ?? null, isDrawing ? spinElapsed : null);
  const drawn = new Set(lit);
  const newest = isDrawing ? lit[lit.length - 1] : undefined;
  const hits = lit.filter((number) => picks.has(number)).length;
  const cell = (number: number): RenderElement => {
    const isPick = picks.has(number);
    const isDrawn = drawn.has(number);
    const text = isPick ? `[${String(number).padStart(2)}]` : ` ${String(number).padStart(2)} `;
    const color = isPick ? (isDrawn ? GOLD : PINK) : isDrawn ? FG1 : FG6;
    const face =
      number === newest ? (
        <Text backgroundColor={isPick ? GOLD : LINE4} color={isPick ? INK : FG1} bold>
          {text}
        </Text>
      ) : (
        <Text color={color} bold={isPick || isDrawn}>
          {text}
        </Text>
      );

    return shown !== null && isOpen(shown) ? face : (numberButton(`${KENO_PICK_KEY}${number}`, face) ?? face);
  };
  const rows = Array.from({ length: KENO_NUMBERS / KENO_COLUMNS }, (_, row) => (
    <Box flexDirection="row">
      {Array.from({ length: KENO_COLUMNS }, (_, column) => (
        <Box width={KENO_CELL}>{cell(row * KENO_COLUMNS + column + 1)}</Box>
      ))}
    </Box>
  ));
  const count = picks.size;
  const hitsText = `${hits} ${hits === 1 ? "hit" : "hits"}`;

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
        <Box flexDirection="column">{rows}</Box>
        <Box flexDirection="column">
          <Text color={FG4}>
            <Text color={PINK} bold>
              {String(count)}
            </Text>
            {` ${count === 1 ? "pick" : "picks"}`}
          </Text>
          {shown === null ? (
            <Text color={FG6}>Ten numbers are drawn.</Text>
          ) : lit.length === 0 ? (
            <Text color={FG6}>drawing…</Text>
          ) : isDrawing ? (
            <Text color={hits > 0 ? GOLD : FG4} bold>
              {hitsText}
            </Text>
          ) : (
            <Text color={toneOf(shown.net)} bold>
              {`${hitsText} `}
              {verdict(ui, shown)}
            </Text>
          )}
        </Box>
      </Box>
      {detail !== null && kenoPays(ui, detail.paytable, lit.length === 0 ? null : hits, !isDrawing)}
    </Box>
  );
}

/** How long the wheel takes to slow from full speed into the drawn segment: about a dice roll. */
export const WHEEL_SPIN_MS = 1_100;
/**
 * Full speed, in segments a ms: under half a segment a frame of the main screen (100 ms), else
 * the eye sees the wedges step backwards (a wagon wheel), then turn the right way as it slows.
 */
const TOP_SPEED = 0.4 / 100;
/** How far the slowing turns: the cubic ease-out that starts at full speed. */
const LANDING_TURN = (TOP_SPEED * WHEEL_SPIN_MS) / 3;

/**
 * Which segment the pointer is over, `elapsed` into a spin of a wheel of `segments` (a fraction is
 * part way to the next): turning clockwise at full speed while the chain draws; once it has,
 * slowing on a cubic ease-out to rest exactly on the drawn `segment`. The count falls as the wheel
 * turns clockwise: the segment before comes under the pointer.
 */
export function wheelSegmentAt(
  segments: number,
  segment: number | null,
  elapsed: number | null,
  isDrawing: boolean,
): number {
  const rest = segment ?? 0;

  if (isDrawing) {
    // The slowing's slope at its start, so landing changes the pace without a jolt.
    return (rest - TOP_SPEED * (elapsed ?? 0)) % segments;
  }

  if (elapsed === null || elapsed >= WHEEL_SPIN_MS) {
    return rest;
  }

  return rest + LANDING_TURN * (1 - elapsed / WHEEL_SPIN_MS) ** 3;
}

/** Multipliers under ×2 count as small wins, in cool colors; the rest are the warm big ones. */
const BIG_WIN = 200n;
/** Under ×1 a landing gives part of the stake back: a loss, never drawn in a win's color. */
const STAKE_BACK = 100n;

/**
 * One color per multiplier the wheel pays: nothing dim, part of the stake back a dim red, the small
 * wins cool (blue, teal, green as they rise), the big ones warm, the biggest pink and the others gold.
 */
export function segmentColors(pays: readonly string[]): Map<string, string> {
  const values = [...new Set(pays)].sort((a, b) => Number(hundredths(a) - hundredths(b)));
  const small = values.filter((value) => hundredths(value) >= STAKE_BACK && hundredths(value) < BIG_WIN);
  const big = values.filter((value) => hundredths(value) >= BIG_WIN);
  const cool = [BLUE, TEAL, GREEN];
  const colors = new Map<string, string>(
    values.map((value) => [value, hundredths(value) > 0n && hundredths(value) < STAKE_BACK ? PART_BACK : LINE4]),
  );

  small.forEach((value, rank) => colors.set(value, cool[Math.min(rank, cool.length - 1)] ?? GREEN));
  big.forEach((value, rank) => colors.set(value, rank === big.length - 1 ? PINK : GOLD));

  return colors;
}

/** The color of a landing that gives part of the stake back: a loss, dimmer than LOSE's red. */
const PART_BACK = "#8a4a4a";

/** A label in the strip (`×19.60` at most) with its gap, or a dot with its gap where there are too many to label. */
const LABEL_CELL = 7;
const DOT_CELL = 2;
/** Up to this many segments, the strip labels each one. */
const MAX_LABELED = 20;
/** The strip's segments: this many each side of the pointer. */
const STRIP_REACH: Record<number, number> = { [LABEL_CELL]: 3, [DOT_CELL]: 12 };

/** The discs the wheel is drawn as, biggest first: the columns each takes across, odd so the pointer stands over a middle one. */
const DISC_COLUMNS = [31, 25, 17] as const;
/** Beside the disc: a gap and the side's `10 segments · low risk`. */
const SIDE_COLUMNS = 24;

/**
 * The biggest disc that fits, with its side, in the `columns` and `rows` the table has; null where
 * none does and the strip is drawn instead.
 */
export function wheelDisc(columns: number, rows: number): number | null {
  return DISC_COLUMNS.find((disc) => disc + SIDE_COLUMNS <= columns && wheelRows(disc) <= rows) ?? null;
}

/**
 * A cell holds two pixels one over the other (`▀`: its color the top one, its fill the bottom
 * one), near enough square: a disc as many pixels down as across takes half as many rows.
 */
const discHeight = (columns: number): number => (columns + 1) / 2;

/** How far past its radius a pixel's centre still counts as on the disc: a flat top, not a lone pixel. */
const EDGE_PX = 0.35;
/** The gold rim's width, as a share of the radius: a pixel at the least. */
const RIM_SHARE = 0.1;
/** The hub's radius, as a share of the disc's. */
const HUB_SHARE = 0.15;
/** Wedges at least this wide along the rim get a dark seam between them; narrower ones would be all seam. */
const SEAM_MIN_PX = 5;
const SEAM_HALF_PX = 0.5;
/** The seams stay dark on either ground, as a wheel's own would; a grey of the 256-color palette, so it stays one without true color. */
const SEAM = "#1c1c1c";
const TAU = 2 * Math.PI;

/** A run of a disc row's cells that draw alike. */
interface Run {
  glyph: string;
  color: string | null;
  fill: string | null;
  count: number;
}

/**
 * The disc's rows, `columns` across: the wedges in `wedgeColors` clockwise, turned so that
 * `position` (a segment, a fraction part way to the next) is under the top, inside a gold rim
 * around a hub. Neighbouring cells drawn alike share one Text.
 */
function discLines(ui: Ui, columns: number, wedgeColors: readonly string[], position: number): RenderElement[] {
  const { Text } = ui;
  const rows = discHeight(columns);
  const radius = columns / 2;
  const hub = radius * HUB_SHARE;
  const faceRadius = radius - Math.max(1, radius * RIM_SHARE);
  const wedges = wedgeColors.length;
  const hasSeams = (TAU * faceRadius) / wedges >= SEAM_MIN_PX;
  const colorAt = (column: number, y: number): string | null => {
    const dx = column + 0.5 - radius;
    const dy = y + 0.5 - rows;
    const distance = Math.hypot(dx, dy);

    if (distance > radius + EDGE_PX) {
      return null;
    }

    if (distance > faceRadius) {
      return GOLD;
    }

    if (distance < hub) {
      return CARD_FACE;
    }

    // Clockwise from the top, in wedges; the one at `position` has its middle under the pointer.
    const along = (Math.atan2(dx, -dy) / TAU) * wedges + position + 0.5;
    const wedge = Math.floor(along);
    const off = along - wedge;

    if (hasSeams && (Math.min(off, 1 - off) * TAU * distance) / wedges < SEAM_HALF_PX) {
      return SEAM;
    }

    return wedgeColors[((wedge % wedges) + wedges) % wedges] ?? LINE4;
  };

  return Array.from({ length: rows }, (_, row) => {
    const runs: Run[] = [];

    for (let column = 0; column < columns; column++) {
      const top = colorAt(column, 2 * row);
      const bottom = colorAt(column, 2 * row + 1);
      const cell: Omit<Run, "count"> =
        top === null
          ? { glyph: bottom === null ? " " : "▄", color: bottom, fill: null }
          : bottom === null || bottom === top
            ? { glyph: bottom === null ? "▀" : "█", color: top, fill: null }
            : { glyph: "▀", color: top, fill: bottom };
      const last = runs[runs.length - 1];

      if (last !== undefined && last.glyph === cell.glyph && last.color === cell.color && last.fill === cell.fill) {
        last.count++;
      } else {
        runs.push({ ...cell, count: 1 });
      }
    }

    if (runs[runs.length - 1]?.color === null) {
      runs.pop();
    }

    return (
      <Text>
        {runs.map(({ glyph, color, fill, count }) =>
          color === null ? (
            glyph.repeat(count)
          ) : fill === null ? (
            <Text color={color}>{glyph.repeat(count)}</Text>
          ) : (
            <Text color={color} backgroundColor={fill}>
              {glyph.repeat(count)}
            </Text>
          ),
        )}
      </Text>
    );
  });
}

/** `text` centered in `width` columns, the odd space on the right. */
function centered(text: string, width: number): string {
  const left = Math.floor((width - text.length) / 2);

  return `${" ".repeat(Math.max(0, left))}${text}`.padEnd(width);
}

/** The space around the landed multiplier on its chip. */
const CHIP_PAD = 3;

/**
 * The wheel as a disc of colored wedges in a gold rim, `disc` columns across (`wheelDisc`),
 * turning under a fixed pointer `▼` at the top; where no disc fits (null), a strip of the segments
 * around the pointer instead. Beside it, the wheel's segments and risk until it lands, then the
 * landed multiplier on a chip of its color; under it, what each color pays. `spinElapsed`: how
 * far into its spin the round on the table is; null draws it at rest.
 */
export function wheelTable(
  ui: Ui,
  round: RoundView | null,
  prefs: Prefs,
  disc: number | null,
  spinElapsed: number | null,
): RenderElement {
  const { Box, Text } = ui;
  const shown: WheelView | null = shownRound(round, prefs, "wheel")?.detail ?? null;
  const segments = shown?.segments ?? prefs.wheelSegments;
  const risk = shown?.risk ?? prefs.wheelRisk;
  const pays = shown?.multipliers ?? [];
  const colors = segmentColors(pays);
  const isDrawing = shown !== null && round?.phase === "drawing";
  const isSpinning = shown !== null && (spinElapsed !== null || isDrawing);
  const landed = isSpinning ? null : (shown?.segment ?? null);
  const position = wheelSegmentAt(segments, shown?.segment ?? null, spinElapsed, isDrawing);
  // On a dim 0× chip the theme's text reads; on a colored one, the ink made for fills.
  const chipInk = (multiplier: string) => (hundredths(multiplier) === 0n ? FG1 : INK);
  const landedPays = landed === null ? null : (pays[landed] ?? "0.00");
  const status = <Text color={FG6}>{isSpinning ? "spinning…" : "No spin yet."}</Text>;
  const about = <Text color={FG4}>{`${segments} segments · ${risk} risk`}</Text>;
  // The colors come in the order of what they pay.
  const legend = [...colors].map(([multiplier, color]) => (
    <Text color={FG6}>
      <Text color={color}>●</Text>
      {` ×${multiplier}`}
    </Text>
  ));

  if (disc !== null) {
    const wedgeColors = Array.from({ length: segments }, (_, index) => {
      const multiplier = pays[index];

      return multiplier === undefined ? LINE4 : (colors.get(multiplier) ?? LINE4);
    });
    const side =
      landedPays === null ? (
        <Box flexDirection="column">
          {about}
          {status}
        </Box>
      ) : (
        <Box backgroundColor={colors.get(landedPays) ?? LINE4} height={3} paddingX={CHIP_PAD} alignItems="center">
          <Text color={chipInk(landedPays)} bold>{` ×${landedPays} `}</Text>
        </Box>
      );

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} alignItems="center">
          <Box flexDirection="column">
            <Text color={GOLD} bold>{`${" ".repeat((disc - 1) / 2)}▼`}</Text>
            {discLines(ui, disc, wedgeColors, position)}
          </Box>
          {side}
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {legend}
        </Box>
      </Box>
    );
  }

  const turn = Math.round(position);
  const cellColumns = segments > MAX_LABELED ? DOT_CELL : LABEL_CELL;
  const face = cellColumns - 1;
  const cell = (slot: number): RenderElement => {
    const multiplier = pays[(((turn + slot) % segments) + segments) % segments];
    const color = multiplier === undefined ? LINE4 : (colors.get(multiplier) ?? LINE4);
    const isUnder = slot === 0 && shown !== null;

    if (face === 1) {
      return (
        <Text color={color} bold={isUnder}>
          {isUnder ? "◉" : "●"}
        </Text>
      );
    }

    const label = centered(multiplier === undefined ? "·" : `×${multiplier}`, face);

    return isUnder ? (
      <Text backgroundColor={color} color={chipInk(multiplier ?? "0")} bold>
        {label}
      </Text>
    ) : (
      <Text color={color}>{label}</Text>
    );
  };
  const reach = STRIP_REACH[cellColumns] ?? 0;
  // The pointer stands over the middle of a cell's face.
  const faceMiddle = Math.floor((face - 1) / 2);

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text color={GOLD} bold>{`${" ".repeat(reach * cellColumns + faceMiddle)}▼`}</Text>
        <Text>
          {Array.from({ length: reach * 2 + 1 }, (_, index) => [index === 0 ? "" : " ", cell(index - reach)])}
        </Text>
      </Box>
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {landedPays === null ? (
          about
        ) : (
          <Text backgroundColor={colors.get(landedPays) ?? LINE4} color={chipInk(landedPays)} bold>
            {` ×${landedPays} `}
          </Text>
        )}
        {legend}
        {landedPays === null && status}
      </Box>
    </Box>
  );
}

/** The rows `wheelTable` takes: the pointer and the disc (or the strip), a blank, the legend. */
export function wheelRows(disc: number | null): number {
  return 1 + (disc === null ? 1 : discHeight(disc)) + 2;
}
