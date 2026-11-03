// Cards and hand rows, shared by blackjack and baccarat.
import type { RenderElement } from "claude-code";

import { cardFace, isRedSuit, rankLabel } from "./format";
import type { Card, RoundView } from "./protocol";
import { CARD_FACE, CARD_INK, FG1, FG4, FG6, GOLD, LINE4, RED, type Ui } from "./theme";

export const BLACKJACK = 21;
const NATURAL_CARDS = 2;

/** `large`: the design system's five-row card; `small`: one row, where the large ones do not fit. */
export type CardSize = "large" | "small";

export const LARGE_CARD_ROWS = 5;
const LARGE_CARD_COLUMNS = 7;
/** A large card under the next one shows this much of its left edge: its corner, rank and suit. */
const LARGE_CARD_PEEK = 4;

/** The columns a hand of `count` large cards takes, each overlapped by the next. */
export const largeHandColumns = (count: number): number =>
  count === 0 ? 0 : LARGE_CARD_PEEK * (count - 1) + LARGE_CARD_COLUMNS;

const BACK_ROW = "░".repeat(LARGE_CARD_COLUMNS - 2);
const BACK_ART = ["╭─────╮", `│${BACK_ROW}│`, `│${BACK_ROW}│`, `│${BACK_ROW}│`, "╰─────╯"];

/** One card turned over every step, on the fullscreen table and on the main screen alike. */
export const DEAL_STEP_MS = 150;

/** A round's first cards turn from the first one at once (they lay face down while the move was in
 *  flight); a card drawn into a round in play lies face down a step first, so its face never shows in
 *  the frame it lands. */
const leadOf = (from: number): number => (from === 0 ? 1 : 0);

/** Cards turned over `elapsed` ms into a deal that found `from` of `total` already shown; null once all are. */
export function revealedAt(from: number, total: number, elapsed: number): number | null {
  const revealed = from + leadOf(from) + Math.floor(elapsed / DEAL_STEP_MS);

  return revealed >= total ? null : revealed;
}

/** How long after a deal starts its last card is turned over. */
export const dealMs = (from: number, total: number): number => Math.max(0, total - from - leadOf(from)) * DEAL_STEP_MS;

/** The cards on a blackjack, baccarat or Hilo table, all hands together; 0 for the other games. */
export function dealtCards(round: RoundView | null): number {
  const detail = round?.detail;

  switch (detail?.game) {
    case "blackjack":
      return detail.hands.reduce((sum, hand) => sum + hand.cards.length, detail.dealer.length);
    case "baccarat":
      return detail.player.length + detail.banker.length;
    case "hilo":
      return detail.cards.length;
    default:
      return 0;
  }
}

/** Cards not drawn yet, to lay face down (`faceDown`) where they will fall: their faces are never shown. */
export const faceDownCards = (count: number): Card[] =>
  Array.from({ length: count }, (): Card => ({ rank: 1, suit: "♠" }));

/** How many of a hand's cards, dealt at these places in the deal, are still face down. */
export const faceDownOf = (order: readonly number[], revealed: number | null): number =>
  revealed === null ? 0 : order.filter((index) => index >= revealed).length;

function faceArt(card: Card): string[] {
  const corner = `${rankLabel(card.rank)}${card.suit}`;

  return [
    "╭─────╮",
    `│${corner.padEnd(5)}│`,
    `│  ${card.suit}  │`,
    `│${`${card.suit}${rankLabel(card.rank)}`.padStart(5)}│`,
    "╰─────╯",
  ];
}

/** One large card, cut to its peek when `isCovered`: the next card lies over the rest. */
function largeCard(ui: Ui, art: readonly string[], color: string, isCovered: boolean, isFace: boolean): RenderElement {
  const { Box, Text } = ui;

  return (
    <Box flexDirection="column">
      {art.map((line, row) => (
        <Text color={color} bold={isFace && (row === 1 || row === 3)}>
          {isCovered ? [...line].slice(0, LARGE_CARD_PEEK).join("") : line}
        </Text>
      ))}
    </Box>
  );
}

/** A hand of large cards, each overlapped by the next, so ten cards fit in 43 columns. */
export function cardStack(ui: Ui, cards: readonly Card[], options: CardRowOptions = {}): RenderElement {
  const { Box } = ui;
  const firstHidden = cards.length - (options.faceDown ?? 0);
  const drawn: { art: readonly string[]; color: string; isFace: boolean }[] = cards.map((card, index) =>
    index >= firstHidden
      ? { art: BACK_ART, color: FG6, isFace: false }
      : { art: faceArt(card), color: isRedSuit(card.suit) ? RED : FG1, isFace: true },
  );

  if (options.isMoreToCome === true) {
    drawn.push({ art: BACK_ART, color: FG6, isFace: false });
  }

  return (
    <Box flexDirection="row">
      {drawn.map((card, index) => largeCard(ui, card.art, card.color, index < drawn.length - 1, card.isFace))}
    </Box>
  );
}

/** A hand at the size asked for. */
export function handCards(ui: Ui, cards: readonly Card[], size: CardSize, options: CardRowOptions = {}): RenderElement {
  return size === "large" ? cardStack(ui, cards, options) : cardRow(ui, cards, options);
}

export interface CardRowOptions {
  /** The last this many cards are drawn face down: dealt, not turned over yet. */
  faceDown?: number;
  /** A "?" after the cards: the dealer's second card, not drawn yet. */
  isMoreToCome?: boolean;
}

export function cardRow(ui: Ui, cards: readonly Card[], options: CardRowOptions = {}): RenderElement {
  const { Box, Text } = ui;
  const firstHidden = cards.length - (options.faceDown ?? 0);

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      {cards.map((card, index) =>
        index >= firstHidden ? (
          <Text backgroundColor={LINE4} color={FG6}>
            {" ▒▒ "}
          </Text>
        ) : (
          <Text backgroundColor={CARD_FACE} color={CARD_INK[isRedSuit(card.suit) ? "red" : "black"]} bold>
            {` ${cardFace(card)} `}
          </Text>
        ),
      )}
      {options.isMoreToCome === true && (
        <Text backgroundColor={LINE4} color={FG4}>
          {" ? "}
        </Text>
      )}
    </Box>
  );
}

/** A total's verdict, drawn beside it: over 21 busts, 21 on the first two cards is a blackjack,
 * unless `canBeNatural` is false (a hand born from a split: its 21 is a plain 21). */
export function handTag(ui: Ui, total: number, cardCount: number, canBeNatural = true): RenderElement | null {
  const { Text } = ui;

  if (total > BLACKJACK) {
    return (
      <Text color={RED} bold>
        {" BUST"}
      </Text>
    );
  }

  if (canBeNatural && total === BLACKJACK && cardCount === NATURAL_CARDS) {
    return (
      <Text color={GOLD} bold>
        {" BLACKJACK"}
      </Text>
    );
  }

  return null;
}

/** Who, the total and its verdict, then the cards: beside them when small, above them when large. */
export function handRow(
  ui: Ui,
  hand: { label: string; total: string; tag: RenderElement | null },
  cards: RenderElement,
  size: CardSize = "small",
): RenderElement {
  const { Box, Text } = ui;

  return (
    <Box flexDirection={size === "large" ? "column" : "row"} flexWrap="wrap" columnGap={2}>
      <Text color={FG4}>
        {hand.label} <Text color={FG1}>{hand.total}</Text>
        {hand.tag}
      </Text>
      {cards}
    </Box>
  );
}
