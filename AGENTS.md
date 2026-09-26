# AGENTS.md

## Project

Grandemonium is an Obsidian plugin that embeds provider-backed coding agents in a sidebar and inline-edit flow. Claude is the default provider. Codex, Grok, OpenCode, and Pi are optional providers that plug into the same conversation model through `Conversation.providerId` and opaque provider-owned `providerState`.

Do not assume provider parity. Check each provider's `capabilities.ts`, `registration.ts`, and UI config before wiring shared behavior.

## Scope Guides

- Before editing a scoped area, read its nearest scoped guide:
  - `src/app/AGENTS.md`
  - `src/core/AGENTS.md`
  - `src/features/chat/AGENTS.md`
  - `src/features/collab/AGENTS.md`
  - `src/providers/claude/AGENTS.md`
  - `src/providers/codex/AGENTS.md`
  - `src/providers/grok/AGENTS.md`
  - `src/providers/opencode/AGENTS.md`
  - `src/providers/pi/AGENTS.md`
  - `src/style/AGENTS.md`

## AGENTS.md Maintenance

- AGENTS.md is execution context for agents, not general documentation. Keep only repository- or scope-specific information that a capable agent would not reliably know; every statement must change implementation, review, or verification behavior.
- Keep repository-wide rules here; put local ownership, dependencies, invariants, failure modes, verification, and active decisions in the narrowest scoped guide that governs them.
- Do not duplicate inherited guidance or silently contradict it. State a necessary local exception and its rationale explicitly.
- Omit tours, ordinary implementation details, temporary status, and general engineering advice.
- Record a decision only when it is active, surprising from the code, expensive to reverse, and reflects a real tradeoff. State the decision, rationale, and any concrete reconsideration condition; use Git history as the archive.
- `CLAUDE.md` files should import the nearest `AGENTS.md`; do not duplicate shared guidance there.

## Commands

```bash
npm run dev
npm run build
npm run typecheck
npm run lint
npm run lint:fix
npm run test
npm run test:watch
npm run test:coverage
```

The default full check is:

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

Tests mirror `src/` under `tests/unit/` and `tests/integration/`.

## Architecture

Scoped guides define the source of truth and allowed mutators for state in their area.

| Area | Responsibility |
| --- | --- |
| `src/main.ts` | Plugin lifecycle and concrete application composition |
| `@claudian-collab/protocol` | Exact-version registry dependency whose standalone repository solely owns the decision-complete shared Collab wire contract, compatibility policy, tests, build, and release |
| `src/app/` | Application conversation, settings, provider-host, and storage services |
| `src/core/` | Provider-neutral runtime, registry, storage, tool, and type contracts |
| `src/providers/acp/` | Shared ACP transport, interaction, and session primitives without provider policy |
| `src/providers/*/` | Provider adaptors, provider-owned runtime protocol, history, storage, settings, and UI |
| `src/features/chat/` | Sidebar chat orchestration against provider-neutral contracts |
| `src/features/comments/` | Quote-anchored review comments, vendored from Tandem Comments |
| `src/features/inline-edit/` | Inline edit modal and provider-backed edit services |
| `src/features/settings/` | Shared settings shell and provider tab assembly |
| `src/shared/` | Reusable UI components |
| `src/style/` | Modular CSS built into `styles.css` |

### Dependency Direction

In the rules below, `A -> B` means `A` may import or call `B`:

```text
composition root (`src/main.ts`) -> app services + features + provider registrations + core
app services -> core contracts
features -> FeatureHost + core contracts + shared UI
providers -> ProviderHost + core contracts + shared provider and UI primitives
```

- `core/` must not import feature code, app composition, or provider implementations.
- `src/` consumes the standalone shared contract only through the `@claudian-collab/protocol` package root. Grandemonium must not retain package source, source aliases, compatibility policy, or copied registries; `src/core/collab/` retains only client-owned Collab contracts without re-exporting package symbols.
- Feature code must not import provider implementations. Resolve provider behavior through core registries and contracts.
- Provider runtime and protocol code must not import chat views, feature controllers, or other feature orchestration.
- Existing Claude compatibility re-exports that point into `src/app/` are migration seams, not an allowed general dependency direction. Do not add new provider-to-app imports; move shared contracts into `core/` when touching those seams materially.
- `src/providers/acp/` may contain protocol primitives shared by ACP providers. Provider-specific launch policy, extensions, normalization, history, and state remain in the owning provider.
- If a dependency does not fit these directions, introduce or extend an explicit contract at the owning boundary instead of reaching across layers.

### Cross-Layer Ownership

- `src/main.ts` owns plugin lifecycle and wiring; it does not become the home for feature or provider behavior.
- Complex application domains may expose one app-owned subcomposition helper, but `src/main.ts` remains the sole concrete caller and lifecycle publisher; subcomposition must not become a second root or service locator.
- `src/app/` owns application-scoped repositories, settings transactions, host adapters, and persistence coordination. See its scoped guide for exact state authority.
- `src/features/*/` owns user-facing orchestration and presentation state, not provider-native processes or storage formats.
- `src/providers/*/` owns native protocol, process, session, transcript, settings, and provider-state interpretation.
- `src/core/` owns provider-neutral contracts and shared lifecycle mechanisms, not concrete provider behavior.

Provider-specific session fields belong behind typed helpers in the owning provider directory.

## Naming Conventions

- **Symbols**: no `I` prefix on interfaces. Treat acronyms as words (`SdkSessionReadResult`), except in types mirroring an external SDK (`SDKMessage`).
- **Files**: name the file after its primary exported concept in `PascalCase.ts`; use `camelCase.ts` only for utility bags with no dominant export (when in doubt, `PascalCase`). Use `kebab-case.ts` only to mirror an external package name (`tests/__mocks__/claude-agent-sdk.ts`). Barrels stay `index.ts`, type buckets stay `types.ts`, tests mirror the source name plus `.test.ts` (qualifiers allowed: `fileLink.dom.test.ts`).
- **Folders**: `kebab-case`.
- **Imports**: no `.ts` extensions; prefer `@/` aliases over deep relative paths.

## Development Rules

- Write code, comments, identifiers, commit messages, and code blocks in English. Keep Markdown soft-wrapped (no hard-wrapped lines).
- Do not use `console.*` in production code.
- Settings writers must merge rather than replace provider-owned configuration.
- Put non-committed notes, handoff files, traces, and throwaway scripts in `.context/`.
- Production bundling Brotli-compresses locale JSON and the canonical `sql.js/dist/sql-wasm.wasm` import through `scripts/compressedStaticAssets.js`. Keep those import paths or update the build round-trip test with the bundler.

## TDD Workflow

### General

- Production behavior changes and bug fixes must use TDD: establish a failing executable test at an agreed seam before implementation. Documentation-only and non-behavioral mechanical changes are exempt. When an automated failing test is not feasible, record repeatable failing evidence first and cover the closest stable seam.
- Treat documented owning-module and public interfaces as pre-agreed test seams. If behavior cannot be verified without reaching past a seam, resolve the ownership or interface decision before writing the test; do not add a test-only facade or public method.
- Build vertical tracer bullets: exercise one observable behavior at one seam with the minimum implementation needed to prove it. Do not batch a horizontal layer of tests around imagined types, collaborators, or future behavior.
- Derive expected results independently from the implementation, using a specification literal, accepted fixture, or worked example. Do not reproduce the production algorithm in the assertion, assert internal call counts, or bypass the owning interface to inspect storage unless that storage contract is the declared seam under test.
- Do not test statically defined values whose correctness is already established by their source or type declaration. Test the observable behavior that consumes them only when that behavior has meaningful regression risk.
- When logic is deleted, do not add negative tests that merely prove the removed path no longer exists. Cover only the observable replacement behavior or contract that could realistically regress.
- Mock only true external boundaries, through narrow operation-specific ports rather than a generic conditional transport. Keep owned modules real.
- After a tracer bullet is green, review and refactor its structure separately under the passing seam-level tests. Do not mix speculative architecture work into the behavior cycle.

### Project-specific

- The owner and public contracts named in the applicable scoped guides are the accepted seams for their areas.
- Accepted Collab protocol fixtures and captured provider-native examples are independent sources of expected behavior.
- Mock only environment, Obsidian, and provider boundaries. Keep Grandemonium-owned modules real. For shared provider contracts, prove provider-neutral behavior first, then cover each adapter's distinct native behavior.

## UI Semantics and Tests

- New or materially changed atomic UI actions must use native controls with explicit non-submit button types. Use a non-native interactive element only when native semantics cannot express the interaction, and then cover its accessible name, role, and complete keyboard behavior.
- At real-DOM UI seams, query actions by role and accessible name with Testing Library, retain assertions for their callback or state outcome, and use targeted jest-axe checks for deterministic component subtrees. MockElement tag or class assertions do not replace that semantic coverage.

## Provider Rules

- Prefer provider-native behavior over local reimplementation. Adapt provider output at the boundary instead of shadowing provider features.
- Keep live streaming and history replay responsibilities separate. Live output should come from the provider runtime protocol when available; provider transcript files are the replay source.
- New provider behavior must be expressed through registries and capabilities: `ProviderRegistry`, `ProviderWorkspaceRegistry`, `ProviderChatUIConfig`, provider capabilities, and provider-owned settings reconciliation.
- Model, permission, command, MCP, skill, and subagent behavior is provider-specific unless the core contract explicitly makes it shared.
- Treat persisted provider configuration as untrusted runtime input. Provider settings readers and storage normalization must decode every field; invalid permission, tool, and sandbox modes must fail closed.
- When provider behavior is uncertain, inspect real runtime output first. Put throwaway scripts, traces, and handoff notes in `.context/`.
- Treat provider-native history and transcripts as read-only. Never mutate or delete provider session data when a Grandemonium conversation changes.
- Only explicitly enabled models belong in the chat selector: no synthetic provider entries, no hidden session models, and no provider-default fallback when none are enabled.
- Runtime-discovered commands are read-only in Grandemonium; providers own their editing and deletion.
- Auxiliary query runners own their own process and session, independent from the chat runtime.

## Review Checks

Reviews must enforce the dependency, ownership, provider-boundary, and state-lifetime constraints above.

## Vault Deployment

`vaults.json` registers the local Obsidian vaults the plugin is installed into. `npm run deploy` builds, then copies `main.js`, `styles.css`, and `manifest.json` into `.obsidian/plugins/<manifest id>/` of each registered vault, skipping with a warning any vault without a `.obsidian` folder; paths passed to `scripts/install-to-vault.mjs` replace the register for one run. `npm run dev` copies on each watch rebuild into every registered vault path that exists, creating the plugin folder if needed, and `OBSIDIAN_VAULT` (from the environment or `.env.local`) replaces the register with one vault for dev only.

## Comments Feature

`src/features/comments/` is vendored from the standalone Tandem Comments plugin
(MIT, see `NOTICE.md`) and keeps that project's flat file layout and double-quote
style, so upstream fixes stay easy to compare. Three adaptations matter:

- `CommentsController` is constructed by `src/main.ts` and takes the host
  `Plugin`. It is not a `Plugin` subclass, and `this.app` is a delegating getter,
  which is why the vendored call sites read unchanged.
- Settings persist under the `tandemComments` key of the shared `data.json`.
  Never call `plugin.saveData` with a bare settings object here; that would drop
  the chat side's `tabManagerState`.
- The settings surface renders as a lazily activated tab inside the shared
  settings shell, not as its own `PluginSettingTab`.
- Selection-triggered comment drafts (`selection-comment.ts`, the editor
  extension's pointer handlers, and the `commentOnSelection` setting) are a
  Grandemonium addition with no upstream counterpart.
- The inline comment popover (`comment-popover.ts`, `resolveHighlightClick`, and
  the `commentPopover` setting) is likewise Grandemonium-only. It covers the
  CodeMirror editor surface: rendered tables paint highlights directly into
  widget DOM and Reading view has no CodeMirror at all, so both still route
  clicks to the sidebar.
- The vault-wide inbox (`comment-index.ts`, `inbox-model.ts`, `read-marks.ts`,
  `inbox-row.ts`) is Grandemonium-only. The panel exists to be emptied, so it is
  one flat list: every file with open comments, every open comment under its
  file, nothing filed behind a section the reader must remember to open. Unread
  marks a row; it never moves one. The note being read is not singled out
  either, so the list does not rearrange when the reader opens a different note.
  A row is one line carrying only the passage it marks and its status (a new
  reply, an AI working and for how long), because the discussion, the author
  and the full timestamp are one click away in the expanded card and putting
  them in the row is what made the list unreadable. Five
  consequences bind:
  - Comment text is Markdown and a row is plain prose, so `plainText` strips the
    syntax rather than rendering it: raw `**bold**` and `[[long/wiki/link]]` in
    a narrow row are the noise, not the content.
  - `resolveHighlightClick` gives an open sidebar priority over the popover, so
    a highlight click expands the thread in the list rather than showing it
    twice at once. The popover covers the sidebar-closed case, and
    `commentPopover` still disables it entirely.
  - Read marks are per person and live in per-vault localStorage, never in the
    shared comment block. They are keyed `path\u0000id`, so `vault.on("rename")`
    must move them or every thread in a renamed note returns as unread.
  - Obsidian's metadata cache does not record fence languages, so finding
    commented notes means reading them. `CommentIndex` sweeps once on load and
    afterwards re-reads only files whose `mtime` moved.
  - Reviews do not run in chat tabs. `CommentAiPort.review` starts one
    `CommentReviewRunner` session per AI reached, disposable and started clean,
    because a shared tab accumulated every comment in every note until its
    context degraded. Nothing needs carrying between reviews: the whole thread
    lives in the note's comment block. Each run settles on its own, so a
    thread's working state clears exactly when its own review ends. The cost is
    visibility: there is no chat turn to watch, so the expanded thread shows
    each AI still replying and any review error (`threadActivity`). Errors are
    held in memory, never written into the note, because the AIs read and
    follow the comment block's schema; a whole-note review has no thread, so
    its failure is a `Notice` that stays until dismissed. Reconsider only if
    reviews need interactive approval.
- Repository threads (`repository-thread.ts`, `RepositoryThreadsController`,
  `repository-panel.ts`) are Grandemonium-only: comments about the whole vault,
  pinned above the file list. Unlike a file comment's review, each thread keeps
  one `RepositoryThreadSession` per AI it reaches until it is resolved, because
  the thread is the conversation and has no note to hold it. Consequences:
  - Threads have no anchor, so they persist under the `repositoryThreads` key of
    `data.json`, never in a note. Merge on write, as `tandemComments` does.
  - The agent's final text is posted as its reply by the controller; the agent
    is told to leave its per-passage review points as ordinary file comments.
  - Approvals are answered inline in the thread, since a reader is watching it.
    Questions are still refused until the panel has a form for them.
  - The composer toolbar is chat's `mountStandaloneComposerToolbar`, injected by
    `src/main.ts` through `RepositoryAgentPort`, so comments never import chat.
    Only the model belongs to the thread; effort, permission and service tier
    are provider settings shared with chat tabs.
  - A session lost to a failure, restart or reload is reopened on the next
    reply and sent the thread so far (`isFresh`). Sessions are in memory only.
  - An AI that cannot start or finish posts the error into the thread as an
    entry marked `kind: "error"`, not a `Notice`, which fades before it is
    read. Error entries are never replayed to a fresh session.
  - The panel's root element is re-attached across sidebar redraws, never
    rebuilt, so streaming never takes focus from a reply being typed.
- The file sidebar rebuilds its whole DOM whenever a commented note changes or a review starts or ends, which parallel sessions and other comments' AIs cause while the reader is typing. Every textarea `CommentSidebar` builds must be bound to `UnsentInputs` under a stable key, and forgotten once sent or cancelled, or the next redraw empties it. `UnsentInputs` holds redraws while a composition is open, because replacing the box ends macOS dictation and IME input mid-sentence.
- An orphaned anchor is usually an agent having rewritten the passage, not a
  fault: `isFullReplace` treats an external `vault.modify` as unmappable, so
  anchors re-resolve by quote search and stop matching. The inbox therefore
  presents that state as `rewritten`, to confirm and resolve.
