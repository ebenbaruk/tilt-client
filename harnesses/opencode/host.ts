// The parts of the OpenCode / Kilo v1 TUI plugin API this plugin uses, written out by hand:
// `@opencode-ai/plugin/tui` (and Kilo's `@kilocode/plugin/tui`) is not installed in a clone, and
// the two only differ in names this plugin does not touch. Shapes copied from
// https://github.com/anomalyco/opencode/blob/v1.18.11/packages/plugin/src/tui.ts and
// https://github.com/Kilo-Org/kilocode/blob/v7.8.18/packages/plugin/src/tui.ts.

export type Dispose = () => void;

export interface TuiCommand {
  name: string;
  title: string;
  desc?: string;
  category?: string;
  /** "palette" lists the command in the command palette and the slash menu. */
  namespace?: "palette";
  slashName?: string;
  run(): void;
}

export interface TuiBinding {
  key: string;
  cmd: string | (() => void);
  desc?: string;
  group?: string;
}

export interface TuiLayer {
  /** Only active while this mode is on top of the host's mode stack ("base" = normal UI). */
  mode?: string;
  commands?: TuiCommand[];
  bindings?: TuiBinding[];
}

export interface TuiToast {
  variant?: "info" | "success" | "warning" | "error";
  title?: string;
  message: string;
  duration?: number;
}

export interface TuiSelectOption<Value> {
  title: string;
  value: Value;
  description?: string;
}

/** `JSX.Element` of @opentui/solid; opaque here. */
export type Element = unknown;

export interface TuiSessionStatusEvent {
  type: "session.status";
  properties: { sessionID: string; status: { type: "idle" | "busy" | "retry" } };
}

/** Theme colors are OpenTUI RGBA values, passed straight to `fg`. */
export interface TuiSlotContext {
  theme: { current: { warning: unknown; textMuted: unknown } };
}

export interface TuiApi {
  keymap: { registerLayer(layer: TuiLayer): Dispose };
  mode: { push(mode: string): Dispose };
  ui: {
    toast(input: TuiToast): void;
    DialogSelect<Value>(props: {
      title: string;
      options: TuiSelectOption<Value>[];
      onSelect?: (option: TuiSelectOption<Value>) => void;
    }): Element;
    dialog: { replace(render: () => Element, onClose?: () => void): void; clear(): void };
  };
  event: { on(type: "session.status", handler: (event: TuiSessionStatusEvent) => void): Dispose };
  lifecycle: { onDispose(fn: () => void | Promise<void>): Dispose };
  slots: { register(plugin: { order?: number; slots: { app_bottom(ctx: TuiSlotContext): Element } }): string };
}
