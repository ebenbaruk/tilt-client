# Tilt companion

The Tilt table as a full-screen terminal app. Run it in a split pane next to any coding agent
(Codex, Gemini CLI, Aider, OpenCode, …) and play with single keys while the agent works. Harness
folders that have turn hooks or a status line point at the scripts in `bin/`.

## Requirements

A clone of this repo and [Bun](https://bun.sh). `bin/tilt` runs `bun tilt.ts`: nothing is
downloaded when it starts, so the code that runs is the code in the clone.

## Run

```sh
chmod +x <TILT_DIR>/harnesses/companion/bin/*   # once, if your checkout lost the executable bit
export TILT_API_URL=https://your-tilt-api.example # https only; plain http only on localhost
<TILT_DIR>/harnesses/companion/bin/tilt
```

`<TILT_DIR>` is the absolute path of your clone. Open it next to the agent:

- **tmux:** `tmux split-window -h "<TILT_DIR>/harnesses/companion/bin/tilt"` (inherits `TILT_API_URL` from the tmux server's environment; else prefix the command with `TILT_API_URL=… `).
- **WezTerm:** `wezterm cli split-pane --right --percent 40 -- <TILT_DIR>/harnesses/companion/bin/tilt`.
- **iTerm2:** split the window with Cmd+D, then run `bin/tilt` in the new pane.
- **Windows Terminal:** `wt -w 0 split-pane -V bun <TILT_DIR>\harnesses\companion\tilt.ts`
  (`bin/tilt` is a POSIX sh script; on Windows call Bun on `tilt.ts` directly).

Keys:

| Key              | Action                                                                         |
| ---------------- | ------------------------------------------------------------------------------ |
| letters / digits | the hotkeys shown on the table (Caps Lock is fine)                             |
| Ctrl+L           | log in when logged out; log out (or cancel a pending login) on a second Ctrl+L |
| Ctrl+C / Ctrl+D  | quit                                                                           |

Login opens the confirmation page with `open` (macOS), `xdg-open` (Linux) or `rundll32`
(Windows), without a shell; the code and link also stay on the table. The session token lives in
`~/.tilt/session.json` (mode 0600). Logging out removes it.

## Signal and status contract

Turn hooks in other harness folders call these scripts by absolute path. Both are POSIX sh, never
read stdin (it carries the user's prompt in several harnesses), and always exit 0 quickly.

- `bin/tilt-signal <working|idle> [--json]` writes `~/.tilt/agent.json` atomically
  (`{"state":"working","at":<unix seconds>}`, mode 0600). `--json` prints `{}` for harnesses that
  require JSON on stdout. Any other state is ignored.
- `bin/tilt-status` prints the line the companion keeps in `~/.tilt/status.txt` (rewritten
  atomically on every change, removed when the companion quits), or
  `TILT · run <dir>/tilt` when the companion is not running. For status-line harnesses.

The companion watches `~/.tilt/agent.json` and shows whether the agent is working.

## Privacy

The companion and the scripts only know when a turn starts and ends. They never read prompts,
replies, code, tool calls or transcripts, and run no command other than the platform opener for
the login page. The only server contacted is `TILT_API_URL`.

## Uninstall

Quit the companion, remove the hook or status-line entries you added in other harnesses, and
delete `~/.tilt/` (the token, the turn signal and the status line).

## Verified / not verified

- Verified: `tilt-signal` / `tilt-status` on Linux (dash): atomic write, 0600, `{}` with `--json`,
  stdin closed, exit 0. On Linux under Bun in a pseudo-terminal: the table draws, a
  `tilt-signal working` shows up, Ctrl+L starts a login, Ctrl+C / Ctrl+D quit and restore the
  terminal, and `status.txt` is written 0600 then removed on exit. It refuses a non-terminal stdin,
  as intended.
- Verified on 2026-10-29 on Linux (Bun 1.4.2, in tmux) against the fake API
  (`bun packages/play/test/fake-api.ts 8099`), not the real one: `TILT_API_URL=… bin/tilt` renders
  the table and `n` rolls the dice; `tilt-signal working --json`, with text piped on stdin (not
  read), prints `{}` and switches the pane to `● agent working`; `tilt-signal idle` switches it to
  `✓ agent finished…`; `tilt-status` prints `TILT 100.10 · Dice · −0.10 · agent working`; Ctrl+C
  quits and removes `status.txt`.
- Split-pane commands follow the official docs:
  [tmux](https://man7.org/linux/man-pages/man1/tmux.1.html),
  [WezTerm](https://wezterm.org/cli/cli/split-pane.html),
  [Windows Terminal](https://learn.microsoft.com/en-us/windows/terminal/command-line-arguments),
  [iTerm2](https://iterm2.com/documentation-one-page.html).
- Not verified: login and play against the real API, a full interactive Node + tsx run, macOS `open`, and the
  Windows opener and Windows Terminal launch.
