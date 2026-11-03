# Tilt for Factory Droid

Droid (`droid`, Factory) has no API to draw a panel or capture keys, so you play Tilt in the **companion** app in a split pane. Droid gives two things:

- **Hooks** (`hooks.json`) tell the companion when a turn starts (`UserPromptSubmit`) and ends (`Stop`; `Notification` of type `idle_prompt`, which Droid sends instead of `Stop` when you cancel; `SessionEnd`). They call `harnesses/companion/bin/tilt-signal`, which never reads stdin. Droid pipes the prompt and a `transcript_path` there; neither is read.
- **Status line** (`statusLine` in `settings.json`) runs `harnesses/companion/bin/tilt-status`, whose output Droid shows above the input.

`<TILT_DIR>` is the absolute path of your Tilt clone.

## Install

```sh
TILT_DIR=/absolute/path/to/Tilt
# Only if ~/.factory/hooks.json doesn't exist yet; otherwise merge the event entries by hand.
sed "s#<TILT_DIR>#$TILT_DIR#g" "$TILT_DIR/harnesses/droid/hooks.json" > ~/.factory/hooks.json
```

Then add the `statusLine` key from `settings.json` (with `<TILT_DIR>` replaced) to `~/.factory/settings.json`, or set it with `/statusline` in Droid. Restart Droid: it snapshots hooks at startup. `/hooks` → **Effective** shows what's loaded.

## Play: the companion in a split pane

```sh
export TILT_API_URL=https://your-tilt-api   # the API URL you were given
tmux split-window -h "$TILT_DIR/harnesses/companion/bin/tilt"
```

Any terminal split works. Log in and play from that pane while Droid works in the other one.

## Uninstall

- Remove the Tilt entries from `~/.factory/hooks.json` (or delete the file if it only holds them).
- Remove `statusLine` from `~/.factory/settings.json`.
- Optional: `rm -r ~/.tilt` to forget the session.

## Verified vs not

Verified against the docs on 2026-10-29 (not run: Droid isn't installed here):

- `~/.factory/hooks.json` is keyed directly by event name, groups `{matcher?, hooks: [{type: "command", command, timeout}]}`, absolute paths recommended; events `UserPromptSubmit`, `Stop`, `Notification` (`notification_type` `idle_prompt` is sent after a cancel too), `SessionEnd`; cancel emits `Notification` instead of `Stop`; exit 0 = success: <https://docs.factory.ai/harness/hooks.md>.
- `statusLine: { command, padding?, maxRows? }`, stdout rendered above the input: <https://docs.factory.ai/droid-cli/settings.md>.

Not verified:

- That a `Notification` matcher is tested against `notification_type` (as in Claude Code). The docs only say matchers can target "lifecycle matchers". If `idle_prompt` never matches, a cancelled turn stays "working" until the next turn ends.
- How often the status line refreshes, whether it gets a stdin payload, and ANSI color support. `tilt-status` ignores stdin either way.
- For `UserPromptSubmit`, Droid adds a hook's stdout to the context. `tilt-signal` without `--json` prints nothing, so nothing is added.
