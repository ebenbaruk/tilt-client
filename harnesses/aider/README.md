# Tilt for Aider

Aider has no plugins, hooks, status line or key bindings. It has one integration point: `notifications_command`, which aider runs when the LLM has finished and it waits for your input. So:

- You play Tilt in the **companion** app in a split pane.
- `aider.conf.yml` makes aider run `harnesses/companion/bin/tilt-signal idle` at the end of each turn.
- **The "agent is working" indicator is unavailable on aider.** Aider sends no turn-start signal, so the companion never learns that aider started working. The game itself works as everywhere else; only that indicator is missing.

`tilt-signal` never reads stdin, and aider passes it no prompt or reply.

`<TILT_DIR>` is the absolute path of your Tilt clone.

## Install

```sh
TILT_DIR=/absolute/path/to/Tilt
# Only if ~/.aider.conf.yml has no notifications keys yet; otherwise edit them by hand.
sed "s#<TILT_DIR>#$TILT_DIR#g" "$TILT_DIR/harnesses/aider/aider.conf.yml" >> ~/.aider.conf.yml
```

Or per run: `aider --notifications --notifications-command "$TILT_DIR/harnesses/companion/bin/tilt-signal idle"`. The env equivalents are `AIDER_NOTIFICATIONS=true` and `AIDER_NOTIFICATIONS_COMMAND=...`.

This replaces aider's default notification (terminal bell or desktop notification).

## Play: the companion in a split pane

```sh
export TILT_API_URL=https://your-tilt-api   # the API URL you were given
tmux split-window -h "$TILT_DIR/harnesses/companion/bin/tilt"
```

Any terminal split works. Log in and play from that pane while aider works in the other one.

## Uninstall

- Remove `notifications` and `notifications_command` from `~/.aider.conf.yml` (or drop the flags / env vars).
- Optional: `rm -r ~/.tilt` to forget the session.

## Verified vs not

Verified on 2026-10-29 (not run: aider isn't installed here):

- `--notifications`, `--notifications-command`, the `notifications` / `notifications_command` YAML keys and env vars: <https://aider.chat/docs/usage/notifications.html>.
- Aider runs the command with `subprocess.run(..., shell=True)`, waits for it, and only if `notifications` is on (`InputOutput.ring_bell` in <https://github.com/Aider-AI/aider/blob/main/aider/io.py>). That's why both keys are set and why `tilt-signal` must stay fast.
- No hook or plugin system exists upstream: <https://github.com/Aider-AI/aider>.

Not verified:

- Whether the command also runs after a turn you interrupt with ctrl-c.
