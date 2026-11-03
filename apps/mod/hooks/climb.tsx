// Hilo and Tower: a draw per move, a cash-out between moves, as Mines. Drawn still by the pane
// and the table surface module alike.
import type { RenderElement } from "claude-code";

import type { TableFx } from "./blackjack";
import { type CardSize, faceDownCards, faceDownOf, handCards } from "./cards";
import { cardFace, hiloChance, hiloGuessName, shortMultiplier, towerMultiplier } from "./format";
import {
  BOARD_SIDE_COLUMNS,
  boardSide,
  cashOutLine,
  MINE_GLYPH,
  pendingLook,
  SAFE_GLYPH,
  stakeTile,
  TILE_FILL,
  TILE_INK,
  type TileButton,
  type TileLook,
  type TileSize,
} from "./games";
import { TOWER_LEVELS, TOWER_SHAPES, TOWER_TILE_KEY, tileLetter } from "./keys";
import type { Prefs } from "./model";
import type { HiloGuess, HiloView, RoundView, TowerView } from "./protocol";
import { FG1, FG4, FG6, GOLD, GREEN, PINK, RED, type Ui } from "./theme";

const isOpen = (round: RoundView): boolean => round.phase !== "idle";

/** Large cards on the table: the last ones drawn, the current one last. */
const HILO_SHOWN = 8;
/** Cards the history under them recalls, the guess that drew each before it. */
const HILO_HISTORY = 12;
const GUESS_GLYPHS: Record<HiloGuess, string> = { higher: "▲", lower: "▼", skip: "⇥" };
/** A card in the history not turned over yet. */
const HIDDEN_FACE = "▒▒";

/** Right guesses so far: every guess but the skips, and the wrong one that busted. */
export function hiloRight(detail: HiloView): number {
  return detail.guesses.filter((guess) => guess !== "skip").length - (detail.busted ? 1 : 0);
}

/**
 * "K♠ ▼ 9♥ ▲ Q♦ ▲ ▒▒": the last cards drawn, each after the guess that drew it, a right guess in
 * green, the wrong one in red; a card face down or on its way shows its back.
 */
function hiloHistory(ui: Ui, detail: HiloView, faceDown: number): RenderElement {
  const { Text } = ui;
  const from = Math.max(0, detail.cards.length - HILO_HISTORY);
  const firstHidden = detail.cards.length - faceDown;
  // A guess whose card is not turned over yet stays grey: its colour would tell the card first.
  const glyph = (guess: HiloGuess, isHidden: boolean, isWrong: boolean) => (
    <Text color={guess === "skip" || isHidden ? FG6 : isWrong ? RED : GREEN} bold={isWrong}>
      {`${GUESS_GLYPHS[guess]} `}
    </Text>
  );
  const cards = detail.cards.slice(from).map((card, offset) => {
    const index = from + offset;
    const guess = offset === 0 ? undefined : detail.guesses[index - 1];
    const isHidden = index >= firstHidden;
    const isWrong = detail.busted && index === detail.cards.length - 1 && !isHidden;

    return (
      <Text>
        {offset > 0 && " "}
        {guess !== undefined && glyph(guess, isHidden, isWrong)}
        <Text color={isHidden ? FG6 : FG4}>{isHidden ? HIDDEN_FACE : cardFace(card)}</Text>
      </Text>
    );
  });

  return (
    <Text color={FG6}>
      {from > 0 && `+${from} · `}
      {cards}
      {detail.pending !== null && (
        <Text>
          {detail.cards.length > 0 && " "}
          {glyph(detail.pending, true, false)}
          {HIDDEN_FACE}
        </Text>
      )}
    </Text>
  );
}

/** A guess the player can make: what it is called on this card, its chance and what it pays. */
function hiloOffer(ui: Ui, guess: "higher" | "lower", rank: number, multiplier: string | null): RenderElement | null {
  const { Text } = ui;

  if (multiplier === null) {
    return null;
  }

  return (
    <Text color={FG4}>
      {`${GUESS_GLYPHS[guess]} ${hiloGuessName(guess, rank)} `}
      <Text color={FG6}>{`${hiloChance(guess, rank)}% `}</Text>
      <Text color={FG1} bold>
        {`×${shortMultiplier(multiplier)}`}
      </Text>
    </Text>
  );
}

/** Whose move it is: the player's, a card on its way, or how the round ended once its last card shows. */
function hiloState(ui: Ui, round: RoundView, detail: HiloView, isTurning: boolean, isPulseOn: boolean): RenderElement {
  const { Text } = ui;

  if (isTurning) {
    const pending = detail.pending;
    const rank = detail.cards.at(-1)?.rank ?? 0;
    const name = pending === null || pending === "skip" ? pending : hiloGuessName(pending, rank);

    return <Text color={FG4}>{`drawing…${pending === null ? "" : ` ${GUESS_GLYPHS[pending]} ${name}`}`}</Text>;
  }

  if (round.phase === "player_turn") {
    return (
      <Text color={isPulseOn ? PINK : GOLD} bold>
        YOUR TURN
      </Text>
    );
  }

  return detail.busted ? (
    <Text color={RED} bold>
      WRONG GUESS
    </Text>
  ) : (
    <Text color={GOLD} bold>
      {`CASHED OUT ×${shortMultiplier(detail.multiplier)}`}
    </Text>
  );
}

/**
 * The last cards drawn, the current one last, and a back where the next is on its way; the
 * round's history under them. Beside them the multiplier, whose move it is, and on the player's
 * turn each guess at its chance and what it pays, and the cash-out. A new card lies face down a
 * step before it turns over, as blackjack deals (`fx.revealed`): until then nothing it decides shows.
 */
export function hiloTable(ui: Ui, round: RoundView | null, fx: TableFx, size: CardSize): RenderElement {
  const { Box, Text } = ui;
  const detail = round?.detail.game === "hilo" ? round.detail : null;

  if (round === null || detail === null) {
    return (
      <Text color={FG6}>
        Guess whether the next card is higher or lower: each right guess raises the multiplier. Start with n.
      </Text>
    );
  }

  const turning = faceDownOf(
    detail.cards.map((_, index) => index),
    fx.revealed,
  );
  const isDrawing = detail.pending !== null || (round.phase === "drawing" && detail.cards.length === 0);
  const isTurning = isDrawing || turning > 0;
  const cards = [...detail.cards, ...faceDownCards(isDrawing ? 1 : 0)];
  const from = Math.max(0, cards.length - HILO_SHOWN);
  const rank = detail.cards.at(-1)?.rank ?? 0;
  const isTurn = round.phase === "player_turn" && !isTurning;
  const right = hiloRight(detail);

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
      <Box flexDirection="column">
        {/* Small, the history alone: a row of small cards over it would show each card twice. */}
        {size === "large" && handCards(ui, cards.slice(from), size, { faceDown: turning + (isDrawing ? 1 : 0) })}
        {hiloHistory(ui, detail, turning)}
      </Box>
      <Box flexDirection="column">
        <Text color={FG4}>
          multiplier {/* A bust pays nothing; before a right guess there is no multiplier to cash out yet. */}
          <Text color={detail.busted && turning === 0 ? RED : FG1} bold>
            {turning > 0 ? "×…" : detail.busted ? "×0" : right === 0 ? "×—" : `×${shortMultiplier(detail.multiplier)}`}
          </Text>
        </Text>
        {hiloState(ui, round, detail, isTurning, fx.isPulseOn)}
        {isTurn && hiloOffer(ui, "higher", rank, detail.higherMultiplier)}
        {isTurn && hiloOffer(ui, "lower", rank, detail.lowerMultiplier)}
        {isTurn && <Text color={FG6}>{`${GUESS_GLYPHS.skip} skip · ${detail.skipsLeft} left`}</Text>}
        {isOpen(round) &&
          right > 0 &&
          turning === 0 &&
          cashOutLine(ui, round.stake, detail.multiplier, detail.canCashOut)}
        {turning === 0 && <Text color={FG6}>{`${right} right`}</Text>}
      </Box>
    </Box>
  );
}

/**
 * A tower tile: a row, wider than tall, as Stake's; narrower compact. The nine levels touch, to fit
 * any pane: alternate hidden levels take the second shade, the multipliers on the left part them too.
 */
const TOWER_TILE: Record<CardSize, TileSize> = {
  large: { columns: 7, hasEdge: false },
  small: { columns: 5, hasEdge: false },
};

/** The tower round to show: the open one, or the last one while the next is played at its difficulty. */
function shownTower(round: RoundView | null, prefs: Prefs): TowerView | null {
  const detail = round?.detail.game === "tower" ? round.detail : null;

  return round !== null && detail !== null && (isOpen(round) || detail.difficulty === prefs.towerDifficulty)
    ? detail
    : null;
}

/**
 * Nine levels, the top first, each with what reaching it pays on its left. Climbed levels show the
 * tile picked as a gem, the others dark; the level being played is lit and offers its tiles, the
 * one being drawn pulsing; a bust shows the mine where it fell. Nothing else is known: each climb
 * draws on its own, no level is laid out ahead. Every state takes the same rows.
 */
export function towerTable(
  ui: Ui,
  round: RoundView | null,
  prefs: Prefs,
  frame: number,
  size: CardSize,
  tileButton: TileButton,
): RenderElement {
  const { Box, Text } = ui;
  const detail = shownTower(round, prefs);
  const difficulty = detail?.difficulty ?? prefs.towerDifficulty;
  const { tiles, safe } = TOWER_SHAPES[difficulty];
  const climbed = detail?.climbed ?? [];
  const isPlaying = round !== null && detail !== null && isOpen(round);
  const tileSize = TOWER_TILE[size];
  const plain = (fill: string): TileLook => ({ fill, glyph: null, ink: TILE_INK.letter });
  const tileCell = (level: number, tile: number): RenderElement => {
    if (level < climbed.length) {
      return climbed[level] === tile
        ? stakeTile(ui, tileSize, { fill: TILE_FILL.safe, glyph: SAFE_GLYPH, ink: TILE_INK.gem }, null, tileButton)
        : stakeTile(ui, tileSize, plain(TILE_FILL.dark), null, tileButton);
    }

    if (level > climbed.length || detail === null) {
      return stakeTile(ui, tileSize, plain(level % 2 === 1 ? TILE_FILL.hiddenAlt : TILE_FILL.hidden), null, tileButton);
    }

    if (detail.busted === tile) {
      return stakeTile(ui, tileSize, { fill: TILE_FILL.mine, glyph: MINE_GLYPH, ink: TILE_INK.mine }, null, tileButton);
    }

    if (detail.pending === tile) {
      return stakeTile(ui, tileSize, pendingLook(frame), null, tileButton);
    }

    const key = isPlaying ? { address: `${TOWER_TILE_KEY}${tile}`, letter: tileLetter(tile) } : null;

    return stakeTile(ui, tileSize, plain(isPlaying ? TILE_FILL.lit : TILE_FILL.hidden), key, tileButton);
  };
  const pays = Array.from({ length: TOWER_LEVELS }, (_, level) => `×${towerMultiplier(tiles, safe, level + 1)}`);
  const paysWidth = Math.max(...pays.map((pay) => pay.length));
  const rows = Array.from({ length: TOWER_LEVELS }, (_, index) => {
    const level = TOWER_LEVELS - 1 - index;
    const isReached = level < climbed.length;
    const isCurrent = level === climbed.length && isPlaying;

    return (
      <Box flexDirection="row" columnGap={1}>
        <Text color={isCurrent ? PINK : isReached ? GOLD : FG6} bold={isCurrent || isReached}>
          {(pays[level] ?? "").padStart(paysWidth)}
        </Text>
        {Array.from({ length: tiles }, (_, tile) => tileCell(level, tile))}
      </Box>
    );
  });

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={4} justifyContent="center">
      <Box flexDirection="column">{rows}</Box>
      <Box flexDirection="column" width={BOARD_SIDE_COLUMNS}>
        <Text color={FG4}>
          <Text color={PINK} bold>
            {difficulty}
          </Text>
          {` · ${safe} safe of ${tiles}`}
        </Text>
        {round === null || detail === null ? (
          <Text color={FG6}>Pick the difficulty with j and k, then play with n.</Text>
        ) : (
          boardSide(ui, round, {
            multiplier: detail.multiplier,
            nextMultiplier: detail.nextMultiplier,
            canCashOut: detail.canCashOut,
            isBusted: detail.busted !== null,
            safe: climbed.length,
            nextLabel: "next level",
            safeLabel: `${climbed.length} ${climbed.length === 1 ? "level" : "levels"}`,
          })
        )}
      </Box>
    </Box>
  );
}
