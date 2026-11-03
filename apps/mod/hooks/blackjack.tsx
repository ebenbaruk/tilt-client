// The blackjack table: one dealer row over one to ten hands (up to six dealt, plus the splits),
// side by side as far as the width allows, then wrapped. Drawn still by the pane, and frame by
// frame by the table surface module.
import type { RenderElement } from "claude-code";

import { BLACKJACK, type CardSize, faceDownOf, handCards, handRow, handTag, largeHandColumns } from "./cards";
import { formatUsdc, SEPARATOR } from "./format";
import type { BlackjackHandView, BlackjackResult, BlackjackView, RoundView } from "./protocol";
import { FG1, FG4, FG6, GOLD, GREEN, PINK, RED, type Ui } from "./theme";

/** A hand's column: room for three small cards, "▶ #6 21 BLACKJACK" or "▶ #10 soft 17 split". */
const HAND_COLUMNS = 20;
/** The rank the api sends for an ace. */
const ACE_RANK = 1;

/** The columns a hand takes on the table, its cards at `size`. */
export const handColumns = (cardCount: number, size: CardSize): number =>
  size === "large" ? Math.max(HAND_COLUMNS, largeHandColumns(cardCount)) : HAND_COLUMNS;

/** What moves on the table between two still frames; `STILL` draws it at rest. */
export interface TableFx {
  /** Blackjack or baccarat cards turned over so far, in deal order (each game's dealOrder); null when all are. */
  revealed: number | null;
  /** The active hand's highlight is on its bright beat. */
  isPulseOn: boolean;
  /** How far into its spin a roulette or slots round is; null when it has landed. */
  spinElapsed: number | null;
  /** The spinner's frame: a Mines tile awaiting its draw turns with it. */
  frame: number;
}

export const STILL: TableFx = { revealed: null, isPulseOn: true, spinElapsed: null, frame: 0 };

const RESULTS: Record<BlackjackResult, { label: string; color: string }> = {
  blackjack: { label: "BJ", color: GOLD },
  win: { label: "WIN", color: GREEN },
  push: { label: "PUSH", color: FG4 },
  lose: { label: "LOSE", color: RED },
};

/** Where each card falls in the deal: a first card to every hand, the dealer's, a second to every
 * dealt hand, then what each hand drew, left to right, and the dealer's draw last. A hand born
 * from a split holds one card of the pair: its second card is a draw. */
function dealOrder(detail: BlackjackView): { hands: number[][]; dealer: number[] } {
  let next = 0;
  const hands: number[][] = detail.hands.map(() => []);
  const dealer: number[] = [];
  const dealTo = (place: number[], count: number, from: number, to: number) => {
    for (let card = from; card < Math.min(count, to); card++) {
      place.push(next++);
    }
  };

  detail.hands.forEach((hand, index) => dealTo(hands[index] ?? [], hand.cards.length, 0, 1));
  dealTo(dealer, detail.dealer.length, 0, 1);
  detail.hands.forEach((hand, index) => {
    if (!hand.split) {
      dealTo(hands[index] ?? [], hand.cards.length, 1, 2);
    }
  });
  detail.hands.forEach((hand, index) => dealTo(hands[index] ?? [], hand.cards.length, hand.split ? 1 : 2, Infinity));
  dealTo(dealer, detail.dealer.length, 1, Infinity);

  return { hands, dealer };
}

interface HandPlace {
  index: number;
  /** Cards of this hand still face down. */
  faceDown: number;
  /** The dealer's cards are all face up: a hand's result is known only then. */
  isDealerShown: boolean;
  size: CardSize;
}

function handColumn(
  ui: Ui,
  detail: BlackjackView,
  hand: BlackjackHandView,
  place: HandPlace,
  fx: TableFx,
): RenderElement {
  const { Box, Text } = ui;
  const { index, faceDown, isDealerShown, size } = place;
  const isActive = detail.activeHand === index;
  const isTurned = faceDown === 0;
  const label = detail.hands.length === 1 ? "YOU" : `#${index + 1}`;
  const total = isTurned ? `${hand.soft ? "soft " : ""}${hand.total}` : "";
  const highlight = fx.isPulseOn ? PINK : GOLD;
  // Split aces take one card each and are finished: said on the hand, or it looks like a stand.
  const isSplitAces = hand.split && hand.cards[0]?.rank === ACE_RANK;
  const stake = `${formatUsdc(hand.stake)}${hand.doubled ? " doubled" : ""}${isSplitAces ? " · 1 card" : ""}`;
  // WIN, BJ or LOSE waits for the dealer's cards too: it would tell the hole card first.
  const result = hand.result === null || !isTurned || !isDealerShown ? null : RESULTS[hand.result];

  return (
    <Box flexDirection="column" width={handColumns(hand.cards.length, size)}>
      <Text color={isActive ? highlight : FG4} bold={isActive}>
        {isActive ? "▶ " : ""}
        {label} <Text color={FG1}>{total}</Text>
        {isTurned && handTag(ui, hand.total, hand.cards.length, !hand.split)}
        {hand.split && <Text color={FG6}>{" split"}</Text>}
      </Text>
      {handCards(ui, hand.cards, size, { faceDown })}
      {result === null ? (
        <Text color={FG6}>{`bet ${stake}`}</Text>
      ) : (
        <Text color={FG6}>
          <Text color={result.color} bold>
            {result.label}
          </Text>
          {` ${stake}`}
        </Text>
      )}
    </Box>
  );
}

export function blackjackTable(ui: Ui, round: RoundView | null, fx: TableFx, size: CardSize): RenderElement {
  const { Box, Text } = ui;

  if (round === null || round.detail.game !== "blackjack") {
    return <Text color={FG4}>No hand yet. Deal one with n.</Text>;
  }

  const detail = round.detail;
  const order = dealOrder(detail);
  const dealerFaceDown = faceDownOf(order.dealer, fx.revealed);
  const isMoreToCome = round.phase === "player_turn" && detail.dealer.length === 1;
  const dealerTotal = dealerFaceDown > 0 ? "" : isMoreToCome ? `${detail.dealerTotal} + ?` : String(detail.dealerTotal);

  return (
    <Box flexDirection="column" gap={1}>
      {handRow(
        ui,
        {
          label: "DEALER",
          total: dealerTotal,
          tag: isMoreToCome || dealerFaceDown > 0 ? null : handTag(ui, detail.dealerTotal, detail.dealer.length),
        },
        handCards(ui, detail.dealer, size, { faceDown: dealerFaceDown, isMoreToCome }),
        size,
      )}
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} rowGap={1}>
        {detail.hands.map((hand, index) =>
          handColumn(
            ui,
            detail,
            hand,
            {
              index,
              faceDown: faceDownOf(order.hands[index] ?? [], fx.revealed),
              isDealerShown: dealerFaceDown === 0,
              size,
            },
            fx,
          ),
        )}
      </Box>
    </Box>
  );
}

const COUNT_WORDS: Record<BlackjackResult, string> = {
  blackjack: "blackjack",
  win: "won",
  push: "push",
  lose: "lost",
};

/** A settled round in a sentence: "19 beats 17." for one hand, "Dealer 17 · 2 won · 1 lost." for
 * more, "Dealer 17 · 3 split hands · 2 won · 1 lost." when some were born from a split. */
export function blackjackOutcome(detail: BlackjackView, net: string): string {
  const dealer = detail.dealerTotal;
  const [only] = detail.hands;

  if (detail.hands.length === 1 && only !== undefined) {
    const you = only.total;

    if (you > BLACKJACK) {
      return `Bust at ${you}.`;
    }

    if (dealer > BLACKJACK) {
      return `Dealer busts at ${dealer}.`;
    }

    if (BigInt(net) === 0n) {
      return `Push at ${you}.`;
    }

    return BigInt(net) > 0n ? `${you} beats ${dealer}.` : `Dealer ${dealer} beats ${you}.`;
  }

  const counts = (Object.keys(COUNT_WORDS) as BlackjackResult[])
    .map((result) => [detail.hands.filter((hand) => hand.result === result).length, COUNT_WORDS[result]] as const)
    .filter(([count]) => count > 0)
    .map(([count, word]) => `${count} ${word}`);
  const head = dealer > BLACKJACK ? `Dealer busts at ${dealer}` : `Dealer ${dealer}`;
  const splitHands = detail.hands.filter((hand) => hand.split).length;
  const splits = splitHands === 0 ? [] : [`${splitHands} split ${splitHands === 1 ? "hand" : "hands"}`];

  return `${[head, ...splits, ...counts].join(SEPARATOR)}.`;
}

/** The hands for the band: "you 11 · dealer 9", or "hands 11 ▶19 24 · dealer 9". */
export function blackjackSummary(detail: BlackjackView): string {
  const totals = detail.hands.map((hand, index) => `${index === detail.activeHand ? "▶" : ""}${hand.total}`);
  const you = detail.hands.length === 1 ? `you ${detail.hands[0]?.total ?? ""}` : `hands ${totals.join(" ")}`;

  return `${you}${SEPARATOR}dealer ${detail.dealerTotal}`;
}
