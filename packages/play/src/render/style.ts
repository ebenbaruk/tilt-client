// The Tilt palette as ANSI truecolor (tilt-design tokens): pink is the brand, gold money and
// keys, green the agent and wins, red losses and red suits. Off when color is false.

type Paint = (color: boolean, text: string) => string;

const sgr =
  (open: string): Paint =>
  (color, text) =>
    color && text !== "" ? `\x1b[${open}m${text}\x1b[0m` : text;

export const pink = sgr("38;2;236;111;174");
export const gold = sgr("38;2;240;194;106");
export const green = sgr("38;2;124;207;143");
export const red = sgr("38;2;240;113;95");
export const dim = sgr("2");
export const bold = sgr("1");
export const inverse = sgr("7");

const ANSI = /\x1b\[[0-9;]*m/g;

/** Columns `text` takes on screen: ANSI codes take none, every code point one. */
export const visibleWidth = (text: string): number => [...text.replace(ANSI, "")].length;

/** `text` padded with spaces, or cut, to exactly `width` columns (cuts drop colors). */
export function fit(text: string, width: number): string {
  const visible = visibleWidth(text);
  if (visible <= width) return text + " ".repeat(width - visible);
  return [...text.replace(ANSI, "")].slice(0, Math.max(0, width - 1)).join("") + "…";
}
