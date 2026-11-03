# Tilt for Kimi Code CLI

For Kimi Code CLI (`MoonshotAI/kimi-code`, the TypeScript successor of the archived Python `kimi-cli`). Kimi can't draw a panel or capture keys, so you play Tilt in the **companion** app in a split pane. Kimi gives two things:

- **Hooks** (this plugin, `kimi.plugin.json`) tell the companion when a turn starts and ends by calling `harnesses/companion/bin/tilt-signal`:

  | Kimi hook                                  | Signal    |
  | ------------------------------------------ | --------- |
  | `TurnStarted`                              | `working` |
  | `Stop`                                     | `idle`    |
  | `Interrupt` (Esc, fires instead of `Stop`) | `idle`    |
  | `StopFailure`                              | `idle`    |

  `tilt-signal` never reads stdin; Kimi pipes the prompt there (`TurnStarted`) and it isn't read. It prints nothing.

- **Status line** (`[status_line].command` in `~/.kimi-code/tui.toml`) runs `harnesses/companion/bin/tilt-status`, whose first line replaces Kimi's footer.

`<TILT_DIR>` is the absolute path of your Tilt clone.

## Install

Kimi copies a local plugin to `~/.kimi-code/plugins/managed/tilt/` and runs it from there, so the hooks need the clone's absolute path, written in before installing:

```sh
TILT_DIR=/absolute/path/to/Tilt
P="$HOME/.tilt/kimi-plugin"
mkdir -p "$P" && sed "s#<TILT_DIR>#$TILT_DIR#g" "$TILT_DIR/harnesses/kimi/kimi.plugin.json" > "$P/kimi.plugin.json"
echo "$P"
```

In Kimi, run `/plugins install <the path printed above>`, then `/reload`.

Status line: add this to `~/.kimi-code/tui.toml` (with `<TILT_DIR>` replaced; a plugin can't set it), then `/reload-tui`:

```toml
[status_line]
command = '"<TILT_DIR>/harnesses/companion/bin/tilt-status"'
```

## Play: the companion in a split pane

```sh
export TILT_API_URL=https://your-tilt-api   # the API URL you were given
tmux split-window -h "$TILT_DIR/harnesses/companion/bin/tilt"
```

Any terminal split works. Log in and play from that pane while Kimi works in the other one.

## Uninstall

- `/plugins remove tilt`, then `/reload`. Kimi keeps the managed copy: `rm -r ~/.kimi-code/plugins/managed/tilt ~/.tilt/kimi-plugin`.
- Remove `[status_line].command` from `~/.kimi-code/tui.toml`.
- Optional: `rm -r ~/.tilt` to forget the session.

## Verified vs not

Checked on 2026-10-29 against the docs on `main` (Kimi Code isn't installed here, so not run):

- `kimi.plugin.json` (`name`, `version`, `description`, `interface`, `hooks` array of `{event, matcher?, command, timeout}`), `/plugins install <local dir>` copies to `$KIMI_CODE_HOME/plugins/managed/<id>/`, `/plugins remove` keeps the copy: <https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/customization/plugins.md>.
- Events `TurnStarted`, `Stop`, `Interrupt` (fires instead of `Stop`), `StopFailure`; only those four rule fields allowed; timeout 1–600 s; hooks fail open: <https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/customization/hooks.md>.
- `[status_line].command` in `tui.toml`: first stdout line replaces the footer, 300 ms cap, at most once per second, `/reload-tui`: <https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/configuration/config-files.md>.

Not verified:

- What triggers a status line refresh (the docs only give the throttle). If Kimi only re-runs it on its own events, the line can lag behind the companion while the agent is idle.
- Whether `/plugins install` asks for confirmation before enabling hooks.
