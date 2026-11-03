# Tilt for CodeWhale (ex DeepSeek-TUI)

CodeWhale (`codewhale` / `codew`, formerly `deepseek`) has a status bar that only accepts built-in items, and its extension host is sandboxed without network access. So you play Tilt in the **companion** app in a split pane, and CodeWhale's hooks tell the companion when the agent works:

| Event                                                                      | Marks   |
| -------------------------------------------------------------------------- | ------- |
| `session_busy` (an idle or waiting session starts or resumes work)         | working |
| `session_idle`, `waiting_for_user` (approval or question), `session_error` | idle    |

These four events carry only the state transition, no prompt or reply text. The hooks call `harnesses/companion/bin/tilt-signal`, which never reads stdin.

`config.toml` holds the snippet. `<TILT_DIR>` is the absolute path of your Tilt clone.

## Install

```sh
TILT_DIR=/absolute/path/to/Tilt
# Only if ~/.codewhale/config.toml has no [hooks] table yet; otherwise copy the
# [[hooks.hooks]] entries by hand and make sure [hooks] has enabled = true.
sed "s#<TILT_DIR>#$TILT_DIR#g" "$TILT_DIR/harnesses/codewhale/config.toml" >> ~/.codewhale/config.toml
```

Still on the legacy `~/.deepseek/config.toml`? CodeWhale migrates it on first run; edit `~/.codewhale/config.toml` afterwards. Restart CodeWhale and run `/hooks` to check that the four hooks loaded and none were rejected.

Hooks only fire in the interactive TUI (not `codewhale exec`).

## Play: the companion in a split pane

```sh
export TILT_API_URL=https://your-tilt-api   # the API URL you were given
tmux split-window -h "$TILT_DIR/harnesses/companion/bin/tilt"
```

Any terminal split works. Log in and play from that pane while CodeWhale works in the other one.

## Uninstall

- Delete the four `tilt-*` `[[hooks.hooks]]` entries from `~/.codewhale/config.toml` (and the `[hooks]` table if you added it only for Tilt).
- Optional: `rm -r ~/.tilt` to forget the session.

## Verified vs not

Verified against the docs on 2026-10-29 (not run: CodeWhale isn't installed here):

- `[hooks] enabled` + `[[hooks.hooks]] event/command/name/timeout_secs`, commands run with `sh -c`, the 15 events including `session_busy`, `session_idle`, `waiting_for_user`, `session_error` (observers, transition-only payloads), TUI-only scope: <https://github.com/codewhale-hq/Codewhale/blob/main/docs/HOOKS.md>.
- Config path `~/.codewhale/config.toml`, legacy `~/.deepseek/config.toml`: <https://github.com/codewhale-hq/Codewhale/blob/main/docs/CONFIGURATION.md>.

Not verified:

- That the first turn of a session fires `session_busy` (the docs say startup observations stay silent but a new turn from idle should fire it).
