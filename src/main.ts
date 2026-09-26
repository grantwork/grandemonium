import { StartupProfiler } from './core/performance/StartupProfiler';
// Must run before any SDK imports to patch Electron/Node.js realm incompatibility
import { patchSetMaxListenersForElectron } from './utils/electronCompat';
patchSetMaxListenersForElectron();

import './providers';

StartupProfiler.finishModuleEvaluation();

import type { Editor, TAbstractFile, WorkspaceLeaf } from 'obsidian';
import { MarkdownView, Notice, Plugin, TFolder } from 'obsidian';

import { ConversationRepository } from './app/conversations/ConversationRepository';
import { GrandemoniumProviderHost } from './app/providers/GrandemoniumProviderHost';
import { ChatModelSelectionCoordinator } from './app/settings/ChatModelSelectionCoordinator';
import { DEFAULT_GRANDEMONIUM_SETTINGS } from './app/settings/defaultSettings';
import { PinnedLinkedContentPathCoordinator } from './app/settings/PinnedLinkedContentPathCoordinator';
import type {
  ConditionalSettingsMutation,
  SettingsCommit,
} from './app/settings/SettingsCoordinator';
import {
  SettingsCoordinator,
  type SettingsMutation,
  SettingsPostCommitError,
} from './app/settings/SettingsCoordinator';
import { SharedStorageService } from './app/storage/SharedStorageService';
import type { CommentReviewRunner } from './core/auxiliary/CommentReviewRunner';
import type { SessionMetadataReadResult } from './core/bootstrap/SessionStorage';
import type { SharedAppStorage } from './core/bootstrap/storage';
import {
  ProviderExecutionLifecycleRegistry,
  type ProviderExecutionTransitionScope,
} from './core/execution';
import { resolveProviderDefaultModel } from './core/providers/conversationModel';
import {
  getEnvironmentVariablesForScope as getScopedEnvironmentVariables,
  getRuntimeEnvironmentText,
  setEnvironmentVariablesForScope,
} from './core/providers/providerEnvironment';
import { ProviderRegistry } from './core/providers/ProviderRegistry';
import {
  ProviderSettingsCoordinator,
  type SettingsReconciliationResult,
} from './core/providers/ProviderSettingsCoordinator';
import { ProviderWorkspaceRegistry } from './core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderCliResolutionContext,
  ProviderId,
} from './core/providers/types';
import { DEFAULT_CHAT_PROVIDER_ID } from './core/providers/types';
import type {
  Conversation,
  ConversationMeta,
  ConversationMutablePatch,
  GrandemoniumSettings,
  SessionMetadata,
} from './core/types';
import {
  VIEW_TYPE_GRANDEMONIUM,
} from './core/types';
import type { ChatViewPlacement, EnvironmentScope } from './core/types/settings';
import type { ChatExecutionPersistence } from './features/chat/execution/ChatExecutionCoordinator';
import {
  DEFAULT_MAX_WARM_AGENT_PROCESSES,
  normalizeWarmExecutionLimit,
  WarmExecutionPool,
} from './features/chat/execution/WarmExecutionPool';
import { registerFileMenu } from './features/chat/fileMenu';
import { GrandemoniumView } from './features/chat/GrandemoniumView';
import { mountStandaloneComposerToolbar } from './features/chat/ui/StandaloneComposerToolbar';
import {
  type CommentReviewHandle,
  CommentsController,
  type RepositoryAgentPort,
} from './features/comments';
import { type InlineEditContext, InlineEditModal } from './features/inline-edit/ui/InlineEditModal';
import { GrandemoniumSettingTab } from './features/settings/GrandemoniumSettings';
import { setLocale } from './i18n/i18n';
import type { Locale } from './i18n/types';
import { buildCursorContext } from './utils/editor';
import { revealWorkspaceLeaf } from './utils/obsidianCompat';
import { getVaultPath } from './utils/path';

function isGrandemoniumView(value: unknown): value is GrandemoniumView {
  return !!value
    && typeof value === 'object'
    && typeof (value as { getTabManager?: unknown }).getTabManager === 'function';
}

function readPendingProviderSessionInvalidations(
  settings: Record<string, unknown>,
): Map<ProviderId, number> {
  const registeredProviderIds = new Set(ProviderRegistry.getRegisteredProviderIds());
  const value = settings.pendingProviderSessionInvalidations;
  const pending = new Map<ProviderId, number>();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return pending;
  }

  for (const [providerId, generation] of Object.entries(value)) {
    if (
      registeredProviderIds.has(providerId)
      && typeof generation === 'number'
      && Number.isSafeInteger(generation)
      && generation > 0
    ) {
      pending.set(providerId, generation);
    }
  }
  return pending;
}

function serializePendingProviderSessionInvalidations(
  pending: ReadonlyMap<ProviderId, number>,
): Partial<Record<string, number>> {
  return Object.fromEntries(
    Array.from(pending.entries()).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function hasSamePendingProviderSessionInvalidations(
  value: unknown,
  pending: ReadonlyMap<ProviderId, number>,
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const entries = Object.entries(value);
  return entries.length === pending.size
    && entries.every(([providerId, generation]) => pending.get(providerId) === generation);
}

export default class GrandemoniumPlugin extends Plugin {
  settings!: GrandemoniumSettings;
  storage!: SharedAppStorage;
  readonly executionLifecycleRegistry = new ProviderExecutionLifecycleRegistry();
  readonly providerHost = new GrandemoniumProviderHost(this);
  readonly warmExecutionPool = new WarmExecutionPool(
    () => this.settings?.maxWarmAgentProcesses ?? DEFAULT_MAX_WARM_AGENT_PROCESSES,
  );
  private settingsCoordinator!: SettingsCoordinator<GrandemoniumSettings>;
  private chatModelSelectionCoordinator!: ChatModelSelectionCoordinator;
  private pinnedLinkedContentPaths!: PinnedLinkedContentPathCoordinator;
  private conversationRepository!: ConversationRepository;
  private pendingSessionMetadataScan = false;
  private pendingEnvironmentInvalidationGenerations = new Map<ProviderId, number>();
  private blockedEnvironmentInvalidationGenerations = new Map<ProviderId, number>();
  private environmentUpdateTail: Promise<void> = Promise.resolve();
  private agentSkillResourceGeneration = 0;
  private isLoadingRemainingSessionMetadata = false;
  private hasLoadedAllSessionMetadata = false;
  private sessionMetadataLoadTimer: number | null = null;
  private remainingSessionMetadataLoad: Promise<void> | null = null;
  private providerChatOptionsChangeTail: Promise<void> = Promise.resolve();
  private isUnloading = false;
  private applicationShutdownPromise: Promise<void> | null = null;

  get executionPersistence(): ChatExecutionPersistence {
    return this.conversationRepository;
  }

  get chatModelSelection(): ChatModelSelectionCoordinator {
    return this.chatModelSelectionCoordinator;
  }

  /** Quote-anchored review comments. Loaded alongside the chat surface. */
  readonly comments = new CommentsController(this);
  private readonly commentReviewRunners = new Map<ProviderId, CommentReviewRunner>();

  async onload() {
    StartupProfiler.startOnload();
    try {
      await StartupProfiler.runAsync(
        'settings-load',
        () => this.loadSettings({ deferNonRestoredSessionMetadata: true }),
      );
      // Provider workspace services are initialized lazily on first use.

      this.registerView(
        VIEW_TYPE_GRANDEMONIUM,
        (leaf) => new GrandemoniumView(leaf, this)
      );
      registerFileMenu(this);
      this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
        void this.handleLinkedContentRename(file, oldPath).catch(() => {
          new Notice('Failed to update linked content paths');
        });
      }));
      this.registerEvent(this.app.vault.on('delete', (file) => {
        void this.handlePinnedLinkedContentDeleted(file).catch(() => {
          new Notice('Failed to update pinned linked content');
        });
      }));
      this.registerEvent(this.app.vault.on('create', (file) => {
        for (const view of this.getAllViews()) {
          view.handleLinkedContentCreated(file.path);
        }
        this.notifyConversationViewsChanged();
      }));

      // The comments panel is the primary surface; the chat view stays
      // reachable through the `open-view` command.
      this.addRibbonIcon('bot', 'Open Grandemonium', () => {
        void this.comments.openSidebar();
      });

      this.addCommand({
        id: 'open-view',
        name: 'Open chat view',
        callback: () => {
          void this.activateView();
        },
      });

      this.addCommand({
        id: 'inline-edit',
        name: 'Inline edit',
        editorCallback: async (editor: Editor, ctx) => {
          const view = ctx instanceof MarkdownView
            ? ctx
            : this.app.workspace.getActiveViewOfType(MarkdownView);
          if (!view) {
            new Notice('Inline edit unavailable: could not access the active Markdown view.');
            return;
          }

          const selectedText = editor.getSelection();
          const notePath = view.file?.path || 'unknown';

          let editContext: InlineEditContext;
          if (selectedText.trim()) {
            editContext = { mode: 'selection', selectedText };
          } else {
            const cursor = editor.getCursor();
            const cursorContext = buildCursorContext(
              (line) => editor.getLine(line),
              editor.lineCount(),
              cursor.line,
              cursor.ch
            );
            editContext = { mode: 'cursor', cursorContext };
          }

          const modal = new InlineEditModal(
            this.app,
            this,
            editor,
            view,
            editContext,
            notePath,
          );
          const result = await modal.openAndWait();

          if (result.decision === 'accept' && result.editedText !== undefined) {
            new Notice(editContext.mode === 'cursor' ? 'Inserted' : 'Edit applied');
          }
        },
      });

      this.addCommand({
        id: 'new-tab',
        name: 'New',
        checkCallback: (checking: boolean) => {
          if (!this.canCreateNewTab()) return false;

          if (!checking) {
            void this.openNewTab();
          }
          return true;
        },
      });

      this.addCommand({
        id: 'new-session',
        name: 'Replace current conversation',
        checkCallback: (checking: boolean) => {
          const view = this.getView();
          if (!view) return false;
          if (view.isDualPaneMode()) return false;

          const tabManager = view.getTabManager();
          if (!tabManager) return false;

          const activeTab = tabManager.getActiveTab();
          if (!activeTab) return false;

          if (activeTab.state.isStreaming) return false;

          if (!checking) {
            void tabManager.createNewConversation();
          }
          return true;
        },
      });

      this.addCommand({
        id: 'close-current-tab',
        name: 'Close current tab',
        checkCallback: (checking: boolean) => {
          const view = this.getView();
          if (!view) return false;
          if (view.isDualPaneMode()) return false;

          const tabManager = view.getTabManager();
          if (!tabManager) return false;

          if (!checking) {
            const activeTabId = tabManager.getActiveTabId();
            if (activeTabId) {
              void tabManager.closeTab(activeTabId);
            }
          }
          return true;
        },
      });

      this.addCommand({
        id: 'copy-startup-diagnostics',
        name: 'Copy startup diagnostics',
        callback: async () => {
          const copied = await StartupProfiler.copyToClipboard();
          new Notice(copied ? 'Startup diagnostics copied to clipboard.' : 'Failed to copy startup diagnostics.');
        },
      });

      this.addSettingTab(new GrandemoniumSettingTab(this.app, this));

      await this.comments.load();
      this.comments.setAiPort({
        agentNames: () => ProviderRegistry
          .getEnabledProviderIds(this.settings)
          .map(providerId => ProviderRegistry.getAgentName(providerId, this.settings)),
        review: (prompt, targetAgentName) => this.startCommentReviews(prompt, targetAgentName),
      });
      this.comments.setRepositoryPort(this.createRepositoryAgentPort());
      this.scheduleRemainingSessionMetadataLoad();
    } finally {
      StartupProfiler.finishOnload();
    }
  }

  onunload(): void {
    this.isUnloading = true;
    this.comments.unload();
    if (this.sessionMetadataLoadTimer !== null) {
      window.clearTimeout(this.sessionMetadataLoadTimer);
      this.sessionMetadataLoadTimer = null;
    }
    StartupProfiler.freeze();
    this.applicationShutdownPromise ??= this.shutdownApplication();
    void this.applicationShutdownPromise.catch(() => undefined);
  }

  private async shutdownApplication(): Promise<void> {
    await Promise.allSettled(
      this.getAllViews().map(view => view.prepareForPluginUnload()),
    );
    try {
      await this.executionLifecycleRegistry.dispose();
    } catch {
      // Continue releasing provider workspaces even if execution cleanup fails.
    }
    try {
      await ProviderWorkspaceRegistry.disposeInitialized();
    } catch {
      // Obsidian teardown has no error channel; workspace cleanup is best effort.
    }
  }

  async activateView() {
    const { workspace } = this.app;
    const existingLeaf = workspace.getLeavesOfType(VIEW_TYPE_GRANDEMONIUM)[0];
    const leaf = existingLeaf
      ?? this.getLeafForPlacement(this.settings.chatViewPlacement);
    if (!leaf) return;

    let focusSuperseded = false;
    const focusIntentRef = workspace.on('active-leaf-change', (activeLeaf) => {
      if (activeLeaf && activeLeaf !== leaf) {
        focusSuperseded = true;
      }
    });

    try {
      if (!existingLeaf) {
        await leaf.setViewState({
          type: VIEW_TYPE_GRANDEMONIUM,
          active: true,
        });
      }

      await revealWorkspaceLeaf(workspace, leaf);
      if (!focusSuperseded && isGrandemoniumView(leaf.view)) {
        leaf.view.focusActiveInput();
      }
    } finally {
      workspace.offref(focusIntentRef);
    }
  }

  private getLeafForPlacement(placement: ChatViewPlacement): WorkspaceLeaf | null {
    const { workspace } = this.app;
    switch (placement) {
      case 'main-tab':
        return workspace.getLeaf('tab');
      case 'left-sidebar':
        return workspace.getLeftLeaf(false);
      case 'right-sidebar':
        return workspace.getRightLeaf(false);
    }
  }

  private canCreateNewTab(): boolean {
    const hasGrandemoniumLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_GRANDEMONIUM).length > 0;
    const view = this.getView();
    const tabManager = view?.getTabManager();

    if (tabManager) {
      return true;
    }

    if (hasGrandemoniumLeaf) {
      return false;
    }

    return true;
  }

  private async ensureViewOpen(): Promise<GrandemoniumView | null> {
    const existingView = this.getView();
    if (existingView) {
      return existingView;
    }

    await this.activateView();
    return this.getView();
  }

  private async openNewTab(): Promise<void> {
    const existingView = this.getView();
    if (existingView) {
      if (await existingView.handleNewConversationCommand()) {
        return;
      }
      await existingView.createNewTab();
      return;
    }

    const view = await this.ensureViewOpen();
    if (!view) {
      return;
    }

    view.focusActiveInput();
  }

  async loadSettings(options: { deferNonRestoredSessionMetadata?: boolean } = {}) {
    this.hasLoadedAllSessionMetadata = false;
    const sharedStorage = new SharedStorageService(this);
    this.storage = sharedStorage;
    const { grandemonium } = await sharedStorage.initialize();
    this.settings = {
      ...DEFAULT_GRANDEMONIUM_SETTINGS,
      ...grandemonium,
    };
    const normalizedWarmExecutionLimit = normalizeWarmExecutionLimit(
      this.settings.maxWarmAgentProcesses,
    );
    const didNormalizeWarmExecutionLimit =
      normalizedWarmExecutionLimit !== this.settings.maxWarmAgentProcesses;
    this.settings.maxWarmAgentProcesses = normalizedWarmExecutionLimit;
    this.settingsCoordinator = new SettingsCoordinator(
      this.settings,
      async (settings) => {
        ProviderSettingsCoordinator.normalizeProviderSelection(settings);
        ProviderSettingsCoordinator.persistProjectedProviderState(settings);
        await this.storage.saveGrandemoniumSettings(settings);
      },
    );
    this.chatModelSelectionCoordinator = new ChatModelSelectionCoordinator(
      this.settingsCoordinator,
    );
    this.pinnedLinkedContentPaths = new PinnedLinkedContentPathCoordinator(
      this.settingsCoordinator,
    );
    const didNormalizePendingSessionInvalidations = this.syncPendingSessionInvalidations();
    this.conversationRepository = new ConversationRepository({
      getSettings: () => this.settings,
      getVaultPath: () => getVaultPath(this.app),
      persistence: sharedStorage.conversationPersistence,
      onConversationDeleted: (conversationId) => this.resetDeletedConversationTabs(conversationId),
    });

    const didNormalizeProviderSelection = ProviderSettingsCoordinator.normalizeProviderSelection(
      this.settings,
    );
    const didNormalizeModelVariants = this.normalizeModelVariantSettings();

    const deferRemainingMetadata = options.deferNonRestoredSessionMetadata === true;
    const initialMetadataScan = deferRemainingMetadata
      ? {
          records: [],
          complete: false,
          invalidMetadataCount: 0,
        }
      : await StartupProfiler.runAsync(
          'session-metadata-load',
          () => this.loadSessionMetadataRecords(),
        );
    const initialModelRecoverySources = initialMetadataScan.records.map(({ metadata }) => (
      this.createConversationMetadataShell(metadata)
    ));
    const initialEntries = initialMetadataScan.records.map(({ metadata, needsMigration }) => ({
      conversation: this.createConversationMetadataShell(metadata),
      needsMigration,
    }));
    StartupProfiler.recordCount('initial-session-metadata-count', initialEntries.length);
    StartupProfiler.recordCount('session-metadata-count', initialEntries.length);
    StartupProfiler.recordCount(
      'invalid-session-metadata-count',
      initialMetadataScan.invalidMetadataCount,
    );
    await this.conversationRepository.adoptMetadataConversations(initialEntries);
    this.conversationRepository.registerHistoricalModelRecoverySources(
      initialModelRecoverySources,
    );
    if (initialMetadataScan.complete) {
      const recoveredModels = await this.conversationRepository
        .recoverMissingSelectedModels();
      StartupProfiler.recordCount(
        'recovered-session-model-count',
        recoveredModels.length,
      );
    }
    setLocale(this.settings.locale as Locale);

    const reconciliation = this.reconcileModelWithEnvironment();
    this.markPendingSessionInvalidations(
      this.settings,
      reconciliation.sessionInvalidationProviderIds,
    );
    const pendingInvalidatedConversations = ProviderSettingsCoordinator
      .invalidateConversationSessions(
        this.conversationRepository.getAll(),
        Array.from(this.pendingEnvironmentInvalidationGenerations.keys()),
      );
    const completedInvalidationGenerations = initialMetadataScan.complete
      ? new Map(this.pendingEnvironmentInvalidationGenerations)
      : new Map<ProviderId, number>();

    ProviderSettingsCoordinator.projectActiveProviderState(
      this.settings,
    );

    if (
      reconciliation.changed
      || didNormalizeModelVariants
      || didNormalizeProviderSelection
      || didNormalizePendingSessionInvalidations
      || didNormalizeWarmExecutionLimit
    ) {
      await this.saveSettings();
    }

    const conversationsToSave = new Set([
      ...reconciliation.invalidatedConversations,
      ...pendingInvalidatedConversations,
    ]);
    await this.conversationRepository.persistConversations(
      Array.from(conversationsToSave),
    );
    await this.completePendingSessionInvalidations(completedInvalidationGenerations);
    this.hasLoadedAllSessionMetadata = initialMetadataScan.complete;
    this.pendingSessionMetadataScan = deferRemainingMetadata;
  }

  private async loadSessionMetadataRecords(): Promise<{
    records: SessionMetadataReadResult[];
    complete: boolean;
    invalidMetadataCount: number;
  }> {
    const scan = await this.storage.sessions.scanMetadata();
    return {
      records: await this.loadMetadataRecords(scan.metadata),
      complete: scan.complete,
      invalidMetadataCount: scan.invalidMetadataCount,
    };
  }

  private async loadMetadataRecords(
    metadata: SessionMetadata[],
  ): Promise<SessionMetadataReadResult[]> {
    const records = await Promise.all(
      metadata.map(({ id }) => this.storage.sessions.load(id)),
    );
    return records.filter(
      (record): record is SessionMetadataReadResult => record !== null,
    );
  }

  private scheduleRemainingSessionMetadataLoad(): void {
    if (!this.pendingSessionMetadataScan || this.isUnloading) {
      return;
    }

    const schedule = (): void => {
      if (!this.pendingSessionMetadataScan || this.isUnloading) {
        return;
      }
      this.sessionMetadataLoadTimer = window.setTimeout(() => {
        this.sessionMetadataLoadTimer = null;
        this.startRemainingSessionMetadataLoad();
      }, 0);
    };

    if (typeof this.app.workspace.onLayoutReady === 'function') {
      this.app.workspace.onLayoutReady(schedule);
    } else {
      schedule();
    }
  }

  private startRemainingSessionMetadataLoad(): void {
    if (
      !this.pendingSessionMetadataScan
      || this.isUnloading
      || this.remainingSessionMetadataLoad
    ) {
      return;
    }

    this.pendingSessionMetadataScan = false;
    const load = StartupProfiler.runAsync(
      'session-metadata-background-load',
      () => this.loadRemainingSessionMetadata(),
    ).catch(() => {
      StartupProfiler.increment('session-metadata-background-failures');
    }).finally(() => {
      if (this.remainingSessionMetadataLoad === load) {
        this.remainingSessionMetadataLoad = null;
      }
    });
    this.remainingSessionMetadataLoad = load;
  }

  private async loadRemainingSessionMetadata(): Promise<void> {
    this.isLoadingRemainingSessionMetadata = true;
    try {
      const addedConversations: Conversation[] = [];
      const invalidatedConversations: Conversation[] = [];
      let didChangeConversationList = false;
      const publishBatch = (records: SessionMetadataReadResult[]): void => {
        if (this.isUnloading || records.length === 0) return;

        const recoverySources = records.map(({ metadata }) => (
          this.createConversationMetadataShell(metadata)
        ));
        const shells = records
          .map(({ metadata }) => this.createConversationMetadataShell(metadata))
          .filter(conversation => (
            this.conversationRepository.isSelectedModelPublicationSafe(conversation)
          ));
        const publishedIds = new Set(shells.map(({ id }) => id));
        const invalidatedShells = ProviderSettingsCoordinator
          .invalidateConversationSessions(
            shells,
            Array.from(this.pendingEnvironmentInvalidationGenerations.keys()),
          );
        const invalidatedIds = new Set(
          invalidatedShells.map(({ id }) => id),
        );
        const added = this.conversationRepository.mergeMetadataConversations(shells);
        this.conversationRepository.registerHistoricalModelRecoverySources(
          recoverySources.filter(({ id }) => publishedIds.has(id)),
        );
        if (added.length === 0) return;

        addedConversations.push(...added);
        invalidatedConversations.push(
          ...added.filter(({ id }) => invalidatedIds.has(id)),
        );
        didChangeConversationList = true;
      };
      const scan = await this.storage.sessions.scan({
        onBatch: publishBatch,
      });
      if (this.isUnloading) {
        return;
      }

      StartupProfiler.recordCount('session-metadata-count', scan.records.length);
      StartupProfiler.recordCount(
        'invalid-session-metadata-count',
        scan.invalidMetadataCount,
      );
      const scannedShells = scan.records
        .map(({ metadata }) => this.conversationRepository.getCachedConversation(metadata.id))
        .filter((shell): shell is Conversation => shell !== null);
      const records = await this.loadMetadataRecords(
        scan.records.map(({ metadata }) => metadata),
      );
      const resolvedIds = new Set(records.map(({ metadata }) => metadata.id));
      const unresolvedShells = scannedShells.filter(
        ({ id }) => !resolvedIds.has(id),
      );
      this.conversationRepository.discardUnresolvedMetadataShells(
        unresolvedShells,
      );
      if (unresolvedShells.length > 0) {
        didChangeConversationList = true;
      }
      publishBatch(records);
      const entries = records.map(({ metadata, needsMigration }) => ({
        conversation: this.createConversationMetadataShell(metadata),
        needsMigration,
      }));
      const shells = entries.map(({ conversation }) => conversation);
      const invalidatedEntries = ProviderSettingsCoordinator
        .invalidateConversationSessions(
          shells,
          Array.from(this.pendingEnvironmentInvalidationGenerations.keys()),
        );
      const invalidatedIds = new Set(
        invalidatedEntries.map(({ id }) => id),
      );
      const existingIds = new Set(
        this.conversationRepository.getAll().map(({ id }) => id),
      );
      await this.conversationRepository.adoptMetadataConversations(entries);
      this.conversationRepository.registerHistoricalModelRecoverySources(
        shells,
      );
      const adoptedConversations = shells.filter((conversation) => (
        !existingIds.has(conversation.id)
        && this.conversationRepository.getCachedConversation(conversation.id)
          === conversation
      ));
      if (adoptedConversations.length > 0) {
        addedConversations.push(...adoptedConversations);
        invalidatedConversations.push(
          ...adoptedConversations.filter(({ id }) => invalidatedIds.has(id)),
        );
        didChangeConversationList = true;
      }
      const currentAddedConversations = addedConversations.filter((conversation) => (
        this.conversationRepository.getCachedConversation(conversation.id)
          === conversation
      ));
      const currentInvalidatedConversations = invalidatedConversations.filter(
        (conversation) => (
          this.conversationRepository.getCachedConversation(conversation.id)
            === conversation
        ),
      );
      const uniqueCurrentInvalidatedConversations = currentInvalidatedConversations.filter(
        ({ id }, index, conversations) => (
          conversations.findIndex(conversation => conversation.id === id) === index
        ),
      );
      StartupProfiler.recordCount('background-session-metadata-count', currentAddedConversations.length);
      let recoveredModels: Conversation[] = [];
      if (!this.isUnloading) {
        recoveredModels = await this.conversationRepository
          .recoverMissingSelectedModels();
        StartupProfiler.recordCount(
          'recovered-session-model-count',
          recoveredModels.length,
        );
      }
      await this.conversationRepository.persistConversations(
        uniqueCurrentInvalidatedConversations,
      );
      if (
        !this.isUnloading
        && (didChangeConversationList || recoveredModels.length > 0)
      ) {
        this.notifyConversationViewsChanged();
      }
      if (scan.complete) {
        this.hasLoadedAllSessionMetadata = true;
        if (!this.isUnloading) {
          await this.completePendingSessionInvalidations(
            this.getCompletablePendingSessionInvalidations(),
          );
        }
      }
    } finally {
      this.isLoadingRemainingSessionMetadata = false;
    }
  }

  private syncPendingSessionInvalidations(): boolean {
    const pending = readPendingProviderSessionInvalidations(this.settings);
    const changed = !hasSamePendingProviderSessionInvalidations(
      this.settings.pendingProviderSessionInvalidations,
      pending,
    );
    this.settings.pendingProviderSessionInvalidations =
      serializePendingProviderSessionInvalidations(pending);
    this.pendingEnvironmentInvalidationGenerations = pending;
    return changed;
  }

  private markPendingSessionInvalidations(
    settings: GrandemoniumSettings,
    providerIds: ProviderId[],
  ): Map<ProviderId, number> {
    const marked = this.stagePendingSessionInvalidations(settings, providerIds);
    this.commitPendingSessionInvalidations(marked);
    return marked;
  }

  private stagePendingSessionInvalidations(
    settings: GrandemoniumSettings,
    providerIds: ProviderId[],
  ): Map<ProviderId, number> {
    const pending = readPendingProviderSessionInvalidations(settings);
    const marked = new Map<ProviderId, number>();
    for (const providerId of new Set(providerIds)) {
      const previousGeneration = Math.max(
        pending.get(providerId) ?? 0,
        this.pendingEnvironmentInvalidationGenerations.get(providerId) ?? 0,
      );
      const generation = Math.max(Date.now(), previousGeneration + 1);
      pending.set(providerId, generation);
      marked.set(providerId, generation);
    }
    settings.pendingProviderSessionInvalidations =
      serializePendingProviderSessionInvalidations(pending);
    return marked;
  }

  private commitPendingSessionInvalidations(
    generations: ReadonlyMap<ProviderId, number>,
  ): void {
    for (const [providerId, generation] of generations) {
      this.pendingEnvironmentInvalidationGenerations.set(providerId, generation);
    }
  }

  private blockEnvironmentInvalidationCompletion(
    generations: ReadonlyMap<ProviderId, number>,
  ): void {
    for (const [providerId, generation] of generations) {
      this.blockedEnvironmentInvalidationGenerations.set(providerId, generation);
    }
  }

  private releaseEnvironmentInvalidationCompletion(
    generations: ReadonlyMap<ProviderId, number>,
  ): void {
    for (const [providerId, generation] of generations) {
      if (this.blockedEnvironmentInvalidationGenerations.get(providerId) === generation) {
        this.blockedEnvironmentInvalidationGenerations.delete(providerId);
      }
    }
  }

  private getCompletablePendingSessionInvalidations(): Map<ProviderId, number> {
    return new Map(Array.from(
      this.pendingEnvironmentInvalidationGenerations,
      ([providerId, generation]) => [providerId, generation] as const,
    ).filter(([providerId, generation]) => (
      this.blockedEnvironmentInvalidationGenerations.get(providerId) !== generation
    )));
  }

  private async completePendingSessionInvalidations(
    completedGenerations: ReadonlyMap<ProviderId, number>,
  ): Promise<void> {
    if (completedGenerations.size === 0) {
      return;
    }

    const removed = new Map<ProviderId, number>();
    try {
      await this.mutateSettingsConditionally((settings) => {
        const pending = readPendingProviderSessionInvalidations(settings);
        for (const [providerId, generation] of completedGenerations) {
          if (pending.get(providerId) === generation) {
            pending.delete(providerId);
            removed.set(providerId, generation);
          }
        }
        if (removed.size === 0) {
          return false;
        }
        settings.pendingProviderSessionInvalidations =
          serializePendingProviderSessionInvalidations(pending);
        return true;
      });
    } catch (error) {
      const pending = readPendingProviderSessionInvalidations(this.settings);
      for (const [providerId, generation] of removed) {
        if (this.pendingEnvironmentInvalidationGenerations.get(providerId) === generation) {
          pending.set(providerId, generation);
        }
      }
      this.settings.pendingProviderSessionInvalidations =
        serializePendingProviderSessionInvalidations(pending);
      throw error;
    }

    for (const [providerId, generation] of removed) {
      if (this.pendingEnvironmentInvalidationGenerations.get(providerId) === generation) {
        this.pendingEnvironmentInvalidationGenerations.delete(providerId);
      }
    }
  }

  private createConversationMetadataShell(meta: SessionMetadata): Conversation {
    return {
      id: meta.id,
      providerId: meta.providerId ?? DEFAULT_CHAT_PROVIDER_ID,
      title: meta.title,
      createdAt: meta.createdAt,
      lastActivityAt: meta.lastActivityAt,
      sessionId: meta.sessionId !== undefined ? meta.sessionId : meta.id,
      selectedModel: meta.selectedModel,
      providerState: meta.providerState,
      modelRecoverySource: meta.modelRecoverySource,
      messages: [],
      linkedContentPath: meta.linkedContentPath,
      isPinned: meta.isPinned,
      isArchived: meta.isArchived,
      usage: meta.usage,
      titleGenerationStatus: meta.titleGenerationStatus,
      resumeAtMessageId: meta.resumeAtMessageId,
    };
  }

  normalizeModelVariantSettings(): boolean {
    return ProviderSettingsCoordinator.normalizeAllModelVariants(
      this.settings,
    );
  }

  async saveSettings() {
    await this.settingsCoordinator.persistCurrent();
  }

  async mutateSettings(
    mutation: SettingsMutation<GrandemoniumSettings>,
    onCommitted?: SettingsCommit<GrandemoniumSettings>,
  ): Promise<void> {
    await this.settingsCoordinator.mutate(mutation, onCommitted);
  }

  getAgentSkillResourceGeneration(): number {
    return this.agentSkillResourceGeneration;
  }

  async notifyAgentSkillsChanged(): Promise<void> {
    const providerIds: ProviderId[] = ['codex', 'grok', 'pi', 'opencode'];
    const generation = ++this.agentSkillResourceGeneration;

    for (const view of this.getAllViews()) {
      view.invalidateProviderResources(providerIds, generation);
    }

    await ProviderWorkspaceRegistry.getIfInitialized('codex')?.commandCatalog?.refresh();
  }

  async mutateSettingsConditionally(
    mutation: ConditionalSettingsMutation<GrandemoniumSettings>,
  ): Promise<void> {
    await this.settingsCoordinator.mutateConditionally(mutation);
  }

  /** Updates and persists environment variables, restarting processes to apply changes. */
  async applyEnvironmentVariables(scope: EnvironmentScope, envText: string): Promise<void> {
    await this.applyEnvironmentVariablesBatch([{ scope, envText }]);
  }

  async applyEnvironmentVariablesBatch(
    updates: Array<{ scope: EnvironmentScope; envText: string }>,
  ): Promise<void> {
    const queuedUpdates = updates.map(update => ({ ...update }));
    const apply = this.environmentUpdateTail.then(
      () => this.applyEnvironmentVariablesBatchNow(queuedUpdates),
    );
    this.environmentUpdateTail = apply.catch(() => undefined);
    await apply;
  }

  async applyProviderRuntimeSettings(
    providerIds: ProviderId[],
    mutation: SettingsMutation<GrandemoniumSettings>,
    onApplied?: () => void | Promise<void>,
  ): Promise<void> {
    const uniqueProviderIds = Array.from(new Set(providerIds));
    await this.runProviderExecutionTransition(uniqueProviderIds, async () => {
      await this.commitProviderRuntimeSettings(
        uniqueProviderIds,
        mutation,
        {
          failureMessage: 'Provider runtime settings change recovery failed.',
          onSettingsCommitted: onApplied,
        },
      );
    });
  }

  private async commitProviderRuntimeSettings(
    providerIds: ProviderId[],
    mutation: SettingsMutation<GrandemoniumSettings>,
    options: {
      failureMessage: string;
      onInvalidationsPersisted?: (
        reconciliation: SettingsReconciliationResult,
      ) => void | Promise<void>;
      onSettingsCommitted?: (
        reconciliation: SettingsReconciliationResult,
      ) => void | Promise<void>;
    },
  ): Promise<SettingsReconciliationResult> {
    let reconciliation: SettingsReconciliationResult = {
      changed: false,
      environmentChangedProviderIds: [],
      invalidatedConversations: [],
      sessionInvalidationProviderIds: [],
    };
    let invalidationGenerations = new Map<ProviderId, number>();
    let invalidationPublished = false;
    let settingsCommitted = false;
    const errors: unknown[] = [];

    try {
      await this.mutateSettings(async (settings) => {
        await mutation(settings);
        reconciliation = this.reconcileModelWithEnvironment(providerIds, false);
        invalidationGenerations = this.stagePendingSessionInvalidations(
          settings,
          reconciliation.sessionInvalidationProviderIds,
        );
      }, () => {
        this.commitPendingSessionInvalidations(invalidationGenerations);
        this.blockEnvironmentInvalidationCompletion(invalidationGenerations);
        ProviderSettingsCoordinator.invalidateConversationSessions(
          this.conversationRepository.getAll(),
          reconciliation.sessionInvalidationProviderIds,
        );
        invalidationPublished = true;
      });
      settingsCommitted = true;
    } catch (error) {
      if (error instanceof SettingsPostCommitError) {
        settingsCommitted = true;
        errors.push(error.cause);
      } else {
        errors.push(error);
      }
    }

    if (settingsCommitted) {
      try {
        await options.onSettingsCommitted?.(reconciliation);
      } catch (error) {
        errors.push(error);
      }
    }

    if (invalidationPublished && invalidationGenerations.size > 0) {
      let invalidationMetadataPersisted = false;
      try {
        const invalidatedProviderIds = new Set(invalidationGenerations.keys());
        const conversationsToPersist = this.conversationRepository.getAll().filter(
          conversation => invalidatedProviderIds.has(conversation.providerId),
        );
        await this.conversationRepository.persistConversations(
          conversationsToPersist.filter(
            (conversation) =>
              this.conversationRepository.getCachedConversation(conversation.id)
              === conversation,
          ),
        );
        invalidationMetadataPersisted = true;
      } catch (error) {
        errors.push(error);
      }
      if (invalidationMetadataPersisted) {
        this.releaseEnvironmentInvalidationCompletion(invalidationGenerations);
        if (this.hasLoadedAllSessionMetadata && !this.isUnloading) {
          try {
            await this.completePendingSessionInvalidations(invalidationGenerations);
          } catch (error) {
            errors.push(error);
          }
        }
      }
    }

    if (settingsCommitted) {
      try {
        await options.onInvalidationsPersisted?.(reconciliation);
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, options.failureMessage);
    }
    return reconciliation;
  }

  private async applyEnvironmentVariablesBatchNow(
    updates: Array<{ scope: EnvironmentScope; envText: string }>,
  ): Promise<void> {
    const nextEnvironmentByScope = new Map<EnvironmentScope, string>();
    for (const update of updates) {
      nextEnvironmentByScope.set(update.scope, update.envText);
    }

    const changedScopes = [...nextEnvironmentByScope].flatMap(([scope, envText]) => (
      getScopedEnvironmentVariables(
        this.settings as unknown as Record<string, unknown>,
        scope,
      ) === envText
        ? []
        : [scope]
    ));
    const providersToQuiesce = this.getAffectedEnvironmentProviders(changedScopes);
    await this.runProviderExecutionTransition(providersToQuiesce, async () => {
      let affectedProviderIds: ProviderId[] = [];
      const modelCatalogDiagnostics: string[] = [];
      await this.commitProviderRuntimeSettings(
        providersToQuiesce,
        (settings) => {
          const settingsBag = settings as unknown as Record<string, unknown>;
          const changedScopes: EnvironmentScope[] = [];
          for (const [scope, envText] of nextEnvironmentByScope) {
            const currentValue = getScopedEnvironmentVariables(settingsBag, scope);
            if (currentValue !== envText) {
              changedScopes.push(scope);
            }
            setEnvironmentVariablesForScope(settingsBag, scope, envText);
          }
          affectedProviderIds = this.getAffectedEnvironmentProviders(changedScopes);
          ProviderSettingsCoordinator.handleEnvironmentChange(settingsBag, affectedProviderIds);
        },
        {
          failureMessage: 'Environment change recovery failed.',
          onSettingsCommitted: async () => {
            if (affectedProviderIds.length === 0) {
              return;
            }
            for (const providerId of affectedProviderIds) {
              if (ProviderRegistry.isEnabled(providerId, this.settings)) {
                const transitionOwner = { providerTransitionOwner: true } as const;
                const result = await ProviderWorkspaceRegistry.refreshModelCatalog(
                  providerId,
                  transitionOwner,
                );
                if (result.diagnostics) {
                  modelCatalogDiagnostics.push(
                    `${ProviderRegistry.getProviderDisplayName(providerId)}: ${result.diagnostics}`,
                  );
                }
              }
            }
          },
          onInvalidationsPersisted: async (reconciliation) => {
            if (affectedProviderIds.length === 0) {
              return;
            }
            for (const openView of this.getAllViews()) {
              openView.invalidateProviderCommandCaches(affectedProviderIds);
            }
            await Promise.all(
              affectedProviderIds.map(providerId => (
                this.notifyProviderChatOptionsChanged(providerId)
              )),
            );

            const noticeText = reconciliation.sessionInvalidationProviderIds.length > 0
              ? 'Environment variables applied. Sessions will be rebuilt on next message.'
              : 'Environment variables applied.';
            new Notice(noticeText);
            if (modelCatalogDiagnostics.length > 0) {
              new Notice(`Model catalog refresh failed:\n${modelCatalogDiagnostics.join('\n')}`);
            }
          },
        },
      );
    });
  }

  /** Returns the runtime environment variables (fixed at plugin load). */
  getActiveEnvironmentVariables(
    providerId: ProviderId = ProviderRegistry.resolveSettingsProviderId(
      this.settings,
    ),
  ): string {
    return getRuntimeEnvironmentText(
      this.settings,
      providerId,
    );
  }

  getEnvironmentVariablesForScope(scope: EnvironmentScope): string {
    return getScopedEnvironmentVariables(
      this.settings,
      scope,
    );
  }

  async getResolvedProviderCliPath(
    providerId: ProviderId,
    context?: ProviderCliResolutionContext,
  ): Promise<string | null> {
    if (context?.providerTransitionOwner !== true) {
      await ProviderWorkspaceRegistry.ensureInitialized(
        this.providerHost,
        providerId,
        'cli-resolution',
      );
    }
    const cliResolver = ProviderWorkspaceRegistry.getCliResolver(providerId);
    if (!cliResolver) {
      if (context?.providerTransitionOwner === true) {
        throw new Error(
          `Provider transition owner requires initialized workspace services for "${providerId}".`,
        );
      }
      return null;
    }

    return cliResolver.resolveFromSettings(this.settings, context);
  }

  private reconcileModelWithEnvironment(
    providerIds: ProviderId[] = ProviderRegistry.getRegisteredProviderIds(),
    invalidateConversations = true,
  ): SettingsReconciliationResult {
    return ProviderSettingsCoordinator.reconcileProviders(
      this.settings,
      this.conversationRepository.getAll(),
      providerIds,
      { invalidateConversations },
    );
  }

  private getAffectedEnvironmentProviders(scopes: EnvironmentScope[]): ProviderId[] {
    const registeredProviderIds = new Set(ProviderRegistry.getRegisteredProviderIds());
    const affectedProviderIds = new Set<ProviderId>();

    for (const scope of scopes) {
      if (scope === 'shared') {
        for (const providerId of registeredProviderIds) {
          affectedProviderIds.add(providerId);
        }
        continue;
      }

      const providerId = scope.slice('provider:'.length);
      if (registeredProviderIds.has(providerId)) {
        affectedProviderIds.add(providerId);
      }
    }

    return Array.from(affectedProviderIds);
  }

  async createConversation(options?: {
    providerId?: ProviderId;
    sessionId?: string;
    selectedModel?: string;
    linkedContentPath?: string;
  }): Promise<Conversation> {
    const conversation = await this.conversationRepository.create(options);
    this.notifyConversationViewsChanged();
    return conversation;
  }

  async switchConversation(id: string): Promise<Conversation | null> {
    return this.conversationRepository.switchTo(id);
  }

  async deleteConversation(id: string): Promise<void> {
    await this.conversationRepository.delete(id);
    this.notifyConversationViewsChanged();
  }

  runProviderExecutionTransition<T>(
    providerIds: ProviderId[],
    mutation: (scope: ProviderExecutionTransitionScope) => Promise<T>,
    parentScope?: ProviderExecutionTransitionScope,
  ): Promise<T> {
    return this.executionLifecycleRegistry.runTransition(
      providerIds,
      mutation,
      parentScope,
    );
  }

  private async resetDeletedConversationTabs(id: string): Promise<void> {
    const errors: unknown[] = [];
    for (const view of this.getAllViews()) {
      const tabManager = view.getTabManager();
      if (!tabManager) continue;

      for (const tab of tabManager.getAllTabs()) {
        if (tab.conversationId === id) {
          try {
            tab.controllers.inputController?.cancelStreaming();
            await tab.controllers.conversationController?.createNew({ force: true });
          } catch (error) {
            errors.push(error);
          }
        }
      }
    }
    if (errors.length > 0) {
      const first = errors[0];
      throw first instanceof Error ? first : new Error(String(first));
    }
  }

  async handleMissingProviderSession(
    id: string,
    missingProviderSessionId?: string,
  ): Promise<'deleted' | 'reset' | 'preserved' | 'not_found'> {
    return this.conversationRepository.handleMissingProviderSession(id, missingProviderSessionId);
  }

  async renameConversation(id: string, title: string): Promise<void> {
    await this.conversationRepository.rename(id, title);
    this.notifyConversationViewsChanged();
  }

  async setConversationPinned(id: string, isPinned: boolean): Promise<void> {
    await this.conversationRepository.setPinned(id, isPinned);
    this.notifyConversationViewsChanged();
  }

  async setLinkedContentPinned(contentPath: string, isPinned: boolean): Promise<void> {
    const changed = await this.pinnedLinkedContentPaths.setPinned(contentPath, isPinned);
    if (changed) {
      this.notifyConversationViewsChanged();
    }
  }

  async setConversationArchived(id: string, isArchived: boolean): Promise<void> {
    await this.conversationRepository.setArchived(id, isArchived);
    this.notifyConversationViewsChanged();
  }

  private async handleLinkedContentRename(
    file: TAbstractFile,
    oldPath: string,
  ): Promise<void> {
    const includeDescendants = file instanceof TFolder;
    for (const view of this.getAllViews()) {
      view.handleLinkedContentRenamed(oldPath, file.path, includeDescendants);
    }
    await this.rewriteLinkedContentPaths(oldPath, file.path, includeDescendants);
    await this.pinnedLinkedContentPaths.rewritePaths(
      oldPath,
      file.path,
      includeDescendants,
    );
    this.notifyConversationViewsChanged();
  }

  private async handlePinnedLinkedContentDeleted(file: TAbstractFile): Promise<void> {
    const includeDescendants = file instanceof TFolder;
    for (const view of this.getAllViews()) {
      view.handleLinkedContentDeleted(file.path, includeDescendants);
    }
    try {
      await this.pinnedLinkedContentPaths.removePaths(
        file.path,
        includeDescendants,
      );
    } finally {
      this.notifyConversationViewsChanged();
    }
  }

  async rewriteLinkedContentPaths(
    oldPath: string,
    newPath: string,
    includeDescendants: boolean,
  ): Promise<void> {
    await this.conversationRepository.rewriteLinkedContentPaths(oldPath, newPath, {
      includeDescendants,
    });
    this.notifyConversationViewsChanged();
  }

  async updateConversation(id: string, updates: ConversationMutablePatch): Promise<void> {
    await this.conversationRepository.update(id, updates);
    this.notifyConversationViewsChanged();
  }

  private notifyConversationViewsChanged(): void {
    for (const view of this.getAllViews()) {
      try {
        view.notifyConversationListChanged();
      } catch {
        // UI projection failures must not roll back a committed repository mutation.
      }
    }
  }

  /**
   * Starts one background review per AI reached. Each runs in a disposable
   * session rather than in a chat tab, so no review inherits the context of
   * every comment before it. One runner per provider, kept for the plugin's
   * lifetime, so that provider's concurrency limit holds across reviews.
   */
  private startCommentReviews(prompt: string, targetAgentName?: string): CommentReviewHandle[] {
    return ProviderRegistry.getEnabledProviderIds(this.settings)
      .filter(providerId =>
        !targetAgentName || ProviderRegistry.getAgentName(providerId, this.settings) === targetAgentName)
      .map((providerId) => {
        let runner = this.commentReviewRunners.get(providerId);
        if (!runner) {
          runner = ProviderRegistry.createCommentReviewRunner(this, providerId);
          this.commentReviewRunners.set(providerId, runner);
        }
        const run = runner.start(prompt);
        return {
          agentName: ProviderRegistry.getAgentName(providerId, this.settings),
          cancel: () => run.cancel(),
          done: run.done,
          startedAt: run.startedAt,
        };
      });
  }

  /**
   * Repository comment threads: each one keeps a provider session per AI it
   * reaches until the thread is resolved. Effort, permission mode and service
   * tier are read from the provider's settings at send time, as a chat turn
   * reads them, so the toolbar under a thread and a chat tab agree.
   */
  private createRepositoryAgentPort(): RepositoryAgentPort {
    const enabled = () => ProviderRegistry.getEnabledProviderIds(this.settings);
    const agentName = (providerId: ProviderId) => ProviderRegistry.getAgentName(providerId, this.settings);
    const setting = (settings: Record<string, unknown>, key: string): string | undefined =>
      typeof settings[key] === 'string' && settings[key] ? settings[key] : undefined;
    return {
      agents: () => enabled().map(providerId => ({ name: agentName(providerId), providerId })),
      defaultSelection: (preferredAgentName) => {
        const providerIds = enabled();
        const wanted = preferredAgentName.trim().toLowerCase();
        const providerId = providerIds.find(id => agentName(id).toLowerCase() === wanted) ?? providerIds[0];
        if (!providerId) return null;
        const model = resolveProviderDefaultModel(providerId, this.settings)
          ?? setting(ProviderSettingsCoordinator.getProviderSettingsSnapshot(this.settings, providerId), 'model');
        return model ? { model, providerId } : null;
      },
      generateTitle: text => new Promise((resolve) => {
        void ProviderRegistry.createTitleGenerationService(this)
          .generateTitle(`repository-${Date.now()}`, text, async (_id, result) => {
            resolve(result.success ? result.title : null);
          })
          .catch(() => resolve(null));
      }),
      mountToolbar: (parent, binding) => mountStandaloneComposerToolbar(parent, this, {
        getSelection: () => {
          const selection = binding.getSelection();
          return { model: selection.model, providerId: selection.providerId };
        },
        onSelectionChange: selection => binding.onSelectionChange(selection),
      }),
      openSession: (providerId, interactionPort) => {
        const id = providerId;
        const session = ProviderRegistry.createRepositoryThreadSession(this, id, interactionPort);
        return {
          dispose: () => session.dispose(),
          isFresh: () => session.isFresh(),
          isRunning: () => session.isRunning(),
          send: (prompt, model, callbacks) => {
            const settings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(this.settings, id);
            return session.send({
              model: model ?? undefined,
              permissionMode: setting(settings, 'permissionMode'),
              prompt,
              reasoning: setting(settings, 'effortLevel') ?? setting(settings, 'thinkingBudget'),
              serviceTier: setting(settings, 'serviceTier'),
            }, callbacks);
          },
        };
      },
    };
  }

  notifyProviderChatOptionsChanged(providerId: ProviderId): Promise<void> {
    const reconcileAndRefresh = async (): Promise<void> => {
      let didReconcile = false;
      try {
        const changedConversations = this.conversationRepository
          ? await this.conversationRepository.reconcileSelectedModels(providerId)
          : [];
        didReconcile = true;
        if (changedConversations.length > 0) {
          this.notifyConversationViewsChanged();
        }
      } catch (error) {
        new Notice(
          error instanceof Error
            ? `Failed to reconcile ${ProviderRegistry.getProviderDisplayName(providerId)} models: ${error.message}`
            : `Failed to reconcile ${ProviderRegistry.getProviderDisplayName(providerId)} models.`,
        );
      }
      if (didReconcile) {
        for (const view of this.getAllViews()) {
          view.refreshModelSelector(providerId);
        }
      }
    };

    this.providerChatOptionsChangeTail = this.providerChatOptionsChangeTail.then(
      reconcileAndRefresh,
      reconcileAndRefresh,
    );
    return this.providerChatOptionsChangeTail;
  }

  async getConversationById(id: string): Promise<Conversation | null> {
    return this.conversationRepository.getById(id);
  }

  getCachedConversation(id: string): Conversation | null {
    return this.conversationRepository.getCachedConversation(id);
  }

  getConversationSync(id: string): Conversation | null {
    return this.conversationRepository.getSync(id);
  }

  findEmptyConversation(): Conversation | null {
    return this.conversationRepository.findEmpty();
  }

  getConversationList(): ConversationMeta[] {
    return this.conversationRepository.list();
  }

  async ensureConversationMetadataLoaded(conversationIds: readonly string[]): Promise<void> {
    const missingIds = Array.from(new Set(conversationIds)).filter(
      id => !this.conversationRepository.getCachedConversation(id),
    );
    if (missingIds.length === 0) return;

    const records = (await Promise.all(
      missingIds.map(id => this.storage.sessions.load(id)),
    )).filter((record): record is SessionMetadataReadResult => record !== null);
    if (records.length === 0) return;

    const entries = records.map(({ metadata, needsMigration }) => ({
      conversation: this.createConversationMetadataShell(metadata),
      needsMigration,
    }));
    const shells = entries.map(({ conversation }) => conversation);
    const invalidatedIds = new Set(
      ProviderSettingsCoordinator.invalidateConversationSessions(
        shells,
        Array.from(this.pendingEnvironmentInvalidationGenerations.keys()),
      ).map(({ id }) => id),
    );
    await this.conversationRepository.adoptMetadataConversations(entries);
    this.conversationRepository.registerHistoricalModelRecoverySources(shells);
    await this.conversationRepository.persistConversations(
      Array.from(invalidatedIds)
        .map(id => this.conversationRepository.getCachedConversation(id))
        .filter((conversation): conversation is Conversation => conversation !== null),
    );
  }

  getView(): GrandemoniumView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_GRANDEMONIUM);
    return leaves.map(leaf => leaf.view).find(isGrandemoniumView) ?? null;
  }

  getAllViews(): GrandemoniumView[] {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_GRANDEMONIUM);
    return leaves.map(leaf => leaf.view).filter(isGrandemoniumView);
  }

  findConversationAcrossViews(conversationId: string): { view: GrandemoniumView; tabId: string } | null {
    for (const view of this.getAllViews()) {
      const tabManager = view.getTabManager();
      if (!tabManager) continue;

      const tabs = tabManager.getAllTabs();
      for (const tab of tabs) {
        if (tab.conversationId === conversationId) {
          return { view, tabId: tab.id };
        }
      }
    }
    return null;
  }

}
