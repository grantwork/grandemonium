import type { Editor} from "obsidian";
import { type App, MarkdownView, normalizePath, Notice, type Plugin, type PluginManifest, TFile } from "obsidian";

import { ProviderRegistry } from "../../core/providers/ProviderRegistry";
import { resolveReplyTarget } from "./agent-mention";
import {
  AUTHOR_OVERRIDE_KEY,
  detectOsUsername,
  FALLBACK_AUTHOR,
  LEGACY_AUTHOR_OVERRIDE_KEY,
  resolveAuthorName,
} from "./author";
import { CommentIndex } from "./comment-index";
import type { CommentPopoverHost } from "./comment-popover";
import { CommentsSettingsStore } from "./CommentsSettingsStore";
import { confirmAction } from "./confirm-action";
import { buildEditorExtension } from "./editor-extension";
import {
  buildExportNote,
  formatTs,
  renderExportFileName,
  resolveExportDirectory,
} from "./export";
import { buildImplementMessage, type ImplementTarget } from "./implement-message";
import { buildInbox, type InboxView, readMarkKey } from "./inbox-model";
import { type ReadMark, ReadMarksStore } from "./read-marks";
import { registerReadingView } from "./reading-view";
import { type RepositoryAgentPort, RepositoryThreadsController } from "./RepositoryThreadsController";
import { buildReviewMessage } from "./review-message";
import { shouldStartSelectionComment } from "./selection-comment";
import {
  type CommentsSettings,
  DEFAULT_SETTINGS,
  parseCommentsSettings,
  settingsEffects,
} from "./settings-model";
import { CommentSidebar, suggestionFailureMessage, VIEW_TYPE_COMMENTS } from "./sidebar";
import {
  addReply,
  declineSuggestion,
  makeAnchor,
  parseDocument,
  planSuggestionAcceptance,
  removeComment,
  resolveAll,
  resolveAnchor,
  serializeDocument,
  setStatus,
  type SuggestionAcceptancePlan,
} from "./store";
import { commitSuggestionAcceptance } from "./suggestion-editor";
import type { ThreadActivity } from "./thread-status";
import { formatSidebarTimestamp } from "./timestamp";
import type { Anchor, ParsedDoc } from "./types";

const DEFAULT_CLAUDE_AGENT_NAME = "claude";

export type CommentReviewResult =
  | { readonly kind: "completed" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failed"; readonly message: string };

/** One AI working on one review, running in a background session of its own. */
export interface CommentReviewHandle {
  readonly agentName: string;
  /** When the review was asked for, so the age a reader sees includes any wait. */
  readonly startedAt: number;
  /** Settles once and never rejects: every outcome is a result. */
  readonly done: Promise<CommentReviewResult>;
  cancel(): void;
}

/**
 * The AIs, as this vendored feature sees them. Supplied by the composition root
 * so comments never import chat or provider code.
 */
export interface CommentAiPort {
  /** Agent names of the enabled AIs, used to tell their replies from a person's. */
  agentNames(): string[];
  /**
   * Starts one review per AI reached: every enabled one, or the one named. Each
   * runs in a disposable session, so no review inherits another's context. A
   * review used to go into a long-lived chat tab, whose context grew with every
   * comment in every note until it degraded. Empty when no AI could take it.
   */
  review(prompt: string, targetAgentName?: string): CommentReviewHandle[];
}

/** A handle, plus which thread in which note is waiting on it. */
interface ActiveReview {
  readonly filePath: string | null;
  /** Null for a review of a whole note rather than of one thread. */
  readonly threadKey: string | null;
  readonly handle: CommentReviewHandle;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class CommentsController {
  settings: CommentsSettings = DEFAULT_SETTINGS;
  private applyingSuggestion = false;
  private settingsWriteQueue: Promise<void> = Promise.resolve();
  private readonly store: CommentsSettingsStore;

  private aiPort: CommentAiPort | null = null;

  /**
   * Replies typed but not sent, keyed by file and comment. The popover is
   * dismissed by a click anywhere else, which would otherwise throw the text
   * away. Session-only: an unsent reply is not worth writing into the note.
   */
  private readonly replyDrafts = new Map<string, string>();

  private readonly index: CommentIndex;
  private readonly readMarks: ReadMarksStore;
  private repositoryPort: RepositoryAgentPort | null = null;
  /** Comments about the whole vault, each a live conversation with an AI. */
  readonly repository: RepositoryThreadsController;
  /**
   * Every review still running. Each settles on its own, so a thread clears the
   * moment its own review ends; a chat tab only ever reported that it was idle.
   */
  private readonly activeReviews = new Set<ActiveReview>();
  /** Failed reviews by thread key, until the thread is asked again. */
  private readonly reviewErrors = new Map<string, ThreadActivity["errors"]>();
  private indexSweep: Promise<void> | null = null;

  constructor(private readonly plugin: Plugin) {
    this.store = new CommentsSettingsStore(plugin);
    this.index = new CommentIndex({
      listFiles: () =>
        plugin.app.vault.getMarkdownFiles().map((file) => ({
          mtime: file.stat.mtime,
          path: file.path,
        })),
      read: async (path) => {
        const file = plugin.app.vault.getAbstractFileByPath(path);
        return file instanceof TFile ? await plugin.app.vault.cachedRead(file) : null;
      },
    });
    this.repository = new RepositoryThreadsController({
      agents: () => this.repositoryPort,
      author: () => this.currentAuthor(),
      notify: (message, options) => new Notice(message, options?.persistent ? 0 : 10_000),
      now: () => this.nowTs(),
      preferredAgentName: () => this.settings.replyTarget,
      resolveBehavior: () => this.settings.resolveBehavior,
      storage: {
        read: () => this.store.readRepositoryThreads(),
        write: (data) => this.store.writeRepositoryThreads(data),
      },
    });
    this.readMarks = new ReadMarksStore({
      load: (key) => {
        const stored: unknown = plugin.app.loadLocalStorage(key);
        return stored;
      },
      save: (key, value) => plugin.app.saveLocalStorage(key, value),
    });
  }

  /**
   * Every open comment in the vault, under the note it belongs to. The panel
   * exists to be emptied, so nothing is filed out of sight: unread marks a row
   * rather than moving it somewhere the reader has to remember to look.
   */
  inbox(): InboxView {
    const runningPaths = new Set<string>();
    const runningThreads = new Map<string, number>();
    for (const { filePath, handle, threadKey } of this.activeReviews) {
      if (filePath) runningPaths.add(filePath);
      if (!threadKey) continue;
      // Several AIs may be on one thread; the reader has been waiting since the
      // first was asked, so that is the age the row shows.
      const earliest = runningThreads.get(threadKey);
      runningThreads.set(
        threadKey,
        earliest === undefined ? handle.startedAt : Math.min(earliest, handle.startedAt)
      );
    }
    return buildInbox({
      files: this.index.files(),
      readMarks: this.readMarks.marks(),
      runningPaths,
      runningThreads,
      selfAuthor: this.currentAuthor(),
      sortOrder: this.settings.sidebarSortOrder,
    });
  }

  threadActivity(filePath: string, commentId: string): ThreadActivity {
    const key = readMarkKey(filePath, commentId);
    const replying = [...this.activeReviews]
      .filter((review) => review.threadKey === key)
      .map((review) => review.handle.agentName);
    return { errors: this.reviewErrors.get(key) ?? [], replying };
  }

  /** Stops every AI still working on one thread. What it already wrote stays. */
  stopReviews(filePath: string, commentId: string): void {
    const key = readMarkKey(filePath, commentId);
    for (const review of this.activeReviews) {
      if (review.threadKey === key) review.handle.cancel();
    }
  }

  /**
   * Starts a review on every AI the port reaches and follows each to its end.
   * A failure is shown in its thread, or for a whole-note review in a popup
   * that stays until dismissed; a stop the reader asked for is not a failure.
   */
  private dispatch(
    prompt: string,
    targetAgentName: string | null,
    filePath: string | null,
    commentId: string | null
  ): void {
    const port = this.aiPort;
    if (!port) return;
    let handles: CommentReviewHandle[];
    try {
      handles = port.review(prompt, targetAgentName ?? undefined);
    } catch (error) {
      new Notice("Review request failed: " + errorText(error));
      return;
    }
    if (handles.length === 0) {
      new Notice(
        targetAgentName
          ? `${targetAgentName} is not available to review comments.`
          : "No enabled AI could take the review."
      );
      return;
    }
    const threadKey = filePath && commentId ? readMarkKey(filePath, commentId) : null;
    const subject = filePath ? filePath.split("/").pop() ?? filePath : "your comments";
    // Asking again supersedes whatever went wrong last time.
    if (threadKey) this.reviewErrors.delete(threadKey);
    for (const handle of handles) {
      const review: ActiveReview = { filePath, handle, threadKey };
      this.activeReviews.add(review);
      void handle.done.then((result) => {
        this.activeReviews.delete(review);
        if (result.kind === "failed") {
          if (threadKey) {
            const error = { author: handle.agentName, text: `Couldn't finish: ${result.message}`, ts: this.nowTs() };
            this.reviewErrors.set(threadKey, [...(this.reviewErrors.get(threadKey) ?? []), error]);
          } else {
            new Notice(`${handle.agentName} couldn't finish reviewing ${subject}: ${result.message}`, 0);
          }
        }
        this.refreshSidebars();
      });
    }
    this.refreshSidebars();
  }

  markThreadsRead(items: Iterable<ReadMark>): void {
    this.readMarks.markAllRead(items);
  }

  /** Sweeps the vault once; callers arriving mid-sweep share the one in flight. */
  async refreshIndex(): Promise<void> {
    this.indexSweep ??= this.index
      .refresh()
      .then(() => {
        this.readMarks.prune(new Set(this.index.files().map((file) => file.path)));
      })
      .finally(() => {
        this.indexSweep = null;
      });
    await this.indexSweep;
  }

  private async reindexFile(file: TFile): Promise<void> {
    if (file.extension !== "md") return;
    let changed: boolean;
    try {
      changed = await this.index.refreshFile(file.path, file.stat.mtime);
    } catch {
      // A file that cannot be read now keeps whatever the index last saw.
      return;
    }
    if (changed) this.refreshSidebars();
  }

  private refreshSidebars(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_COMMENTS)) {
      if (leaf.view instanceof CommentSidebar) void leaf.view.render();
    }
  }

  /** Installed by the composition root once the chat side can accept prompts. */
  setAiPort(port: CommentAiPort | null): void {
    this.aiPort = port;
  }

  /** Installed by the composition root; repository threads stay hidden without it. */
  setRepositoryPort(port: RepositoryAgentPort | null): void {
    this.repositoryPort = port;
    this.refreshSidebars();
  }

  /** True while an AI can be asked to review; the action stays hidden otherwise. */
  canRequestReview(): boolean {
    return this.aiPort !== null;
  }

  /** Agent names of the enabled AIs, for the reply-target picker. */
  enabledAgentNames(): string[] {
    return this.aiPort?.agentNames() ?? [];
  }

  /** Whether a thread entry was written by one of the enabled AIs. */
  isAgentAuthor(author: string): boolean {
    const names = this.aiPort?.agentNames() ?? [];
    return names.some(name => name.toLowerCase() === author.trim().toLowerCase());
  }

  /**
   * Called after the user adds a comment or reply. Requests a review straight
   * away when that setting is on, so the review action need not be pressed.
   */
  async notifyUserCommentAdded(filePath: string, text = "", commentId?: string): Promise<void> {
    const port = this.aiPort;
    if (!this.settings.reviewOnComment || !port) return;
    // "@gpt run your changes" addresses one AI; otherwise the standing choice
    // decides, and only an unset choice reaches every enabled AI.
    const target = resolveReplyTarget(text, port.agentNames(), this.settings.replyTarget);
    await this.requestReview(filePath, target, commentId);
  }

  /**
   * Asks one AI to carry out what it proposed on one comment. The target is
   * required: the configured prompt alone does not say which comment, and an
   * AI reading the whole block would otherwise act on every open comment.
   */
  async requestImplementation(agentName: string, target: ImplementTarget): Promise<void> {
    const port = this.aiPort;
    if (!port) {
      new Notice("No AI is available to make changes.");
      return;
    }
    const prompt = this.settings.implementPrompt.trim();
    if (!prompt) {
      new Notice("Set an implementation request in comments settings first.");
      return;
    }
    this.dispatch(buildImplementMessage(prompt, target), agentName, target.filePath, target.commentId);
  }

  /**
   * Asks every enabled AI to review open comments, using the configured
   * prompt. The file is named so an AI whose tab is linked elsewhere still
   * reviews the right note.
   */
  async requestReview(
    filePath: string | null = null,
    targetAgentName: string | null = null,
    commentId?: string,
  ): Promise<void> {
    const port = this.aiPort;
    if (!port) {
      new Notice("No AI is available to review comments.");
      return;
    }
    const prompt = this.settings.reviewPrompt.trim();
    if (!prompt) {
      new Notice("Set a review request in comments settings first.");
      return;
    }
    this.dispatch(buildReviewMessage(prompt, filePath), targetAgentName, filePath, commentId ?? null);
  }

  /** Obsidian app handle, delegated so feature code keeps using `this.app`. */
  private get app(): App {
    return this.plugin.app;
  }

  /** Host plugin manifest, read by the sidebar for its block language tag. */
  get manifest(): PluginManifest {
    return this.plugin.manifest;
  }

  /**
   * The name Claude signs review comments with, so the exported skill matches
   * the identity the chat system prompt already gives it. Reads the host
   * plugin's settings structurally: this vendored feature only holds `Plugin`.
   */
  claudeAgentName(): string {
    const settings = (this.plugin as Plugin & { settings?: unknown }).settings;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return DEFAULT_CLAUDE_AGENT_NAME;
    }
    return ProviderRegistry.getAgentName('claude', settings as Record<string, unknown>);
  }

  async load(): Promise<void> {
    await this.loadSettings();
    await this.repository.load().catch(() => {
      new Notice("Repository comments could not be loaded.");
    });
    this.applyHighlightAppearance();
    this.applyReadingViewPreference();

    this.plugin.registerHoverLinkSource(this.manifest.id, {
      display: this.manifest.name,
      defaultMod: false,
    });
    this.plugin.registerView(VIEW_TYPE_COMMENTS, (leaf) => new CommentSidebar(leaf, this));
    this.plugin.registerEditorExtension(buildEditorExtension(this));
    registerReadingView(this.plugin, this);

    this.plugin.addCommand({
      id: "add-comment",
      name: "Add comment",
      icon: "message-square-plus",
      editorCallback: (editor) => this.addCommentFromSelection(editor),
    });
    this.plugin.addCommand({
      id: "suggest-edit",
      name: "Suggest edit",
      icon: "replace",
      editorCallback: (editor) => this.addSuggestionFromSelection(editor),
    });
    this.plugin.addCommand({
      id: "open-sidebar",
      name: "Open comment sidebar",
      icon: "message-square",
      callback: () => void this.openSidebar(),
    });
    this.plugin.addCommand({
      id: "toggle-resolved",
      name: "Toggle resolved threads",
      icon: "check-check",
      callback: () => void this.openSidebar().then((v) => v?.toggleResolved()),
    });
    this.plugin.addCommand({
      id: "purge-resolved",
      name: "Remove resolved threads from file",
      icon: "trash-2",
      callback: () => void this.removeResolvedThreads(),
    });

    this.plugin.addCommand({
      id: "export-comments",
      name: "Export review threads of active file",
      icon: "file-output",
      callback: () => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") {
          new Notice("No active Markdown file.");
          return;
        }
        void this.exportComments(file);
      },
    });

    this.plugin.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile) void this.reindexFile(file);
      })
    );
    this.plugin.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile) void this.reindexFile(file);
      })
    );
    this.plugin.registerEvent(
      this.app.vault.on("delete", (file) => {
        this.index.forget(file.path);
        this.refreshSidebars();
      })
    );
    this.plugin.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        // Read marks are keyed by path, so they have to follow the file or
        // every thread in it would come back as unread.
        this.index.rename(oldPath, file.path);
        this.readMarks.rename(oldPath, file.path);
        this.refreshSidebars();
      })
    );
    // The first sweep reads every note, so it runs behind the rest of startup.
    // A vault that refuses a read leaves the inbox thinner, never unloaded.
    void this.refreshIndex().then(
      () => this.refreshSidebars(),
      () => undefined
    );

    this.plugin.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        if (!editor.somethingSelected()) return;
        menu.addItem((item) =>
          item
            .setTitle("Add comment")
            .setIcon("message-square")
            .onClick(() => this.addCommentFromSelection(editor))
        );
        menu.addItem((item) =>
          item
            .setTitle("Suggest edit")
            .setIcon("replace")
            .onClick(() => this.addSuggestionFromSelection(editor))
        );
      })
    );

    this.plugin.registerEvent(
      this.app.workspace.on("window-open", (win) => {
        this.applyHighlightAppearanceTo(win.doc);
        this.applyReadingViewPreferenceTo(win.doc);
      })
    );
  }

  unload(): void {
    this.replyDrafts.clear();
    void this.repository.dispose();
    for (const doc of this.allDocuments()) {
      doc.body.style.removeProperty("--tc-highlight-color");
      doc.body.style.removeProperty("--tc-highlight-opacity");
      doc.body.classList.remove("tc-hide-reading-indicator");
    }
  }

  async loadSettings(): Promise<void> {
    const parsed = parseCommentsSettings(await this.store.read());
    this.migrateLegacyAuthorName(parsed.legacyAuthorName);
    this.settings = parsed.settings;
    if (parsed.changed) await this.store.write(this.settings);
  }

  async updateSettings(patch: Partial<CommentsSettings>): Promise<void> {
    const previous = this.settings;
    const next = parseCommentsSettings({ ...previous, ...patch }).settings;
    this.settings = next;
    const write = this.settingsWriteQueue
      .catch(() => undefined)
      .then(() => this.store.write(next));
    this.settingsWriteQueue = write;
    await write;
    const effects = settingsEffects(previous, next);
    if (effects.refreshHighlights) this.applyHighlightAppearance();
    if (effects.refreshAuthorColors) this.refreshAuthorColors();
    if (effects.refreshReadingViewIndicator) this.applyReadingViewPreference();
    if (effects.refreshSidebar) {
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_COMMENTS)) {
        if (leaf.view instanceof CommentSidebar) {
          leaf.view.settingsChanged(effects.resetResolvedVisibility);
        }
      }
    }
  }

  private async removeResolvedThreads(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") return;
    if (
      this.settings.confirmDestructiveActions &&
      !(await confirmAction(this.app, {
        title: "Remove resolved threads?",
        message: "This will permanently remove every resolved review thread from the active note.",
        confirmLabel: "Remove threads",
      }))
    ) {
      return;
    }
    await this.updateDoc(file, (doc) => {
      let count = 0;
      for (const [id, comment] of Object.entries(doc.comments)) {
        if (comment.status === "resolved") {
          delete doc.comments[id];
          count++;
        }
      }
      new Notice(
        count > 0
          ? `${count} resolved thread${count === 1 ? "" : "s"} removed.`
          : "No resolved threads in this file."
      );
    });
  }

  /**
   * The author label attached to new comments/replies from this device: the
   * manual override if set, otherwise the detected OS account username, else a
   * generic fallback. See {@link resolveAuthorName}.
   */
  currentAuthor(): string {
    return resolveAuthorName(this.authorOverride(), detectOsUsername());
  }

  /** The name auto-detection would use — shown as the settings placeholder. */
  detectedAuthor(): string {
    return detectOsUsername() ?? FALLBACK_AUTHOR;
  }

  /** Device-local manual override for the author label ("" when unset). Never synced. */
  authorOverride(): string {
    const v: unknown = this.app.loadLocalStorage(AUTHOR_OVERRIDE_KEY);
    return typeof v === "string" ? v : "";
  }

  /** Persist the override to per-vault localStorage; an empty value clears it. */
  setAuthorOverride(value: string): void {
    const trimmed = value.trim();
    this.app.saveLocalStorage(AUTHOR_OVERRIDE_KEY, trimmed || null);
  }

  /**
   * One-time transition: the author name used to live in synced settings. Seed
   * it as this device's local override (unless one already exists) and drop it
   * from the settings object so it stops being synced.
   */
  private migrateLegacyAuthorName(syncedAuthorName?: string): void {
    const current: unknown = this.app.loadLocalStorage(AUTHOR_OVERRIDE_KEY);
    const oldLocal: unknown = this.app.loadLocalStorage(LEGACY_AUTHOR_OVERRIDE_KEY);
    const legacy =
      typeof oldLocal === "string" && oldLocal.trim()
        ? oldLocal.trim()
        : syncedAuthorName?.trim();
    if (typeof current !== "string" && legacy && legacy !== FALLBACK_AUTHOR) {
      this.app.saveLocalStorage(AUTHOR_OVERRIDE_KEY, legacy);
    }
    if (oldLocal !== null) this.app.saveLocalStorage(LEGACY_AUTHOR_OVERRIDE_KEY, null);
  }

  /** The main window plus every popout window. */
  private allDocuments(): Set<Document> {
    const docs = new Set<Document>([activeDocument]);
    this.app.workspace.iterateAllLeaves((leaf) => docs.add(leaf.view.containerEl.ownerDocument));
    return docs;
  }

  applyHighlightAppearance(): void {
    for (const doc of this.allDocuments()) {
      this.applyHighlightAppearanceTo(doc);
    }
  }

  private applyHighlightAppearanceTo(doc: Document): void {
    doc.body.style.setProperty("--tc-highlight-color", this.settings.highlightColor);
    doc.body.style.setProperty("--tc-highlight-opacity", `${this.settings.highlightOpacity}%`);
  }

  private applyReadingViewPreference(): void {
    for (const doc of this.allDocuments()) this.applyReadingViewPreferenceTo(doc);
  }

  private applyReadingViewPreferenceTo(doc: Document): void {
    doc.body.classList.toggle(
      "tc-hide-reading-indicator",
      !this.settings.showReadingViewIndicator
    );
  }

  nowTs(): string {
    return new Date().toISOString();
  }

  async readDoc(file: TFile): Promise<ParsedDoc> {
    return parseDocument(await this.app.vault.read(file));
  }

  /** Every mutation runs through here: read, parse, mutate, serialize, write. */
  async updateDoc(file: TFile, mutate: (doc: ParsedDoc) => void): Promise<boolean> {
    const raw = await this.app.vault.read(file);
    const doc = parseDocument(raw);
    if (doc.error) {
      new Notice("tandem-comments block is invalid — please fix the JSON: " + doc.error);
      return false;
    }
    mutate(doc);
    const out = serializeDocument(doc, this.settings.schemaHint);
    if (out !== raw) await this.app.vault.modify(file, out);
    return true;
  }

  /** Exports the file's comments as a note, overwriting it on re-export. */
  async exportComments(file: TFile): Promise<void> {
    const doc = await this.readDoc(file);
    if (doc.error) {
      new Notice("tandem-comments block is invalid — please fix the JSON: " + doc.error);
      return;
    }
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const content = buildExportNote(file.basename, resolveAll(doc.prose, doc.comments), {
      scope: this.settings.exportScope,
      date,
      formatTs,
    });
    if (!content) {
      new Notice("No review threads to export.");
      return;
    }
    const name = renderExportFileName(this.settings.exportNameTemplate, file.basename, date);
    const folder = resolveExportDirectory(
      file.parent?.path ?? null,
      this.settings.exportDestination,
      this.settings.exportFolder
    );
    const targetFolder = folder
      ? this.app.vault.getFolderByPath(normalizePath(folder))
      : this.app.vault.getRoot();
    if (!targetFolder) {
      new Notice("The selected export folder no longer exists. Choose another folder in settings.");
      return;
    }
    const path = normalizePath((folder ? folder + "/" : "") + name + ".md");
    if (path === file.path) {
      new Notice("Export name matches the source file — change the template in settings.");
      return;
    }
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) await this.app.vault.modify(existing, content);
    else if (existing) {
      new Notice("Export target is a folder: " + path);
      return;
    } else await this.app.vault.create(path, content);
    new Notice("Review threads exported to " + path);
  }

  addCommentFromSelection(editor: Editor): void {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;
    const anchor = this.anchorFromSelection(editor);
    if (!anchor) return;
    void this.openSidebar().then((view) => view?.startDraft(file, anchor));
  }

  /**
   * Opens a comment draft as soon as a passage is selected in the editor, so a
   * comment needs no context menu. Called from the editor extension after the
   * pointer is released, with the document text and selection it observed.
   */
  startSelectionComment(text: string, from: number, to: number): void {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") return;
    const doc = parseDocument(text);
    if (doc.error) return;
    const openDraftRange = this.openSidebarView()?.draftRange(file.path, doc.prose) ?? null;
    if (
      !shouldStartSelectionComment({
        enabled: this.settings.commentOnSelection,
        from,
        to,
        proseLength: doc.prose.length,
        openDraftRange,
      })
    ) {
      return;
    }
    const anchor = makeAnchor(doc.prose, from, to);
    void this.openSidebar(undefined, { activate: false }).then((view) =>
      view?.startDraft(file, anchor, { focus: false })
    );
  }

  /**
   * Wires one inline popover to the plugin. The sidebar keeps the full surface,
   * so anything beyond replying and resolving hands off to it.
   */
  commentPopoverHost(id: string, close: () => void): CommentPopoverHost {
    const file = this.app.workspace.getActiveFile();
    const draftKey = `${file?.path ?? ""}\u0000${id}`;
    return {
      authorColorOverrides: this.settings.authorColorOverrides,
      colorAuthorNames: this.settings.colorAuthorNames,
      formatTimestamp: (ts) => formatSidebarTimestamp(ts, this.settings.timestampDisplay),
      submitOnEnter: this.settings.submitShortcut === "enter",
      replyDraft: this.replyDrafts.get(draftKey) ?? "",
      size:
        this.settings.commentPopoverWidth && this.settings.commentPopoverHeight
          ? {
              width: this.settings.commentPopoverWidth,
              height: this.settings.commentPopoverHeight,
            }
          : null,
      onReplyDraftChange: (text) => {
        if (text) this.replyDrafts.set(draftKey, text);
        else this.replyDrafts.delete(draftKey);
      },
      onSizeChange: ({ width, height }) => {
        void this.updateSettings({
          commentPopoverWidth: width,
          commentPopoverHeight: height,
        });
      },
      onReply: (text) => {
        if (!file) return;
        void this.updateDoc(file, (d) =>
          addReply(d.comments, id, this.currentAuthor(), this.nowTs(), text)
        ).then((ok) => {
          if (ok) void this.notifyUserCommentAdded(file.path, text, id);
        });
      },
      onResolve: () => {
        if (!file) return;
        void (async () => {
          const removes = this.settings.resolveBehavior === "remove";
          if (
            removes &&
            this.settings.confirmDestructiveActions &&
            !(await confirmAction(this.app, {
              title: "Resolve?",
              message: "This will permanently remove the comment thread from the note.",
              confirmLabel: "Resolve",
            }))
          ) {
            return;
          }
          await this.updateDoc(file, (d) => {
            if (removes) removeComment(d.comments, id);
            else setStatus(d.comments, id, "resolved");
          });
          close();
        })();
      },
      onAcceptSuggestion: () => {
        if (!file) return;
        const result = this.acceptEditSuggestion(file, id);
        if (!result.ok) {
          new Notice(suggestionFailureMessage(result.reason));
          return;
        }
        close();
      },
      onDeclineSuggestion: () => {
        if (!file) return;
        void (async () => {
          if (
            this.settings.resolveBehavior === "remove" &&
            this.settings.confirmDestructiveActions &&
            !(await confirmAction(this.app, {
              title: "Decline suggestion?",
              message:
                "This will permanently remove the suggestion and its discussion from the note.",
              confirmLabel: "Decline",
            }))
          ) {
            return;
          }
          await this.updateDoc(file, (d) => {
            const result = declineSuggestion(d.comments, id, this.settings.resolveBehavior);
            if (!result.ok) new Notice(suggestionFailureMessage(result.reason));
          });
          close();
        })();
      },
      onOpenSidebar: () => {
        close();
        void this.openSidebar(id);
      },
    };
  }

  /** Read by the editor extension: an open sidebar takes a highlight click. */
  isSidebarOpen(): boolean {
    return this.openSidebarView() !== null;
  }

  /** The comment sidebar if it is already open; never opens one. */
  private openSidebarView(): CommentSidebar | null {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_COMMENTS)) {
      if (leaf.view instanceof CommentSidebar) return leaf.view;
    }
    return null;
  }

  addSuggestionFromSelection(editor: Editor): void {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;
    const anchor = this.anchorFromSelection(editor);
    if (!anchor) return;
    void this.openSidebar().then((view) => view?.startSuggestionDraft(file, anchor));
  }

  private anchorFromSelection(editor: Editor): Anchor | null {
    if (!editor.somethingSelected()) {
      new Notice("Select some text first.");
      return null;
    }
    const from = editor.posToOffset(editor.getCursor("from"));
    const to = editor.posToOffset(editor.getCursor("to"));
    const doc = parseDocument(editor.getValue());
    if (to > doc.prose.length) {
      new Notice("Only prose can be commented or suggested (not the comment block).");
      return null;
    }
    return makeAnchor(doc.prose, from, to);
  }

  private editorForFile(file: TFile): Editor | null {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active?.file?.path === file.path) return active.editor;
    const leaf = this.app.workspace
      .getLeavesOfType("markdown")
      .find((l) => l.view instanceof MarkdownView && l.view.file?.path === file.path);
    return leaf ? (leaf.view as MarkdownView).editor : null;
  }

  /**
   * Applies the prose replacement and comment-block mutation as one editor
   * transaction, so a single Undo restores both the text and the suggestion.
   */
  isApplyingSuggestion(): boolean {
    return this.applyingSuggestion;
  }

  acceptEditSuggestion(file: TFile, id: string): SuggestionAcceptancePlan {
    const editor = this.editorForFile(file);
    if (!editor) return { ok: false, reason: "no-editor" };
    const raw = editor.getValue();
    const plan = planSuggestionAcceptance(
      raw,
      id,
      this.settings.resolveBehavior,
      this.settings.schemaHint
    );
    if (!plan.ok) return plan;
    this.applyingSuggestion = true;
    try {
      commitSuggestionAcceptance(editor, plan);
    } finally {
      this.applyingSuggestion = false;
    }
    return plan;
  }

  /** The current editor selection as an anchor, used to re-anchor orphans. */
  getProseSelection(file: TFile): { anchor: Anchor } | null {
    const editor = this.editorForFile(file);
    if (!editor) return null;
    if (!editor.somethingSelected()) return null;
    const from = editor.posToOffset(editor.getCursor("from"));
    const to = editor.posToOffset(editor.getCursor("to"));
    const doc = parseDocument(editor.getValue());
    if (to > doc.prose.length || from === to) return null;
    return { anchor: makeAnchor(doc.prose, from, to) };
  }

  /**
   * `activate: false` opens the panel without making it the active leaf, so the
   * editor keeps focus and its selection.
   */
  async openSidebar(
    focusId?: string,
    options: { activate?: boolean } = {}
  ): Promise<CommentSidebar | null> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_COMMENTS)[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (!right) return null;
      leaf = right;
      await leaf.setViewState({ type: VIEW_TYPE_COMMENTS, active: options.activate ?? true });
    }
    await workspace.revealLeaf(leaf);
    const view = leaf.view instanceof CommentSidebar ? leaf.view : null;
    // A highlight click names only the comment; the note it sits in is the one
    // being read, which is what keys the thread in the vault-wide list.
    const filePath = workspace.getActiveFile()?.path;
    if (view && focusId && filePath) view.focusComment(filePath, focusId);
    return view;
  }

  refreshAuthorColors(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_COMMENTS)) {
      if (leaf.view instanceof CommentSidebar) leaf.view.refreshAuthorColors();
    }
  }

  /** Scrolls the Markdown editor to the resolved anchor position. */
  /**
   * Opens the note a thread belongs to and puts the reader on its passage.
   * The inbox lists threads from notes that are not open, which is why this
   * opens one first rather than reporting that nothing is open, as
   * {@link revealAnchor} does. Clicking the highlight there opens the popover.
   */
  async revealComment(file: TFile, id: string): Promise<void> {
    const open = this.app.workspace
      .getLeavesOfType("markdown")
      .find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);
    if (open) await this.app.workspace.revealLeaf(open);
    else await this.app.workspace.getLeaf(false).openFile(file);
    const doc = await this.readDoc(file);
    const comment = doc.comments[id];
    if (!comment) {
      new Notice("That comment is no longer in the note.");
      return;
    }
    // A rewritten passage has nothing left to scroll to, and saying so every
    // time would nag: opening the note is the useful half, and is why the
    // reader is being taken there at all.
    if (resolveAnchor(doc.prose, comment.anchor).kind !== "resolved") return;
    this.revealAnchor(file, comment.anchor);
  }

  revealAnchor(file: TFile, anchor: Anchor): void {
    const leaf = this.app.workspace
      .getLeavesOfType("markdown")
      .find((l) => l.view instanceof MarkdownView && l.view.file?.path === file.path);
    if (!leaf) {
      new Notice("File is not open in any editor.");
      return;
    }
    const view = leaf.view as MarkdownView;
    void this.app.workspace.revealLeaf(leaf);
    const editor = view.editor;
    const doc = parseDocument(editor.getValue());
    const r = resolveAnchor(doc.prose, anchor);
    if (r.kind !== "resolved") {
      new Notice("Thread is orphaned — text passage not found.");
      return;
    }
    const fromPos = editor.offsetToPos(r.start);
    const toPos = editor.offsetToPos(r.end);
    editor.setSelection(fromPos, toPos);
    editor.scrollIntoView({ from: fromPos, to: toPos }, true);
  }
}
