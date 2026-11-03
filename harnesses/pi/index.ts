// Tilt for omp (oh-my-pi) and pi: one extension module for both. omp imports it with Bun, pi with
// jiti, straight from a clone, so it imports nothing but the shared core by relative path and
// declares the few host types it uses below.
//
// Privacy: only agent_start/agent_end are heard, for their timing; their payloads are never read.
// No prompt, reply, tool call or transcript is touched. Keys are captured only in game mode.
import { TiltSession, fileStore, renderPanel, renderStatusLine } from "../../packages/play/src/index";

// --- The parts of the omp/pi ExtensionAPI this file uses (omp: packages/coding-agent/src/
// extensibility/extensions/types.ts; pi: packages/coding-agent/docs/extensions.md).

interface HostTui {
  requestRender(): void;
}

interface WidgetComponent {
  render(width: number): string[];
  invalidate(): void;
  dispose?(): void;
}

type WidgetFactory = (tui: HostTui, theme: unknown) => WidgetComponent;

type TerminalInputHandler = (data: string) => { consume?: boolean; data?: string } | undefined;

interface ExtensionUI {
  setWidget(
    key: string,
    content: string[] | WidgetFactory | undefined,
    options?: { placement?: "aboveEditor" | "belowEditor" },
  ): void;
  onTerminalInput(handler: TerminalInputHandler): () => void;
  notify(message: string, type?: "info" | "warning" | "error"): void;
}

interface ExtensionContext {
  ui: ExtensionUI;
  mode?: string;
  /** omp only: factories are rebound to every subagent session. pi has no subagents. */
  agent?: { kind: "main" | "sub" };
}

interface ExecResult {
  code: number;
}

type LifecycleEvent = "session_start" | "session_switch" | "session_shutdown" | "agent_start" | "agent_end";

export interface ExtensionAPI {
  on(event: LifecycleEvent, handler: (event: unknown, ctx: ExtensionContext) => void | Promise<void>): void;
  registerCommand(
    name: string,
    options: { description?: string; handler: (args: string, ctx: ExtensionContext) => void | Promise<void> },
  ): void;
  registerShortcut(
    shortcut: string,
    options: { description?: string; handler: (ctx: ExtensionContext) => void | Promise<void> },
  ): void;
  exec(command: string, args: string[], options?: { timeout?: number }): Promise<ExecResult>;
}

const WIDGET_KEY = "tilt";
// Free in both hosts' default bindings (omp only uses alt+t inside its tree selector overlay).
const GAME_SHORTCUT = "alt+t";
const FALLBACK_WIDTH = 80;
const OPEN_TIMEOUT_MS = 10_000;
const NO_API_URL = "TILT · set TILT_API_URL";
const USAGE = "Usage: /tilt [login|logout]";

// Esc arrives bare, or as CSI 27 u when the terminal speaks the kitty keyboard protocol.
const ESCAPE = /^\x1b(?:\[27(?:;1(?::1)?)?u)?$/;
const HOTKEY = /^[a-z0-9]$/;

function opener(url: string): [string, string[]] {
  if (process.platform === "darwin") return ["open", [url]];
  // explorer.exe exits 1 even when it opened the page; rundll32 reports a real status.
  if (process.platform === "win32") return ["rundll32", ["url.dll,FileProtocolHandler", url]];
  return ["xdg-open", [url]];
}

/** Lives from session_start to session_shutdown of the main agent in the interactive TUI. */
class Table {
  private isShown = true;
  private isGameMode = false;
  private tui: HostTui | null = null;
  private readonly session: TiltSession;
  private ui: ExtensionUI;
  private readonly stopListening: () => void;
  private stopInput: () => void = () => {};

  constructor(session: TiltSession, ui: ExtensionUI) {
    this.session = session;
    this.ui = ui;
    this.stopListening = session.onChange(() => this.tui?.requestRender());
    this.attach(ui);
    session.setVisible(true);
    session.start();
  }

  /** (Re)draws the widget and listens for keys. omp drops both on /new, /resume and forks. */
  attach(ui: ExtensionUI): void {
    this.stopInput();
    this.ui = ui;
    this.stopInput = ui.onTerminalInput((data) => this.onInput(data));
    ui.setWidget(WIDGET_KEY, (tui) => this.widget(tui), { placement: "aboveEditor" });
  }

  toggleShown(): void {
    this.isShown = !this.isShown;
    if (!this.isShown) this.isGameMode = false;
    this.redraw();
  }

  toggleGameMode(): void {
    this.isGameMode = !this.isGameMode;
    if (this.isGameMode) this.isShown = true;
    this.redraw();
  }

  close(): void {
    this.stopInput();
    this.stopListening();
    this.session.stop();
    this.ui.setWidget(WIDGET_KEY, undefined);
  }

  private redraw(): void {
    this.session.setVisible(this.isShown);
    this.tui?.requestRender();
  }

  private widget(tui: HostTui): WidgetComponent {
    this.tui = tui;
    return {
      render: (width) => this.render(Number.isFinite(width) && width > 0 ? width : FALLBACK_WIDTH),
      invalidate: () => {},
      dispose: () => {
        if (this.tui === tui) this.tui = null;
      },
    };
  }

  // A component, not a string array: both hosts cap string widgets at 10 lines, and the
  // component is told the real width on every frame.
  private render(width: number): string[] {
    const color = !process.env.NO_COLOR;
    const snapshot = this.session.snapshot();
    if (!this.isShown) return [renderStatusLine(snapshot, { color, width })];

    const hint = this.isGameMode
      ? `game mode: keys play the table · esc or ${GAME_SHORTCUT} to type again`
      : `${GAME_SHORTCUT} to play with the keys · /tilt to hide`;
    const hintLine = hint.slice(0, width).padEnd(width);
    return [...renderPanel(snapshot, { color, width }), color ? `\x1b[2m${hintLine}\x1b[22m` : hintLine];
  }

  // Outside game mode nothing is consumed: the person types prompts as usual.
  private onInput(data: string): { consume: boolean } | undefined {
    if (!this.isGameMode) return undefined;
    if (ESCAPE.test(data)) {
      this.toggleGameMode();
      return { consume: true };
    }
    // Only one typed character goes to the table; control keys, escape sequences and pastes
    // (Enter, ctrl+c, arrows, alt+t...) reach the host as usual.
    if ([...data].length !== 1 || /\p{C}/u.test(data)) return undefined;

    const key = data.toLowerCase();
    if (HOTKEY.test(key)) this.session.press(key);
    // Every other typed character is swallowed too, so nothing leaks into the prompt.
    return { consume: true };
  }
}

export default function tilt(pi: ExtensionAPI): void {
  const apiUrl = process.env.TILT_API_URL?.trim() ?? "";
  // One per session binding: omp rebinds this factory per session, pi reloads it.
  let table: Table | null = null;
  let session: TiltSession | null = null;

  const isMain = (ctx: ExtensionContext): boolean => ctx.agent === undefined || ctx.agent.kind === "main";

  const openUrl = async (url: string): Promise<boolean> => {
    const [command, args] = opener(url);
    const result = await pi.exec(command, args, { timeout: OPEN_TIMEOUT_MS });
    return result.code === 0;
  };

  const close = (): void => {
    table?.close();
    table = null;
    session = null;
  };

  const mount = (_event: unknown, ctx: ExtensionContext): void => {
    if (!isMain(ctx) || ctx.mode !== "tui") return;
    if (apiUrl === "") {
      // Fail closed: no host is ever guessed.
      ctx.ui.setWidget(WIDGET_KEY, [NO_API_URL], { placement: "aboveEditor" });
      return;
    }
    if (table !== null) {
      table.attach(ctx.ui);
      return;
    }
    session = new TiltSession({ apiUrl, store: fileStore(), openUrl });
    table = new Table(session, ctx.ui);
  };

  // pi rebinds the extension and fires session_start for every session; omp fires it once and,
  // on /new, /resume and forks, clears widgets and key listeners then fires session_switch.
  pi.on("session_start", mount);
  pi.on("session_switch", mount);

  pi.on("session_shutdown", close);

  pi.on("agent_start", (_event, ctx) => {
    if (isMain(ctx)) session?.setAgent(true);
  });
  pi.on("agent_end", (_event, ctx) => {
    if (isMain(ctx)) session?.setAgent(false);
  });

  pi.registerShortcut(GAME_SHORTCUT, {
    description: "Tilt: play the table with the keys (esc to type again)",
    handler: () => table?.toggleGameMode(),
  });

  pi.registerCommand("tilt", {
    description: "Tilt: show or hide the table; /tilt login, /tilt logout",
    handler: async (args, ctx) => {
      if (session === null || table === null) {
        ctx.ui.notify(apiUrl === "" ? NO_API_URL : "Tilt runs in the interactive TUI only.", "warning");
        return;
      }
      const action = args.trim().toLowerCase();
      try {
        if (action === "") table.toggleShown();
        else if (action === "login") await session.login();
        else if (action === "logout") await session.logout();
        else ctx.ui.notify(USAGE, "warning");
      } catch (error) {
        ctx.ui.notify(`Tilt: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });
}
