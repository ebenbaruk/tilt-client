# Tilt for OpenAI Codex CLI

Codex has no API to draw a panel, capture keys or run a custom status line (`tui.status_line` only takes built-in items), so you play Tilt in the **companion** app in a split pane. This pack only tells the companion when Codex is working, through three hooks that call `harnesses/companion/bin/tilt-signal`:

| Codex hook         | Signal                                                   |
| ------------------ | -------------------------------------------------------- |
| `UserPromptSubmit` | `working`                                                |
| `Stop`             | `idle --json` (Codex requires JSON on stdout for `Stop`) |
| `Interrupt`        | `idle`                                                   |

`tilt-signal` never reads stdin. Codex pipes the prompt (`UserPromptSubmit`) and the last reply (`Stop`) there; neither is read.

`<TILT_DIR>` is the absolute path of your Tilt clone.

## Install (plugin)

Codex copies a plugin into `~/.codex/plugins/cache/` on install, so `PLUGIN_ROOT` points to that copy, not to your clone. The hooks therefore need the absolute path of the clone, written in before installing:

```sh
TILT_DIR=/absolute/path/to/Tilt
M="$HOME/.tilt/codex-marketplace"
mkdir -p "$M" && cp -R "$TILT_DIR/harnesses/codex/.agents" "$TILT_DIR/harnesses/codex/plugin" "$M/"
sed "s#<TILT_DIR>#$TILT_DIR#g" "$TILT_DIR/harnesses/codex/plugin/hooks/hooks.json" > "$M/plugin/hooks/hooks.json"
codex plugin marketplace add "$M"
codex plugin add tilt@tilt-local
```

Then start Codex and open `/hooks`: Codex skips every non-managed hook until you **review and trust** it (trust is tied to the hook's hash, so re-trust after any change).

## Install (without a plugin)

If `~/.codex/hooks.json` doesn't exist yet (otherwise merge the three event entries by hand):

```sh
sed "s#<TILT_DIR>#$TILT_DIR#g" "$TILT_DIR/harnesses/codex/plugin/hooks/hooks.json" > ~/.codex/hooks.json
```

Then trust the hooks with `/hooks` as above.

## Play: the companion in a split pane

```sh
export TILT_API_URL=https://your-tilt-api   # the API URL you were given
tmux split-window -h "$TILT_DIR/harnesses/companion/bin/tilt"
```

Any terminal split works. Log in and play from that pane while Codex works in the other one.

## Uninstall

- Plugin: `codex plugin remove tilt`, then `codex plugin marketplace remove tilt-local` and `rm -r ~/.tilt/codex-marketplace`.
- Without a plugin: remove the Tilt entries from `~/.codex/hooks.json`.
- Optional: `rm -r ~/.tilt` to forget the session.

## Verified vs not

Checked on 2026-10-29 against the docs and the local `codex-cli 0.159.3` (`codex plugin --help`, `codex plugin add --help`, `codex plugin marketplace add --help`); not run end to end:

- Hook file shape (`hooks.<Event>[].hooks[] = {type: "command", command, timeout}`), events `UserPromptSubmit` / `Stop` / `Interrupt`, `Stop` needs JSON on stdout, `UserPromptSubmit` plain stdout becomes model context (so `tilt-signal working` prints nothing), `Interrupt` timeout 1–3 s, `/hooks` trust by hash, `~/.codex/hooks.json` location: <https://developers.openai.com/codex/hooks>.
- `.codex-plugin/plugin.json` with `hooks: "./hooks/hooks.json"`, `PLUGIN_ROOT` = installed copy, plugins cached under `~/.codex/plugins/cache/<marketplace>/<plugin>/local/`, marketplace file `.agents/plugins/marketplace.json` with `./`-relative `source.path`, installing doesn't trust hooks: <https://developers.openai.com/plugins/build/plugins>.
- No command-backed status line: <https://developers.openai.com/codex/config-reference>, open request <https://github.com/openai/codex/issues/17827>.

Run on 2026-10-29 with `codex-cli 0.159.3` and an isolated `CODEX_HOME`: `codex plugin marketplace add` then `codex plugin add tilt@tilt-local` installs the plugin pack and reports it `installed, enabled`.

Not verified:

- That the hooks fire during a real turn: the isolated home had no auth, so no turn ran, and the hooks would also need `/hooks` trust.
- That `codex plugin add` (CLI) wires the hooks the same way as the desktop app; the CLI install itself works (above), but the docs point to the desktop app for local installs. The `~/.codex/hooks.json` route doesn't depend on this.
- Whether `Interrupt` fires for every way a turn can be cut short (only Esc-style interrupts are documented).
