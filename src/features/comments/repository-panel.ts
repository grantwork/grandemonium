import { type App, type Component, MarkdownRenderer, setIcon, setTooltip } from "obsidian";

import { confirmAction } from "./confirm-action";
import { formatWorkingAge } from "./inbox-row";
import type { RepositorySelection, RepositoryThread } from "./repository-thread";
import type {
  RepositoryComposerToolbar,
  RepositoryThreadsController,
  ThreadLiveState,
} from "./RepositoryThreadsController";
import type { SubmitShortcut } from "./settings-model";
import { shouldSubmitComment } from "./sidebar-preferences";
import { keptThreadEntries, renderCollapsedEntry, renderEntryFoldToggle } from "./thread-collapse";
import { renderErrorIcon, renderTypingDots } from "./thread-status";

export interface RepositoryPanelHost {
  app: App;
  /** Owns the lifetime of rendered Markdown. */
  component: Component;
  controller: RepositoryThreadsController;
  submitShortcut(): SubmitShortcut;
  showResolved(): boolean;
  confirmDestructive(): boolean;
  /** Colours an author name or entry the way the rest of the panel does. */
  paintAuthor(el: HTMLElement, author: string, rail: boolean): void;
  isAgentAuthor(author: string): boolean;
  formatTimestamp(ts: string): string | null;
}

/** A text box with the chat toolbar under it, kept alive across redraws. */
interface Composer {
  readonly el: HTMLElement;
  readonly input: HTMLTextAreaElement;
  toolbar: RepositoryComposerToolbar | null;
}

/**
 * The "Repository" section at the top of the comments panel: comments about
 * the whole vault, each one a conversation with an AI that works across many
 * files and leaves ordinary comments in the notes it changed.
 *
 * The section owns a root element that the sidebar re-attaches rather than
 * rebuilds, so its two composers survive every redraw of the file list. An AI
 * streaming a reply updates only its own thread; the text a reader is typing,
 * and the focus they are typing with, are never touched.
 */
export class RepositoryPanel {
  readonly el: HTMLElement;
  private readonly headerEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly newComposer: Composer;
  private replyComposer: (Composer & { threadId: string }) | null = null;
  private composing = false;
  private collapsed = false;
  private expandedId: string | null = null;
  private liveEl: HTMLElement | null = null;
  private draftSelection: RepositorySelection | null = null;
  /** Folded entries the reader opened, as `threadId index`; cleared with the thread. */
  private readonly openedEntries = new Set<string>();
  private readonly stopListening: () => void;

  constructor(private readonly host: RepositoryPanelHost) {
    this.el = createDiv({ cls: "tc-file tc-repo" });
    this.headerEl = this.el.createDiv({ cls: "tc-repo-header" });
    this.newComposer = this.createComposer(
      "Ask an AI to make changes across the vault…",
      (text) => this.submitNew(text),
      () => this.closeNewComposer()
    );
    this.newComposer.el.addClass("tc-repo-new");
    this.el.appendChild(this.newComposer.el);
    this.listEl = this.el.createDiv({ cls: "tc-file-threads tc-repo-list" });
    this.stopListening = host.controller.onChange((threadId) => {
      if (threadId !== null && threadId === this.expandedId) this.renderLive();
      else if (threadId === null) this.render();
      else this.renderList();
    });
    this.render();
  }

  destroy(): void {
    this.stopListening();
    this.newComposer.toolbar?.destroy();
    this.replyComposer?.toolbar?.destroy();
    this.el.remove();
  }

  /** Opens the box for a new repository comment. */
  startComposing(): void {
    this.composing = true;
    this.collapsed = false;
    this.render();
    window.setTimeout(() => this.newComposer.input.focus(), 0);
  }

  render(): void {
    this.renderHeader();
    const available = this.host.controller.isAvailable();
    this.newComposer.el.toggleClass("tc-repo-hidden", !this.composing || this.collapsed || !available);
    if (this.composing && available) this.ensureToolbar(this.newComposer, {
      getSelection: () => this.draftSelectionOrDefault(),
      onSelectionChange: (selection) => {
        this.draftSelection = selection;
      },
    });
    this.renderList();
  }

  private renderHeader(): void {
    const open = this.visibleThreads().filter((thread) => thread.status === "open");
    this.headerEl.empty();
    const toggle = this.headerEl.createEl("button", {
      cls: "tc-file-group tc-repo-toggle",
      attr: { "aria-expanded": String(!this.collapsed), type: "button" },
    });
    setIcon(toggle.createSpan({ cls: "tc-file-chevron" }), this.collapsed ? "chevron-right" : "chevron-down");
    setIcon(toggle.createSpan({ cls: "tc-repo-icon" }), "folder-git-2");
    toggle.createSpan({ cls: "tc-file-name", text: "Repository" });
    if (open.some((thread) => this.host.controller.isWorking(thread.id))) {
      setIcon(toggle.createSpan({ cls: "tc-file-running", attr: { "aria-label": "Agent working" } }), "loader");
    }
    if (open.length) toggle.createSpan({ cls: "tc-file-count", text: String(open.length) });
    toggle.onclick = () => {
      this.collapsed = !this.collapsed;
      this.render();
    };
    if (!this.host.controller.isAvailable()) return;
    const add = this.headerEl.createEl("button", {
      cls: "clickable-icon tc-repo-add",
      attr: { "aria-label": "New repository comment", type: "button" },
    });
    setIcon(add, "plus");
    setTooltip(add, "New repository comment");
    add.onclick = () => {
      if (this.composing && !this.collapsed) this.closeNewComposer();
      else this.startComposing();
    };
  }

  private renderList(): void {
    // Redrawing detaches the reply box for a moment, which drops focus; put it
    // back so an agent finishing never interrupts someone typing.
    const input = this.replyComposer?.input;
    const typing = input && input.ownerDocument.activeElement === input
      ? { end: input.selectionEnd, start: input.selectionStart }
      : null;
    this.listEl.empty();
    this.liveEl = null;
    this.listEl.toggleClass("tc-repo-hidden", this.collapsed);
    if (this.collapsed) return;
    this.renderHeaderStatusOnly();
    const threads = this.visibleThreads();
    if (this.expandedId && !threads.some((thread) => thread.id === this.expandedId)) {
      this.collapseThread();
    }
    for (const thread of threads) {
      if (thread.id === this.expandedId) this.renderExpanded(thread);
      else this.renderRow(thread);
    }
    if (typing && input?.isConnected) {
      input.focus();
      input.setSelectionRange(typing.start, typing.end);
    }
  }

  /** The spinner and count follow every change without redrawing the button. */
  private renderHeaderStatusOnly(): void {
    const toggle = this.headerEl.querySelector(".tc-repo-toggle");
    if (!toggle) return;
    const working = this.visibleThreads().some(
      (thread) => thread.status === "open" && this.host.controller.isWorking(thread.id)
    );
    const spinner = toggle.querySelector(".tc-file-running");
    if (working && !spinner) {
      const el = createSpan({ cls: "tc-file-running", attr: { "aria-label": "Agent working" } });
      setIcon(el, "loader");
      toggle.querySelector(".tc-file-name")?.after(el);
    } else if (!working) {
      spinner?.remove();
    }
  }

  private visibleThreads(): RepositoryThread[] {
    return this.host.controller
      .list()
      .filter((thread) => thread.status === "open" || this.host.showResolved());
  }

  private renderRow(thread: RepositoryThread): void {
    const wrapper = this.listEl.createDiv({ cls: "tc-inbox-item tc-repo-item" });
    if (thread.status === "resolved") wrapper.addClass("tc-resolved");
    const row = wrapper.createEl("button", {
      cls: "tc-inbox-row",
      attr: { "aria-expanded": "false", type: "button" },
    });
    setIcon(row.createSpan({ cls: "tc-inbox-icon" }), "folder-git-2");
    row.createSpan({ cls: "tc-inbox-blurb", text: thread.title });
    this.renderStatus(row, thread);
    setTooltip(row, thread.thread.at(-1)?.text.slice(0, 300) ?? thread.title);
    row.onclick = () => this.expandThread(thread.id);
    const actions = wrapper.createDiv({ cls: "tc-inbox-actions" });
    this.renderThreadActions(actions, thread);
  }

  private renderStatus(row: HTMLElement, thread: RepositoryThread): void {
    const state = row.createSpan({ cls: "tc-inbox-status" });
    const live = this.host.controller.live(thread.id);
    if (live.approvals.length) {
      const waiting = state.createSpan({ cls: "tc-repo-waiting", attr: { "aria-label": "Waiting for approval" } });
      setIcon(waiting, "shield-question");
    }
    const since = this.host.controller.workingSince(thread.id);
    if (since === null) return;
    const working = state.createSpan({ cls: "tc-inbox-working", attr: { "aria-label": "AI working on this" } });
    setIcon(working.createSpan({ cls: "tc-inbox-working-icon" }), "loader");
    const age = working.createSpan({ cls: "tc-inbox-working-age", text: formatWorkingAge(Date.now() - since) });
    age.dataset.tcWorkingSince = String(since);
  }

  private renderThreadActions(actions: HTMLElement, thread: RepositoryThread): void {
    if (this.host.controller.isWorking(thread.id)) {
      const stop = actions.createEl("button", {
        cls: "tc-entry-action clickable-icon tc-inbox-stop",
        attr: { "aria-label": "Stop the AI", type: "button" },
      });
      setIcon(stop, "square");
      setTooltip(stop, "Stop the AI");
      stop.onclick = () => void this.confirmStop(thread.id);
    }
    if (thread.status === "open") {
      const resolve = actions.createEl("button", {
        cls: "tc-entry-action clickable-icon",
        attr: { "aria-label": "Resolve and end the AI session", type: "button" },
      });
      setIcon(resolve, "check");
      setTooltip(resolve, "Resolve and end the AI session");
      resolve.onclick = () => void this.resolveThread(thread.id);
    } else {
      const reopen = actions.createEl("button", {
        cls: "tc-entry-action clickable-icon",
        attr: { "aria-label": "Reopen", type: "button" },
      });
      setIcon(reopen, "rotate-ccw");
      setTooltip(reopen, "Reopen");
      reopen.onclick = () => this.host.controller.reopen(thread.id);
    }
  }

  private renderExpanded(thread: RepositoryThread): void {
    const wrapper = this.listEl.createDiv({ cls: "tc-inbox-expanded tc-repo-expanded" });
    const line = wrapper.createDiv({ cls: "tc-inbox-item" });
    const head = line.createEl("button", {
      cls: "tc-inbox-row tc-inbox-expanded-head",
      attr: { "aria-expanded": "true", type: "button" },
    });
    setIcon(head.createSpan({ cls: "tc-inbox-icon" }), "folder-git-2");
    head.createSpan({ cls: "tc-inbox-blurb", text: thread.title });
    this.renderStatus(head, thread);
    setIcon(head.createSpan({ cls: "tc-inbox-collapse" }), "chevron-up");
    head.onclick = () => {
      this.collapseThread();
      this.renderList();
    };
    this.renderThreadActions(line.createDiv({ cls: "tc-inbox-actions" }), thread);

    const body = wrapper.createDiv({ cls: "tc-inbox-expanded-body" });
    const card = body.createDiv({ cls: thread.status === "resolved" ? "tc-card tc-resolved" : "tc-card" });
    const kept = keptThreadEntries(thread.thread, (author) => this.host.isAgentAuthor(author));
    for (const [index, entry] of thread.thread.entries()) {
      const key = `${thread.id} ${index}`;
      if (!kept[index] && !this.openedEntries.has(key)) {
        const folded = renderCollapsedEntry(card, entry, () => {
          this.openedEntries.add(key);
          this.renderList();
        });
        this.host.paintAuthor(folded, entry.author, true);
        continue;
      }
      const agent = this.host.isAgentAuthor(entry.author);
      const row = card.createDiv({ cls: agent ? "tc-entry tc-entry-agent" : "tc-entry" });
      const error = entry.kind === "error";
      if (error) row.addClass("tc-entry-error");
      this.host.paintAuthor(row, entry.author, true);
      const meta = row.createDiv({ cls: "tc-meta" });
      const heading = kept[index]
        ? meta
        : renderEntryFoldToggle(meta, entry, () => {
            this.openedEntries.delete(key);
            this.renderList();
          });
      if (error) renderErrorIcon(heading);
      this.host.paintAuthor(heading.createSpan({ cls: "tc-author", text: entry.author }), entry.author, false);
      const ts = this.host.formatTimestamp(entry.ts);
      if (ts) heading.createSpan({ cls: "tc-ts", text: ts });
      const text = row.createDiv({ cls: "tc-text" });
      // An error is the provider's own words, not Markdown the AI wrote.
      if (error) text.setText(entry.text);
      else void MarkdownRenderer.render(this.host.app, entry.text, text, "", this.host.component);
    }
    this.liveEl = card.createDiv({ cls: "tc-repo-live" });
    this.renderLive();
    if (thread.status === "open") card.appendChild(this.replyComposerFor(thread).el);
  }

  /** Only the part of the open thread that changes while an AI works. */
  private renderLive(): void {
    const el = this.liveEl;
    const threadId = this.expandedId;
    if (!el || !threadId) return;
    const live = this.host.controller.live(threadId);
    el.empty();
    for (const turn of live.turns) {
      const row = el.createDiv({ cls: "tc-entry tc-entry-agent tc-repo-streaming" });
      this.host.paintAuthor(row, turn.agentName, true);
      const meta = row.createDiv({ cls: "tc-meta" });
      this.host.paintAuthor(meta.createSpan({ cls: "tc-author", text: turn.agentName }), turn.agentName, false);
      const working = meta.createSpan({ cls: "tc-inbox-working" });
      setIcon(working.createSpan({ cls: "tc-inbox-working-icon" }), "loader");
      const age = working.createSpan({
        cls: "tc-inbox-working-age",
        text: formatWorkingAge(Date.now() - turn.startedAt),
      });
      age.dataset.tcWorkingSince = String(turn.startedAt);
      if (turn.activity) row.createDiv({ cls: "tc-repo-activity", text: turn.activity });
      if (turn.text) row.createDiv({ cls: "tc-text tc-repo-stream-text", text: turn.text });
      else renderTypingDots(row, turn.agentName);
    }
    this.renderApprovals(el, live);
    if (this.replyComposer?.threadId === threadId) this.replyComposer.toolbar?.setUsage(live.usage);
    this.renderHeaderStatusOnly();
  }

  private renderApprovals(el: HTMLElement, live: ThreadLiveState): void {
    for (const approval of live.approvals) {
      const box = el.createDiv({ cls: "tc-repo-approval", attr: { role: "group", "aria-label": "Permission required" } });
      const title = box.createDiv({ cls: "tc-repo-approval-title" });
      setIcon(title.createSpan(), "shield-question");
      title.createSpan({ text: `${approval.agentName} wants to use ${approval.toolName}` });
      if (approval.description && approval.description !== approval.toolName) {
        box.createDiv({ cls: "tc-repo-approval-detail", text: approval.description });
      }
      const buttons = box.createDiv({ cls: "tc-actions" });
      approval.choices.forEach((choice, index) => {
        const button = buttons.createEl("button", {
          cls: index === 0 ? "mod-cta" : "",
          text: choice.label,
          attr: { type: "button" },
        });
        if (choice.description) setTooltip(button, choice.description);
        button.onclick = () => this.host.controller.answerApproval(approval.id, choice.decision);
      });
    }
  }

  private replyComposerFor(thread: RepositoryThread): Composer {
    if (this.replyComposer?.threadId === thread.id) {
      this.replyComposer.toolbar?.refresh();
      return this.replyComposer;
    }
    this.replyComposer?.toolbar?.destroy();
    this.replyComposer?.el.remove();
    const binding = {
      getSelection: () =>
        this.host.controller.get(thread.id)?.selection ?? this.draftSelectionOrDefault(),
      onSelectionChange: (selection: RepositorySelection) => {
        this.host.controller.setSelection(thread.id, selection);
      },
    };
    const composer = this.createComposer(
      "Reply, or @mention another AI…",
      (text) => {
        this.host.controller.reply(thread.id, text);
        return true;
      },
      () => undefined
    );
    this.ensureToolbar(composer, binding);
    this.replyComposer = { ...composer, threadId: thread.id };
    return this.replyComposer;
  }

  private createComposer(
    placeholder: string,
    submit: (text: string) => boolean,
    cancel: () => void
  ): Composer {
    const el = createDiv({ cls: "tc-repo-composer grandemonium-container" });
    const input = el.createEl("textarea", {
      cls: "tc-input tc-repo-input",
      attr: {
        "aria-label": placeholder,
        placeholder:
          this.host.submitShortcut() === "enter"
            ? `${placeholder} (Enter = send)`
            : `${placeholder} (Cmd/Ctrl+Enter = send)`,
        rows: "3",
      },
    });
    input.onkeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      } else if (shouldSubmitComment(event, this.host.submitShortcut())) {
        event.preventDefault();
        const text = input.value.trim();
        if (text && submit(text)) input.value = "";
      }
    };
    return { el, input, toolbar: null };
  }

  private ensureToolbar(
    composer: Composer,
    binding: { getSelection(): RepositorySelection; onSelectionChange(selection: RepositorySelection): void }
  ): void {
    if (composer.toolbar) {
      composer.toolbar.refresh();
      return;
    }
    const port = this.host.controller.agentPort();
    if (!port || !this.host.controller.defaultSelection()) return;
    composer.toolbar = port.mountToolbar(composer.el, binding);
  }

  private draftSelectionOrDefault(): RepositorySelection {
    const selection = this.draftSelection ?? this.host.controller.defaultSelection();
    // The toolbar is only mounted once a default exists, so this is a guard.
    return selection ?? { model: "", providerId: "claude" };
  }

  private submitNew(text: string): boolean {
    const selection = this.draftSelectionOrDefault();
    const thread = this.host.controller.create(text, selection);
    if (!thread) return false;
    this.composing = false;
    this.expandedId = thread.id;
    this.render();
    return true;
  }

  private closeNewComposer(): void {
    this.composing = false;
    this.render();
  }

  private expandThread(threadId: string): void {
    this.expandedId = threadId;
    this.renderList();
  }

  private collapseThread(): void {
    this.expandedId = null;
    this.openedEntries.clear();
    this.replyComposer?.toolbar?.destroy();
    this.replyComposer?.el.remove();
    this.replyComposer = null;
  }

  /** Always confirms: a repository task has usually been running for minutes. */
  private async confirmStop(threadId: string): Promise<void> {
    const confirmed = await confirmAction(this.host.app, {
      confirmLabel: "Stop",
      message: "The AI is still working. Files it has already changed stay changed.",
      title: "Stop the AI?",
    });
    if (confirmed) this.host.controller.stop(threadId);
  }

  private async resolveThread(threadId: string): Promise<void> {
    if (
      this.host.confirmDestructive() &&
      this.host.controller.isWorking(threadId) &&
      !(await confirmAction(this.host.app, {
        confirmLabel: "Resolve",
        message: "The AI is still working. Resolving stops it and ends its session.",
        title: "Resolve repository comment?",
      }))
    ) {
      return;
    }
    if (this.expandedId === threadId) this.collapseThread();
    await this.host.controller.resolve(threadId);
  }
}
