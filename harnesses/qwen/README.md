# Tilt for Qwen Code

Qwen Code can't draw a panel or capture keys, so you play Tilt in the **companion** app in a split pane. Qwen gives two things:

- **Hooks** (this extension, `hooks/hooks.json`) tell the companion when a turn starts and ends by calling `harnesses/companion/bin/tilt-signal`:

  | Qwen hook                                                            | Signal    |
  | -------------------------------------------------------------------- | --------- |
  | `UserPromptSubmit`                                                   | `working` |
  | `Stop`                                                               | `idle`    |
  | `StopFailure` (API error or loop detection, fires instead of `Stop`) | `idle`    |
  | `SessionEnd`                                                         | `idle`    |

  `tilt-signal` never reads stdin; Qwen pipes the prompt there and it isn't read. It prints nothing (Qwen would add plain stdout to the model context on `UserPromptSubmit`).

- **Status line** (`ui.statusLine` in your settings) runs `harnesses/companion/bin/tilt-status`, which prints the companion's one-line status in Qwen's footer.

The hooks use `${CLAUDE_PLUGIN_ROOT}/../companion/bin/tilt-signal` (the only variable Qwen substitutes in `hooks/hooks.json`). With `qwen extensions link`, it is your clone's `harnesses/qwen` folder, so nothing needs editing. Don't use `qwen extensions install` on this folder: it copies the extension and the relative path to the companion breaks.

## Install

```sh
TILT_DIR=/absolute/path/to/Tilt
qwen extensions link "$TILT_DIR/harnesses/qwen"
```

Status line: add this to `~/.qwen/settings.json` (merge with any existing `ui` key), with `<TILT_DIR>` replaced. An extension can't set it for you.

```json
{
  "ui": {
    "statusLine": {
      "type": "command",
      "command": "\"<TILT_DIR>/harnesses/companion/bin/tilt-status\"",
      "refreshInterval": 1,
      "respectUserColors": true
    }
  }
}
```

Restart Qwen Code. `/hooks` lists the Tilt hooks under the source Extension.

## Play: the companion in a split pane

```sh
export TILT_API_URL=https://your-tilt-api   # the API URL you were given
tmux split-window -h "$TILT_DIR/harnesses/companion/bin/tilt"
```

Any terminal split works. Log in and play from that pane while Qwen works in the other one.

## Uninstall

- `qwen extensions uninstall tilt`
- Remove `ui.statusLine` from `~/.qwen/settings.json`.
- Optional: `rm -r ~/.tilt` to forget the session.

## Verified vs not

Checked on 2026-10-29 against the docs and source on `main` (Qwen Code isn't installed here, so not run):

- `qwen-extension.json` (`name`, `version`), `qwen extensions link` / `uninstall`: <https://github.com/QwenLM/qwen-code/blob/main/docs/users/extension/introduction.md>.
- Extension hooks are read from `hooks/hooks.json` (`{"hooks": {...}}`) for native Qwen extensions, `${CLAUDE_PLUGIN_ROOT}` is replaced with the extension path, and for a linked extension that path is the source folder: `loadExtension` and `substituteHookVariables` in <https://github.com/QwenLM/qwen-code/blob/main/packages/core/src/extension/extensionManager.ts> and <https://github.com/QwenLM/qwen-code/blob/main/packages/core/src/extension/variables.ts>.
- Hook schema, `timeout` in seconds, events `UserPromptSubmit` / `Stop` / `StopFailure` / `SessionEnd`, hooks on by default, plain stdout on `UserPromptSubmit` becomes model context: <https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/hooks.md>.
- `ui.statusLine` command mode (`refreshInterval` ≥ 1 s, `respectUserColors`, up to 2 lines): <https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/status-line.md>.

Not verified:

- What fires when you cancel a turn with Esc: no interrupt hook is documented, and `Stop` may not run. If not, the companion stays in "working" until the next turn ends.
- `UserPromptSubmit` also fires on tool-result sends inside a turn; that only repeats `working`, which is harmless.
