# Grandemonium

An Obsidian plugin that puts coding agents and a review workflow in the same vault. Chat with Claude Code, Codex, Grok, OpenCode or Pi in a sidebar that treats your vault as its working directory, and leave comment threads on your notes that both people and agents can read and answer.

Desktop only. macOS, Linux and Windows.

## What it does

**Agent chat.** A sidebar conversation with a coding agent running on your own machine. The vault is the working directory, so the agent can read and write notes, search, run shell commands, and work through multi-step tasks. Sessions, history, and per-provider settings live with the vault.

**Review comments.** Select a passage to comment on it or suggest an edit. Threads are anchored to the quoted text and stored in one fenced block at the end of the note, so the prose stays clean, threads survive edits, and an agent can write them as easily as a person.

- **Inbox.** One sidebar list of every open thread in the vault, grouped by note, with unread replies marked.
- **AI replies.** Each enabled agent reviews open threads and replies under its own name. Address one agent with `@name` in a reply, or choose which agents a reply goes to.
- **Popover.** Click a highlight to read and answer its thread in place.
- **Repository threads.** Threads about the whole vault rather than a passage, pinned above the inbox, where each agent keeps its session until the thread is resolved.
- Resolve, purge and export threads from the sidebar.

**Inline edit.** Rewrite a selection in place without leaving the note.

**Read aloud.** Play back an assistant reply using a system voice, or OpenAI text-to-speech if you would rather have a better one.

## Requirements

- At least one agent CLI installed and authenticated:
  - [Claude Code](https://code.claude.com/docs/en/overview)
  - [Codex](https://github.com/openai/codex)
  - [Grok Build](https://github.com/xai-org/grok-build)
  - [OpenCode](https://github.com/anomalyco/opencode)
  - [Pi](https://github.com/earendil-works/pi)
- A subscription or API access for whichever CLI you use. The plugin runs your local CLI and inherits however it is already authenticated.
- Obsidian 1.13.0 or newer, desktop.

## Installing

This plugin is not in the Obsidian community directory. `vaults.json` lists the vaults it is installed into. Edit it, then:

```bash
git clone https://github.com/grantwork/grandemonium.git
cd grandemonium
npm install
npm run deploy
```

That builds and copies `main.js`, `styles.css` and `manifest.json` into `.obsidian/plugins/grandemonium/` of every listed vault, skipping any vault without a `.obsidian` folder. Restart Obsidian and enable Grandemonium under Community plugins.

To install into vaults that are not in the list, build and pass their paths:

```bash
npm run build
node scripts/install-to-vault.mjs /path/to/vault
```

## Developing

Node 24 is required and pinned in `.node-version`.

```bash
npm run dev
```

Watch mode rebuilds on save and copies into every vault in `vaults.json`. To copy into one vault instead, set `OBSIDIAN_VAULT` in `.env.local`. Obsidian does not hot-reload, so toggle the plugin off and on to pick up a build, or use the Hot Reload community plugin.

`npm run build` also copies into the listed vaults. Run it as `OBSIDIAN_VAULT=/nonexistent npm run build` to build without installing.

The full check before committing:

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

Architecture notes, layering rules and per-area guides are in `AGENTS.md` and the scoped `AGENTS.md` files beneath `src/`.

## Collab mode (archived)

Collab mode was removed on 26 September 2026. Its last version is kept at the Git tag `archive/collab`. To browse it without disturbing your checkout, run:

```bash
git worktree add ../grandemonium-collab-archive archive/collab
```

It is kept for reference only. A future Collab would be rewritten rather than restored.

## Privacy

- **Sent to your provider.** Prompts, attached files, images and tool output go to whichever provider your chosen CLI is configured against, and nowhere else. The destination is controlled by that CLI's own settings and the environment variables you set here.
- **Read aloud.** The system voice runs entirely on your machine. If you switch to OpenAI text-to-speech, the reply text is sent to OpenAI for synthesis.
- **No telemetry.** The plugin sends nothing about you or your vault anywhere. There are no analytics, beacons or update pings.

## Security notes

The permission mode ships as YOLO, which lets the agent run shell commands and write files with no approval prompt. That is convenient and it is also the setting under which a prompt injection hidden in a note could act on your machine. Switch to Safe mode in the chat toolbar if you want approval prompts. Comment reviews run with the same permissions as a chat turn.

API keys entered in plugin settings are stored unencrypted in the vault, under `.grandemonium/`. Prefer authenticating your CLI directly, and add that folder to your vault's `.gitignore` if the vault is a Git repository.

## Licence and attribution

MIT. This project began as a combination of two MIT-licensed plugins and still contains substantial code from both. See [NOTICE.md](NOTICE.md) for what came from where and what was changed.
