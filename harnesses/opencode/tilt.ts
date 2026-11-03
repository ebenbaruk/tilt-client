// Everything the OpenCode / Kilo TUI plugin does besides drawing: one TiltSession, the table's
// shown/hidden and game-mode state, the agent's busy/idle from session statuses, and the /tilt
// menu. tui.tsx only wires this to the host's slots, keymap and dialogs.
import { TiltSession, fileStore, openInBrowser, renderPanel, renderStatusLine } from "../../packages/play/src/index";

/** Enters game mode; `alt+t` is free in both hosts' default keybinds. Override: plugin option `key`. */
export const DEFAULT_PLAY_KEY = "alt+t";
/** Every key a key plan can offer: one digit or one lowercase letter. */
export const HOTKEYS: readonly string[] = [..."abcdefghijklmnopqrstuvwxyz0123456789"];

export const NO_API_URL = "TILT · set TILT_API_URL (or the plugin's apiUrl option) and restart";

export interface PluginSettings {
  apiUrl: string | null;
  playKey: string;
}

/** Reads the tui.json tuple options `{ apiUrl?, key? }`, then `TILT_API_URL`. Never guesses a host. */
export function readSettings(options: unknown, env: NodeJS.ProcessEnv = process.env): PluginSettings {
  // tui.json hands over whatever JSON the user wrote: each field is checked before use.
  const record = (typeof options === "object" && options !== null ? options : {}) as {
    apiUrl?: unknown;
    key?: unknown;
  };
  const configured = typeof record.apiUrl === "string" ? record.apiUrl : env.TILT_API_URL;
  const playKey = typeof record.key === "string" && record.key.trim() !== "" ? record.key.trim() : DEFAULT_PLAY_KEY;
  return { apiUrl: webUrl(configured?.trim() ?? ""), playKey };
}

export interface Notice {
  variant: "info" | "success" | "warning" | "error";
  message: string;
}

export type MenuAction = "play" | "show" | "hide" | "login" | "logout";

export class TiltTable {
  readonly session: TiltSession;
  private shown = true;
  private playing = false;
  /** Sessions (main and subagents) between busy and idle: the agent works while any is. */
  private readonly busySessions = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly stopListening: () => void;

  constructor(apiUrl: string) {
    this.session = new TiltSession({ apiUrl, store: fileStore(), openUrl: openInBrowser });
    this.stopListening = this.session.onChange(() => this.emit());
    this.session.setVisible(true);
    this.session.start();
  }

  get isShown(): boolean {
    return this.shown;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Hidden collapses the table to its status line; sponsor impressions count only when shown. */
  setShown(shown: boolean): void {
    this.shown = shown;
    if (!shown) this.playing = false;
    this.session.setVisible(shown);
    this.emit();
  }

  setPlaying(playing: boolean): void {
    if (playing && !this.shown) this.setShown(true);
    this.playing = playing;
    this.emit();
  }

  /** A key typed in game mode; keys the table does not offer now are dropped. */
  press(hotkey: string): void {
    if (this.playing) this.session.press(hotkey);
  }

  /** Only the status type is read: no message, part or prompt ever reaches this plugin. */
  sessionStatus(sessionID: string, type: "idle" | "busy" | "retry"): void {
    if (type === "idle") this.busySessions.delete(sessionID);
    else this.busySessions.add(sessionID);
    this.session.setAgent(this.busySessions.size > 0);
  }

  /** The lines to draw `width` columns wide, ANSI colored. */
  lines(width: number): string[] {
    const snapshot = this.session.snapshot();
    if (!this.shown) return [renderStatusLine(snapshot, { color: true, width })];
    return renderPanel(snapshot, { color: true, width });
  }

  menu(): { title: string; value: MenuAction }[] {
    const signedIn = this.session.snapshot().auth.status === "in";
    return [
      { title: this.playing ? "Back to the prompt" : "Play (game mode)", value: "play" },
      this.shown ? { title: "Hide the table", value: "hide" } : { title: "Show the table", value: "show" },
      signedIn ? { title: "Log out", value: "logout" } : { title: "Log in", value: "login" },
    ];
  }

  async runMenu(action: MenuAction): Promise<Notice | null> {
    switch (action) {
      case "play":
        this.setPlaying(!this.playing);
        return null;
      case "show":
      case "hide":
        this.setShown(action === "show");
        return null;
      case "login":
        return this.login();
      case "logout":
        return this.logout();
    }
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.stopListening();
    this.listeners.clear();
    this.session.stop();
  }

  private async login(): Promise<Notice> {
    if (this.session.snapshot().auth.status === "in") return { variant: "info", message: "Already signed in to Tilt." };
    try {
      await this.session.login();
    } catch (error) {
      return {
        variant: "error",
        message: `Tilt login failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const { auth } = this.session.snapshot();
    if (auth.status === "pending")
      return { variant: "info", message: `Confirm code ${auth.userCode} at ${auth.verifyUrl}` };
    if (auth.status === "out") return { variant: "warning", message: auth.message ?? "Tilt login did not complete." };
    return { variant: "success", message: "Signed in to Tilt." };
  }

  private async logout(): Promise<Notice> {
    try {
      await this.session.logout();
    } catch (error) {
      return {
        variant: "error",
        message: `Tilt logout failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    return { variant: "success", message: "Signed out of Tilt." };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** How a run of a renderPanel line is drawn, read back from its ANSI codes. */
export interface SpanStyle {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  inverse?: boolean;
}

/** One run of text in one style. */
export interface Segment {
  text: string;
  style: SpanStyle;
}

const SGR = /\x1b\[([0-9;]*)m/g;

/** Splits a renderPanel line on its SGR codes (the core only emits truecolor, bold, dim, inverse). */
export function parseAnsi(line: string): Segment[] {
  const segments: Segment[] = [];
  let style: SpanStyle = {};
  let start = 0;
  for (const match of line.matchAll(SGR)) {
    if (match.index > start) segments.push({ text: line.slice(start, match.index), style });
    style = applySgr(style, match[1] ?? "");
    start = match.index + match[0].length;
  }
  if (start < line.length) segments.push({ text: line.slice(start), style });
  return segments;
}

function applySgr(style: SpanStyle, params: string): SpanStyle {
  const codes = params === "" ? [0] : params.split(";").map(Number);
  let next: SpanStyle = { ...style };
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (code === 0) next = {};
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 7) next.inverse = true;
    else if (code === 22) next.bold = next.dim = false;
    else if (code === 27) next.inverse = false;
    else if (code === 39) delete next.fg;
    else if (code === 49) delete next.bg;
    else if ((code === 38 || code === 48) && codes[i + 1] === 2) {
      const hex = `#${codes
        .slice(i + 2, i + 5)
        .map((value) =>
          Math.max(0, Math.min(255, value || 0))
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")}`;
      if (code === 38) next.fg = hex;
      else next.bg = hex;
      i += 4;
    } else if ((code === 38 || code === 48) && codes[i + 1] === 5) i += 2;
  }
  return next;
}

/** `text` as an http(s) URL, or null: no other API URL is ever called. */
function webUrl(text: string): string | null {
  if (!URL.canParse(text)) return null;
  const url = new URL(text);
  return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
}
