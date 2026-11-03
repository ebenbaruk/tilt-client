// Turns raw terminal input (stdin in raw mode) into what the companion does with it. Pure, so the
// rules are testable without a terminal.

export type KeyEvent =
  /** A table hotkey: one lowercase letter or digit, offered or not (the session decides). */
  | { kind: "press"; key: string }
  /** Ctrl+L: log in when logged out, log out (after a confirmation) when logged in. */
  | { kind: "account" }
  /** Ctrl+C or Ctrl+D. */
  | { kind: "quit" };

const CTRL_C = "\x03";
const CTRL_D = "\x04";
const CTRL_L = "\x0c";
const ESC = "\x1b";
const HOTKEY = /^[a-z0-9]$/;

/** Decodes one chunk of raw input. Escape sequences (arrows, function keys, Alt+key) are dropped. */
export function decodeKeys(input: string): KeyEvent[] {
  const events: KeyEvent[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === ESC) {
      i = skipEscape(input, i);
      continue;
    }
    i += 1;
    const event = decodeChar(ch);
    if (event) events.push(event);
  }
  return events;
}

function decodeChar(ch: string): KeyEvent | null {
  if (ch === CTRL_C || ch === CTRL_D) return { kind: "quit" };
  if (ch === CTRL_L) return { kind: "account" };
  // Caps Lock should not make the table deaf.
  const key = ch.toLowerCase();
  return HOTKEY.test(key) ? { kind: "press", key } : null;
}

/** Index just past the escape sequence starting at `start` (CSI, SS3, Alt+key or a lone Esc). */
function skipEscape(input: string, start: number): number {
  const next = input[start + 1];
  if (next === undefined) return start + 1;
  if (next === "[") return skipCsi(input, start + 2);
  // SS3 (ESC O x) is three characters; Alt+key (ESC x) is two.
  if (next === "O") return Math.min(start + 3, input.length);
  return start + 2;
}

/** CSI parameters and intermediates run until a final byte in @..~. */
function skipCsi(input: string, from: number): number {
  let i = from;
  while (i < input.length) {
    const code = input.charCodeAt(i);
    i += 1;
    if (code >= 0x40 && code <= 0x7e) return i;
  }
  return i;
}
