// The parts of the Copilot CLI extension SDK (`@github/copilot-sdk/extension`) this adapter uses.
// The SDK is bundled with the CLI and resolved by it at run time, so it cannot be installed here;
// these mirror github/copilot-sdk nodejs/src/types.ts and session.ts.

export interface CommandContext {
  /** Raw text typed after the command name; "" for a bare `/tilt` (the docs' own example still guards for absent). */
  args?: string;
}

export interface CommandDefinition {
  name: string;
  description?: string;
  handler: (context: CommandContext) => Promise<void> | void;
}

export interface JoinSessionConfig {
  commands?: CommandDefinition[];
  /** Variables the CLI would otherwise strip from the extension process. */
  requestedEnvironmentVariables?: string[];
}

/** Session events used for their timing only; their payload is never read. */
export type TimingEvent = "assistant.turn_start" | "session.idle" | "session.shutdown";

export interface CopilotSession {
  readonly capabilities: { ui?: { elicitation?: boolean } };
  readonly ui: {
    /** Resolves the chosen option, or null when the person cancels. */
    select(message: string, options: string[]): Promise<string | null>;
  };
  log(message: string, options?: { level?: "info" | "warning" | "error"; ephemeral?: boolean }): Promise<void>;
  on(eventType: TimingEvent, handler: () => void): () => void;
}

export type JoinSession = (config: JoinSessionConfig) => Promise<CopilotSession>;
