# Tilt for Cline CLI

The Cline CLI (`cline -i`) has no documented API to draw in its TUI or capture keys, so you play Tilt in the **companion** app in a split pane. Cline's **file hooks** tell the companion when the agent works:

| Hook file                                                                | Marks   |
| ------------------------------------------------------------------------ | ------- |
| `TaskStart.sh`, `TaskResume.sh`, `UserPromptSubmit.sh`                   | working |
| `TaskComplete.sh`, `TaskError.sh`, `TaskCancel.sh`, `SessionShutdown.sh` | idle    |

Each one runs `harnesses/companion/bin/tilt-signal <state> --json` with stdin closed, so the event JSON Cline pipes in (with the prompt, for `UserPromptSubmit`) is never read. Cline expects JSON on stdout; `--json` prints `{}`, which means "do nothing".

`<TILT_DIR>` is the absolute path of your Tilt clone.

## Install

Option A: point Cline at this folder (no files copied):

```sh
TILT_DIR=/absolute/path/to/Tilt
export CLINE_HOOKS_DIR="$TILT_DIR/harnesses/cline/hooks"   # or: cline --hooks-dir "$TILT_DIR/harnesses/cline/hooks" -i
```

Option B: add one-line wrappers to your own hooks directory (`~/.cline/hooks`). This skips any file that already exists, so it never overwrites your hooks:

```sh
TILT_DIR=/absolute/path/to/Tilt
mkdir -p ~/.cline/hooks
for hook in TaskStart TaskResume UserPromptSubmit TaskComplete TaskError TaskCancel SessionShutdown; do
  target=~/.cline/hooks/$hook.sh
  [ -e "$target" ] && { echo "skip $target (exists: call $TILT_DIR/harnesses/cline/hooks/$hook.sh from it)"; continue; }
  printf '#!/bin/sh\nexec "%s/harnesses/cline/hooks/%s.sh"\n' "$TILT_DIR" "$hook" > "$target"
  chmod +x "$target"
done
```

Hooks are disabled in `--yolo` mode.

## Play: the companion in a split pane

```sh
export TILT_API_URL=https://your-tilt-api   # the API URL you were given
tmux split-window -h "$TILT_DIR/harnesses/companion/bin/tilt"
```

Any terminal split works. Log in and play from that pane while Cline works in the other one.

## Uninstall

- Option A: unset `CLINE_HOOKS_DIR` / drop `--hooks-dir`.
- Option B: delete the seven wrappers from `~/.cline/hooks` (the ones that `exec .../harnesses/cline/hooks/...`).
- Optional: `rm -r ~/.tilt` to forget the session.

## Verified vs not

Verified against the docs on 2026-10-29 (not run: Cline isn't installed here):

- File hook names, their events (`TaskStart` = `agent_start`, `TaskComplete` = `agent_end`, `TaskError`, `TaskCancel`, `SessionShutdown`…), `.sh` scripts in `.cline/hooks/`, JSON on stdin, JSON required on stdout (`{}` = do nothing), hooks off in `--yolo`: <https://github.com/cline/cline/blob/main/sdk/examples/hooks/README.md>.
- `--hooks-dir` (default `~/.cline/hooks`) and `CLINE_HOOKS_DIR`: <https://docs.cline.bot/cli/cli-reference.md>.

Not verified:

- Whether `--hooks-dir` / `CLINE_HOOKS_DIR` adds to `~/.cline/hooks` or replaces it (the reference calls it "additional hooks" but gives `~/.cline/hooks` as its default). If it replaces it and you have your own hooks there, use option B.
- Which of `TaskStart`, `TaskResume` and `UserPromptSubmit` fire on each turn of an interactive session. All three mark working, so any of them is enough.
