# Tandemonium

An Obsidian plugin that puts a coding agent and a review workflow in the same
vault. Chat with Claude Code, Codex, Grok, OpenCode or Pi in a sidebar that
treats your vault as its working directory, and leave Google Docs-style comment
threads on your notes that both people and agents can read and answer.

Desktop only. macOS, Linux and Windows.

## What it does

**Agent chat.** A sidebar conversation with a coding agent running on your own
machine. The vault is the working directory, so the agent can read and write
notes, search, run shell commands, and work through multi-step tasks. Sessions,
history, and per-provider settings live with the vault.

**Review comments.** Select any passage and attach a comment or an edit
suggestion. Threads are quote-anchored and stored in a single fenced block at
the end of the file, so your prose stays clean and the threads survive edits,
stay readable in plain Markdown, and can be written by an agent as easily as by
a person. Resolve, purge, and export threads from the comment sidebar.

**Inline edit.** Rewrite a selection in place without leaving the note.

**Collab mode.** Share a project with teammates over the local network, with
Git as the transport. Nothing routes through a cloud service.

**Read aloud.** Play back an assistant reply using a system voice, or OpenAI
text-to-speech if you would rather have a better one.

## Requirements

- At least one agent CLI installed and authenticated:
  - [Claude Code](https://code.claude.com/docs/en/overview)
  - [Codex](https://github.com/openai/codex)
  - [Grok Build](https://github.com/xai-org/grok-build)
  - [OpenCode](https://github.com/anomalyco/opencode)
  - [Pi](https://github.com/earendil-works/pi)
- A subscription or API access for whichever CLI you use. The plugin runs your
  local CLI and inherits however it is already authenticated.
- Obsidian 1.13.0 or newer, desktop.
- Collab mode additionally needs [Git](https://git-scm.com/install/) 2.38+.

## Installing

This plugin is not in the Obsidian community directory. Build it and copy the
three build artefacts into a vault.

```bash
git clone https://github.com/grantwork/tandemonium.git
cd tandemonium
npm install
npm run build
```

`vaults.json` lists the vaults to install into. Edit it, then:

```bash
npm run deploy
```

That builds and copies `main.js`, `styles.css` and `manifest.json` into
`.obsidian/plugins/tandemonium/` for every listed vault. Restart Obsidian and
enable Tandemonium under Community plugins.

To install somewhere not in the register, pass paths directly:

```bash
node scripts/install-to-vault.mjs /path/to/vault
```

## Developing

Node 24 is required and pinned in `.node-version`.

```bash
npm run dev
```

Watch mode rebuilds on save and copies into every vault in `vaults.json`.
Obsidian does not hot-reload, so toggle the plugin off and on to pick up a
build, or use the Hot Reload community plugin.

The full check before committing:

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

Architecture notes, layering rules and per-area guides are in `AGENTS.md` and
the scoped `AGENTS.md` files beneath `src/`.

## Collab mode

Collab shares a project folder between invited devices on your local network.
One device hosts, others join with a short-lived invitation. Traffic is HTTPS
against a self-signed certificate that is pinned on first use, member
credentials are hashed on the host, and the transport is Git over the local
network only. Project data does not reach any cloud service.

## Privacy

- **Sent to your provider.** Prompts, attached files, images and tool output go
  to whichever provider your chosen CLI is configured against, and nowhere
  else. The destination is controlled by that CLI's own settings and the
  environment variables you set here.
- **Read aloud.** The system voice runs entirely on your machine. If you switch
  to OpenAI text-to-speech, the reply text is sent to OpenAI for synthesis.
- **Collab.** Project Git data and coordination metadata travel directly
  between invited devices on the local network.
- **No telemetry.** The plugin sends nothing about you or your vault anywhere.
  There are no analytics, beacons or update pings.

## Security notes

The permission mode ships as YOLO, which lets the agent run shell commands and
write files with no approval prompt. That is convenient and it is also the
setting under which a prompt injection hidden in a note could act on your
machine. Switch to Safe mode in the chat toolbar if you want approval prompts.

API keys entered in plugin settings are stored unencrypted in the vault, under
`.claudian/`. Prefer authenticating your CLI directly, and add that folder to
your vault's `.gitignore` if the vault is a Git repository.

## Licence and attribution

MIT. This project began as a combination of two MIT-licensed plugins and still
contains substantial code from both. See [NOTICE.md](NOTICE.md) for what came
from where and what was changed.
