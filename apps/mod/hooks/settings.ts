// The person's choices for how Tilt sits in their terminal: the manifest's `userConfig` fields,
// changed in `/config` or from `/tilt setup`. A value the mod does not know counts as the default.
import type { PluginOptions } from "claude-code";

import type { CardSize } from "./cards";

/**
 * `side`: the pane, docked beside the transcript in fullscreen, under it otherwise.
 * `bottom`: the whole table in the band above the prompt, no pane.
 * `compact`: two lines above the prompt; `/tilt` still opens the pane.
 */
export type Placement = "side" | "bottom" | "compact";

export interface Settings {
  layout: Placement;
  cards: CardSize;
  /** Open (or fill) Tilt when the agent starts working. */
  autoOpen: boolean;
  /** A short sound on a deal and on a win. */
  sound: boolean;
}

export const PLACEMENTS: readonly Placement[] = ["side", "bottom", "compact"];
export const CARD_SIZES: readonly CardSize[] = ["large", "small"];

export const DEFAULT_SETTINGS: Settings = { layout: "side", cards: "large", autoOpen: true, sound: false };

/** The `userConfig` field each setting is stored in. */
export const SETTING_FIELDS: Record<keyof Settings, string> = {
  layout: "layout",
  cards: "cards",
  autoOpen: "autoOpen",
  sound: "sound",
};

const oneOf = <T extends string>(values: readonly T[], value: unknown, fallback: T): T =>
  values.find((each) => each === value) ?? fallback;

export function settingsOf(options: PluginOptions): Settings {
  return {
    layout: oneOf(PLACEMENTS, options.layout, DEFAULT_SETTINGS.layout),
    cards: oneOf(CARD_SIZES, options.cards, DEFAULT_SETTINGS.cards),
    autoOpen: typeof options.autoOpen === "boolean" ? options.autoOpen : DEFAULT_SETTINGS.autoOpen,
    sound: typeof options.sound === "boolean" ? options.sound : DEFAULT_SETTINGS.sound,
  };
}
