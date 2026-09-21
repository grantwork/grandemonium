import type { Editor} from "obsidian";
import { type App, MarkdownView, normalizePath, Notice, type Plugin, type PluginManifest, TFile } from "obsidian";

import { ProviderRegistry } from "../../core/providers/ProviderRegistry";
import { findAgentMention } from "./agent-mention";
import {
  AUTHOR_OVERRIDE_KEY,
  detectOsUsername,
  FALLBACK_AUTHOR,
  LEGACY_AUTHOR_OVERRIDE_KEY,
  resolveAuthorName,
} from "./author";
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
import { registerReadingView } from "./reading-view";
import { buildReviewMessage } from "./review-message";
import { shouldStartSelectionComment } from "./selection-comment";
import {
  type CommentsSettings,
  DEFAULT_SETTINGS,
  parseCommentsSettings,
  settingsEffects,
} from "./settings-model";
import { CommentSidebar, VIEW_TYPE_COMMENTS } from "./sidebar";
import {
  makeAnchor,
  parseDocument,
  planSuggestionAcceptance,
  resolveAll,
  resolveAnchor,
  serializeDocument,
  type SuggestionAcceptancePlan,
} from "./store";
import { commitSuggestionAcceptance } from "./suggestion-editor";
import type { Anchor, ParsedDoc } from "./types";

const DEFAULT_CLAUDE_AGENT_NAME = "claude";

/**
 * Sends the review prompt to the AIs. Supplied by the composition root so this
 * vendored feature never reaches into chat; resolves with the names reached.
 */
export interface CommentReviewOutcome {
  /** Agent names that started reviewing straight away. */
  sent: string[];
  /** Agent names that were mid-turn and queued the request behind it. */
  queued: string[];
}

/**
 * The chat side, as this vendored feature sees it. Supplied by the composition
 * root so comments never import chat code.
 */
export interface CommentAiPort {
  /** Agent names of the enabled AIs, used to tell their replies from a person's. */
  agentNames(): string[];
  /** Sends a prompt to every enabled AI, or to one when `targetAgentName` is given. */
  request(prompt: string, targetAgentName?: string): Promise<CommentReviewOutcome>;
}

/**
 * A queued request runs only after the AI finishes what it is doing, so it is
 * reported apart from one that started immediately.
 */
export function describeReviewOutcome(sent: string[], queued: string[]): string {
  const parts: string[] = [];
  if (sent.length > 0) parts.push(`Review requested from ${sent.join(", ")}.`);
  if (queued.length > 0) {
    parts.push(`Queued behind current work for ${queued.join(", ")}.`);
  }
  return parts.length > 0
    ? parts.join(" ")
    : "No enabled AI has a chat tab to review comments.";
}

/** Reports what one AI did with an implementation request. */
export function describeImplementOutcome(
  agentName: string,
  sent: string[],
  queued: string[]
): string {
  if (sent.length > 0) return `${agentName} is making the changes.`;
  if (queued.length > 0) return `${agentName} will make the changes after its current work.`;
  return `${agentName} has no chat tab to make the changes.`;
}

export class CommentsController {
  settings: CommentsSettings = DEFAULT_SETTINGS;
  private applyingSuggestion = false;
  private settingsWriteQueue: Promise<void> = Promise.resolve();
  private readonly store: CommentsSettingsStore;

  private aiPort: CommentAiPort | null = null;

  constructor(private readonly plugin: Plugin) {
    this.store = new CommentsSettingsStore(plugin);
  }

  /** Installed by the composition root once the chat side can accept prompts. */
  setAiPort(port: CommentAiPort | null): void {
    this.aiPort = port;
  }

  /** True while an AI can be asked to review; the action stays hidden otherwise. */
  canRequestReview(): boolean {
    return this.aiPort !== null;
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
  async notifyUserCommentAdded(filePath: string, text = ""): Promise<void> {
    const port = this.aiPort;
    if (!this.settings.reviewOnComment || !port) return;
    // "@gpt run your changes" addresses one AI; an untagged comment still goes
    // to every enabled one.
    const mentioned = findAgentMention(text, port.agentNames());
    await this.requestReview(filePath, mentioned);
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
    try {
      const { queued, sent } = await port.request(
        buildImplementMessage(prompt, target),
        agentName,
      );
      new Notice(describeImplementOutcome(agentName, sent, queued));
    } catch (error) {
      new Notice(
        "Implementation request failed: "
          + (error instanceof Error ? error.message : String(error))
      );
    }
  }

  /**
   * Asks every enabled AI to review open comments, using the configured
   * prompt. The file is named so an AI whose tab is linked elsewhere still
   * reviews the right note.
   */
  async requestReview(
    filePath: string | null = null,
    targetAgentName: string | null = null,
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
    try {
      const { queued, sent } = await port.request(
        buildReviewMessage(prompt, filePath),
        targetAgentName ?? undefined,
      );
      new Notice(describeReviewOutcome(sent, queued));
    } catch (error) {
      new Notice(
        "Review request failed: " + (error instanceof Error ? error.message : String(error))
      );
    }
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
    void this.openSidebar().then((view) => view?.startDraft(file, anchor));
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

  async openSidebar(focusId?: string): Promise<CommentSidebar | null> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_COMMENTS)[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (!right) return null;
      leaf = right;
      await leaf.setViewState({ type: VIEW_TYPE_COMMENTS, active: true });
    }
    await workspace.revealLeaf(leaf);
    const view = leaf.view instanceof CommentSidebar ? leaf.view : null;
    if (view && focusId) view.focusComment(focusId);
    return view;
  }

  refreshAuthorColors(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_COMMENTS)) {
      if (leaf.view instanceof CommentSidebar) leaf.view.refreshAuthorColors();
    }
  }

  /** Scrolls the Markdown editor to the resolved anchor position. */
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
