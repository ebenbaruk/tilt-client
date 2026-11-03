# Tilt for Claude Code

A Claude Code mod that opens a small casino pane (twelve games: blackjack, roulette, baccarat, slots, Mines, dice, Limbo, flip, Keno, the wheel, Hilo and Tower) while your agent works. On a narrow terminal it shows a compact band above the prompt instead. Bets are real USDC, settled on-chain by Tilt.

## What the mod reads and sends

It reads:

- the **start and end of each turn**: only that a turn started, and when it ended, how long it took and whether it finished, was interrupted or failed. It never reads your prompt, the agent's answer, your code, files, tool calls or transcripts.
- its own `/tilt` command, its pane and the band above the prompt.
- its own settings (`apiUrl`, `layout`, `cards`, `autoOpen`, `sound`) and its own store, which holds your Tilt session token, whether you have made a first move, and your table choices (the game shown, the bet, each game's settings). `/tilt setup` changes only its own settings rows, as `/config` would.
- Claude Code's `theme` setting, only to pick light or dark colors.

It sends, only to the Tilt API (`apiUrl`):

- `POST /v1/auth/device` and `POST /v1/auth/device/token` to log in with a device code.
- `GET /v1/state` for your balance, current round, sponsor and leaderboard.
- `POST /v1/play` and `GET /v1/intents/:id` for the moves you make with the keys. Game moves only: deposits and withdrawals happen on the web.
- `POST /v1/impressions` with the sponsor's name and how many seconds its block was on screen.

It puts text on your clipboard only when you press `w` on a big win: a line with the amount, the game and the sponsor, nothing about your work. With `sound` on, it plays its own two short sounds (`sounds/`).

It runs one command on your machine, `open <login url>`, when you type `/tilt login`. If that fails, the pane shows the link and the code instead. The mod opens or shows the login URL only if it is on the API's own site: `https` (plain `http` only on loopback, like `apiUrl`), on the API's host or its parent domain (`api.tilt.xyz` → `tilt.xyz`); with a loopback `apiUrl`, any loopback host. Any other URL fails the login. It hooks no other event, uses no file system access, and runs nothing else.

## Install

In Claude Code:

```
/plugin install tilt --marketplace ebenbaruk/tilt-client
```

Answer `y` to add the marketplace, pick a scope, then set where the table sits on the screen that follows (you can change it any time). Then `/tilt login`, confirm the code in your browser, and play.

## Make it yours

`/tilt setup` shows each choice with a small preview and saves the one you press; the same rows are in `/config`.

- **Layout** (`1` side, `2` bottom, `3` compact). Side: a pane, docked beside the transcript in fullscreen (`"tui": "fullscreen"`), under it otherwise. Bottom: the whole table above the prompt, no pane, in every mode, within the band's rows: in fullscreen what the bottom slot leaves it, on the main screen half the terminal, so the agent's answer stays in view. A table taller than that takes its smaller form (small cards, the Wheel's strip), else gives way to the compact band: the sponsor never scrolls out of view. Compact: two lines above the prompt; `/tilt` still opens the pane.
- **Cards** (`l` large, `s` small). Large: the five-row cards, each overlapped by the next. Where they would push the keys out of the pane (a short terminal, many hands), the table draws small ones by itself.
- **When the agent starts** (`a`): open Tilt without taking the keyboard, or wait for `/tilt`.
- **Sounds** (`m`): a short sound on a deal and on a win. Off by default.

Colors follow Claude Code's theme: a light theme gets darker pink and gold.

## Use

- `/tilt` opens the pane (with the bottom layout, the table is already above the prompt). `/tilt login` and `/tilt logout` manage your session; to switch accounts, `/tilt logout` first. `/tilt setup` moves the table and sizes the cards.
- Blackjack plays 1 to 6 hands against one dealer, at the same bet on each hand, left to right: the hand to play is marked `▶`. A pair splits into two hands (at most 4 splits a round, so up to 10 hands, wrapped to the pane's width); hands born from a split are marked `split`, and their 21 on two cards pays 1:1, not as a blackjack. Split aces get one card each.

Letter keys work everywhere (the pane and the band, inline or fullscreen):

- `ctrl+x tab` gives the pane (or the band) the keyboard; `Esc` hands it back.
- `1`–`9` switch to a game of the page shown in the header, `0` flips to the next page of games (12 games on two pages); not mid-round: a blackjack hand still to play, `▶`, a Mines, Hilo or Tower board in play, or a draw in progress keeps its game, and the key says so. In the band above the prompt (bottom or compact layout), the tabs take clicks only and `m` steps to the next game: Claude Code hands a digit typed first in an empty prompt to the band, so `2 bugs` would otherwise switch game instead of reaching the agent. The clicked table in the band takes the same game keys (`m`, no digit). While a round is in play `m` is not the next game (a Mines board has a tile `m`): that key then takes a click only. `v` / `b` lower / raise the bet per hand (held at the table's limits), `n` deals, spins or plays.
- Blackjack: `j` / `k` one hand fewer / more (1 to 6), `h` hit, `s` stand, `d` double, `p` split (first two cards of the same value), all on the hand marked `▶`. Split aces take one card each and are finished, as in a casino: their hands say `· 1 card`.
- Roulette: a spin carries up to 20 bets, each a stack of chips. `v` / `b` size the chip; `r` red, `k` black, `o` odd, `e` even, `l` low, `g` high put a chip on that bet; `s` / `d` move the cursor (shown inverse) one cell over 0–36, the dozens, then the `2:1` columns, `f` / `h` move it across the felt (three numbers at a time along a row, 0 and the row's `2:1` at its ends: any number in a few presses), `a` puts a chip under it, `x` takes its chips off; `u` takes the last chip back, `q` clears the table, `n` spins them all (`roulette_chips`). A cell's stacks add up to the table maximum at most. Each cell with chips shows `●` and its stake (a number too narrow for both keeps its number, the stake shows on the cursor's line), with `on the table 2.30 · 6 bets · max win 31.50` above the layout (max win: the best pocket's gain over the stake, before the fee); a balance short of that stake is said before `n`. The chips stay after a spin, so `n` (or `Space` at the table) bets the same layout again. Once the ball lands, the pocket and the winning cells are lit. In fullscreen, in the side pane or the bottom band, a click on any cell (a number, a dozen, a `2:1`, an outside bet) adds a chip, as its key would, and `undo`, `clear` and the spin are buttons; the main screen reports no clicks, so there the line under the layout recalls the keys. The wheel and the layout take the widest cells the column fits (narrower beside the sidebar); where the room is short the wheel is a single row.
- Baccarat: `p` player, `y` banker, `t` tie.
- Slots: `x` normal, `f` fast (the reels land three times sooner), `t` turbo (no spin: the draw shows as soon as the chain has it).
- Mines: `j` / `k` one mine fewer / more (1 to 24, 3 by default); in play, `a`–`y` reveal the tile with that letter (5×5, row by row, the letter in the tile's corner) and `z` cashes out, from the first safe tile. In fullscreen, a click on a tile reveals it.
- Dice: `j` / `k` win chance down / up, `o` over or under. Limbo: `j` / `k` target multiplier. Flip: `h` heads, `t` tails, `j` / `k` coins (1 to 10). Keno: `j` / `k` how many numbers (1 to 10), `r` new random numbers; in fullscreen (pane or band), click a number to pick it. Wheel: `j` / `k` segments, `r` risk. The last round stays on the table while it was played with the choices set; changing one clears it, its result line too. A new session opens as you left the table: the game shown, the bet and each game's settings (roulette chips, mines, dice target, Keno picks…); a first session opens on the game last played, set up as it was played.
- Hilo: `n` deals the first card; then `h` higher or same, `l` lower or same (on a king, `l` is strictly lower; on an ace, `h` strictly higher), `s` skip (10 per round), `z` cash out. Tower: `j` / `k` difficulty; in play, `a`–`d` pick a tile of the current level (the lit one), `z` cashes out. In fullscreen, `↑` / `↓` step the game's own setting.
- Each game keeps one key row, in the same order in every phase: its turn's moves (blackjack `h` `s` `d` `p`, Hilo `h` `l` `s` `z`, the Mines and Tower cash-out `z`), its choices, the bet and `n`. A key not playable now stays in its place, dimmed, and does nothing: a reflex `z` before a cash-out is offered, or `h` after a Hilo bust, is caught instead of going to the prompt. A move is sent once: until its round has played out on the table (the move shown, the cards turned, the wheel or the reels stopped, the result started), every play key is dimmed, with plain words that say nothing of the cards to come. A letter the pane has no key for still goes to the prompt (Claude Code's own behavior).

In the fullscreen layout (`claude --settings '{"tui":"fullscreen"}'`), in the side pane or the bottom band, click the table to give it the keys. Only a click does: `ctrl+x tab` gives the pane the letters, not Space, Enter or the arrows (Space then goes to the prompt, and the table says so), and takes the keys from a clicked table, which needs a click again. `Esc` or a click on the prompt hands them back; Claude Code does not tell the table, so once clicked it keeps its keys' words, and the footer says both how to get the keys and how to hand them back. Switched to Mines or Tower, a clicked table keeps the keys: the board's letters reveal or climb, Space plays a new round. In the bottom band, a game too tall for the band's rows shows the compact band, which holds no table: the keys go back to the prompt. Without it, `←` is Claude Code's own (the agents view).

- `Space` or `Enter` plays a new round with the same bet and hands; in a blackjack turn `Space` hits, `Enter` stands, `d` doubles, `p` splits.
- `←` / `→` lower / raise the bet (the chip at roulette), `↑` / `↓` add / remove a blackjack hand (move the roulette cursor), `1`–`9` and `0` switch game (in the band, `m`). `Esc` hands the keys back.
- The table deals the cards one by one (at baccarat: player, banker, player, banker, then any third cards) and counts up a win. The main screen draws the same moving table, in the pane and in the band: it takes no click nor Space there, the letters play it, and Mines and Tower keep their board of letter keys. The roulette wheel turns steadily while the chain draws, then slows into the drawn pocket before the ball shows. The Wheel game is drawn as a wheel of fortune: a disc of wedges colored by what they pay (the legend under it), in a gold rim around a hub, under a fixed `▼` (the biggest that fits the room the table has, whatever the card size: 31 columns across, else 25, else 17, else a strip of the segments). The disc turns the same way, then slows over a few laps until the drawn segment stops under the pointer; beside it, the segments and risk give way to the landed multiplier. The result, balance and any celebration wait for it to stop. The other one-draw games play out the same way, in about a second: the dice roll tumbles along the track (the target marked `┃`) and closes in on the drawn roll; Limbo's multiplier rises from ×1.00 to the result, gold once it reaches the target, red when it stops short; Flip's coins land one by one up to the first off the call (every coin has to land on it, so the ones after show dim); Keno lights its ten numbers one by one, the newest on a chip, while the hits count up, then the paytable's row lands on a chip. A round sent and not on the table yet shows its draw to come (`rolling…`, `drawing…`), as a blackjack deal in flight is dealt face down. Each settled round is tagged `WIN`, `LOSE` or `PUSH` (a dice win at ×1 gives the stake back).

When a turn starts, the pane opens without taking the keyboard. When it ends the table stays, with `✓ agent finished in 6m 14s · your hand is saved for 6 hours`: a hand or board left 6 hours without a move is closed for you (blackjack hands stand, Mines, Hilo and Tower cash out at their current value). `ctrl+x tab` gives it the keys and, pressed again, hands them back (as `Esc` does); `ctrl+x x` or ✕ hides it until `/tilt`. A pane left open comes back by itself when the session starts over: at the next launch, or back from Claude Code's agents view (`←`, then `Esc`). That return moves the session to a new process drawn fullscreen, where a pane would dock on the side: if you played with the pane under the transcript, the table comes back above the prompt instead (as with `layout: bottom`, for that session).

Around the table:

- Your first time, a guide says how to give Tilt the keys and deal; it goes after your first move.
- The bet and, at blackjack, the hands are steppers: `v ◂ bet 0.50 ▸ b`, `j ◂ ●●○○○○ 2 hands ▸ k`. If your balance does not cover the bet, the table says so before you press `n`, with a link to deposit on the web.
- A blackjack or baccarat deal shows its cards face down at once, then turns them over as the chain deals them; a Hilo guess lays its card face down the same way, and a Mines reveal or a tower climb turns its tile from the key on. Baccarat tags the winning side `WINS` (`TIE` on a tie) and says what the bet got (`Banker wins 7 to 5: pays ×1.95.`); slots says the line hit (`7 7 7 pays ×250.`).
- Mines, Tower and Hilo say whose move it is (`YOUR TURN`, `drawing…`) and how the round ended (`BUST` in red, `CASHED OUT ×1.4785` in gold), and keep the multiplier, what the next tile, level or guess brings (Hilo: each guess's chance too) and the cash-out on its key (`z cash out 1.28`) in view.
- A result counts a win up and flashes gold, or flashes red and shakes the table on a loss, in every placement: the main screen's still Mines and Tower boards too.
- A win sparkles on one row under the table once its result shows; a win of ten times the stake or more sets off bursts on that row and, in the pane, gets a banner; `w` copies a line to share. The result, what is in flight and the sparkles each keep their row, blank at rest, so the band's height never changes during a round.
- The footer counts this session (`session +2.30 · 14 rounds · 22m`), as the mod saw rounds settle; the leaderboard says how far the next rank is.

## Local development

```
claude --plugin-dir apps/mod
```

Point the mod at a local API with its `apiUrl` setting (`/config`, or `pluginConfigs.tilt.options.apiUrl` in `~/.claude/settings.json`), for example `http://127.0.0.1:8080`. Plain `http` is accepted only for `localhost` and `127.0.0.1`.

Checks, from this folder:

```
claude plugin validate .
claude plugin test .
pnpm typecheck
```

`pnpm typecheck` needs the engine's declarations in `.claude-plugin/types/` (git-ignored). An interactive `claude --plugin-dir apps/mod` session writes them.
