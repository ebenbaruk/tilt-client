// The parts of DeepSeek Harness (Cordis plugin context) this plugin uses. dsh is a developer
// preview whose packages are not installed here; these mirror deepseek-ai/deepseek-harness
// packages/core/agent/src/runtime-types.ts (`agent/status`), packages/interaction/commands
// (`ctx.commands`), and the TUI's `ctx.tui` contract (packages/ui/tui/src/extension/types.ts at
// commit 890343751a356273128416eba6be6b09ece7d463, the last public copy of the TUI).

/** An agent is only compared by identity here; nothing on it is read. */
export type Agent = object;

export type CommandResult = { kind: "success"; text?: string } | { kind: "error"; text: string };

export interface CommandDefinition {
  name: string;
  description: string;
  input?: { hint: string };
  handler: (invocation: { rawInput: string }) => CommandResult | Promise<CommandResult>;
}

export interface TuiComponent {
  render(width: number): string[];
  handleInput?(data: string): void;
  invalidate(): void;
}

export interface TuiOverlayHost {
  /** Aborts when the overlay closes for any reason. */
  readonly signal: AbortSignal;
  invalidate(): void;
  close(): void;
}

export interface TuiOverlayOptions {
  readonly width?: number | `${number}%`;
  readonly minWidth?: number;
  readonly maxHeight?: number | `${number}%`;
  readonly anchor?: "center" | "top-center" | "bottom-center";
}

export interface TuiService {
  /** Queues a modal overlay; one shows at a time. Throws once the TUI shuts down. */
  openOverlay(request: { create: (host: TuiOverlayHost) => TuiComponent; options?: TuiOverlayOptions }): unknown;
}

export interface DshContext {
  on(event: "agent/status", listener: (payload: { agent: Agent; status: string }) => void): () => void;
  on(event: "agent/disposed", listener: (payload: { agent: Agent }) => void): () => void;
  /** Runs `setup` now and its returned disposer when the plugin unloads. */
  effect(setup: () => () => void): void;
  /** An optional service: undefined while no provider is loaded (e.g. no TUI mounted). */
  get(name: "tui"): TuiService | undefined;
  readonly commands: { register(definition: CommandDefinition): () => void };
}
