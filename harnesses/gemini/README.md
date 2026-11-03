# Tilt for Gemini CLI

Gemini CLI has no API to draw a panel, capture keys or run a custom status line (the footer only takes built-in items), so you play Tilt in the **companion** app in a split pane. This extension only tells the companion when Gemini is working, through hooks that call `harnesses/companion/bin/tilt-signal`:

| Gemini hook                | Signal           |
| -------------------------- | ---------------- |
| `BeforeAgent` (turn start) | `working --json` |
| `AfterAgent` (turn end)    | `idle --json`    |
| `SessionEnd`               | `idle --json`    |

Gemini parses hook stdout as JSON, so every call uses `--json` (prints `{}`). `tilt-signal` never reads stdin; Gemini pipes the prompt and the reply there, and neither is read.

The hooks use `${extensionPath}/../companion/bin/tilt-signal`. With `gemini extensions link`, `${extensionPath}` is your clone's `harnesses/gemini` folder, so nothing needs editing. Don't use `gemini extensions install` on this folder: it copies the extension and the relative path to the companion breaks.

## Install

```sh
TILT_DIR=/absolute/path/to/Tilt
gemini extensions link "$TILT_DIR/harnesses/gemini"
```

Restart Gemini CLI. `/hooks panel` lists the three `tilt-*` hooks.

Note: since 2026-06-18 Gemini CLI only works with a paid API key or an enterprise licence; consumer accounts were moved to Antigravity CLI, which this pack doesn't cover.

## Play: the companion in a split pane

```sh
export TILT_API_URL=https://your-tilt-api   # the API URL you were given
tmux split-window -h "$TILT_DIR/harnesses/companion/bin/tilt"
```

Any terminal split works. Log in and play from that pane while Gemini works in the other one.

## Uninstall

- `gemini extensions uninstall tilt`
- Optional: `rm -r ~/.tilt` to forget the session.

## Verified vs not

Checked on 2026-10-29 against the docs and source on `main` (Gemini CLI isn't installed here, so not run):

- `gemini-extension.json` (`name`, `version`, `description`), hooks live in `hooks/hooks.json` (not in the manifest), `${extensionPath}` substitution in `hooks/hooks.json`, `gemini extensions link <path>` / `uninstall <name>`: <https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/reference.md>.
- Hook schema (`{matcher?, hooks: [{type: "command", command, name, timeout (ms)}]}`), `BeforeAgent` / `AfterAgent` / `SessionEnd`, stdout must be pure JSON: <https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md>, <https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/index.md>.
- For a linked extension, `${extensionPath}` is the source folder (`effectiveExtensionPath = installMetadata.source`) and `hooks/hooks.json` is hydrated with it: <https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/config/extension-manager.ts>.
- `hooksConfig.enabled` defaults to `true`: <https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md>.

Not verified:

- Whether `AfterAgent` fires when you cancel a turn (Gemini has no interrupt hook). If not, the companion stays in "working" until the next turn ends or the session ends.
- Whether `link` asks for consent before enabling extension hooks.
