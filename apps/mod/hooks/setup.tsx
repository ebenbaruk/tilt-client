// `/tilt setup`: where Tilt sits and how big its cards are, each choice drawn as a small preview.
// No `$` here: the hooks module saves a choice to the mod's own `/config` rows.
import type { RenderElement } from "claude-code";

import { type CardSize, cardRow, cardStack } from "./cards";
import type { Card } from "./protocol";
import type { Placement, Settings } from "./settings";
import { FG1, FG4, FG6, GOLD, INK, LINE3, PINK, type Ui } from "./theme";
import { pinkRule } from "./view";

export type OnChoose = (change: Partial<Settings>) => void;

/** A preview row: the transcript's part (grey), then Tilt's (pink). */
type SketchRow = readonly [transcript: string, tilt: string];

const PLACEMENT_CHOICES: readonly {
  value: Placement;
  hotkey: string;
  label: string;
  about: string;
  rows: SketchRow[];
}[] = [
  {
    value: "side",
    hotkey: "1",
    label: "Side",
    about: "beside the transcript in fullscreen, under it otherwise",
    rows: [
      ["● Edit(auth.ts) │", " TILT   "],
      ["  └ +12 −4      │", " ╭─╮╭─╮ "],
      ["✻ Running…      │", " │9││9│ "],
      ["                │", " ╰─╯╰─╯ "],
      ["❯ _             │", " h s d  "],
    ],
  },
  {
    value: "bottom",
    hotkey: "2",
    label: "Bottom",
    about: "the whole table above the prompt, no pane",
    rows: [
      ["● Edit(auth.ts)          ", ""],
      ["✻ Running…               ", ""],
      ["", " TILT ╭─╮╭─╮  18  h s d  "],
      ["", "      ╰─╯╰─╯             "],
      ["❯ _                      ", ""],
    ],
  },
  {
    value: "compact",
    hotkey: "3",
    label: "Compact",
    about: "two lines above the prompt; /tilt opens the pane",
    rows: [
      ["● Edit(auth.ts)          ", ""],
      ["  └ +12 −4               ", ""],
      ["✻ Running…               ", ""],
      ["", " TILT 12.40 · you 18 · h "],
      ["❯ _                      ", ""],
    ],
  },
];

const CARD_CHOICES: readonly { value: CardSize; hotkey: string; label: string; about: string }[] = [
  { value: "large", hotkey: "l", label: "Large", about: "small where they would not fit" },
  { value: "small", hotkey: "s", label: "Small", about: "one row, for short terminals" },
];

const SAMPLE_HAND: readonly Card[] = [
  { rank: 1, suit: "♠" },
  { rank: 13, suit: "♥" },
];

/** A choice in a frame, pink when it is the one saved. */
function option(ui: Ui, isChosen: boolean, children: readonly (RenderElement | null)[]): RenderElement {
  const { Box } = ui;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={isChosen ? PINK : LINE3} paddingX={1}>
      {children}
    </Box>
  );
}

function choiceButton(ui: Ui, hotkey: string, label: string, isChosen: boolean, onPress: () => void): RenderElement {
  const { Button, Text } = ui;

  return (
    <Button key={`setup-${label.toLowerCase()}`} plain hotkey={hotkey} onPress={onPress}>
      <Text color={isChosen ? PINK : FG1} bold>
        {label}
      </Text>
      {isChosen && <Text color={PINK}>{" ●"}</Text>}
    </Button>
  );
}

/** An on/off choice: its label, then its state in gold when on. */
function toggle(ui: Ui, hotkey: string, label: string, isOn: boolean, onPress: () => void): RenderElement {
  const { Button, Text } = ui;

  return (
    <Button key={`setup-${hotkey}`} plain hotkey={hotkey} onPress={onPress}>
      <Text color={FG1}>
        {`${label} `}
        <Text color={isOn ? GOLD : FG6} bold>
          {isOn ? "on" : "off"}
        </Text>
      </Text>
    </Button>
  );
}

function sketch(ui: Ui, rows: readonly SketchRow[]): RenderElement {
  const { Box, Text } = ui;

  return (
    <Box flexDirection="column">
      {rows.map(([transcript, tilt]) => (
        <Text color={FG6}>
          {transcript}
          <Text color={PINK}>{tilt}</Text>
        </Text>
      ))}
    </Box>
  );
}

function section(ui: Ui, title: string, children: RenderElement): RenderElement {
  const { Box, Text } = ui;

  return (
    <Box flexDirection="column">
      <Text color={FG6}>{title}</Text>
      {children}
    </Box>
  );
}

/** The rows `/tilt setup` asks for: every choice and its preview in view. */
export const SETUP_ROWS = 30;

export function renderSetup(ui: Ui, settings: Settings, columns: number, onChoose: OnChoose): RenderElement {
  const { Box, Text } = ui;

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={2} paddingX={1}>
          <Text color={PINK} bold>
            TILT
          </Text>
          <Text backgroundColor={PINK} color={INK} bold>
            {" setup "}
          </Text>
          <Box flexGrow={1} />
          <Text color={FG4}>saved to /config · applies at once</Text>
        </Box>
        {pinkRule(ui, columns)}
      </Box>
      <Box flexDirection="column" gap={1} paddingX={1}>
        {section(
          ui,
          "WHERE THE TABLE SITS",
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            {PLACEMENT_CHOICES.map((choice) => {
              const isChosen = settings.layout === choice.value;

              return option(ui, isChosen, [
                choiceButton(ui, choice.hotkey, choice.label, isChosen, () => onChoose({ layout: choice.value })),
                sketch(ui, choice.rows),
                <Text color={FG4}>{choice.about}</Text>,
              ]);
            })}
          </Box>,
        )}
        {section(
          ui,
          "CARDS",
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            {CARD_CHOICES.map((choice) => {
              const isChosen = settings.cards === choice.value;

              return option(ui, isChosen, [
                choiceButton(ui, choice.hotkey, choice.label, isChosen, () => onChoose({ cards: choice.value })),
                choice.value === "large" ? cardStack(ui, SAMPLE_HAND) : cardRow(ui, SAMPLE_HAND),
                <Text color={FG4}>{choice.about}</Text>,
              ]);
            })}
          </Box>,
        )}
        {section(
          ui,
          "OPTIONS",
          <Box flexDirection="row" columnGap={4}>
            {toggle(ui, "a", "open Tilt when the agent starts", settings.autoOpen, () =>
              onChoose({ autoOpen: !settings.autoOpen }),
            )}
            {toggle(ui, "m", "sounds on a deal and a win", settings.sound, () => onChoose({ sound: !settings.sound }))}
          </Box>,
        )}
        <Text color={FG6}>ctrl+x tab for the keys · esc closes</Text>
      </Box>
    </Box>
  );
}
