// The slice of `@ampcode/plugin` this plugin uses, copied from the generated reference at
// https://ampcode.com/docs/plugin-api so the folder typechecks without the package installed.
// Only shapes we touch are declared; the agent events deliberately omit `message` and
// `messages` so nothing here can read the user's prompt or the transcript.

export interface Subscription {
  unsubscribe(): void;
}

export interface StatusItemValue {
  text: string;
  /** `command:<id>` runs a command registered by a plugin. */
  url?: string;
}

export interface StatusItem extends Subscription {
  update(value: StatusItemValue): void;
}

export interface PluginSelectOptions {
  title: string;
  /** Markdown. */
  message?: string;
  initialValue?: string;
  options: string[];
}

export interface PluginConfirmOptions {
  title: string;
  /** Markdown. */
  message?: string;
  confirmButtonText?: string;
}

export interface PluginUI {
  notify(message: string): Promise<void>;
  confirm(options: PluginConfirmOptions): Promise<boolean>;
  /** The chosen option, or undefined when dismissed. */
  select(options: PluginSelectOptions): Promise<string | undefined>;
}

export interface PluginSystem {
  open(url: string | URL): Promise<void>;
}

export interface PluginCommandOptions {
  title: string;
  category?: string;
  description?: string;
}

export interface PluginCommandContext {
  ui: PluginUI;
  system: PluginSystem;
}

interface TurnEvent {
  thread: { id: string };
}

/** agent.start is a request event: the handler must return a result, `{}` adds nothing. */
type AgentStartResult = Record<string, never>;

export interface PluginAPI {
  logger: { log(...args: unknown[]): void };
  system: PluginSystem;
  on(event: "agent.start", handler: (event: TurnEvent) => AgentStartResult): Subscription;
  on(event: "agent.end", handler: (event: TurnEvent) => void): Subscription;
  registerCommand(
    id: string,
    options: PluginCommandOptions,
    handler: (ctx: PluginCommandContext) => void | Promise<void>,
  ): Subscription;
  onDispose(callback: () => void | Promise<void>): Subscription;
  experimental?: {
    createStatusItem(initial?: StatusItemValue): StatusItem;
  };
}
