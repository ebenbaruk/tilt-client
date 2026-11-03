# Tilt for Grok Build (and superagent grok-cli)

Grok Build (`grok`, xAI) can't host an interactive panel: extensions can't draw in the TUI or bind keys. So you play Tilt in the **companion** app in a split pane. Grok gives two things:

- **Hooks** tell the companion when the agent is working (`UserPromptSubmit`) and when it stops (`Stop`, `StopFailure`, `StopCancelled`, `SessionEnd`). They call `harnesses/companion/bin/tilt-signal`, which never reads stdin, so the prompt Grok pipes there is never read.
- **Status line**: Grok's `[ui.status_line]` runs `harnesses/companion/bin/tilt-status` and shows the companion's one-line summary under the prompt.

Files:

| File                          | Goes to                                                       |
| ----------------------------- | ------------------------------------------------------------- |
| `tilt.json`                   | `~/.grok/hooks/tilt.json` (Grok Build)                        |
| `config.toml`                 | append to `~/.grok/config.toml` (Grok Build)                  |
| `grok-cli/user-settings.json` | merge into `~/.grok/user-settings.json` (superagent grok-cli) |

`<TILT_DIR>` is the absolute path of your Tilt clone.

## Install (Grok Build)

```sh
TILT_DIR=/absolute/path/to/Tilt
mkdir -p ~/.grok/hooks
sed "s#<TILT_DIR>#$TILT_DIR#g" "$TILT_DIR/harnesses/grok/tilt.json" > ~/.grok/hooks/tilt.json
# Only if ~/.grok/config.toml has no [ui.status_line] yet; otherwise edit that section by hand.
sed "s#<TILT_DIR>#$TILT_DIR#g" "$TILT_DIR/harnesses/grok/config.toml" >> ~/.grok/config.toml
```

Restart Grok (it reads `[ui.status_line]` at startup). Check with `/hooks` and `grok inspect`.

## Install (superagent grok-cli, `grok-dev`)

The community [superagent-ai/grok-cli](https://github.com/superagent-ai/grok-cli) has hooks in `~/.grok/user-settings.json` but no status line. Merge the `hooks` object from `grok-cli/user-settings.json` into that file (replace `<TILT_DIR>`). Don't overwrite the file: it holds your other settings.

## Play: the companion in a split pane

```sh
export TILT_API_URL=https://your-tilt-api   # the API URL you were given
tmux split-window -h "$TILT_DIR/harnesses/companion/bin/tilt"
```

Any terminal split works (iTerm2, WezTerm, Kitty, Windows Terminal). Log in and play from that pane while Grok works in the other one.

## Uninstall

- `rm ~/.grok/hooks/tilt.json`
- Remove the `[ui.status_line]` section from `~/.grok/config.toml` (or set `type = "disabled"`).
- grok-cli: remove the Tilt entries from `hooks` in `~/.grok/user-settings.json`.
- Optional: `rm -r ~/.tilt` to forget the session.

## Verified vs not

Verified against the docs on 2026-10-29 (not run: Grok isn't installed here):

- Hook file location `~/.grok/hooks/*.json`, `{"hooks": {Event: [{matcher?, hooks: [{type, command, timeout}]}]}}` shape, `command` = path or inline shell command, stdin JSON, passive events ignore stdout: <https://docs.x.ai/build/features/hooks>, <https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/10-hooks.md>.
- `StopCancelled` fires instead of `Stop` on interrupts, declined permissions and turn limits; `Stop` also fires once at session end: same `10-hooks.md`.
- `[ui.status_line] type = "command"`, `command`, `refresh_interval` (1–86,400 s, re-runs while idle), user config only, 10 s timeout, up to 5 lines: <https://docs.x.ai/build/features/status-line>, `25-status-line.md` in the same repo.
- grok-cli hook config and events: <https://github.com/superagent-ai/grok-cli/blob/main/README.md#hooks>.

Not verified:

- Whether Grok tolerates a status-line script that exits without reading the stdin payload (`tilt-status` never reads stdin). It should, since the payload is small.
- grok-cli: whether `matcher` may be omitted on lifecycle events (its README only shows a tool matcher), and whether `StopCancelled` exists there (not in its event list, so an interrupted turn may stay "working" until the next turn ends).
- Grok Build also reads Cursor's `.cursor/hooks.json` and Claude Code's `.claude/settings.json`. If you also installed Tilt for those, the signal may fire twice per turn, which is harmless.
