// Tilt for Amp (https://ampcode.com/manual/plugins). Amp runs this file with Bun as a directory
// plugin entry. It draws one status line, follows turn start/end, and plays through palette
// commands and select dialogs. It never looks at prompts, replies or tool calls: the agent
// events are used for their timing and thread id only.
import { TiltSession, fileStore, renderPanel, renderStatusLine, writeAgentSignal } from "../../packages/play/src/index";
import type { Snapshot } from "../../packages/play/src/index";
import type { PluginAPI, PluginUI } from "./amp";

export const description =
  "Tilt: a USDC casino table in the status line, played from the command palette while Amp works.";

// Amp gives plugins no terminal width, and nothing documents ANSI in status items or dialogs:
// plain text at fixed widths that fit a common terminal.
const STATUS_WIDTH = 80;
const PANEL_WIDTH = 72;
// How long `Tilt: play` waits for a move to land before showing the keys again.
const MOVE_SETTLE_MS = 15_000;
// The command palette entry that signs in, shown where the panel tells the player how to log in.
const LOGIN_HINT = "Tilt: login";

const COMMAND = {
  play: "tilt.play",
  table: "tilt.table",
  login: "tilt.login",
  logout: "tilt.logout",
} as const;

export default function (amp: PluginAPI): void {
  const status = amp.experimental?.createStatusItem();
  const apiUrl = process.env.TILT_API_URL?.trim();
  if (!apiUrl) {
    // Fail closed: no host is ever guessed.
    status?.update({ text: "TILT · set TILT_API_URL and reload plugins" });
    registerCommands(amp, null);
    return;
  }

  const session = new TiltSession({
    apiUrl,
    store: fileStore(),
    openUrl: async (url: string) => {
      try {
        await amp.system.open(url);
        return true;
      } catch {
        return false;
      }
    },
  });

  let shownText = "";
  const draw = (): void => {
    const text = renderStatusLine(session.snapshot(), { color: false, width: STATUS_WIDTH, loginHint: LOGIN_HINT });
    if (text === shownText) return;
    shownText = text;
    status?.update({ text, url: `command:${COMMAND.play}` });
  };

  // Amp hosts several threads at once and has no session.end: the agent counts as working while
  // any thread is between agent.start and agent.end.
  const workingThreads = new Set<string>();
  const syncAgent = (): void => {
    const isWorking = workingThreads.size > 0;
    session.setAgent(isWorking);
    // The companion pane (harnesses/companion) follows the same turns through this file.
    writeAgentSignal(isWorking ? "working" : "idle").catch((error: unknown) => {
      amp.logger.log(
        `tilt: could not write the turn signal: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  };
  const turnStart = amp.on("agent.start", (event) => {
    workingThreads.add(event.thread.id);
    syncAgent();
    return {};
  });
  const turnEnd = amp.on("agent.end", (event) => {
    workingThreads.delete(event.thread.id);
    syncAgent();
  });

  const stopDrawing = session.onChange(draw);
  session.setVisible(true);
  session.start();
  draw();
  registerCommands(amp, session);

  amp.onDispose(() => {
    turnStart.unsubscribe();
    turnEnd.unsubscribe();
    stopDrawing();
    // A reload mid-turn sends no agent.end: leave the companion idle rather than stuck working.
    workingThreads.clear();
    syncAgent();
    session.stop();
    status?.unsubscribe();
  });
}

function registerCommands(amp: PluginAPI, session: TiltSession | null): void {
  const withSession =
    (run: (session: TiltSession, ui: PluginUI) => Promise<void>) =>
    async (ctx: { ui: PluginUI }): Promise<void> => {
      if (!session) {
        await ctx.ui.notify("Tilt needs TILT_API_URL in Amp's environment. Set it, then run `plugins: reload`.");
        return;
      }
      await run(session, ctx.ui);
    };

  amp.registerCommand(
    COMMAND.play,
    { title: "play", category: "Tilt", description: "Pick the table's moves from a list until you close it" },
    withSession(play),
  );
  amp.registerCommand(
    COMMAND.table,
    { title: "show table", category: "Tilt", description: "Show the whole Tilt table" },
    withSession(showTable),
  );
  amp.registerCommand(
    COMMAND.login,
    { title: "login", category: "Tilt", description: "Sign in to Tilt in your browser" },
    withSession(login),
  );
  amp.registerCommand(
    COMMAND.logout,
    { title: "logout", category: "Tilt", description: "Sign out of Tilt on this machine" },
    withSession(logout),
  );
}

async function play(session: TiltSession, ui: PluginUI): Promise<void> {
  for (;;) {
    const snapshot = session.snapshot();
    if (snapshot.auth.status !== "in") {
      await ui.notify("Sign in first: run `Tilt: login` from the command palette.");
      return;
    }
    const keys = snapshot.keys.filter((key) => key.hotkey !== "");
    if (keys.length === 0) {
      await ui.notify(snapshot.message?.text ?? "Nothing to play right now.");
      return;
    }

    const options = keys.map((key) => `${key.hotkey} · ${key.label}${key.isSelected ? " ✓" : ""}`);
    const status = renderStatusLine(snapshot, { color: false, width: STATUS_WIDTH, loginHint: LOGIN_HINT }).trim();
    const choice = await ui.select({ title: "Tilt", message: `${status}\n\n${tableBlock(snapshot)}`, options });
    const key = keys[options.indexOf(choice ?? "")];
    if (!key) return; // dismissed

    if (!session.press(key.hotkey)) {
      await ui.notify("That move is not available now. Wait for the table to catch up.");
    }
    await settled(session);
  }
}

async function showTable(session: TiltSession, ui: PluginUI): Promise<void> {
  const snapshot = session.snapshot();
  await ui.confirm({ title: "Tilt", message: tableBlock(snapshot), confirmButtonText: "Close" });
}

async function login(session: TiltSession, ui: PluginUI): Promise<void> {
  if (session.snapshot().auth.status === "in") {
    await ui.notify("Already signed in to Tilt.");
    return;
  }
  try {
    await session.login();
  } catch (error) {
    await ui.notify(`Tilt login failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const { auth } = session.snapshot();
  if (auth.status === "pending") {
    await ui.notify(`Confirm code ${auth.userCode} at ${auth.verifyUrl}`);
  } else if (auth.status === "out") {
    await ui.notify(auth.message ?? "Tilt login did not complete.");
  }
}

async function logout(session: TiltSession, ui: PluginUI): Promise<void> {
  try {
    await session.logout();
  } catch (error) {
    await ui.notify(`Tilt logout failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  await ui.notify("Signed out of Tilt.");
}

/** Resolves once no move is in flight, or after MOVE_SETTLE_MS so the loop never hangs. */
function settled(session: TiltSession): Promise<void> {
  if (!session.snapshot().isBusy) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      stop();
      resolve();
    };
    const timer = setTimeout(done, MOVE_SETTLE_MS);
    const stop = session.onChange(() => {
      if (!session.snapshot().isBusy) done();
    });
  });
}

// Dialog bodies are Markdown: a fenced block keeps the table's columns.
const tableBlock = (snapshot: Snapshot): string =>
  ["```text", ...renderPanel(snapshot, { color: false, width: PANEL_WIDTH, loginHint: LOGIN_HINT }), "```"].join("\n");
