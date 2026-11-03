# Tilt for omp and pi

This is a single extension module, `index.ts`, that works in both
[omp (oh-my-pi)](https://github.com/can1357/oh-my-pi) and
[pi](https://github.com/earendil-works/pi). It draws the Tilt table as a widget above the editor,
and you play it with the keys while the agent works. omp loads the file with Bun and pi loads it
with jiti, straight from a clone of this repo. You don't need to install or build anything. The
only import is the shared core, `../../packages/play/src/index`, by relative path, so keep the file
inside the clone.

## Install

`TILT_API_URL` must be set in the environment that starts the harness, for example
`export TILT_API_URL=https://<your Tilt API>`. If it isn't set, the widget shows
`TILT · set TILT_API_URL` and the extension does nothing else. Replace `<TILT_DIR>` below with the
absolute path of your clone.

### omp

Choose one of these:

```sh
# 1. Auto-discovered user extension: a one-line re-export from the clone
mkdir -p ~/.omp/agent/extensions
printf 'export { default } from "%s/harnesses/pi/index.ts";\n' "<TILT_DIR>" > ~/.omp/agent/extensions/tilt.ts

# 2. Configured path: add the file to the extensions list in ~/.omp/agent/config.yml
#    extensions:
#      - <TILT_DIR>/harnesses/pi/index.ts

# 3. A single run
omp -e <TILT_DIR>/harnesses/pi/index.ts
```

### pi

Choose one of these:

```sh
# 1. A single run
pi -e <TILT_DIR>/harnesses/pi/index.ts

# 2. Auto-discovered global extension (/reload picks up changes)
mkdir -p ~/.pi/agent/extensions
printf 'export { default } from "%s/harnesses/pi/index.ts";\n' "<TILT_DIR>" > ~/.pi/agent/extensions/tilt.ts

# 3. Configured path: add the file to "extensions" in ~/.pi/agent/settings.json
#    { "extensions": ["<TILT_DIR>/harnesses/pi/index.ts"] }
```

### Uninstall

Delete `~/.omp/agent/extensions/tilt.ts` or `~/.pi/agent/extensions/tilt.ts`, or remove the path
from `config.yml` or `settings.json`. To sign out as well, delete `~/.tilt/session.json`, or run
`/tilt logout` before you uninstall.

## Play

| Input                            | Effect                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/tilt login`                    | Starts the device login. Your browser opens the confirmation page (`xdg-open`, `open` or `rundll32`, depending on the platform) and the table shows the code. |
| `/tilt logout`                   | Signs out.                                                                                                                                                    |
| `/tilt`                          | Shows or hides the table. A hidden table shrinks to one status line.                                                                                          |
| `alt+t`                          | Turns game mode on or off.                                                                                                                                    |
| letters and digits, in game mode | Play the table. The table lists the key for each move.                                                                                                        |
| `esc`, in game mode              | Leaves game mode so you can type prompts again.                                                                                                               |

`alt+t` isn't bound by default in pi or omp. omp uses it only inside its `/tree` selector overlay,
where the overlay gets the key first. In game mode every single typed character is taken from the
editor, so nothing leaks into your prompt. Enter, ctrl keys, arrows, pastes and `alt+t` still reach
the harness. **Outside game mode the extension doesn't take any keystroke.**

The widget is a component, not a string array, because both hosts cut string widgets at 10 lines.
It is drawn at the width the host passes on each frame, or 80 columns when the host passes none.
Set `NO_COLOR` to turn colours off. Your token and table choices are kept in
`~/.tilt/session.json` with mode 0600, and that file is shared with the other Tilt harnesses.

## Privacy

- To know whether the agent is working, the extension listens only to `agent_start` and
  `agent_end` of the main agent. In omp that is `ctx.agent.kind === "main"`, which leaves out
  subagents and the advisor. It never reads their payloads.
- It never subscribes to `input`, `before_agent_start`, `message_*`, `tool_*`, `context` or provider
  events, and it never reads the session history.
- The only command it runs is the platform opener, called with the login URL through `pi.exec`. Its
  only network traffic goes to `TILT_API_URL`, through the shared core.
- Both hosts run extensions in-process without a sandbox. These guarantees come from this code, not
  from the harness.

## Verified vs not

These points were checked against the host source and docs on 2026-10-29:

- omp: the `ExtensionUIContext` methods `setWidget`, which accepts a `(tui, theme) => Component`
  factory, and `onTerminalInput`, `registerShortcut`, `registerCommand`, `exec`, `ctx.mode` and
  `ctx.agent.kind`
  ([types.ts](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/extensibility/extensions/types.ts)).
- omp: input listeners run before the focused editor and before shortcuts, and returning
  `{ consume: true }` stops the key there (`packages/tui/src/tui.ts`).
- omp: string widgets are capped at 10 lines (`extension-ui-controller.ts`, `MAX_WIDGET_LINES`).
- omp: `/new`, `/resume` and forks clear extension widgets and input listeners and then emit
  `session_switch` instead of `session_start`, so the extension draws itself again on that event
  (`extension-ui-controller.ts`, `interactive-mode.ts#prepareSessionSwitch`).
- omp: the reserved shortcuts don't include `alt+t`
  ([extensions.md, "Constraints"](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/docs/extensions.md)).
- omp: the discovery paths `~/.omp/agent/extensions/*.ts`, the `extensions:` key in
  `~/.omp/agent/config.yml`, and `-e`
  ([extension-loading.md](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/docs/extension-loading.md)).
- pi: the same UI and API methods, `-e`, `~/.pi/agent/extensions/`, `settings.json#extensions`,
  `agent_start`/`agent_end`, and the 10-line string widget cap
  ([docs/extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md),
  `src/modes/interactive/interactive-mode.ts`).
- pi: `alt+t` doesn't appear in the default keybindings
  ([docs/keybindings.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/keybindings.md)).
- pi: registering `session_switch`, an event pi doesn't emit, only stores a handler that never
  runs (`src/core/extensions/loader.ts`).

Run on 2026-10-29 in omp 18.11.1 on Linux (`omp --no-extensions -e <TILT_DIR>/harnesses/pi/index.ts`
in tmux), against the fake API (`bun packages/play/test/fake-api.ts 8099`), not the real one:

- The extension loads and the widget shows above the editor: the logged-out invite line, then the
  full table.
- `/tilt login` completes the device login.
- `alt+t` enters game mode; `n` deals a blackjack hand; on dice, `6` then `n` rolls and settles,
  and the balance updates.
- Esc leaves game mode, and text typed afterwards goes to the prompt: no key is captured outside
  game mode.
- Sending a prompt shows `● agent working` during the turn and `✓ agent finished in 2s` after.

Not verified:

- **pi itself hasn't been run**, only omp. Nothing has been tried against the real API.
- Whether jiti (pi) resolves the core's extensionless relative imports. It is expected to, but it
  hasn't been run.
- `tui.requestRender()` from a widget factory: the widget repainted in omp, but it hasn't been
  observed in pi.
- Kitty keyboard protocol: plain letters are assumed to arrive as text, which holds for the flags
  omp pushes, and Esc as `\x1b` or `\x1b[27u`. Other terminals' encodings haven't been tried.
- pi's `agent_end` isn't its final idle event (`agent_settled` is). During auto-retries the table
  can briefly show the agent as idle.
- In omp, an exception inside the shared core's own timers would take the session down, because
  raw timers aren't isolated. This extension doesn't start any timers itself.
