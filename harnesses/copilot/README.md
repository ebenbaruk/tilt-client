# Tilt for GitHub Copilot CLI

A Copilot CLI extension that adds `/tilt`: the Tilt table plays through Copilot's select dialogs
while the agent works, and prints in the timeline. The agent's working/idle state comes from the
`assistant.turn_start` and `session.idle` events, used for their timing only. The extension never
reads prompts, replies, tool calls or event payloads, and runs no shell command except the
platform opener (`open`, `xdg-open`, `rundll32`) for the login page.

Extensions are an **experimental** Copilot CLI feature and may change.

## Files

- `extension.mjs`: the entry the CLI runs with Node. It lets Node load the shared TypeScript
  table (`packages/play`) straight from your clone, then joins the session.
- `tilt.ts`: the `/tilt` command, the play loop and the turn tracking.
- `copilot.ts`: the few SDK types used, declared locally (the SDK ships inside the CLI).

## Install

1. Point Tilt at its API in the environment you start Copilot from (no host is ever guessed):
   `export TILT_API_URL=https://…`
2. Link this folder as a user extension. Replace `<TILT_DIR>` with the absolute path of your clone:

   ```sh
   mkdir -p ~/.copilot/extensions
   ln -s <TILT_DIR>/harnesses/copilot ~/.copilot/extensions/tilt
   ```

3. Start Copilot with extensions on: `copilot --experimental` (or `/experimental on` in a running
   session, then `/clear`). `/extensions manage` should list `tilt` under **User** as running.
   Problems are logged under `~/.copilot/logs/extensions/`.

## Play

| Command        | What it does                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------- |
| `/tilt login`  | Opens the login page and prints the code to confirm; the timeline says when you're in.         |
| `/tilt`        | Opens a dialog with the table and its keys; pick moves until you cancel it.                    |
| `/tilt table`  | Prints the table in the timeline.                                                              |
| `/tilt <key>`  | Presses one key (e.g. `/tilt 1`), then prints the table. Use it where dialogs are unavailable. |
| `/tilt logout` | Signs out on this machine.                                                                     |

The extension also writes the turn file `~/.tilt/agent.json`, so the companion app
(`harnesses/companion/bin/tilt` in a split pane) shows a live table you play with single keys
while Copilot works.

## Uninstall

`rm ~/.copilot/extensions/tilt`, then `/clear` or restart Copilot. `~/.tilt/session.json` holds the
login shared by every Tilt harness; delete it (or `/tilt logout` first) to sign out everywhere.

## Verified vs not

Verified against the docs and SDK source (2026-10-29, CLI 1.0.105):

- Extension location, `joinSession`, `commands` with `ctx.args`, `session.log`, `--experimental`,
  `/extensions manage`: <https://docs.github.com/en/copilot/tutorials/create-an-extension>.
- `assistant.turn_start` and `session.idle` events: <https://github.com/github/copilot-sdk/blob/main/nodejs/docs/examples.md>.
- `session.ui.select(message, options)` returning the choice or `null`, gated by
  `session.capabilities.ui.elicitation`; `requestedEnvironmentVariables` (the CLI strips sensitive
  variables from extensions): `nodejs/src/session.ts`, `nodejs/src/types.ts`, `nodejs/src/extension.ts`
  and `nodejs/docs/extensions.md` in <https://github.com/github/copilot-sdk>.
- The adapter and the shared table load under plain Node 22.23 with type stripping and the
  resolve hook in `extension.mjs`, and answer `/tilt` against a fake session.

Not verified (no Copilot CLI was run):

- That the CLI runs extensions on a Node with type stripping (22.18+) and `module.registerHooks`
  (22.15+). The 1.0.105 linux binary embeds Node v24.22.1, which has both, but how it forks
  extensions is not documented.
- That a symlinked extension folder is discovered. If it is not, create a real
  `~/.copilot/extensions/tilt/` folder whose `extension.mjs` holds the single line
  `import "<TILT_DIR>/harnesses/copilot/extension.mjs";`. Whether the CLI then resolves the SDK
  import from your clone is also unverified.
- How the timeline renders `session.log` text (Markdown or plain) and whether the select dialog
  keeps the table's line breaks and columns. The table is plain text at 72 columns because the
  extension cannot read the terminal width.
- Whether `TILT_API_URL` counts as sensitive; if it does, the CLI asks once to pass it through.
