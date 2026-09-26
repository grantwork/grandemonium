import { getDefaultHiddenProviderCommands } from '../../core/providers/commands/hiddenCommands';
import { DEFAULT_REASONING_VALUE } from '../../core/providers/reasoning';
import { type GrandemoniumSettings } from '../../core/types/settings';
import { getBuiltInProviderDefaultConfigs } from '../../providers/defaultProviderConfigs';

export const DEFAULT_GRANDEMONIUM_SETTINGS: GrandemoniumSettings = {
  userName: '',

  permissionMode: 'yolo',

  model: 'haiku',
  thinkingBudget: 'off',
  effortLevel: DEFAULT_REASONING_VALUE,
  serviceTier: 'default',
  enableAutoTitleGeneration: true,
  titleGenerationLocale: '',
  titleGenerationModel: '',

  excludedTags: [],
  mediaFolder: '',
  systemPrompt: '',

  sharedEnvironmentVariables: '',
  envSnippets: [],
  customContextLimits: {},
  customModelAliases: {},

  keyboardNavigation: {
    scrollUpKey: 'w',
    scrollDownKey: 's',
    focusInputKey: 'i',
  },
  requireCommandOrControlEnterToSend: false,

  locale: 'en',

  providerConfigs: getBuiltInProviderDefaultConfigs(),

  settingsProvider: 'claude',
  lastSelectedChatModel: null,
  savedProviderModel: {},
  savedProviderEffort: {},
  savedProviderServiceTier: {},
  savedProviderThinkingBudget: {},
  savedProviderPermissionMode: {},
  pendingProviderSessionInvalidations: {},

  lastCustomModel: '',

  maxWarmAgentProcesses: 5,
  enableAutoScroll: true,
  showMessageTimestamps: false,
  readAloudProvider: 'system',
  readAloudOpenAiVoice: 'fable',
  readAloudOpenAiModel: 'gpt-4o-mini-tts',
  readAloudOpenAiApiKey: '',
  deferMathRenderingDuringStreaming: true,
  expandFileEditsByDefault: false,
  chatViewPlacement: 'right-sidebar',
  enableDualPane: true,
  dualPaneSide: 'right',
  restoreTabsOnStartup: true,
  sessionManagerOrganization: 'list',
  sessionManagerSort: 'last-updated',
  pinnedLinkedContentPaths: [],

  hiddenProviderCommands: getDefaultHiddenProviderCommands(),
};
