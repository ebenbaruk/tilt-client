# Tilt for OpenCode and Kilo Code CLI

A TUI plugin that puts the Tilt table at the bottom of the OpenCode terminal UI, below the prompt.
You play it with single keys while the agent works. Kilo Code CLI is a fork of OpenCode with the
same v1 TUI plugin API, so the same files serve both.

- **Table:** the shared core's `renderPanel`, in color, drawn full width in the `app_bottom` slot
  on every screen. No named slot sits directly above the prompt: `session_prompt` would replace
  the prompt itself. Hidden, it collapses to one status line.
- **Game mode:** press `alt+t`. While game mode is on, letters and digits go to the table, and
  keys the table doesn't offer at that moment are dropped. `Esc` (or `alt+t` again) takes you back
  to the prompt. The host's own shortcuts are paused during game mode because they belong to the
  `base` mode.
- **`/tilt`:** opens a menu with _Play_, _Show/Hide the table_, and _Log in_ or _Log out_. The
  command palette also has _Tilt: play_.
- **Agent working/idle:** read only from `session.status` events, and only their `busy`/`idle`/
  `retry` type. The agent counts as working while any session is busy. The plugin never reads
  messages, parts, prompts, tool calls or the shared KV store.
- **Login:** device code. The login page opens with the platform opener (`open`, `xdg-open` or
  `rundll32`, without a shell). The code and URL are also shown in a toast. The token is stored in
  `~/.tilt/session.json` (0600) by the core's `fileStore`, not in OpenCode's shared plaintext
  `kv.json`.

Files:

- `tui.tsx` is the plugin entry: `export default { id: "tilt", tui }`. It wires the slot, the
  keymap, the dialog and the events.
- `tilt.ts` holds all the Tilt logic: session, show/hide, game mode, busy/idle, the `/tilt` menu,
  reading ANSI and opening URLs.
- `host.ts` declares the parts of the plugin API that are used, as structural types.
- `tui.json` is a ready-made config for trying the plugin out (see below).

## Why the entry is a `.tsx` file

Slot content must be OpenTUI/Solid JSX. The host loads TUI plugin files through OpenTUI's runtime
plugin, which applies the Solid JSX transform. The same plugin also rewrites imports of
`solid-js`, `@opentui/solid` and `@opentui/core` to the host's own copies. That is why nothing
needs installing in the clone. `tilt.ts` and `host.ts` are plain TypeScript, checked by
`harnesses/tsconfig.json`; `tui.tsx` is not.

## Install

`<TILT_DIR>` stands for the absolute path of your Tilt clone. The API URL comes from
`TILT_API_URL`, or from the plugin option `apiUrl`. Without either, the plugin only shows a
one-line notice and never guesses a host.

### OpenCode (v1, tested against 1.18.11)

1. Export the API URL in the shell that starts OpenCode:
   `export TILT_API_URL=https://<your tilt api>`
2. Add the plugin to `~/.config/opencode/tui.json` (create the file if it doesn't exist; a project
   `.opencode/tui.json` also works):

   ```json
   {
     "$schema": "https://opencode.ai/tui.json",
     "plugin": ["<TILT_DIR>/harnesses/opencode/tui.tsx"]
   }
   ```

   With options, the entry becomes a tuple:
   `["<TILT_DIR>/harnesses/opencode/tui.tsx", { "apiUrl": "https://…", "key": "ctrl+alt+j" }]`.
   `key` replaces `alt+t`.

3. Restart `opencode`. The table appears at the bottom; run `/tilt`, then _Log in_.

To try it without editing your config, point OpenCode at the bundled file. OpenCode merges it
over your global `tui.json` and resolves `./tui.tsx` relative to the file:
`OPENCODE_TUI_CONFIG=<TILT_DIR>/harnesses/opencode/tui.json opencode`

`opencode plugin <module>` only installs npm packages, so a plugin loaded from a path is always
listed by hand.

### Kilo Code CLI (tested against v7.8.18 source)

The steps are the same, with Kilo's paths:

- Global config: `~/.config/kilo/tui.json` (or `$KILO_CONFIG_DIR/tui.json`), with the same
  `plugin` entry. Kilo treats in-repo `.kilo/` configs as untrusted, so prefer the global file.
- Try-out: `KILO_TUI_CONFIG=<TILT_DIR>/harnesses/opencode/tui.json kilo`

## Uninstall

Remove the `tui.tsx` entry from `tui.json` and restart. You can also turn the plugin off with
`"plugin_enabled": { "tilt": false }` or from the built-in Plugins dialog. To delete the saved
login, remove `~/.tilt/session.json`.

## Verified vs not verified

Verified by reading source and types, without running anything:

- Plugin shape, `tui.json` `plugin` entries (absolute and relative paths, tuple options),
  `plugin_enabled`, the `OPENCODE_TUI_CONFIG` merge, and the fact that TUI plugins are not
  auto-discovered:
  [opencode specs/tui-plugins.md @ v1.18.11](https://github.com/anomalyco/opencode/blob/v1.18.11/packages/opencode/specs/tui-plugins.md),
  [config/tui.ts](https://github.com/anomalyco/opencode/blob/v1.18.11/packages/opencode/src/config/tui.ts).
- API types (`slots`, `keymap.registerLayer`, `mode.push`, `ui.DialogSelect`, `ui.toast`,
  `event.on`, `lifecycle`): local `~/.opencode/node_modules/@opencode-ai/plugin/dist/tui.d.ts`
  (1.18.11) and
  [packages/plugin/src/tui.ts](https://github.com/anomalyco/opencode/blob/v1.18.11/packages/plugin/src/tui.ts).
  The `session.status` event shape comes from the local `@opencode-ai/sdk` `types.gen.d.ts`.
- Mode-gated layers: the host's prompt bindings, including `escape` → `session.interrupt`, are
  `mode: "base"`. Pushing `tilt.play` therefore pauses them, so Esc doesn't interrupt the agent
  during game mode:
  [packages/tui/src/keymap.tsx](https://github.com/anomalyco/opencode/blob/v1.18.11/packages/tui/src/keymap.tsx),
  [component/prompt/index.tsx](https://github.com/anomalyco/opencode/blob/v1.18.11/packages/tui/src/component/prompt/index.tsx).
- `alt+t` is not one of OpenCode's or Kilo's default keybinds (`packages/tui/src/config/keybind.ts`
  in both repos).
- Runtime module rewriting and the Solid transform for external plugin files:
  [plugin/tui/runtime.ts](https://github.com/anomalyco/opencode/blob/v1.18.11/packages/opencode/src/plugin/tui/runtime.ts)
  (`ensureRuntimePluginSupport`) and
  [opentui runtime-plugin-support-configure.ts](https://github.com/anomalyco/opentui/blob/main/packages/solid/scripts/runtime-plugin-support-configure.ts).
- The OpenTUI Solid reconciler (v0.4.5, the version OpenCode 1.18.11 pins) stringifies a
  `<text content>` prop, so a `StyledText` there draws `[object Object]`. Colored lines are drawn
  as `<span style={{ fg, bg, attributes }}>` children of `<text>` instead, as OpenCode's own TUI
  does:
  [opentui reconciler.ts @ v0.4.5](https://github.com/anomalyco/opentui/blob/v0.4.5/packages/solid/src/reconciler.ts).
- Kilo's TUI plugin API is the OpenCode one with renames that don't affect this plugin
  (`KiloClient`, `@kilocode/plugin`). Its runtime, `app_bottom` slot, mode stack and `base` mode are
  the same:
  [Kilo packages/plugin/src/tui.ts @ v7.8.18](https://github.com/Kilo-Org/kilocode/blob/v7.8.18/packages/plugin/src/tui.ts),
  [Kilo specs/tui-plugins.md](https://github.com/Kilo-Org/kilocode/blob/v7.8.18/packages/opencode/specs/tui-plugins.md).

Run on 2026-10-29 in OpenCode 1.18.11 on Linux, with an isolated XDG config and
`OPENCODE_TUI_CONFIG=<TILT_DIR>/harnesses/opencode/tui.json`, against the fake API
(`bun packages/play/test/fake-api.ts 8099`), not the real one:

- The plugin loads and the table renders in color in the `app_bottom` slot (after the
  `[object Object]` fix described above).
- `alt+t` enters game mode; `n` rolls the dice and the balance updates.
- Esc returns to the prompt, and text typed afterwards goes to the prompt.

Not verified:

- **Kilo hasn't been run**, only OpenCode. Nothing has been tried against the real API.
- The busy/idle indicator during a real agent turn: no provider was configured, so no turn ran.
- That a global keymap binding consumes a letter before the focused prompt textarea inserts it.
  If it doesn't, letters typed in game mode also land in the prompt.
- How tall the `app_bottom` band can grow before it crowds the session view on small terminals.
- That the slot re-renders without visible flicker (it does re-render: the balance updated).
- The opener on Windows and macOS. On Linux it needs `xdg-open`.
- OpenCode v2 (`@opencode/plugin` 2.x, `cli.json`) has a different plugin API and is not
  supported.
