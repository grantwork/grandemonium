import type { App } from 'obsidian';

import type { SharedAppStorage } from '../core/bootstrap/storage';
import type { ProviderHost } from '../core/providers/ProviderHost';
import type { ProviderId } from '../core/providers/types';
import type {
  Conversation,
  ConversationMeta,
  ConversationMutablePatch,
  GrandemoniumSettings,
  StoredChatModelSelection,
} from '../core/types';
import type { ChatExecutionPersistence } from './chat/execution/ChatExecutionCoordinator';
import type { WarmExecutionPool } from './chat/execution/WarmExecutionPool';
import type { AssembledTabRuntime, TabId, TabManagerViewHost } from './chat/tabs/types';
import type { CommentsController } from './comments';

export interface FeatureTabManagerHost {
  canCreateTab(): boolean;
  getAllTabs(): AssembledTabRuntime[];
  getTab(tabId: TabId): AssembledTabRuntime | null;
  isTabWorking(tabId: TabId): boolean;
  switchToTab(tabId: TabId): Promise<void>;
  closeTab(tabId: TabId, force?: boolean): Promise<boolean>;
  primeProviderExecution(providerIds?: ProviderId | ProviderId[]): void;
  invalidateProviderResources(providerIds: ProviderId | ProviderId[], generation: number): void;
}

/** What each provider did with a broadcast prompt. */
export interface ProviderBroadcastResult {
  /** Providers that started a turn with the prompt. */
  sent: ProviderId[];
  /** Providers mid-turn that took it onto their queue instead. */
  queued: ProviderId[];
}

export interface FeatureViewHost extends TabManagerViewHost {
  getActiveTab(): AssembledTabRuntime | null;
  getTabManager(): FeatureTabManagerHost | null;
  notifyConversationListChanged(): void;
  refreshModelSelector(providerId?: ProviderId): void;
  refreshTabControls(): void;
  refreshDualPaneLayout(): void;
  /** Gives every newly enabled provider its tab. */
  refreshProviderTabs(): void;
  /** Sends one prompt to every enabled provider's tab; reports what each did with it. */
  broadcastPromptToProviderTabs(
    prompt: string,
    targetProviderId?: ProviderId,
  ): Promise<ProviderBroadcastResult>;
  refreshMessageTimestamps(): void;
  updateHiddenProviderCommands(): void;
  invalidateProviderResources(providerIds: ProviderId[], generation: number): void;
}

export interface ChatModelSelectionPort {
  beginIntent(): number;
  commitIntent(
    intent: number,
    selection: StoredChatModelSelection,
    isStillValid: () => boolean,
  ): Promise<boolean>;
}

/** Application capabilities consumed by user-facing features. */
export interface FeatureHost {
  readonly app: App;
  readonly chatModelSelection: ChatModelSelectionPort;
  readonly executionPersistence: ChatExecutionPersistence;
  readonly providerHost: ProviderHost;
  readonly settings: GrandemoniumSettings;

  /** Quote-anchored review comments feature. */
  readonly comments: CommentsController;
  readonly storage: SharedAppStorage;
  readonly warmExecutionPool: WarmExecutionPool;

  mutateSettings(
    mutation: (settings: GrandemoniumSettings) => void | Promise<void>,
  ): Promise<void>;
  getActiveEnvironmentVariables(providerId?: ProviderId): string;
  getAgentSkillResourceGeneration(): number;
  notifyAgentSkillsChanged(): Promise<void>;
  notifyProviderChatOptionsChanged(providerId: ProviderId): void;

  createConversation(options?: {
    providerId?: ProviderId;
    sessionId?: string;
    selectedModel?: string;
    linkedContentPath?: string;
  }): Promise<Conversation>;
  switchConversation(id: string): Promise<Conversation | null>;
  deleteConversation(id: string): Promise<void>;
  handleMissingProviderSession(
    id: string,
    missingProviderSessionId?: string,
  ): Promise<'deleted' | 'reset' | 'preserved' | 'not_found'>;
  renameConversation(id: string, title: string): Promise<void>;
  setConversationPinned(id: string, isPinned: boolean): Promise<void>;
  setLinkedContentPinned(contentPath: string, isPinned: boolean): Promise<void>;
  rewriteLinkedContentPaths(
    oldPath: string,
    newPath: string,
    includeDescendants: boolean,
  ): Promise<void>;
  setConversationArchived(id: string, isArchived: boolean): Promise<void>;
  updateConversation(id: string, updates: ConversationMutablePatch): Promise<void>;
  getConversationById(id: string): Promise<Conversation | null>;
  getCachedConversation(id: string): Conversation | null;
  getConversationSync(id: string): Conversation | null;
  getConversationList(): ConversationMeta[];
  ensureConversationMetadataLoaded(conversationIds: readonly string[]): Promise<void>;

  getView(): FeatureViewHost | null;
  getAllViews(): FeatureViewHost[];
  findConversationAcrossViews(
    conversationId: string,
  ): { view: FeatureViewHost; tabId: TabId } | null;
}
