# Tilt for Amp

An [Amp](https://ampcode.com) plugin that puts the Tilt table in Amp's status line and lets you play it from the command palette while the agent works.

- **Status item.** One line (balance, round, sponsor) from `renderStatusLine`, refreshed whenever the table changes. Clicking it runs `Tilt: play`.
- **Turns.** `agent.start` and `agent.end` mark the agent as working or idle. The plugin reads only the event's thread id, never the prompt, the reply or the tool calls. It also writes `~/.tilt/agent.json` so the companion pane follows the same turns.
- **Commands** (palette, <kbd>Ctrl+O</kbd>):
  - `Tilt: play`: a select dialog shows the table and lists the moves offered now (`hotkey · label`). Picking one presses that key, waits for the move to land, then shows the list again. Close the dialog to stop.
  - `Tilt: show table`: the whole table in a dialog.
  - `Tilt: login`: device login. Amp opens the confirmation page with `ctx.system.open` (on SSH, the CLI also shows the URL).
  - `Tilt: logout`.

The token and table choices are kept in `~/.tilt/session.json` (0600), shared with the other Tilt clients. The plugin talks only to `TILT_API_URL`. If that variable is unset, the status item says so and the commands refuse to run.

## Install

Amp runs plugins with Bun from `~/.config/amp/plugins/` (or `$XDG_CONFIG_HOME/amp/plugins/`). This is a directory plugin (`index.ts`) that imports the shared core from `packages/play` by relative path, so it has to run from your clone of the Tilt repo:

```sh
mkdir -p ~/.config/amp/plugins
ln -s <TILT_DIR>/harnesses/amp ~/.config/amp/plugins/tilt
export TILT_API_URL=https://<your-tilt-api>   # in the shell that starts amp
amp
```

Replace `<TILT_DIR>` with the absolute path of your clone. In Amp, run `plugins: reload` (or `amp plugins list` in a shell) to check it loaded, then `Tilt: login`.

If your setup does not follow the symlink back into the clone, use a one-line entry file instead of the symlink:

```sh
mkdir -p ~/.config/amp/plugins/tilt
echo 'export { default, description } from "<TILT_DIR>/harnesses/amp/index.ts";' > ~/.config/amp/plugins/tilt/index.ts
```

`amp plugins add <url>` installs a single file only, so it cannot carry the shared core. Use one of the two options above.

## Full keyboard play: the companion

Amp gives plugins no multi-line panel and no single-key capture, so here you play through dialogs. To play the full table with keys, run the companion in a split pane next to Amp:

```sh
<TILT_DIR>/harnesses/companion/bin/tilt
```

It uses the same login. With this plugin loaded, it also knows when Amp is working.

## Uninstall

```sh
rm ~/.config/amp/plugins/tilt        # the symlink (or rm -r the folder for the entry-file option)
rm -f ~/.tilt/session.json           # optional: forget the Tilt login
```

Then run `plugins: reload` in Amp.

## Verified vs not

Checked against the official docs on 2026-10-29 ([Plugins manual](https://ampcode.com/manual/plugins.md), [Plugin API reference](https://ampcode.com/docs/plugin-api)). Amp is not installed on this machine, so **the plugin has not been run in Amp.**

Verified in the docs:

- Plugin locations, directory plugins (`<name>/index.ts`), the default export receiving `PluginAPI`, the optional static `description` export, and that plugins run with Bun (and can use `process.env` and `node:` modules).
- `amp.experimental?.createStatusItem()` with `update({ text, url })`; `url: "command:<id>"` runs a plugin command. Shown in the CLI only; other clients ignore it. It is an **experimental** API that may change or disappear.
- `amp.registerCommand(id, { title, category, description }, handler)`; the palette shows `category: title`.
- `ctx.ui.notify`, `ctx.ui.confirm` and `ctx.ui.select` (which returns `undefined` when dismissed); dialog messages are Markdown.
- `agent.start` is a request event (the handler returns `{}`), `agent.end` fires with a status, both carry `thread.id`; there is no `session.end`. `amp.onDispose` runs on unload and reload.
- `amp.system.open(url)` / `ctx.system.open(url)` opens the browser and, in the CLI, also shows the URL.

Not verified:

- Whether the status item renders ANSI colors, and how wide it can be. The plugin sends plain text at 80 columns.
- How the select and confirm dialogs render a 72-column fenced code block, and whether a long option list scrolls well.
- Whether Amp follows a symlinked plugin directory back to the clone for relative imports (Bun does by default), and whether an entry file may import an absolute path outside the plugins folder.
- Whether a plugin command ID can be bound to a key in `amp.keymap`.
- Whether `TILT_API_URL` reaches the plugin process from the shell that starts `amp`. The kitchen-sink example reads `process.env`, but the plugin host's environment is not documented.
