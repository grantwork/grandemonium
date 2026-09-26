import type {
  WorkspaceLeaf} from "obsidian";
import {
  type HoverParent,
  type HoverPopover,
  ItemView,
  Keymap,
  MarkdownRenderer,
  Menu,
  Notice,
  type PaneType,
  setIcon,
  setTooltip,
  TFile} from "obsidian";

import { type AuthorColorOverrides,resolveAuthorColor } from "./author-color";
import type { CommentsController } from "./CommentsController";
import { confirmAction } from "./confirm-action";
import { formatComment, formatTs } from "./export";
import { type InboxFileGroup, type InboxItem, readMarkKey } from "./inbox-model";
import {
  refreshWorkingAges,
  renderExpandedHeader,
  renderFileHeader,
  renderInboxRow,
  renderStopButton,
} from "./inbox-row";
import { renderReplyTargets } from "./reply-target";
import { RepositoryPanel } from "./repository-panel";
import type { SelectionRange } from "./selection-comment";
import { shouldSubmitComment } from "./sidebar-preferences";
import {
  addComment,
  addReply,
  addSuggestion,
  declineSuggestion,
  editThreadEntry,
  generateId,
  removeComment,
  removeThreadEntry,
  resolveAnchor,
  setStatus,
  type SuggestionFailureReason,
} from "./store";
import { keptThreadEntries, renderCollapsedEntry, renderEntryFoldToggle } from "./thread-collapse";
import { renderThreadActivity, type ThreadStatusHost } from "./thread-status";
import { formatSidebarTimestamp } from "./timestamp";
import type { Anchor, ResolvedComment, ThreadEntry } from "./types";
import { UnsentInputs } from "./unsent-inputs";

export const VIEW_TYPE_COMMENTS = "tandem-comments-sidebar";

/** Keys the draft's boxes are kept under; there is only ever one draft. */
const DRAFT_INPUTS = ["draft comment", "draft replacement", "draft explanation"] as const;

interface Draft {
  filePath: string;
  anchor: Anchor;
  kind: "comment" | "suggestion";
  /**
   * Whether the next render moves focus into the comment box. Consumed on that
   * render, so later re-renders never pull focus out of the editor.
   */
  focusInput: boolean;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

/** Colors an author name span with accessible light and dark variants. */
/**
 * Publishes an author's colour as CSS variables on an element. Anything inside
 * it can then use that colour, which is how an entry's left rail matches the
 * author name without the element itself being recoloured.
 */
function applyAuthorColorVars(
  el: HTMLElement,
  author: string,
  overrides: AuthorColorOverrides,
  enabled: boolean
): void {
  el.dataset.tcAuthor = author;
  if (!enabled) {
    el.style.removeProperty("--tc-author-color-light");
    el.style.removeProperty("--tc-author-color-dark");
    return;
  }
  el.style.setProperty("--tc-author-color-light", resolveAuthorColor(author, overrides, "light"));
  el.style.setProperty("--tc-author-color-dark", resolveAuthorColor(author, overrides, "dark"));
}

function paintAuthor(
  el: HTMLElement,
  author: string,
  overrides: AuthorColorOverrides,
  enabled: boolean
): void {
  applyAuthorColorVars(el, author, overrides, enabled);
  if (!enabled) {
    el.removeClass("tc-author-colored");
    return;
  }
  el.addClass("tc-author-colored");
}

export function suggestionFailureMessage(reason: SuggestionFailureReason): string {
  switch (reason) {
    case "no-editor":
      return "Open this file in a Markdown editor before accepting the suggestion.";
    case "invalid-document":
      return "The tandem-comments block is invalid. Fix its JSON before accepting the suggestion.";
    case "invalid-suggestion":
      return "The suggestion data is invalid. Its replacement must be text.";
    case "orphaned":
      return "The original passage no longer exists. Re-anchor the suggestion before accepting it.";
    case "ambiguous":
      return "The original passage appears more than once. Re-anchor the suggestion before accepting it.";
    case "empty-replacement":
      return "Empty replacements are not supported yet.";
    case "already-resolved":
      return "This suggestion has already been resolved.";
    case "not-suggestion":
      return "This entry is not an edit suggestion.";
    case "missing":
      return "The suggestion or its editor is no longer available.";
  }
}

export class CommentSidebar extends ItemView implements HoverParent {
  hoverPopover: HoverPopover | null = null;
  private draft: Draft | null = null;
  private showResolved: boolean;
  private focusedId: string | null = null;
  /**
   * The one thread opened in place, keyed by file and id. One rather than a set:
   * two open threads scroll past each other and the reader loses track of which
   * discussion they are reading, so opening one closes the last.
   */
  private expandedKey: string | null = null;
  private readonly collapsedFiles = new Set<string>();
  /** Folded thread entries the reader opened, as `path id index`. */
  private readonly openedEntries = new Set<string>();
  private repositoryPanel: RepositoryPanel | null = null;
  /** Text in every box the sidebar builds, so a redraw never empties one. */
  private readonly inputs = new UnsentInputs();
  /**
   * Thread entries open for editing, as `path id index`, with the entry as it
   * read when editing began. Kept here because a redraw rebuilds the entry, and
   * the edit has to come back open with its conflict check intact.
   */
  private readonly editing = new Map<string, ThreadEntry>();

  constructor(leaf: WorkspaceLeaf, private plugin: CommentsController) {
    super(leaf);
    this.showResolved = plugin.settings.showResolvedByDefault;
  }

  getViewType(): string {
    return VIEW_TYPE_COMMENTS;
  }
  getDisplayText(): string {
    return "Comments";
  }
  getIcon(): string {
    return "message-square";
  }

  /** Timestamps and author colours, drawn from the current settings each time. */
  private readonly authorHost: ThreadStatusHost = {
    formatTimestamp: (ts) => formatSidebarTimestamp(ts, this.plugin.settings.timestampDisplay),
    paintAuthor: (el, author, rail) => {
      const { authorColorOverrides, colorAuthorNames } = this.plugin.settings;
      if (rail) applyAuthorColorVars(el, author, authorColorOverrides, colorAuthorNames);
      else paintAuthor(el, author, authorColorOverrides, colorAuthorNames);
    },
  };

  async onOpen(): Promise<void> {
    this.repositoryPanel = new RepositoryPanel({
      ...this.authorHost,
      app: this.app,
      component: this,
      confirmDestructive: () => this.plugin.settings.confirmDestructiveActions,
      controller: this.plugin.repository,
      isAgentAuthor: (author) => this.plugin.isAgentAuthor(author),
      showResolved: () => this.showResolved,
      submitShortcut: () => this.plugin.settings.submitShortcut,
    });
    // Saved notes need no listener here: the controller redraws once the index
    // has read the change, which is what the panel draws from.
    this.registerEvent(this.app.workspace.on("file-open", () => void this.render()));
    // Ages of reviews in flight, updated in place: a redraw on a timer would
    // throw away a reply being typed. Costs nothing while nothing is running.
    this.registerInterval(
      window.setInterval(() => {
        refreshWorkingAges(this.contentEl, Date.now());
      }, 1_000)
    );
    this.registerInterval(
      window.setInterval(() => {
        if (this.plugin.settings.timestampDisplay === "relative") this.refreshTimestamps();
      }, 60_000)
    );
    await this.render();
  }

  async onClose(): Promise<void> {
    this.repositoryPanel?.destroy();
    this.repositoryPanel = null;
  }

  /** Opens the box for a comment about the whole vault. */
  startRepositoryComment(): void {
    this.repositoryPanel?.startComposing();
  }

  /**
   * A draft opened by selecting text leaves focus in the editor, so the reader
   * can still delete or retype the selection; they click the box to comment.
   */
  startDraft(file: TFile, anchor: Anchor, options: { focus?: boolean } = {}): void {
    this.forgetDraftInputs();
    this.draft = { filePath: file.path, anchor, kind: "comment", focusInput: options.focus ?? true };
    void this.render();
  }

  startSuggestionDraft(file: TFile, anchor: Anchor): void {
    this.forgetDraftInputs();
    this.draft = { filePath: file.path, anchor, kind: "suggestion", focusInput: true };
    void this.render();
  }

  /** Where the open draft sits in this file's prose, so a repeat selection can be ignored. */
  draftRange(filePath: string, prose: string): SelectionRange | null {
    if (!this.draft || this.draft.filePath !== filePath) return null;
    const resolution = resolveAnchor(prose, this.draft.anchor);
    return resolution.kind === "resolved"
      ? { from: resolution.start, to: resolution.end }
      : null;
  }

  /**
   * Opens one thread in the list, wherever its note sits. Called when a
   * highlight is clicked in the editor, so the panel follows the reader rather
   * than making them find the row themselves.
   */
  focusComment(filePath: string, id: string): void {
    this.focusedId = id;
    this.collapsedFiles.delete(filePath);
    // The reader pointed at one passage in the note, so the panel answers with
    // that one thread: anything else left open is from an earlier question.
    this.expandedKey = readMarkKey(filePath, id);
    this.plugin.markThreadsRead([{ filePath, id, at: Date.now() }]);
    void this.render();
  }

  toggleResolved(): void {
    this.showResolved = !this.showResolved;
    void this.render();
  }

  settingsChanged(resetResolved: boolean): void {
    if (resetResolved) this.showResolved = this.plugin.settings.showResolvedByDefault;
    void this.render();
  }

  refreshAuthorColors(): void {
    for (const el of Array.from(
      this.contentEl.querySelectorAll<HTMLElement>(".tc-entry[data-tc-author]")
    )) {
      const author = el.dataset.tcAuthor;
      if (author != null) {
        applyAuthorColorVars(
          el,
          author,
          this.plugin.settings.authorColorOverrides,
          this.plugin.settings.colorAuthorNames
        );
      }
    }
    for (const el of Array.from(this.contentEl.querySelectorAll<HTMLElement>(".tc-author[data-tc-author]"))) {
      const author = el.dataset.tcAuthor;
      if (author != null) {
        paintAuthor(
          el,
          author,
          this.plugin.settings.authorColorOverrides,
          this.plugin.settings.colorAuthorNames
        );
      }
    }
  }

  /** A draft saved or cancelled leaves nothing behind for the next one. */
  private forgetDraftInputs(): void {
    for (const key of DRAFT_INPUTS) this.inputs.forget(key);
  }

  /**
   * Rebuilds the panel. Anything typed into it survives: the panel redraws
   * whenever any commented note is saved or any review starts or ends, which
   * other sessions and other comments' AIs do while the reader is replying.
   */
  async render(): Promise<void> {
    this.inputs.rebuild(() => this.draw());
  }

  private draw(): void {
    const container = this.contentEl;
    const prevScroll = container.scrollTop;
    // The repository section is re-attached, never rebuilt: detaching it would
    // drop the focus of someone typing to an AI while another one finishes.
    const repository = this.repositoryPanel?.el ?? null;
    for (const child of Array.from(container.children)) {
      if (child !== repository) child.remove();
    }
    container.addClass("tc-sidebar");

    const file = this.app.workspace.getActiveFile();
    const activeMarkdown = file && file.extension === "md" ? file : null;
    const inbox = this.plugin.inbox();

    const header = container.createDiv({ cls: "tc-header" });
    header.createSpan({ text: "Comments", cls: "tc-title" });
    if (inbox.openCount) {
      header.createSpan({ text: String(inbox.openCount), cls: "tc-title-count" });
    }
    if (inbox.runningCount) {
      const pill = header.createSpan({ cls: "tc-running-pill" });
      setIcon(pill.createSpan({ cls: "tc-running-icon" }), "loader");
      pill.createSpan({ text: String(inbox.runningCount) });
      setTooltip(pill, `${inbox.runningCount} note(s) with an AI still working`);
    }
    const toggle = header.createEl("button", {
      text: this.showResolved ? "Hide resolved" : "Show resolved",
      cls: "tc-toggle",
      attr: { type: "button" },
    });
    toggle.onclick = () => this.toggleResolved();
    if (activeMarkdown) {
      const exportBtn = header.createEl("button", {
        text: "Export",
        cls: "tc-toggle",
        attr: { type: "button" },
      });
      exportBtn.onclick = () => void this.plugin.exportComments(activeMarkdown);
    }
    container.prepend(header);
    if (repository) {
      header.after(repository);
      this.repositoryPanel?.render();
    }

    // A draft belongs to the note it was selected in, and has nowhere to live
    // in the vault-wide list until it is saved, so it stays pinned at the top.
    if (this.draft && activeMarkdown && this.draft.filePath === activeMarkdown.path) {
      this.renderDraft(container, activeMarkdown);
    } else {
      this.draft = null;
    }

    for (const group of inbox.files) this.renderFileGroup(container, group);
    if (this.showResolved && inbox.resolvedGroups.length) {
      container.createDiv({ cls: "tc-section", text: "Resolved" });
      for (const group of inbox.resolvedGroups) this.renderFileGroup(container, group);
    }

    if (!container.querySelector(".tc-card, .tc-file-group:not(.tc-repo-toggle), .tc-repo-item")) {
      container.createDiv({ text: "No comments anywhere in this vault.", cls: "tc-empty" });
    }
    container.scrollTop = prevScroll;
  }

  /**
   * Who the next reply goes to, under the box it applies to. The choice sticks,
   * so a reader working with one provider never picks again, but it is offered
   * at every box because switching mid-thread is the point: the usual reason is
   * to have a second AI check the first one's answer. An "@name" still wins.
   */
  private renderReplyTargets(container: HTMLElement): void {
    const names = this.plugin.enabledAgentNames();
    if (names.length < 2) return;
    renderReplyTargets(container, {
      authorColorOverrides: this.plugin.settings.authorColorOverrides,
      colorAuthorNames: this.plugin.settings.colorAuthorNames,
      names,
      onSelect: (target) => {
        void this.plugin.updateSettings({ replyTarget: target });
      },
      selected: names.includes(this.plugin.settings.replyTarget)
        ? this.plugin.settings.replyTarget
        : "",
    });
  }

  private renderFileGroup(container: HTMLElement, group: InboxFileGroup): void {
    const collapsed = this.collapsedFiles.has(group.filePath);
    // Each file owns a block so its header can stick within it: a sticky pins
    // only while its own parent is on screen, which is what hands the top of
    // the panel from one file to the next instead of stacking them up.
    const section = container.createDiv({ cls: "tc-file" });
    renderFileHeader(section, group, {
      collapsed,
      onToggle: () => {
        if (collapsed) this.collapsedFiles.delete(group.filePath);
        else this.collapsedFiles.add(group.filePath);
        void this.render();
      },
    });
    if (collapsed) return;
    const list = section.createDiv({ cls: "tc-file-threads" });
    for (const item of group.items) this.renderInboxItem(list, item);
  }

  private renderInboxItem(container: HTMLElement, item: InboxItem): void {
    const key = readMarkKey(item.filePath, item.id);
    const file = this.app.vault.getAbstractFileByPath(item.filePath);
    if (!(file instanceof TFile)) return;
    if (this.expandedKey === key) {
      this.renderExpandedItem(container, file, item);
      return;
    }
    renderInboxRow(container, item, {
      describe: (row) => `${row.blurb}\n\n${row.author} · ${formatTs(row.ts)}`,
      now: () => Date.now(),
      onExpand: () => this.expandItem(item, file),
      onResolve: () => void this.resolveItem(file, item),
      onReveal: () => void this.plugin.revealComment(file, item.id),
      onStop: () => void this.confirmStop(item),
    });
  }

  /**
   * Always confirms, whatever the destructive-action setting says: a review has
   * usually been running for minutes, and a stray click would throw that away.
   */
  private async confirmStop(item: InboxItem): Promise<void> {
    const confirmed = await confirmAction(this.app, {
      title: "Stop the review?",
      message:
        "The AI is still working on this comment. Anything it has already written " +
        "to the note stays.",
      confirmLabel: "Stop",
    });
    if (confirmed) this.plugin.stopReviews(item.filePath, item.id);
  }

  /** Clears a thread from a note the reader does not have open. */
  private async resolveItem(file: TFile, item: InboxItem): Promise<void> {
    const removes = this.plugin.settings.resolveBehavior === "remove";
    if (
      removes &&
      this.plugin.settings.confirmDestructiveActions &&
      !(await confirmAction(this.app, {
        title: "Resolve comment?",
        message: "This will permanently remove the comment thread from the note.",
        confirmLabel: "Resolve",
      }))
    ) {
      return;
    }
    if (this.expandedKey === readMarkKey(item.filePath, item.id)) this.expandedKey = null;
    await this.plugin.updateDoc(file, (d) => {
      if (removes) removeComment(d.comments, item.id);
      else setStatus(d.comments, item.id, "resolved");
    });
  }

  /**
   * An opened thread gets the same card the active note uses, so suggestions,
   * entry menus and deletion behave identically wherever the thread lives.
   */
  private renderExpandedItem(container: HTMLElement, file: TFile, item: InboxItem): void {
    const wrapper = container.createDiv({ cls: "tc-inbox-expanded" });
    const line = wrapper.createDiv({ cls: "tc-inbox-item" });
    // The same line the reader clicked, in the same place, so closing a thread
    // is the gesture that opened it rather than a separate control to find.
    renderExpandedHeader(
      line,
      item,
      () => {
        this.expandedKey = null;
        void this.render();
      },
      () => Date.now()
    );
    const actions = line.createDiv({ cls: "tc-inbox-actions" });
    if (item.workingSince !== null) renderStopButton(actions, () => void this.confirmStop(item));
    const open = actions.createEl("button", {
      cls: "tc-entry-action clickable-icon",
      attr: { "aria-label": "Open in note", type: "button" },
    });
    setIcon(open, "square-arrow-out-up-right");
    setTooltip(open, "Open in note");
    open.onclick = () => void this.plugin.revealComment(file, item.id);
    this.renderComment(wrapper.createDiv({ cls: "tc-inbox-expanded-body" }), file, {
      comment: item.comment,
      id: item.id,
      resolution: item.resolution,
    });
  }

  private expandItem(item: InboxItem, file: TFile): void {
    this.expandedKey = readMarkKey(item.filePath, item.id);
    this.plugin.markThreadsRead([item]);
    void this.render();
    // Opening a thread also takes the reader to the passage it marks, so the
    // note and the panel stay on the same subject.
    void this.plugin.revealComment(file, item.id);
  }

  private renderDraft(container: HTMLElement, file: TFile): void {
    const draft = this.draft;
    if (!draft) return;
    const card = container.createDiv({ cls: "tc-card tc-draft" });
    card.createDiv({ text: `"${truncate(draft.anchor.exact, 80)}"`, cls: "tc-quote" });
    if (draft.kind === "suggestion") {
      this.renderSuggestionDraft(card, file, draft);
      return;
    }
    this.renderReplyTargets(card);
    const input = card.createEl("textarea", {
      cls: "tc-input",
      attr: {
        placeholder:
          this.plugin.settings.submitShortcut === "enter"
            ? "Comment… (Enter = save, Esc = cancel)"
            : "Comment… (Cmd/Ctrl+Enter = save, Esc = cancel)",
        rows: "3",
      },
    });
    this.inputs.bind("draft comment", input);
    if (draft.focusInput) {
      draft.focusInput = false;
      window.setTimeout(() => input.focus(), 0);
    }
    input.onkeydown = (e) => {
      if (e.key === "Escape") {
        this.forgetDraftInputs();
        this.draft = null;
        void this.render();
      } else if (this.shouldSubmit(e)) {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        // Captured so the new thread can be marked as awaiting its agent; the
        // id is minted inside the mutation and is not knowable before it runs.
        let newId = "";
        void this.plugin
          .updateDoc(file, (d) => {
            newId = generateId(d.comments);
            addComment(
              d.comments,
              newId,
              draft.anchor,
              this.plugin.currentAuthor(),
              this.plugin.nowTs(),
              text
            );
          })
          .then((ok) => {
            if (ok) {
              this.forgetDraftInputs();
              this.draft = null;
              void this.render();
              void this.plugin.notifyUserCommentAdded(file.path, text, newId);
            }
          });
      }
    };
  }

  private renderSuggestionDraft(card: HTMLElement, file: TFile, draft: Draft): void {
    card.createDiv({ text: "Suggested replacement", cls: "tc-field-label" });
    const replacement = card.createEl("textarea", {
      cls: "tc-input",
      attr: { placeholder: "Replacement text…", rows: "3", "aria-label": "Suggested replacement" },
    });
    card.createDiv({ text: "Explanation (optional)", cls: "tc-field-label" });
    const note = card.createEl("textarea", {
      cls: "tc-input",
      attr: { placeholder: "Why this change?", rows: "2", "aria-label": "Suggestion explanation" },
    });
    this.inputs.bind("draft replacement", replacement);
    this.inputs.bind("draft explanation", note);
    const actions = card.createDiv({ cls: "tc-actions" });
    const save = actions.createEl("button", { text: "Add suggestion", cls: "mod-cta" });
    const cancel = actions.createEl("button", { text: "Cancel" });

    const submit = (): void => {
      if (save.disabled) return;
      if (replacement.value.length === 0) {
        new Notice("Enter replacement text first.");
        replacement.focus();
        return;
      }
      save.disabled = true;
      const proposedText = replacement.value;
      const explanation = note.value.trim();
      void this.plugin
        .updateDoc(file, (d) => {
          addSuggestion(
            d.comments,
            generateId(d.comments),
            draft.anchor,
            this.plugin.currentAuthor(),
            this.plugin.nowTs(),
            proposedText,
            explanation || undefined
          );
        })
        .then((ok) => {
          if (ok) {
            this.forgetDraftInputs();
            this.draft = null;
            void this.render();
          } else {
            save.disabled = false;
          }
        });
    };
    const discard = (): void => {
      this.forgetDraftInputs();
      this.draft = null;
      void this.render();
    };

    save.onclick = submit;
    cancel.onclick = discard;
    replacement.onkeydown = (e) => {
      if (e.key === "Escape") {
        discard();
      } else if (this.shouldSubmit(e)) {
        e.preventDefault();
        submit();
      }
    };
    note.onkeydown = (e) => {
      if (e.key === "Escape") {
        discard();
      } else if (this.shouldSubmit(e)) {
        e.preventDefault();
        submit();
      }
    };
    if (draft.focusInput) {
      draft.focusInput = false;
      window.setTimeout(() => replacement.focus(), 0);
    }
  }

  private renderComment(container: HTMLElement, file: TFile, r: ResolvedComment): void {
    const cls = ["tc-card"];
    if (r.comment.status === "resolved") cls.push("tc-resolved");
    if (
      r.resolution.kind === "orphaned" &&
      !(r.comment.suggestion?.result === "accepted" && r.comment.status === "resolved")
    ) {
      cls.push("tc-orphan");
    }
    if (r.comment.suggestion) cls.push("tc-suggestion-card");
    if (r.resolution.kind === "resolved" && r.resolution.ambiguous) cls.push("tc-ambiguous");
    const card = container.createDiv({ cls: cls.join(" ") });
    const copyThread = (): void => {
      void navigator.clipboard
        .writeText(formatComment(r, { includeQuote: this.plugin.settings.copyIncludeQuote, formatTs }))
        .then(() => new Notice("Thread copied."));
    };
    const showMenu = (trigger: HTMLElement, build: (menu: Menu) => void): void => {
      const menu = new Menu();
      build(menu);
      trigger.setAttr("aria-expanded", "true");
      menu.onHide(() => trigger.setAttr("aria-expanded", "false"));
      const rect = trigger.getBoundingClientRect();
      menu.showAtPosition({ x: rect.right, y: rect.bottom, left: true }, trigger.ownerDocument);
    };
    const addCopyMenuItem = (menu: Menu): void => {
      menu.addItem((item) => item.setTitle("Copy").setIcon("copy").onClick(copyThread));
    };
    const addResolveButton = (controls: HTMLElement): void => {
      const resolveBtn = controls.createEl("button", {
        cls: "tc-entry-action clickable-icon",
        attr: {
          "aria-label": "Resolve comment",
        },
      });
      setIcon(resolveBtn, "check");
      setTooltip(resolveBtn, "Resolve");
      resolveBtn.onclick = () => {
        void (async () => {
          if (
            this.plugin.settings.resolveBehavior === "remove" &&
            this.plugin.settings.confirmDestructiveActions &&
            !(await confirmAction(this.app, {
              title: "Resolve comment?",
              message: "This will permanently remove the comment thread from the note.",
              confirmLabel: "Resolve",
            }))
          ) {
            return;
          }
          await this.plugin.updateDoc(file, (d) => {
            if (this.plugin.settings.resolveBehavior === "remove") removeComment(d.comments, r.id);
            else setStatus(d.comments, r.id, "resolved");
          });
        })();
      };
    };
    const addReviewButton = (controls: HTMLElement): void => {
      if (!this.plugin.canRequestReview()) return;
      const reviewBtn = controls.createEl("button", {
        cls: "tc-entry-action clickable-icon",
        attr: {
          "aria-label": "Ask AI to review open comments",
          type: "button",
        },
      });
      setIcon(reviewBtn, "sparkles");
      setTooltip(reviewBtn, "Ask AI to review");
      reviewBtn.onclick = () => {
        void this.plugin.requestReview(file.path, null, r.id);
      };
    };
    const addMenuTrigger = (
      controls: HTMLElement,
      ariaLabel: string,
      deleteTitle: string,
      deleteMessage: string,
      deleteAction: () => Promise<unknown>,
      extra?: (menu: Menu) => void
    ): void => {
      const trigger = controls.createEl("button", {
        cls: "tc-entry-menu-trigger clickable-icon",
        attr: {
          "aria-label": ariaLabel,
          "aria-haspopup": "menu",
          "aria-expanded": "false",
        },
      });
      setIcon(trigger, "ellipsis");
      trigger.onclick = () =>
        showMenu(trigger, (menu) => {
          addCopyMenuItem(menu);
          extra?.(menu);
          menu.addItem((item) =>
            item
              .setTitle(deleteTitle)
              .setIcon("trash-2")
              .setWarning(true)
              .onClick(() => {
                void (async () => {
                  if (
                    this.plugin.settings.confirmDestructiveActions &&
                    !(await confirmAction(this.app, {
                      title: `${deleteTitle}?`,
                      message: deleteMessage,
                      confirmLabel: deleteTitle,
                    }))
                  ) {
                    return;
                  }
                  await deleteAction();
                })();
              })
          );
        });
    };
    if (r.id === this.focusedId) {
      card.addClass("tc-focused");
      window.setTimeout(() => card.scrollIntoView({ block: "nearest" }), 0);
      this.focusedId = null;
    }

    if (r.comment.suggestion) {
      const suggestion = r.comment.suggestion;
      const replacement =
        typeof suggestion.replacement === "string" ? suggestion.replacement : "";
      const suggestionResult =
        suggestion.result === "accepted" || suggestion.result === "declined"
          ? suggestion.result
          : undefined;
      const heading = card.createDiv({ cls: "tc-suggestion-heading" });
      heading.createSpan({ text: "Suggested edit", cls: "tc-suggestion-title" });
      if (suggestionResult) {
        heading.createSpan({
          text: suggestionResult === "accepted" ? "Accepted" : "Declined",
          cls: `tc-suggestion-result tc-suggestion-${suggestionResult}`,
        });
      }
      const meta = card.createDiv({ cls: "tc-meta" });
      paintAuthor(
        meta.createSpan({ text: suggestion.author, cls: "tc-author" }),
        suggestion.author,
        this.plugin.settings.authorColorOverrides,
        this.plugin.settings.colorAuthorNames
      );
      this.addTimestamp(meta, suggestion.ts);
      const suggestionControls = meta.createDiv({ cls: "tc-entry-controls" });
      addMenuTrigger(
        suggestionControls,
        "More options for suggestion",
        "Delete Suggestion",
        "This will permanently remove the suggestion and its discussion from the note.",
        () => this.plugin.updateDoc(file, (d) => removeComment(d.comments, r.id))
      );
      const change = card.createDiv({ cls: "tc-suggestion-change" });
      const original = change.createDiv({ text: r.comment.anchor.exact, cls: "tc-suggestion-original" });
      if (r.resolution.kind === "resolved") {
        original.addClass("tc-quote-link");
        original.onclick = () => this.plugin.revealAnchor(file, r.comment.anchor);
      }
      change.createDiv({ text: "↓", cls: "tc-suggestion-arrow", attr: { "aria-hidden": "true" } });
      change.createDiv({
        text: replacement || (typeof suggestion.replacement === "string" ? "" : "Invalid replacement data"),
        cls: "tc-suggestion-replacement",
      });
      if (r.comment.status === "open" && r.resolution.kind === "orphaned") {
        card.createDiv({ text: "Original passage not found.", cls: "tc-suggestion-warning" });
      } else if (
        r.comment.status === "open" &&
        r.resolution.kind === "resolved" &&
        r.resolution.ambiguous
      ) {
        card.createDiv({
          text: "Original passage appears more than once. Re-anchor before accepting.",
          cls: "tc-suggestion-warning",
        });
      } else if (r.comment.status === "open" && replacement.length === 0) {
        card.createDiv({
          text:
            typeof suggestion.replacement === "string"
              ? "Empty replacements are not supported yet."
              : "Replacement must be text.",
          cls: "tc-suggestion-warning",
        });
      }
    } else {
      const quote = card.createDiv({ text: `"${truncate(r.comment.anchor.exact, 80)}"`, cls: "tc-quote" });
      if (r.resolution.kind === "resolved") {
        quote.addClass("tc-quote-link");
        quote.onclick = () => this.plugin.revealAnchor(file, r.comment.anchor);
      }
      if (r.comment.thread.length === 0) {
        const fallbackMeta = card.createDiv({ cls: "tc-meta" });
        const fallbackControls = fallbackMeta.createDiv({ cls: "tc-entry-controls" });
        if (r.comment.status === "open") {
          addReviewButton(fallbackControls);
          addResolveButton(fallbackControls);
        }
        addMenuTrigger(
          fallbackControls,
          "More options for comment",
          "Delete Comment",
          "This will permanently remove the comment thread from the note.",
          () => this.plugin.updateDoc(file, (d) => removeComment(d.comments, r.id))
        );
      }
    }

    const kept = keptThreadEntries(r.comment.thread, (author) => this.plugin.isAgentAuthor(author));
    for (const [entryIndex, entry] of r.comment.thread.entries()) {
      const entryKey = `${file.path} ${r.id} ${entryIndex}`;
      if (!kept[entryIndex] && !this.openedEntries.has(entryKey)) {
        const folded = renderCollapsedEntry(card, entry, () => {
          this.openedEntries.add(entryKey);
          void this.render();
        });
        applyAuthorColorVars(
          folded,
          entry.author,
          this.plugin.settings.authorColorOverrides,
          this.plugin.settings.colorAuthorNames
        );
        continue;
      }
      // Assigned below, once the element it edits exists; the menu built above
      // only calls it when the reader picks Edit.
      let beginEdit = (_resumed = false): void => undefined;
      const isAgentEntry = this.plugin.isAgentAuthor(entry.author);
      const row = card.createDiv({
        cls: isAgentEntry ? "tc-entry tc-entry-agent" : "tc-entry",
      });
      applyAuthorColorVars(
        row,
        entry.author,
        this.plugin.settings.authorColorOverrides,
        this.plugin.settings.colorAuthorNames
      );
      const meta = row.createDiv({ cls: "tc-meta" });
      const heading = kept[entryIndex]
        ? meta
        : renderEntryFoldToggle(meta, entry, () => {
            this.openedEntries.delete(entryKey);
            void this.render();
          });
      paintAuthor(
        heading.createSpan({ text: entry.author, cls: "tc-author" }),
        entry.author,
        this.plugin.settings.authorColorOverrides,
        this.plugin.settings.colorAuthorNames
      );
      this.addTimestamp(heading, entry.ts);
      const entryControls = meta.createDiv({ cls: "tc-entry-controls" });
      if (r.comment.status === "open" && this.plugin.isAgentAuthor(entry.author)) {
        const implementBtn = entryControls.createEl("button", {
          cls: "tc-entry-action clickable-icon",
          attr: {
            "aria-label": `Ask ${entry.author} to make these changes`,
            type: "button",
          },
        });
        setIcon(implementBtn, "wand-2");
        setTooltip(implementBtn, `Ask ${entry.author} to implement`);
        implementBtn.onclick = () => {
          void this.plugin.requestImplementation(entry.author, {
            commentId: r.id,
            filePath: file.path,
            quote: r.comment.anchor.exact,
            reply: entry.text,
            thread: r.comment.thread.map(({ author, text, ts }) => ({ author, text, ts })),
          });
        };
      }
      if (entryIndex === 0 && r.comment.status === "open" && !r.comment.suggestion) {
        addReviewButton(entryControls);
        addResolveButton(entryControls);
      }
      addMenuTrigger(
        entryControls,
        `More options for comment by ${entry.author}`,
        "Delete Comment",
        entryIndex === 0
          ? "This will permanently remove the comment thread from the note."
          : "This will permanently remove this reply from the comment thread.",
        () => this.plugin.updateDoc(file, (d) => removeThreadEntry(d.comments, r.id, entryIndex)),
        (menu) =>
          menu.addItem((item) =>
            item
              .setTitle("Edit")
              .setIcon("pencil")
              .onClick(() => beginEdit())
          )
      );

      const textEl = row.createDiv({
        cls: "tc-text tc-text-editable",
        attr: {
          tabindex: "0",
          "aria-label": `Comment by ${entry.author}. Press Enter to edit.`,
        },
      });
      // Use Obsidian's renderer and inherit its Markdown, sanitization, and
      // registered post-processor behavior.
      void MarkdownRenderer.render(this.app, entry.text, textEl, file.path, this);
      this.wireCommentLinks(textEl, file);
      const editKey = `edit ${entryKey}`;
      let editInput: HTMLTextAreaElement | null = null;
      // Resumed when a redraw rebuilds an entry that was mid-edit. The entry as
      // it read when editing began is kept, so an AI rewriting it meanwhile is
      // still reported as a conflict rather than silently overwritten.
      beginEdit = (resumed = false): void => {
        if (editInput) {
          editInput.focus();
          return;
        }
        const expected = this.editing.get(entryKey) ?? { ...entry };
        this.editing.set(entryKey, expected);
        const input = row.createEl("textarea", {
          cls: "tc-input tc-edit-input",
          attr: { rows: "3", "aria-label": `Edit comment by ${entry.author}` },
        });
        editInput = input;
        input.value = expected.text;
        this.inputs.bind(editKey, input);
        textEl.replaceWith(input);
        const editActions = row.createDiv({ cls: "tc-actions tc-edit-actions" });
        const save = editActions.createEl("button", { text: "Save", cls: "mod-cta" });
        const cancel = editActions.createEl("button", { text: "Cancel" });
        const finish = (): void => {
          this.editing.delete(entryKey);
          this.inputs.forget(editKey);
          void this.render();
        };

        const submit = (): void => {
          if (save.disabled) return;
          const text = input.value.trim();
          if (!text) {
            new Notice("Comment cannot be empty.");
            input.focus();
            return;
          }
          if (text === expected.text) {
            finish();
            return;
          }
          save.disabled = true;
          cancel.disabled = true;
          let failure: "missing" | "conflict" | null = null;
          void this.plugin
            .updateDoc(file, (d) => {
              const result = editThreadEntry(d.comments, r.id, entryIndex, expected, text);
              if (!result.ok) failure = result.reason;
            })
            .then((ok) => {
              if (!ok) {
                save.disabled = false;
                cancel.disabled = false;
                return;
              }
              if (failure === "conflict") {
                new Notice("This comment changed while you were editing it. Your edit was not saved.");
              } else if (failure === "missing") {
                new Notice("This comment no longer exists. Your edit was not saved.");
              }
              finish();
            });
        };

        save.onclick = submit;
        cancel.onclick = finish;
        input.onkeydown = (e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            finish();
          } else if (this.shouldSubmit(e)) {
            e.preventDefault();
            submit();
          }
        };
        // A resumed edit gets focus back only if it had it, which the redraw
        // itself restores; it must not pull the reader out of another box.
        if (resumed) return;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      };
      if (this.editing.has(entryKey)) beginEdit(true);
      // Double-click no longer edits: it is also how a word is selected, and an
      // AI reply full of questions is there to be copied out and answered.
      textEl.onkeydown = (e) => {
        if (e.target !== textEl) return;
        if (e.key === "Enter" || e.key === "F2") {
          e.preventDefault();
          beginEdit();
        }
      };
    }
    renderThreadActivity(card, this.plugin.threadActivity(file.path, r.id), this.authorHost);

    const actions = card.createDiv({ cls: "tc-actions" });
    if (r.comment.status === "open" && r.comment.suggestion && !r.comment.suggestion.result) {
      const canAccept =
        r.resolution.kind === "resolved" &&
        !r.resolution.ambiguous &&
        typeof r.comment.suggestion.replacement === "string" &&
        r.comment.suggestion.replacement.length > 0;
      const acceptBtn = actions.createEl("button", { text: "Accept", cls: "mod-cta" });
      acceptBtn.disabled = !canAccept;
      acceptBtn.onclick = () => {
        const result = this.plugin.acceptEditSuggestion(file, r.id);
        if (!result.ok) {
          new Notice(suggestionFailureMessage(result.reason));
          return;
        }
        card.remove();
      };
      const declineBtn = actions.createEl("button", { text: "Decline" });
      declineBtn.onclick = () => {
        void (async () => {
          if (
            this.plugin.settings.resolveBehavior === "remove" &&
            this.plugin.settings.confirmDestructiveActions &&
            !(await confirmAction(this.app, {
              title: "Decline suggestion?",
              message: "This will permanently remove the suggestion and its discussion from the note.",
              confirmLabel: "Decline",
            }))
          ) {
            return;
          }
          await this.plugin.updateDoc(file, (d) => {
            const result = declineSuggestion(d.comments, r.id, this.plugin.settings.resolveBehavior);
            if (!result.ok) new Notice(suggestionFailureMessage(result.reason));
          });
        })();
      };
    } else if (r.comment.status === "resolved" && !r.comment.suggestion) {
      const reopenBtn = actions.createEl("button", { text: "Reopen" });
      reopenBtn.onclick = () => void this.plugin.updateDoc(file, (d) => setStatus(d.comments, r.id, "open"));
    }
    if (
      r.comment.status === "open" &&
      (r.resolution.kind === "orphaned" ||
        (r.comment.suggestion && r.resolution.kind === "resolved" && r.resolution.ambiguous))
    ) {
      const reBtn = actions.createEl("button", { text: "Re-anchor to selection" });
      reBtn.onclick = () => this.reanchorFromSelection(file, r.id);
    }
    if (!actions.hasChildNodes()) actions.remove();
    if (r.comment.status === "open") {
      this.renderReplyTargets(card);
      const reply = card.createEl("textarea", {
        cls: "tc-input",
        attr: {
          placeholder:
            this.plugin.settings.submitShortcut === "enter"
              ? "Reply… (Enter = send)"
              : "Reply… (Cmd/Ctrl+Enter = send)",
          rows: "2",
        },
      });
      this.inputs.bind(`reply ${readMarkKey(file.path, r.id)}`, reply);
      reply.onkeydown = (e) => {
        if (this.shouldSubmit(e)) {
          e.preventDefault();
          const text = reply.value.trim();
          if (!text) return;
          reply.value = "";
          void this.plugin
            .updateDoc(file, (d) =>
              addReply(d.comments, r.id, this.plugin.currentAuthor(), this.plugin.nowTs(), text)
            )
            .then((ok) => {
              if (ok) void this.plugin.notifyUserCommentAdded(file.path, text, r.id);
            });
        }
      };
    }
  }

  private shouldSubmit(event: KeyboardEvent): boolean {
    return shouldSubmitComment(event, this.plugin.settings.submitShortcut);
  }

  /**
   * MarkdownRenderer.render() produces link elements, but outside a Markdown
   * view they are inert: internal links navigate only if the host view calls
   * openLinkText() itself, and hover previews only appear if the view fires
   * the hover-link event. Wire both up for links inside comment text.
   */
  private wireCommentLinks(textEl: HTMLElement, file: TFile): void {
    const findInternalLink = (evt: Event): HTMLAnchorElement | null => {
      const link = (evt.target as Element | null)?.closest?.("a.internal-link");
      return link && textEl.contains(link) ? (link as HTMLAnchorElement) : null;
    };
    const getLinkTarget = (link: HTMLAnchorElement): string | null =>
      link.getAttribute("data-href") ?? link.getAttribute("href");
    const openInternalLink = (evt: MouseEvent, newLeaf: PaneType | boolean): void => {
      const link = findInternalLink(evt);
      if (!link) return;
      const target = getLinkTarget(link);
      if (!target) return;
      evt.preventDefault();
      // Keep the click from reaching card-level handlers (e.g. edit affordances).
      evt.stopPropagation();
      void this.app.workspace.openLinkText(target, file.path, newLeaf);
    };
    textEl.addEventListener("click", (evt) => {
      openInternalLink(evt, Keymap.isModEvent(evt));
    });
    textEl.addEventListener("auxclick", (evt) => {
      if (evt.button === 1) openInternalLink(evt, true);
    });
    textEl.addEventListener("mouseover", (evt) => {
      const link = findInternalLink(evt);
      if (!link) return;
      const target = getLinkTarget(link);
      if (!target) return;
      this.app.workspace.trigger("hover-link", {
        event: evt,
        source: this.plugin.manifest.id,
        hoverParent: this,
        targetEl: link,
        linktext: target,
        sourcePath: file.path,
      });
    });
  }

  private addTimestamp(container: HTMLElement, timestamp: string): void {
    const formatted = formatSidebarTimestamp(timestamp, this.plugin.settings.timestampDisplay);
    if (formatted === null) return;
    const element = container.createSpan({ text: formatted, cls: "tc-ts" });
    element.dataset.tcTimestamp = timestamp;
    if (this.plugin.settings.timestampDisplay !== "full") {
      setTooltip(element, formatTs(timestamp));
    }
  }

  private refreshTimestamps(): void {
    for (const element of Array.from(
      this.contentEl.querySelectorAll<HTMLElement>(".tc-ts[data-tc-timestamp]")
    )) {
      const timestamp = element.dataset.tcTimestamp;
      if (!timestamp) continue;
      const formatted = formatSidebarTimestamp(timestamp, this.plugin.settings.timestampDisplay);
      if (formatted !== null) element.setText(formatted);
    }
  }

  private reanchorFromSelection(file: TFile, id: string): void {
    const sel = this.plugin.getProseSelection(file);
    if (!sel) {
      new Notice("Select the new text passage in the editor first.");
      return;
    }
    void this.plugin.updateDoc(file, (d) => {
      const c = d.comments[id];
      if (c) c.anchor = sel.anchor;
    });
  }
}
