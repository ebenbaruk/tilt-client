# Tilt for goose

The goose CLI is a line-by-line loop with no panel, status line or key capture, so you play Tilt in the **companion** app in a split pane. This Open Plugins package only tells the companion when goose is working, through hooks that call `harnesses/companion/bin/tilt-signal`:

| goose hook                      | Signal    |
| ------------------------------- | --------- |
| `UserPromptSubmit`              | `working` |
| `Stop` (turn end or stop event) | `idle`    |
| `SessionEnd`                    | `idle`    |

`tilt-signal` never reads stdin; goose pipes the prompt (`UserPromptSubmit`) and the last reply (`Stop`) there, and neither is read. It prints nothing: on `Stop`, goose reads stdout as a block decision, and empty stdout means "allow".

The hooks use `${PLUGIN_ROOT}/../companion/bin/tilt-signal`. Linking this folder into goose's plugin directory keeps that path pointing at your clone, so nothing needs editing.

## Install

```sh
TILT_DIR=/absolute/path/to/Tilt
mkdir -p ~/.agents/plugins
ln -s "$TILT_DIR/harnesses/goose" ~/.agents/plugins/tilt
```

Start a new goose session. (`goose plugin install <git-url>` copies a whole repository and would break the relative path, so use the link.)

## Play: the companion in a split pane

```sh
export TILT_API_URL=https://your-tilt-api   # the API URL you were given
tmux split-window -h "$TILT_DIR/harnesses/companion/bin/tilt"
```

Any terminal split works. Log in and play from that pane while goose works in the other one.

## Uninstall

- `rm ~/.agents/plugins/tilt` (removes the link only), or add `"tilt"` to `disabledPlugins` in `~/.config/goose/settings.json` to just turn it off.
- Optional: `rm -r ~/.tilt` to forget the session.

## Verified vs not

Checked on 2026-10-29 against the docs and source on `main` (goose isn't installed here, so not run):

- Open Plugins layout (`plugin.json` + `hooks/hooks.json`), user plugins in `~/.agents/plugins/<name>/`, `disabledPlugins`: <https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/context-engineering/plugins.md>.
- Hook schema (`hooks.<Event>[] = {matcher?, hooks: [{type: "command", command, timeout (s)}]}`), commands run with `sh -c`, `${PLUGIN_ROOT}` substituted and exported, events `UserPromptSubmit` / `Stop` / `SessionEnd`, `Stop` stdout is a decision channel (empty = allow): <https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/context-engineering/hooks.md>.
- Plugin discovery keeps any entry where `path.is_dir()` is true, which follows symlinks, so a linked folder is found: `list_dir_children` in <https://github.com/aaif-goose/goose/blob/main/crates/goose/src/plugins/discovery.rs>.

Not verified:

- That `${PLUGIN_ROOT}` is the link path or its target; either works, since `<link>/..` resolves through the link to `harnesses/`.
- Whether `Stop` fires when you cancel a turn with Ctrl-C ("receives a stop event" in the docs is not more specific).
