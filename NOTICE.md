# Attribution

Grandemonium is a combination of two MIT-licensed Obsidian plugins, both used
and modified under the terms of their original licences.

## Grandemonium

Copyright (c) 2025 Yishen Tu
<https://github.com/YishenTu/grandemonium>

Provides the coding-agent chat surface: the sidebar chat, provider runtimes for
Claude Code, Codex, Grok, OpenCode and Pi, inline edit, and Collab mode. This is
the base the fork was cut from, so it covers most of the source tree.

## Tandem Comments

Copyright (c) 2026 Leon Pawelzik
<https://github.com/leonpawelzik/obsidian-tandem-comments>

Provides the quote-anchored review comments: the comment sidebar, the editor
highlight extension, re-anchoring, and comment export. Vendored into
`src/features/comments/` at upstream version 0.5.2 and adapted to this
repository, with these changes:

- The plugin class became `CommentsController`, owned by this plugin's
  composition root instead of extending `Plugin` itself.
- Settings persist under a `tandemComments` key in the shared `data.json`
  rather than owning the whole file. Settings written by the standalone plugin
  are still read from the document root.
- The standalone settings tab became a section rendered inside this plugin's
  settings shell.
- Styles moved into the modular CSS build; tests moved from vitest to jest.
- German source comments were translated to English.

The full MIT licence text for both projects is in `LICENSE`.
