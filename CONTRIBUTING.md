# Contributing

This is a personal project under active rewrite, so interfaces and layout move
around without much warning. Issues and pull requests are still welcome.

## Before you start

- Open an issue before a substantial change so the scope can be agreed first.
- Read `AGENTS.md` and the scoped `AGENTS.md` under the area you are touching.
  They record the layering rules, ownership boundaries and test seams that
  reviews enforce.

## Working on a change

Node 24, pinned in `.node-version`.

```bash
npm install
npm run dev
```

Behaviour changes and bug fixes are test-driven: add the failing test at an
agreed seam first. Documentation and mechanical refactors are exempt.

The full check must pass before a pull request:

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

## House rules

- Code, comments, identifiers and commit messages in English.
- No `console.*` in production code.
- Follow the naming conventions in `AGENTS.md`.
- Scratch files, traces and handoff notes belong in `.context/`.

## Reporting a bug

Include your Obsidian version, operating system, which agent CLI and version,
and how the plugin was installed. Strip API keys, tokens, private vault content
and personal paths from anything you attach.
