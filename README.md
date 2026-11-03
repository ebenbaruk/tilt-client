# Tilt client

Tilt is a casino you play inside your coding agent while it works. This repo holds only the code
that runs on your machine:

- `apps/mod`: the Claude Code mod (a marketplace plugin, `tilt@tilt`).
- `packages/play`: the client core every other agent's integration shares (login, moves, the table drawn as text).
- `harnesses/<agent>`: one integration per coding agent (omp, pi, OpenCode, Codex, Gemini CLI, Cursor CLI…), plus a companion app for agents that only have hooks. Index: [`harnesses/README.md`](harnesses/README.md).

What it reads and sends is spelled out in [`apps/mod/README.md`](apps/mod/README.md) and in each harness README. In short: it only learns when a turn starts and ends, never your prompts, code, tool calls or transcripts; it talks only to the Tilt API URL you set; the one command it runs opens the login page in your browser; nothing is downloaded when it runs.

## Install

Tilt is invite-only. Paste the install prompt from your invite (or from the site's "How it works") into your coding agent: the agent identifies itself, fetches this repo, audits the code that will run with `file:line` references, and waits for your go before installing. To update, paste the prompt again: it audits the new commit first.

## Where it comes from

This repo is generated from Tilt's private monorepo by `scripts/publish-client.sh`; each commit names the monorepo commit it was published from. Don't send changes here: they are overwritten on the next publish.
