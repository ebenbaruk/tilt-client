# Tilt for Crush

Crush (Charm) has no API to draw a panel, add a status line or capture keys, so you play Tilt in the **companion** app in a split pane. Crush's hooks tell the companion when the agent works: `TurnStart` marks it working; `TurnEnd`, `Interrupt` (ctrl-c / escape) and `StopFailure` (provider error) mark it idle. They call `harnesses/companion/bin/tilt-signal`, which never reads stdin. Crush pipes the payload there, including the assistant's reply on `TurnEnd`; it's never read.

`crushrc` holds the four `hook add` lines. `<TILT_DIR>` is the absolute path of your Tilt clone.

## Install

Needs Crush v0.99.0 or later (the release that added these hooks).

```sh
TILT_DIR=/absolute/path/to/Tilt
mkdir -p ~/.config/crush
sed "s#<TILT_DIR>#$TILT_DIR#g" "$TILT_DIR/harnesses/crush/crushrc" >> ~/.config/crush/crushrc
```

Global `crushrc` hooks need absolute paths, hence the `sed`. Restart Crush.

## Play: the companion in a split pane

```sh
export TILT_API_URL=https://your-tilt-api   # the API URL you were given
tmux split-window -h "$TILT_DIR/harnesses/companion/bin/tilt"
```

Any terminal split works. Log in and play from that pane while Crush works in the other one. Crush has no status line, so the Tilt state is only in the companion.

## Uninstall

- Delete the four `hook add ... tilt-signal ...` lines from `~/.config/crush/crushrc`.
- Optional: `rm -r ~/.tilt` to forget the session.

## Verified vs not

Verified against the docs on 2026-10-29 (not run: Crush isn't installed here):

- `hook add <Event> --name --command --timeout` in `~/.config/crush/crushrc`, absolute paths for global hooks, events `TurnStart`, `TurnEnd`, `Interrupt`, `StopFailure` (observe-only, top-level agent only), scripts with a `#!` line run through `os/exec`, stdin JSON, exit 0 with empty stdout = no opinion: <https://github.com/charmbracelet/crush/blob/main/docs/hooks/README.md>.
- Release with these hooks: <https://github.com/charmbracelet/crush/releases/tag/v0.99.0>.

Not verified:

- Nothing was run against a live Crush. `SessionEnd` is not hooked on purpose: the docs say `Interrupt` fires first when a running turn is cancelled at exit, and an idle session is already idle.
