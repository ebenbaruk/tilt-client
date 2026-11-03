# Tilt for Cursor CLI

The Cursor CLI (`agent` / `cursor-agent`) has no API to draw a panel or capture keys, so you play Tilt in the **companion** app in a split pane. Cursor gives two things:

- **Hooks** (`hooks.json`) tell the companion when a turn starts (`beforeSubmitPrompt`) and ends (`stop`, which fires for completed, aborted and errored turns, plus `sessionEnd`). The two scripts in `hooks/` call `harnesses/companion/bin/tilt-signal` and never read stdin. Cursor pipes the prompt there; it's never read. `before-submit-prompt` answers `{"continue":true}` because that hook may hold the prompt back otherwise.
- **Status line** (`statusLine` in `cli-config.json`) runs `harnesses/companion/bin/tilt-status` and shows its output above the prompt.

The hook commands are wrapper scripts with no arguments because the docs don't say whether hook commands run through a shell.

`<TILT_DIR>` is the absolute path of your Tilt clone.

## Install

```sh
TILT_DIR=/absolute/path/to/Tilt
# Only if ~/.cursor/hooks.json doesn't exist yet; otherwise merge the entries by hand.
sed "s#<TILT_DIR>#$TILT_DIR#g" "$TILT_DIR/harnesses/cursor/hooks.json" > ~/.cursor/hooks.json
```

Then add the `statusLine` key from `cli-config.json` (with `<TILT_DIR>` replaced) to `~/.cursor/cli-config.json`. Keep the rest of that file: `version`, `editor` and `permissions` are required. Cursor reloads `hooks.json` automatically; restart the CLI for the status line.

## Play: the companion in a split pane

```sh
export TILT_API_URL=https://your-tilt-api   # the API URL you were given
tmux split-window -h "$TILT_DIR/harnesses/companion/bin/tilt"
```

Any terminal split works. Log in and play from that pane while Cursor works in the other one.

## Uninstall

- Remove the Tilt entries from `~/.cursor/hooks.json` (or delete the file if it only holds them).
- Remove `statusLine` from `~/.cursor/cli-config.json`.
- Optional: `rm -r ~/.tilt` to forget the session.

## Verified vs not

Verified against the docs on 2026-10-29 (not run: Cursor isn't installed here):

- `~/.cursor/hooks.json` shape `{"version": 1, "hooks": {event: [{command, timeout?}]}}`, user hooks, `beforeSubmitPrompt` input (the prompt) and output (`continue`, `user_message`), `stop` input `status: completed | aborted | error`, `sessionEnd`, exit codes: <https://cursor.com/docs/hooks.md>.
- The CLI runs hooks and has a custom `statusLine`: <https://cursor.com/docs/cli/changelog.md>.
- `statusLine` fields (`type: "command"`, `command`, `padding`, `updateIntervalMs`, `timeoutMs`), spawned without a shell on Unix, multi-line ANSI output, re-run on conversation updates: Cursor's built-in `statusline` skill, read from a public copy at <https://github.com/SvenBotha/cursor-skills/blob/master/statusline/SKILL.md>. The official config reference (<https://cursor.com/docs/cli/reference/configuration.md>) doesn't list `statusLine` yet.

Not verified:

- Whether `beforeSubmitPrompt` treats `{}` as "continue" (we print `{"continue":true}` to be safe).
- Whether the status line refreshes while the conversation is idle. It is re-run on conversation updates, so the Tilt line may lag behind bets you place in the companion until the next update.
- Grok Build also reads `.cursor/hooks.json`; if you use both, the signal may fire twice per turn, which is harmless.
