// What every drawing shares: the elements it draws with and the design system's colors. The pane,
// the band and the table surface module all draw from these.
import type { Elements } from "claude-code";

export type Ui = Pick<Elements["terminal"], "Box" | "Text" | "Button" | "Link">;

// The main greys are the person's own theme keys, so they follow a light, dark or custom theme as
// Claude Code's own text does. The accents are the design system's oklch tokens in hex, one set
// per ground: the dark set's pink and gold vanish on a light terminal.
interface Accents {
  pink: string;
  gold: string;
  green: string;
  /** Cool accents for the wheel's small wins. */
  blue: string;
  teal: string;
  red: string;
  fg6: string;
  line3: string;
  line4: string;
  pinkRule: string;
  ink: string;
  cardFace: string;
}

const DARK: Accents = {
  pink: "#f779ba",
  gold: "#f1c45e",
  green: "#7ccd8e",
  blue: "#7fa8f2",
  teal: "#5ccbc2",
  red: "#f66d67",
  fg6: "#7d7e84",
  line3: "#3a3b40",
  line4: "#4a4b50",
  // Found as is in the 256-color palette, so it reads the same where the terminal (or tmux) has
  // no true color. A tinted fill turned to a grey slab there.
  pinkRule: "#af5f87",
  ink: "#1b1c1f",
  cardFace: "#f0eee9",
};

const LIGHT: Accents = {
  pink: "#c42a7f",
  gold: "#946200",
  green: "#2f7d46",
  blue: "#2c5fb3",
  teal: "#0e7a72",
  red: "#c4302b",
  fg6: "#7d7e84",
  line3: "#cfcdc8",
  line4: "#b5b3ae",
  pinkRule: "#d75f87",
  ink: "#ffffff",
  cardFace: "#ffffff",
};

export const FG1 = "text";
export const FG4 = "inactive";

// Live bindings, set by `applyTheme` before each drawing; every importer reads the current set.
/** The quietest text: the theme's own `subtle` key is too faint to read on most dark grounds. */
export let FG6 = DARK.fg6;
export let PINK = DARK.pink;
export let GOLD = DARK.gold;
export let GREEN = DARK.green;
export let BLUE = DARK.blue;
export let TEAL = DARK.teal;
export let RED = DARK.red;
export let LINE3 = DARK.line3;
export let LINE4 = DARK.line4;
export let PINK_RULE = DARK.pinkRule;
/** Text on a pink or gold fill (the active tab). */
export let INK = DARK.ink;
/** A small card is one row: its face on a chip, the suit's color as ink. */
export let CARD_FACE = DARK.cardFace;

export const FELT: Record<"red" | "black" | "green", string> = { red: "#b63132", black: "#2a2b2f", green: "#21763c" };
export const CARD_INK: Record<"red" | "black", string> = { red: "#c4302b", black: "#1b1c1f" };
/** Numbers on the roulette felt, which stays dark on any ground: the ball's pocket, then the rest. */
export const FELT_INK = "#ffffff";
export const FELT_INK_DIM = "#d6d4cf";

/** Picks the accents for the terminal's ground; `isLight` from Claude Code's `theme` setting. */
export function applyTheme(isLight: boolean): void {
  const set = isLight ? LIGHT : DARK;

  FG6 = set.fg6;
  PINK = set.pink;
  GOLD = set.gold;
  GREEN = set.green;
  BLUE = set.blue;
  TEAL = set.teal;
  RED = set.red;
  LINE3 = set.line3;
  LINE4 = set.line4;
  PINK_RULE = set.pinkRule;
  INK = set.ink;
  CARD_FACE = set.cardFace;
}

/** Claude Code's theme names a light one by its prefix: `light`, `light-daltonized`, `light-ansi`. */
export const isLightTheme = (value: unknown): boolean => typeof value === "string" && value.startsWith("light");

/** Gains in gold, losses in red, a push in grey. */
export function toneOf(net: string): string {
  const value = BigInt(net);

  return value > 0n ? GOLD : value < 0n ? RED : FG4;
}
