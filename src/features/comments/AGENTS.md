# Comments Feature

`src/features/comments/` owns quote-anchored review comments and edit suggestions stored in notes, the vault-wide inbox, repository threads, and the reviews the AIs run on them. Its origin and licence are recorded in `NOTICE.md`.

## Storage

- A note's comments live in one fenced `grandemonium-comments` JSON block at the end of the note. `store.ts` is the only reader and writer of that format: `parseDocument` reads every top-level block (agents sometimes write one per passage) and merges them, keeping earlier blocks inside `prose` so offsets into it stay offsets into the note; `serializeDocument`, `blockChanges` and `normalizeChanges` always write one block at the end. Two blocks that give one id different content are a parse error, never a guess.
- The previous fence name `tandem-comments` is still read and rewritten under the current name by normalisation, because an agent that learned the format from an older note may still write it. The `data.json` key and local storage keys from before the rename are moved once on load. Remove these fallbacks once no registered vault holds the old names.
- Settings persist under the `comments` key of the shared `data.json` and repository threads under `repositoryThreads`. Every write merges into the existing document: never call `plugin.saveData` with a bare settings object, which would drop the other key.
- The display name and read marks are per person and per device, so they live in per-vault local storage (`grandemonium.comments.*`), never in `data.json` or the comment block. Read marks are keyed `path\u0000id`, so `vault.on("rename")` must move them or every thread in a renamed note returns as unread.
- An orphaned anchor is usually an agent having rewritten the passage, not a fault: `isFullReplace` treats an external `vault.modify` as unmappable, so anchors re-resolve by quote search and stop matching. The inbox presents that state as `rewritten`, to confirm and resolve.

## Composition

- `CommentsController` is constructed by `src/main.ts` and takes the host `Plugin`; it is not a `Plugin` subclass. Its settings render as a lazily activated tab inside the shared settings shell.
- Comments never import chat or provider code. The AIs arrive through `CommentAiPort` and the repository thread composer through `RepositoryAgentPort`, both injected by `src/main.ts`; the composer toolbar is chat's `mountStandaloneComposerToolbar`. Only the model belongs to a thread; effort, permission and service tier are provider settings shared with chat tabs.

## Inbox

- The inbox is one flat list: every file with open comments and every open comment under its file, with nothing filed behind a section. Unread marks a row but never moves it, and the note being read is not singled out, so the list does not rearrange when the reader opens another note.
- A row is one line carrying only the passage and its status (a new reply, an AI working and for how long). The discussion, author and timestamp belong to the expanded card. Comment text is Markdown and a row is plain prose, so `plainText` strips the syntax rather than rendering it.
- Obsidian's metadata cache does not record fence languages, so finding commented notes means reading them. `CommentIndex` sweeps once on load and afterwards re-reads only files whose `mtime` moved.
- `resolveHighlightClick` gives an open sidebar priority over the popover, so a highlight click expands the thread in the list rather than showing it twice. The popover covers the sidebar-closed case and only the CodeMirror surface: rendered tables paint highlights into widget DOM and Reading view has no CodeMirror, so both route clicks to the sidebar.

## Reviews and repository threads

- Reviews do not run in chat tabs. `CommentAiPort.review` starts one disposable `CommentReviewRunner` session per AI reached, because a shared tab accumulated every comment in every note until its context degraded; the whole thread lives in the note, so nothing needs carrying between reviews. Each run settles on its own, so a thread's working state clears exactly when its own review ends.
- A review has no chat turn to watch, so the expanded thread shows each AI still replying and any review error (`threadActivity`). Errors stay in memory, never in the note, because the AIs read and follow the comment block; a whole-note review has no thread, so its failure is a `Notice` that stays until dismissed. Reconsider only if reviews need interactive approval.
- A repository thread is a comment about the whole vault with no anchor, so it is kept in `data.json`, and it keeps one `RepositoryThreadSession` per AI until resolved because the thread is the conversation. The controller posts the agent's final text as its reply; the agent is told to leave per-passage points as ordinary file comments.
- Approvals are answered inline in the thread, since a reader is watching it. Questions are refused, because the panel has no form for them.
- A session lost to a failure, restart or reload is reopened on the next reply and sent the thread so far (`isFresh`). An AI that cannot start or finish posts its error into the thread as an entry with `kind: "error"`, which is never replayed to a fresh session.

## Redraws

- The file sidebar rebuilds its whole DOM whenever a commented note changes or a review starts or ends, which happens while the reader is typing. Every textarea `CommentSidebar` builds must be bound to `UnsentInputs` under a stable key and forgotten once sent or cancelled, or the next redraw empties it. `UnsentInputs` holds redraws while a composition is open, because replacing the box ends macOS dictation and IME input mid-sentence.
- The repository panel's root element is re-attached across sidebar redraws, never rebuilt, so streaming never takes focus from a reply being typed.
