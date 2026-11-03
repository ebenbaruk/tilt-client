# Tilt for DeepSeek Harness (dsh)

A Cordis plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), a
developer preview whose APIs still change. It follows `agent/status` (`running`/`idle`, no
content) and adds `/tilt`. In the terminal UI, `/tilt` opens the table as an overlay that takes
the keys until Esc. Where no terminal UI is mounted (e.g. `dsh web`), `/tilt` answers with the
table as text, and the companion app is the live table. The plugin never reads prompts,
replies, tool calls or session events, and runs no shell command except the platform opener
(`open`, `xdg-open`, `rundll32`) for the login page.

## Files

- `index.mjs`: the entry dsh loads. It lets Node load the TypeScript plugin and the shared table
  (`packages/play`) straight from your clone.
- `tilt.ts`: the plugin (`name`, `inject`, `apply`): turn tracking, `/tilt`, the overlay.
- `dsh.ts`: the few dsh types used, declared locally.
- `package.json` + `cordis.patch.yml`: make this folder a dsh bundle that mounts the plugin.

## Install

1. Point Tilt at its API in the environment you start dsh from: `export TILT_API_URL=https://…`
   (no host is ever guessed). You can set `apiUrl` on the `tilt` row in your profile's
   `cordis.patch.yml` instead; see the comment in `cordis.patch.yml`.
2. Add this folder to the profile you run. Replace `<TILT_DIR>` with the absolute path of your clone:

   ```sh
   dsh plugin --profile tui add <TILT_DIR>/harnesses/deepseek   # terminal UI profile
   dsh plugin --profile web add <TILT_DIR>/harnesses/deepseek   # or the web profile
   ```

   A local path is linked, not copied, so the plugin keeps finding `packages/play` in your clone.
   Check the layer with `dsh --profile tui --dump-config` (it shows a `@tilt/dsh` layer).

3. Start dsh as usual (`dsh --profile tui`, `dsh web`).

## Play

| Command        | What it does                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| `/tilt login`  | Opens the login page and answers with the code to confirm.                                               |
| `/tilt`        | Terminal UI: opens the table; press its keys, Esc goes back to the prompt. Elsewhere: the table as text. |
| `/tilt table`  | The table as text.                                                                                       |
| `/tilt <key>`  | Presses one key (e.g. `/tilt 1`).                                                                        |
| `/tilt logout` | Signs out on this machine.                                                                               |

The overlay is modal (dsh shows one overlay at a time): while it is open, keys go to Tilt and the
agent keeps working. The plugin also writes the turn file `~/.tilt/agent.json`, so
`harnesses/companion/bin/tilt` in a split pane shows a live table next to any dsh front end.

## Uninstall

`dsh plugin --profile tui remove @tilt/dsh` (same for `web`) removes the dependency and its layer.
`~/.tilt/session.json` holds the login shared by every Tilt harness; delete it (or `/tilt logout`
first) to sign out everywhere.

## Verified vs not

Verified against deepseek-ai/deepseek-harness `main` at commit
`f3803c96974ad4a94195fb97e5c637e9c2a3afe3` (2026-10-28):

- Plugin form (`name`, `inject`, `apply(ctx, config)`), `ctx.effect`, optional services through
  `ctx.get`: `docs/user/develop/basic/index.md`, `docs/cordis-tutorial/02-lifecycle-and-effects.md`,
  `docs/cordis-tutorial/03-services.md`.
- Bundle manifest (`dsh.bundle.patch`), `dsh plugin --profile <p> add <path>` linking a local
  checkout, `remove`: `docs/user/develop/basic/publish.md`.
- `agent/status` payload `{ agent, status }` with `running`/`idle`, and `agent/disposed`:
  `packages/core/agent/src/runtime-types.ts`.
- `ctx.commands.register({ name, description, input, handler({ rawInput }) })` returning
  `{ kind: 'success' | 'error', text }`: `packages/interaction/commands/README.md`, `src/types.ts`.
- The plugin and the shared table load under plain Node 22.23 with type stripping and the resolve
  hook in `index.mjs`, and answer `/tilt` and draw the overlay against a fake context.

Not verified:

- **The overlay API.** The terminal UI left the dsh repo on 2026-08-04 (now `@deepseek-ai/dsh-tui`,
  <https://github.com/omdsh-dev/dsh-tui>, whose public repo has no `src/` and which is not on npm).
  `ctx.tui.openOverlay({ create(host) → { render, handleInput, invalidate }, options })` follows its
  last public copy, `packages/ui/tui/src/extension/types.ts` at commit
  `890343751a356273128416eba6be6b09ece7d463` and the design note
  `.agents/notes/archived/architecture/2026-07-22-tui-interactive-extension-service.md`. The
  `agent/status` listener signature changed since that copy, so the overlay may have too. When no
  `tui` service is found, `/tilt` falls back to text and the companion; if the current TUI
  changed the API, the overlay call may fail instead.
- That installed dsh loads `index.mjs` with Node's default type stripping (Node 22.18+, dsh asks
  for `^22.19.0 || >=24.0.0`) without its own module hooks getting in the way.
- How the TUI and the web client render multi-line command answers (the text table is 72 columns
  with no color).
- No dsh was installed or run.
