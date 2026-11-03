// Blackjack, baccarat and Hilo as plain text lines: what the mod's card tables show, without the
// card art. A card is its face ("A♠", "10♥"), red suits in red.
import {
  cardFace,
  cashOutPayout,
  formatSigned,
  formatUsdc,
  hiloChance,
  hiloGuessName,
  isRedSuit,
  SEPARATOR,
  shortMultiplier,
} from "../../../../apps/mod/hooks/format";
import { CASH_OUT_HOTKEY, clampHands } from "../../../../apps/mod/hooks/keys";
import type {
  BaccaratBet,
  BaccaratView,
  BlackjackHandView,
  BlackjackResult,
  BlackjackView,
  Card,
  HiloGuess,
  HiloView,
  RoundView,
} from "../../../../apps/mod/hooks/protocol";
import type { RenderContext } from "../types";
import { bold, dim, fit, gold, green, pink, red, visibleWidth } from "./style";

const BLACKJACK = 21;
const ACE_RANK = 1;
/** Hilo cards kept in the trail before older ones fold into "+n · ". */
const HILO_HISTORY = 12;
const HILO_GLYPHS: Record<HiloGuess, string> = { higher: "▲", lower: "▼", skip: "⇥" };
/** A card on its way, not drawn yet. */
const HIDDEN_FACE = "▒▒";
const BACCARAT_FIRST_CARDS = 2;
const NATURAL_POINTS = 8;
/** What each bet returns, times the stake, when its side wins, as `games/baccarat.rs` pays it. Shown only; the program pays. */
const BACCARAT_PAYS: Record<BaccaratBet, string> = { player: "2", banker: "1.95", tie: "9" };

/** Cut, never padded: the panel pads; a renderer only keeps within the width. */
const clip = (line: string, width: number): string => (visibleWidth(line) > width ? fit(line, width) : line);

const face = (color: boolean, card: Card): string =>
  isRedSuit(card.suit) ? red(color, cardFace(card)) : cardFace(card);

const faces = (color: boolean, cards: readonly Card[]): string => cards.map((card) => face(color, card)).join(" ");

/** "WIN +1.00" in green, "LOSE −1.00" in red, "PUSH 0.00" dim: a settled round's net. */
function verdict(color: boolean, net: string): string {
  const value = BigInt(net);

  if (value > 0n) return green(color, bold(color, `WIN ${formatSigned(net)}`));
  if (value < 0n) return red(color, bold(color, `LOSE ${formatSigned(net)}`));
  return dim(color, `PUSH ${formatSigned(net)}`);
}

// ---- Blackjack ----

const HAND_RESULTS: Record<BlackjackResult, { label: string; paint: (color: boolean, text: string) => string }> = {
  blackjack: { label: "BJ", paint: gold },
  win: { label: "WIN", paint: green },
  push: { label: "PUSH", paint: dim },
  lose: { label: "LOSE", paint: red },
};

function handTotal(hand: BlackjackHandView): string {
  if (hand.cards.length === 0) return "";
  if (hand.total > BLACKJACK) return `${hand.total} bust`;
  return `${hand.soft ? "soft " : ""}${hand.total}`;
}

function handLine(color: boolean, detail: BlackjackView, hand: BlackjackHandView, index: number): string {
  const isActive = detail.activeHand === index;
  const label = detail.hands.length === 1 ? "YOU" : `#${index + 1}`;
  const head = `${isActive ? "▶ " : "  "}${label} ${handTotal(hand)}`.trimEnd();
  // Split aces take one card each and are finished: said on the hand, or it looks like a stand.
  const isSplitAces = hand.split && hand.cards[0]?.rank === ACE_RANK;
  const marks = [hand.doubled ? "doubled" : "", hand.split ? "split" : "", isSplitAces ? "1 card" : ""].filter(Boolean);
  const stake = dim(color, [`bet ${formatUsdc(hand.stake)}`, ...marks].join(" "));
  const result =
    hand.result === null
      ? ""
      : `  ${HAND_RESULTS[hand.result].paint(color, bold(color, HAND_RESULTS[hand.result].label))}`;

  return `${isActive ? pink(color, bold(color, head)) : head}  ${faces(color, hand.cards)}  ${stake}${result}`;
}

function dealerLine(color: boolean, round: RoundView, detail: BlackjackView): string {
  if (detail.dealer.length === 0) return `DEALER  ${dim(color, "dealing…")}`;

  const isMoreToCome = round.phase === "player_turn" && detail.dealer.length === 1;
  const total = isMoreToCome
    ? `${detail.dealerTotal} + ?`
    : `${detail.dealerTotal}${detail.dealerTotal > BLACKJACK ? " bust" : ""}`;
  const hole = isMoreToCome ? ` ${dim(color, HIDDEN_FACE)}` : "";

  return `DEALER ${bold(color, total)}  ${faces(color, detail.dealer)}${hole}`;
}

/** The dealer over one line per hand (ten at most: six dealt and four splits), then the round's net once settled. */
export function renderBlackjack(round: RoundView | null, ctx: RenderContext): string[] {
  const { color, width } = ctx;

  if (round === null || round.detail.game !== "blackjack") {
    const hands = clampHands(ctx.prefs.hands);

    return [
      `DEALER  ${dim(color, "no hand yet")}`,
      `${hands} ${hands === 1 ? "hand" : "hands"} ${dim(color, "· pick the bet and the hands, then deal with n")}`,
    ].map((line) => clip(line, width));
  }

  const detail = round.detail;
  const lines = [
    dealerLine(color, round, detail),
    ...detail.hands.map((hand, index) => handLine(color, detail, hand, index)),
  ];

  if (round.phase === "idle") lines.push(verdict(color, round.net));
  if (round.phase === "drawing" && detail.dealer.length > 0) lines.push(dim(color, "drawing…"));

  return lines.map((line) => clip(line, width));
}

// ---- Baccarat ----

const winnerOf = ({ playerPoints, bankerPoints }: BaccaratView): BaccaratBet =>
  playerPoints === bankerPoints ? "tie" : playerPoints > bankerPoints ? "player" : "banker";

const betLine = (color: boolean, bet: BaccaratBet): string =>
  `bet ${bold(color, bet)} ${dim(color, `${SEPARATOR.trim()} pays ×${BACCARAT_PAYS[bet]}`)}`;

function sideLine(
  color: boolean,
  label: string,
  name: BaccaratBet,
  cards: readonly Card[],
  points: number,
  winner: BaccaratBet | null,
): string {
  const tags = [
    winner === name ? gold(color, bold(color, "WINS")) : "",
    winner === "tie" ? bold(color, "TIE") : "",
    winner !== null && cards.length === BACCARAT_FIRST_CARDS && points >= NATURAL_POINTS
      ? gold(color, bold(color, "NATURAL"))
      : "",
  ].filter(Boolean);

  return [`${label} ${bold(color, String(points))}`, faces(color, cards), ...tags].join("  ");
}

/** The side backed and what it pays, then the player's and the banker's cards and points, the winner once shown. */
export function renderBaccarat(round: RoundView | null, ctx: RenderContext): string[] {
  const { color, width } = ctx;

  if (round === null || round.detail.game !== "baccarat") {
    return [betLine(color, ctx.prefs.baccarat), dim(color, "Pick player, banker or tie, then deal with n.")].map(
      (line) => clip(line, width),
    );
  }

  const detail = round.detail;

  if (detail.player.length === 0) {
    return [
      betLine(color, detail.bet),
      `PLAYER  ${dim(color, `${HIDDEN_FACE} ${HIDDEN_FACE}`)}`,
      `BANKER  ${dim(color, `${HIDDEN_FACE} ${HIDDEN_FACE}`)}`,
      dim(color, "dealing…"),
    ].map((line) => clip(line, width));
  }

  const isSettled = round.phase === "idle";
  const winner = isSettled ? winnerOf(detail) : null;
  const head = isSettled ? `bet ${bold(color, detail.bet)}  ${verdict(color, round.net)}` : betLine(color, detail.bet);

  return [
    head,
    sideLine(color, "PLAYER", "player", detail.player, detail.playerPoints, winner),
    sideLine(color, "BANKER", "banker", detail.banker, detail.bankerPoints, winner),
  ].map((line) => clip(line, width));
}

// ---- Hilo ----

/** Right guesses so far: every guess but the skips, less the wrong one that busted. */
const hiloRight = (detail: HiloView): number =>
  detail.guesses.filter((guess) => guess !== "skip").length - (detail.busted ? 1 : 0);

/** "K♠ ▼ 9♥ ▲ Q♦ ▲ ▒▒": each card after the guess that drew it, right in green, the wrong one in red. */
function hiloTrail(color: boolean, detail: HiloView, width: number): string {
  const tokens = detail.cards.map((card, index) => {
    const guess = index === 0 ? undefined : detail.guesses[index - 1];
    const isWrong = detail.busted && index === detail.cards.length - 1;
    const glyph =
      guess === undefined ? "" : `${(guess === "skip" ? dim : isWrong ? red : green)(color, HILO_GLYPHS[guess])} `;

    return `${glyph}${face(color, card)}`;
  });

  if (detail.pending !== null) tokens.push(dim(color, `${HILO_GLYPHS[detail.pending]} ${HIDDEN_FACE}`));
  if (tokens.length === 0) return dim(color, HIDDEN_FACE);

  // Oldest cards fold first, so the current card always shows.
  let from = Math.max(0, tokens.length - HILO_HISTORY);
  const line = (start: number) => `${start > 0 ? dim(color, `+${start} · `) : ""}${tokens.slice(start).join(" ")}`;

  while (from < tokens.length - 1 && visibleWidth(line(from)) > width) from += 1;

  return line(from);
}

function hiloMultiplier(color: boolean, detail: HiloView, right: number): string {
  if (detail.busted) return red(color, bold(color, "×0"));
  return bold(color, right === 0 ? "×—" : `×${shortMultiplier(detail.multiplier)}`);
}

function hiloStatus(color: boolean, round: RoundView, detail: HiloView): string {
  const rank = detail.cards.at(-1)?.rank ?? 0;

  if (detail.pending !== null) {
    const name = detail.pending === "skip" ? "skip" : hiloGuessName(detail.pending, rank);
    return dim(color, `drawing… ${HILO_GLYPHS[detail.pending]} ${name}`);
  }

  if (round.phase === "drawing") return dim(color, "drawing…");
  if (round.phase === "player_turn") return pink(color, bold(color, "YOUR TURN"));
  if (detail.busted) return `${red(color, bold(color, "WRONG GUESS"))}  ${verdict(color, round.net)}`;
  return `${gold(color, bold(color, `CASHED OUT ×${shortMultiplier(detail.multiplier)}`))}  ${verdict(color, round.net)}`;
}

function hiloOffer(color: boolean, guess: "higher" | "lower", rank: number, multiplier: string | null): string | null {
  if (multiplier === null) return null;

  return `${HILO_GLYPHS[guess]} ${hiloGuessName(guess, rank)} ${dim(color, `${hiloChance(guess, rank)}%`)} ${bold(color, `×${shortMultiplier(multiplier)}`)}`;
}

/** The card trail, the multiplier, whose move it is, each guess's chance and pay, the skips and the cash-out. */
export function renderHilo(round: RoundView | null, ctx: RenderContext): string[] {
  const { color, width } = ctx;

  if (round === null || round.detail.game !== "hilo") {
    return [
      dim(color, "Guess whether the next card is higher or lower:"),
      dim(color, "each right guess raises the multiplier. Start with n."),
    ].map((line) => clip(line, width));
  }

  const detail = round.detail;
  const right = hiloRight(detail);
  const rank = detail.cards.at(-1)?.rank ?? 0;
  const isTurn = round.phase === "player_turn" && detail.pending === null;
  const lines: (string | null)[] = [
    hiloTrail(color, detail, width),
    `multiplier ${hiloMultiplier(color, detail, right)} ${dim(color, `${SEPARATOR.trim()} ${right} right`)}`,
    hiloStatus(color, round, detail),
  ];

  if (isTurn) {
    lines.push(
      hiloOffer(color, "higher", rank, detail.higherMultiplier),
      hiloOffer(color, "lower", rank, detail.lowerMultiplier),
      dim(color, `${HILO_GLYPHS.skip} skip${SEPARATOR}${detail.skipsLeft} left`),
    );
  }

  if (round.phase !== "idle" && right > 0) {
    const payout = formatUsdc(cashOutPayout(round.stake, detail.multiplier));
    lines.push(`cash out ${gold(color, payout)}${detail.canCashOut ? dim(color, ` with ${CASH_OUT_HOTKEY}`) : ""}`);
  }

  return lines.filter((line): line is string => line !== null).map((line) => clip(line, width));
}
