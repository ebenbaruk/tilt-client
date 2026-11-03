// The table surface module: the game table drawn on the terminal's drawing thread (a `Client` in
// the pane or the bottom band). In fullscreen it takes raw keys once a click gives it the focus and
// posts the plan key each one presses to the hooks module; on the main screen it takes neither. It
// animates on its own frame clock everywhere: cards dealt one by one, the active hand pulsing, a
// win counted up, a loss shaken. The clock stops once nothing moves. Its keys are the plan's: none
// while a round plays out, as the pane's (view.tsx `isPlayHeld`).
import type { ClientSurface, RenderElement } from "claude-code";

import { dealMs, dealtCards, revealedAt } from "./cards";
import { SEPARATOR } from "./format";
import { KENO_PICK_KEY, ROULETTE_STRAIGHT_KEY, STEPPER_NAMES } from "./keys";
import type { RoundView } from "./protocol";
import { pressFor, stepperOf, type TableKey, type TableProps } from "./table-input";
import { applyTheme, FG4, FG6, GOLD, PINK, type Ui } from "./theme";
import {
  celebration,
  celebrationMs,
  dealingTable,
  gameTable,
  outcomeLine,
  RESULT_MS,
  resultLine,
  shakeAt,
  spinMs,
  spinProgress,
  tableRound,
} from "./view";

const FRAME_MS = 33;
const PULSE_BEAT_MS = 450;
/** The active hand and the play-again prompt pulse this long after the last change, then rest. */
const PULSE_WINDOW_MS = 12_000;
const STREAK_SHOWN_FROM = 2;

type Outcome = "win" | "loss" | "push";

interface Effect {
  kind: Outcome;
  /** Frame clock time it starts: once the round's last card is turned over. */
  at: number;
  net: string;
  balance: string;
  /** Rounds won in a row once this result shows. */
  streak: number;
}

interface TableState {
  /** Frame clock time, advanced by the ticker only while something moves. */
  now: number;
  /** The round last drawn, and its blackjack, baccarat or Hilo card count then. */
  round: number | null;
  cards: number;
  /** The cards already shown when the last ones came, and when they came: they turn over from
   *  then on as the hooks module's clock turns them (cards.tsx `revealedAt`). */
  dealFrom: number;
  dealAt: number;
  /** Frame clock time a round started spinning (a wheel, the reels, a one-draw game's draw); null when none is. */
  spinAt: number | null;
  /** The round on the table was drawing at the last props. */
  wasDrawing: boolean;
  /** The last round counted as settled, so a redraw never counts it twice. */
  settled: number | null;
  effect: Effect | null;
  /** Rounds won in a row before the effect's round, kept while the instance lives: the effect's
   *  own count shows only with its result, so the line never tells the result first. */
  streak: number;
  /** The last change or key: the pulses run for a while after it. */
  wokeAt: number;
  /** Clicked since the pane last took the keyboard: the raw keys are the table's. */
  isFocused: boolean;
  /** The pane's focus at the last props, to notice it taken. */
  wasPaneFocused: boolean;
}

interface Runtime {
  props: TableProps;
  stopClock: (() => void) | null;
}

const runtimes = new WeakMap<object, Runtime>();

const outcomeOf = (net: string): Outcome => {
  const value = BigInt(net);

  return value > 0n ? "win" : value < 0n ? "loss" : "push";
};

function firstState(props: TableProps): TableState {
  const round = props.state.round;
  const cards = dealtCards(round);

  return {
    now: 0,
    round: round?.number ?? null,
    cards,
    dealFrom: cards,
    dealAt: 0,
    spinAt: null,
    wasDrawing: round?.phase === "drawing",
    settled: round?.phase === "idle" ? round.number : null,
    effect: null,
    streak: 0,
    wokeAt: 0,
    isFocused: false,
    wasPaneFocused: props.isPaneFocused,
  };
}

/** The state after new props: a new round deals from the first card, a new card is dealt, a
 * settled round starts its effect and counts in the streak. The same object when nothing changed. */
function observe(props: TableProps, state: TableState): TableState {
  const round = props.state.round;
  const cards = dealtCards(round);
  const speed = props.prefs.slotsSpeed;
  let next = state;

  // ctrl+x tab gave the pane the keyboard, away from the table: it has to be clicked again before
  // Space and the arrows are its own. The pane losing the keyboard says nothing: a click on the
  // table takes it from the pane too, and the engine never says when Esc takes it from the table.
  if (state.wasPaneFocused !== props.isPaneFocused) {
    next = { ...next, wasPaneFocused: props.isPaneFocused, isFocused: next.isFocused && !props.isPaneFocused };
  }

  // A round that lands after drawing restarts its spin, so the reels stop one by one on the result.
  if (round !== null && round.number === state.round && round.phase === "idle" && state.wasDrawing) {
    next = { ...next, spinAt: spinMs(round.detail, speed) > 0 ? next.now : null, wokeAt: next.now };
  }

  if ((round?.number ?? null) !== state.round) {
    const spinAt = round !== null && spinMs(round.detail, speed) > 0 ? next.now : null;

    next = {
      ...next,
      round: round?.number ?? null,
      cards,
      dealFrom: 0,
      dealAt: next.now,
      spinAt,
      effect: null,
      streak: next.effect?.streak ?? next.streak,
    };
    next.wokeAt = next.now;
  } else if (cards !== state.cards) {
    next = { ...next, cards, dealFrom: state.cards, dealAt: next.now, wokeAt: next.now };
  }

  if (round !== null && round.phase === "idle" && round.number !== state.settled) {
    const kind = outcomeOf(round.net);
    // The effect waits for the last card, or for the wheel or the reels to land.
    const spinEnd = next.spinAt === null ? 0 : next.spinAt + spinMs(round.detail, speed);
    const at = Math.max(next.now, spinEnd, next.dealAt + dealMs(next.dealFrom, next.cards));
    const base = next.effect?.streak ?? next.streak;

    next = {
      ...next,
      settled: round.number,
      streak: base,
      effect: {
        kind,
        at,
        net: round.net,
        balance: props.state.balance,
        streak: kind === "win" ? base + 1 : kind === "loss" ? 0 : base,
      },
      wokeAt: at,
    };
  }

  const isDrawing = round?.phase === "drawing";

  return next.wasDrawing === isDrawing ? next : { ...next, wasDrawing: isDrawing };
}

const hasKey = (keys: readonly TableKey[], address: string): boolean => keys.some((key) => key.key === address);

/** Cards turned over so far, in deal order. */
const revealedOf = (state: TableState): number =>
  revealedAt(state.dealFrom, state.cards, state.now - state.dealAt) ?? state.cards;

/** Rounds won in a row as shown now: the effect's count once its result shows. */
const streakOf = (state: TableState): number =>
  state.effect !== null && state.now >= state.effect.at ? state.effect.streak : state.streak;

/** How far into its spin the round on the table is; null once it landed. */
function spinElapsed(state: TableState, props: TableProps): number | null {
  const round = props.state.round;

  if (state.spinAt === null || round === null) {
    return null;
  }

  return spinProgress(round, state.now - state.spinAt, props.prefs.slotsSpeed);
}

function isAnimating(state: TableState, props: TableProps): boolean {
  const round = props.state.round;
  const isDealing = revealedOf(state) < state.cards || spinElapsed(state, props) !== null;
  const effectMs = Math.max(RESULT_MS, round === null ? 0 : celebrationMs(round));
  const hasEffect = state.effect !== null && state.now < state.effect.at + effectMs;
  const canPulse = hasKey(props.keys, "bj-stand") || hasKey(props.keys, "start");

  return isDealing || hasEffect || (canPulse && state.now < state.wokeAt + PULSE_WINDOW_MS);
}

function tick(surface: ClientSurface<TableState>, rt: Runtime): void {
  const state = surface.state;

  if (state === undefined) {
    return;
  }

  const next: TableState = { ...state, now: state.now + FRAME_MS };

  if (!isAnimating(next, rt.props)) {
    rt.stopClock?.();
    rt.stopClock = null;
  }

  surface.setState(next);
}

function startClock(surface: ClientSurface<TableState>, rt: Runtime): void {
  if (rt.stopClock === null) {
    rt.stopClock = surface.every(FRAME_MS, () => tick(surface, rt));
  }
}

/** A click gives the table the raw keys; a key then wakes its pulses. */
function focus(surface: ClientSurface<TableState>, rt: Runtime): void {
  const state = surface.state;

  if (state !== undefined) {
    surface.setState({ ...state, isFocused: true, wokeAt: state.now });
    startClock(surface, rt);
  }
}

function listen(surface: ClientSurface<TableState>, rt: Runtime): void {
  surface.onPointer((event) => {
    if (event.type === "down") {
      focus(surface, rt);
    }
  });
  surface.onKey((event) => {
    // The engine hands keys only after a click; a key the table holds no click for (none yet, or
    // ctrl+x tab gave the pane the keyboard since) plays nothing, should any reach it.
    if (surface.state?.isFocused !== true) {
      return;
    }

    const press = pressFor(event, rt.props.keys);

    focus(surface, rt);

    if (press !== null) {
      surface.post({ press });
    }
  });
}

function summary(ui: Ui, state: TableState, round: RoundView | null, isSpinning: boolean): RenderElement | null {
  const effect = state.effect;

  if (round === null || round.phase !== "idle" || revealedOf(state) < state.cards || isSpinning) {
    return null;
  }

  // A round this instance saw settle says nothing before its result starts: then it counts up.
  if (effect !== null && effect.net === round.net && state.now < effect.at) {
    return null;
  }

  if (effect === null || effect.net !== round.net) {
    return outcomeLine(ui, round);
  }

  return resultLine(ui, round, state.now - effect.at, effect.balance);
}

interface PromptView {
  /** A click gave the table the raw keys (the engine never says when Esc takes them back). */
  isFocused: boolean;
  /** The pane holds the keyboard (ctrl+x tab), which hands the table no Space: it goes to the prompt. */
  isPaneFocused: boolean;
  /** The shown game's last round is settled: Space plays it again. */
  isSettled: boolean;
  isPulseOn: boolean;
}

/** How to play the table now; null on a Hilo turn, whose moves are the pane's own keycaps (and its
 *  odds beside the cards): one clickable place per move. */
function prompt(ui: Ui, keys: readonly TableKey[], view: PromptView): RenderElement | null {
  const { Text } = ui;
  const start = keys.find((key) => key.key === "start");
  const again = start !== undefined && view.isSettled ? "play again (same bet)" : "play";
  const hasLayout = keys.some((key) => key.key.startsWith(ROULETTE_STRAIGHT_KEY));

  // Blocked, no account, a move settling: Space plays nothing, so the table does not invite it.
  // An empty roulette table invites chips instead.
  if (start === undefined && !hasKey(keys, "bj-stand") && !hasLayout) {
    return null;
  }

  if (!view.isFocused) {
    return start === undefined && hasLayout ? (
      <Text color={GOLD} bold>
        click the layout to add a chip
      </Text>
    ) : (
      <Text color={FG4}>
        <Text color={GOLD} bold>
          click the table
        </Text>
        {view.isPaneFocused ? " for Space · until then it types in the prompt" : `, then Space to ${again}`}
      </Text>
    );
  }

  const parts: string[] = [];

  if (hasKey(keys, "bj-hit")) {
    parts.push("Space hit");
  }

  if (hasKey(keys, "bj-stand")) {
    parts.push("Enter stand");
  }

  if (hasKey(keys, "bj-double")) {
    parts.push("d double");
  }

  if (hasKey(keys, "bj-split")) {
    parts.push("p split");
  }

  if (hasKey(keys, "bet-up")) {
    parts.push("←/→ bet");
  }

  const stepper = stepperOf(keys);

  if (stepper !== null) {
    parts.push(`↑/↓ ${STEPPER_NAMES[stepper] ?? stepper}`);
  }

  if (keys.some((key) => key.key.startsWith(KENO_PICK_KEY))) {
    parts.push("click a number to pick it");
  }

  if (hasLayout) {
    parts.push("click the layout to add a chip");
  }

  if (start === undefined) {
    return parts.length === 0 ? null : <Text color={FG6}>{parts.join(SEPARATOR)}</Text>;
  }

  return (
    <Text color={FG6}>
      <Text color={view.isSettled && view.isPulseOn ? PINK : GOLD} bold>
        {`Space · ${again}`}
      </Text>
      {`${SEPARATOR}${start.label}`}
      {parts.length > 0 && `${SEPARATOR}${parts.join(SEPARATOR)}`}
    </Text>
  );
}

const ROULETTE_BUTTONS: readonly string[] = ["chip-undo", "chip-clear", "start"];

/** Roulette's buttons under the layout: the last chip back, the table cleared, the spin; none without chips. */
function rouletteButtons(
  ui: Ui,
  keys: readonly TableKey[],
  isFocused: boolean,
  post: (press: string) => void,
): RenderElement | null {
  const { Box, Button, Text } = ui;

  if (!keys.some((key) => key.key === "chip-undo")) {
    return null;
  }

  const buttons = ROULETTE_BUTTONS.flatMap((address) => keys.filter((key) => key.key === address));

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      {buttons.map((button) => (
        <Button key={`table-${button.key}`} plain onPress={() => post(button.key)}>
          <Text color={button.key === "start" ? GOLD : FG4} bold={button.key === "start"}>
            {isFocused ? `${button.hotkey} ${button.label}` : button.label}
          </Text>
        </Button>
      ))}
    </Box>
  );
}

/** A key the plan offers right now at `address` (a tile, a Keno number, a roulette cell), as a Button around its face: a click posts it. */
function tileButton(
  ui: Ui,
  keys: readonly TableKey[],
  address: string,
  face: RenderElement,
  post: (press: string) => void,
) {
  const { Button } = ui;

  return keys.some((key) => key.key === address) ? (
    <Button key={`table-${address}`} plain onPress={() => post(address)}>
      {face}
    </Button>
  ) : null;
}

export default function Table(props: TableProps, surface: ClientSurface<TableState>): RenderElement {
  applyTheme(props.isLight);
  const ui: Ui = surface.elements;
  const { Box, Text } = ui;
  let rt = runtimes.get(surface);

  if (rt === undefined) {
    rt = { props, stopClock: null };
    runtimes.set(surface, rt);
    listen(surface, rt);
  }

  rt.props = props;

  const held = surface.state ?? firstState(props);
  const state = observe(props, held);

  if (state !== surface.state) {
    surface.setState(state);
  }

  // A still board is the pane's to draw: the table only keeps the keys.
  if (props.isKeysOnly) {
    return <Box />;
  }

  if (isAnimating(state, props)) {
    startClock(surface, rt);
  }

  const isPulsing = state.now < state.wokeAt + PULSE_WINDOW_MS;
  const isPulseOn = !isPulsing || Math.floor(state.now / PULSE_BEAT_MS) % 2 === 0;
  const effect = state.effect;
  const sinceEffect = effect === null ? -1 : state.now - effect.at;
  const shake = effect?.kind === "loss" && sinceEffect >= 0 ? shakeAt(sinceEffect) : 0;
  const round = tableRound(props.state, props.prefs);
  const spinning = spinElapsed(state, props);
  const revealed = revealedOf(state);
  const streak = streakOf(state);
  const fx = {
    revealed: revealed < state.cards ? revealed : null,
    isPulseOn,
    spinElapsed: spinning,
    // Only a Mines or tower tile awaiting its draw turns with it: those boards are drawn by the pane.
    frame: 0,
  };
  const post = (press: string) => surface.post({ press });
  // A deal or a one-draw round sent and not on the table yet: its hands face down or its draw to
  // come, nothing of the last round's result.
  const isDealing = props.dealing !== null || props.sending !== null;
  const shown = props.sending === null ? props.state : { ...props.state, round: props.sending };
  // Where nothing is clicked (the main screen), the table has no Buttons and invites no click: the
  // letters of the pane's key line play it.
  const isClickable = props.isClickable;

  const drawnTable =
    props.dealing !== null
      ? dealingTable(ui, props.dealing, props.cards)
      : gameTable(ui, shown, props.prefs, props.columns, fx, props.cards, props.wheel, (address, face) =>
          isClickable ? tileButton(ui, props.keys, address, face, post) : null,
        );
  // A row each, always drawn (the sparkles, the result, the prompt): nothing under the table moves
  // when one comes or goes.
  const invite = isClickable
    ? prompt(ui, props.keys, {
        isFocused: state.isFocused,
        isPaneFocused: props.isPaneFocused,
        isSettled: round?.phase === "idle",
        isPulseOn,
      })
    : null;
  // The last streak is not the round in play's: it waits for this one's result.
  const isStreakShown = !isDealing && fx.revealed === null && spinning === null && streak >= STREAK_SHOWN_FROM;
  const effects = (
    <Box flexDirection="column">
      {celebration(ui, isDealing ? null : round, effect?.kind === "win" ? sinceEffect : null, props.columns - 1)}
      {(!isDealing && summary(ui, state, round, spinning !== null)) || <Text> </Text>}
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {invite}
        {isStreakShown && (
          <Text color={GOLD} bold>
            {`${streak} wins in a row`}
          </Text>
        )}
        {invite === null && !isStreakShown && <Text> </Text>}
      </Box>
      {isClickable && rouletteButtons(ui, props.keys, state.isFocused, post)}
    </Box>
  );

  return (
    <Box flexDirection="column" paddingLeft={shake}>
      {props.isResultFirst && effects}
      {drawnTable}
      {!props.isResultFirst && effects}
    </Box>
  );
}
