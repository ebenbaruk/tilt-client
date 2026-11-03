/** @jsxImportSource @opentui/solid */
// Tilt as an OpenCode / Kilo Code v1 TUI plugin, listed by absolute path in tui.json. The host
// compiles this file with its Solid transform and hands it its own copies of solid-js and
// @opentui/solid, so nothing is installed. All Tilt logic lives in ./tilt (plain TypeScript).
// Privacy: only `session.status` events are read, and only their busy/idle type.
import { Index, createSignal, type Accessor } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import type { TuiApi } from "./host";
import { HOTKEYS, NO_API_URL, TiltTable, parseAnsi, readSettings, type Notice, type SpanStyle } from "./tilt";

/** Pushed on the host's mode stack while playing: the prompt's own shortcuts pause until Esc. */
const PLAY_MODE = "tilt.play";

const tui = async (api: TuiApi, options: unknown): Promise<void> => {
  const settings = readSettings(options);
  if (settings.apiUrl === null) {
    // Fail closed: no host is ever guessed.
    api.slots.register({
      slots: { app_bottom: (ctx) => <text fg={ctx.theme.current.warning}>{NO_API_URL}</text> },
    });
    api.keymap.registerLayer({
      commands: [
        {
          name: "tilt.menu",
          title: "Tilt",
          category: "Tilt",
          namespace: "palette",
          slashName: "tilt",
          run: () => api.ui.toast({ variant: "warning", title: "Tilt", message: NO_API_URL }),
        },
      ],
    });
    return;
  }

  const table = new TiltTable(settings.apiUrl);
  api.lifecycle.onDispose(() => table.dispose());

  let leavePlayMode: (() => void) | null = null;
  const [version, setVersion] = createSignal(0);
  table.onChange(() => {
    if (table.isPlaying && leavePlayMode === null) leavePlayMode = api.mode.push(PLAY_MODE);
    if (!table.isPlaying && leavePlayMode !== null) {
      leavePlayMode();
      leavePlayMode = null;
    }
    setVersion((value) => value + 1);
  });

  api.event.on("session.status", (event) =>
    table.sessionStatus(event.properties.sessionID, event.properties.status.type),
  );

  api.slots.register({
    slots: {
      app_bottom: (ctx) => (
        <TiltBand table={table} version={version} playKey={settings.playKey} muted={ctx.theme.current.textMuted} />
      ),
    },
  });

  const notify = (notice: Notice | null): void => {
    if (notice !== null) api.ui.toast({ ...notice, title: "Tilt", duration: 10_000 });
  };
  const openMenu = (): void =>
    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title="Tilt"
        options={table.menu()}
        onSelect={(option) => {
          api.ui.dialog.clear();
          void table.runMenu(option.value).then(notify);
        }}
      />
    ));

  api.keymap.registerLayer({
    mode: "base",
    commands: [
      {
        name: "tilt.menu",
        title: "Tilt: play, show or hide the table, log in or out",
        category: "Tilt",
        namespace: "palette",
        slashName: "tilt",
        run: openMenu,
      },
      {
        name: "tilt.play",
        title: "Tilt: play (keys go to the table, Esc returns)",
        category: "Tilt",
        namespace: "palette",
        run: () => table.setPlaying(true),
      },
    ],
    bindings: [{ key: settings.playKey, cmd: "tilt.play", desc: "Play Tilt", group: "Tilt" }],
  });

  // Every binding returns nothing, so the keymap counts the key as handled and it never reaches
  // the prompt, even when the table does not offer it right now.
  const leave = (): void => table.setPlaying(false);
  api.keymap.registerLayer({
    mode: PLAY_MODE,
    bindings: [
      { key: "escape", cmd: leave, desc: "Back to the prompt", group: "Tilt" },
      { key: settings.playKey, cmd: leave, desc: "Back to the prompt", group: "Tilt" },
      ...HOTKEYS.map((hotkey) => ({ key: hotkey, cmd: () => table.press(hotkey), group: "Tilt" })),
    ],
  });
};

function TiltBand(props: { table: TiltTable; version: Accessor<number>; playKey: string; muted: unknown }) {
  const dimensions = useTerminalDimensions();
  const lines = () => {
    props.version();
    return props.table.lines(Math.max(1, dimensions().width)).map(parseAnsi);
  };
  const hint = () => {
    props.version();
    if (!props.table.isShown) return null;
    return props.table.isPlaying
      ? "TILT game mode · the keys shown play · esc back to the prompt"
      : `${props.playKey} play · /tilt menu`;
  };
  return (
    <box flexDirection="column" flexShrink={0}>
      <Index each={lines()}>
        {(segments) => (
          <text wrapMode="none">
            <Index each={segments()}>
              {(segment) => <span style={spanStyle(segment().style)}>{segment().text}</span>}
            </Index>
          </text>
        )}
      </Index>
      {hint() !== null && (
        <text fg={props.muted} wrapMode="none">
          {hint()}
        </text>
      )}
    </box>
  );
}

/**
 * One renderPanel run as span style props. Colors go through <span> children because the OpenTUI
 * Solid reconciler (v0.4.5) stringifies <text content>, so a StyledText there draws "[object Object]".
 */
function spanStyle(style: SpanStyle): { fg?: string; bg?: string; attributes: number } {
  return {
    fg: style.fg,
    bg: style.bg,
    attributes:
      (style.bold ? TextAttributes.BOLD : 0) |
      (style.dim ? TextAttributes.DIM : 0) |
      (style.inverse ? TextAttributes.INVERSE : 0),
  };
}

export default { id: "tilt", tui };
