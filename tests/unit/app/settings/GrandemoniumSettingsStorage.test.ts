import '@/providers';

import { TEST_CODEX_CATALOG } from '@test/helpers/codexModels';

import { DEFAULT_GRANDEMONIUM_SETTINGS } from '@/app/settings/defaultSettings';
import {
  GRANDEMONIUM_SETTINGS_PATH,
  GrandemoniumSettingsStorage,
} from '@/app/settings/GrandemoniumSettingsStorage';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import type { GrandemoniumSettings } from '@/core/types/settings';
import { getClaudeProviderSettings } from '@/providers/claude/settings';
import {
  getCodexProviderSettings,
  updateCodexProviderSettings,
} from '@/providers/codex/settings';
import { getBuiltInProviderDefaultConfigs } from '@/providers/defaultProviderConfigs';
import { getGrokProviderSettings } from '@/providers/grok/settings';
import { getOpencodeProviderSettings } from '@/providers/opencode/settings';
import { getPiProviderSettings } from '@/providers/pi/settings';

const mockGetHostnameKey = jest.fn(() => 'host-a');
const originalPlatform = process.platform;

jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => mockGetHostnameKey(),
}));

const mockAdapter = {
  exists: jest.fn(),
  read: jest.fn(),
  write: jest.fn(),
  delete: jest.fn(),
} as unknown as jest.Mocked<VaultFileAdapter>;

function storeSettings(stored: Record<string, unknown>): void {
  mockAdapter.exists.mockImplementation(async (path: string) => (
    path === GRANDEMONIUM_SETTINGS_PATH
  ));
  mockAdapter.read.mockResolvedValue(JSON.stringify(stored));
}

function lastWrittenSettings(): Record<string, unknown> {
  return JSON.parse(mockAdapter.write.mock.calls.at(-1)![1]) as Record<string, unknown>;
}

/** A value other than the default for every persisted setting. */
function createEverySetting(): GrandemoniumSettings {
  const providerConfigs = getBuiltInProviderDefaultConfigs();
  return {
    userName: 'Ada',
    permissionMode: 'normal',
    model: 'opus',
    thinkingBudget: 'high',
    effortLevel: 'max',
    serviceTier: 'fast',
    enableAutoTitleGeneration: false,
    titleGenerationLocale: 'de',
    titleGenerationModel: 'sonnet',
    excludedTags: ['private'],
    mediaFolder: 'Attachments',
    systemPrompt: 'Answer briefly.',
    sharedEnvironmentVariables: 'PATH=/opt/tools/bin',
    envSnippets: [{
      id: 'snippet-1',
      name: 'Office proxy',
      description: 'Routes traffic through the office proxy',
      envVars: 'HTTPS_PROXY=http://proxy.example:8080',
      scope: 'shared',
      contextLimits: { 'custom-model': 200_000 },
      modelAliases: { 'custom-model': 'Custom' },
    }],
    customContextLimits: { 'custom-model': 200_000 },
    customModelAliases: { 'custom-model': 'Custom' },
    keyboardNavigation: {
      scrollUpKey: 'k',
      scrollDownKey: 'j',
      focusInputKey: 'a',
    },
    requireCommandOrControlEnterToSend: true,
    locale: 'de',
    providerConfigs: {
      ...providerConfigs,
      claude: { ...providerConfigs.claude, agentName: 'opus-reviewer' },
    },
    settingsProvider: 'codex',
    lastSelectedChatModel: { providerId: 'codex', model: 'gpt-5.5' },
    savedProviderModel: { codex: 'gpt-5.5' },
    savedProviderEffort: { codex: 'high' },
    savedProviderServiceTier: { codex: 'fast' },
    savedProviderThinkingBudget: { claude: 'high' },
    savedProviderPermissionMode: { codex: 'normal' },
    pendingProviderSessionInvalidations: { codex: 2 },
    lastCustomModel: 'custom-model',
    maxWarmAgentProcesses: 7,
    enableAutoScroll: false,
    showMessageTimestamps: true,
    readAloudProvider: 'openai',
    readAloudOpenAiVoice: 'alloy',
    readAloudOpenAiModel: 'tts-1',
    readAloudOpenAiApiKey: 'test-key',
    deferMathRenderingDuringStreaming: false,
    expandFileEditsByDefault: true,
    chatViewPlacement: 'main-tab',
    enableDualPane: false,
    dualPaneSide: 'left',
    restoreTabsOnStartup: false,
    sessionManagerOrganization: 'linked-content',
    sessionManagerSort: 'created',
    pinnedLinkedContentPaths: ['Projects/Current'],
    hiddenProviderCommands: { claude: ['commit'] },
  };
}

describe('GrandemoniumSettingsStorage', () => {
  let storage: GrandemoniumSettingsStorage;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    mockAdapter.exists.mockResolvedValue(false);
    mockAdapter.read.mockResolvedValue('{}');
    mockAdapter.write.mockResolvedValue(undefined);
    mockAdapter.delete.mockResolvedValue(undefined);
    mockGetHostnameKey.mockReturnValue('host-a');
    storage = new GrandemoniumSettingsStorage(mockAdapter);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  describe('persisted keys', () => {
    it('round-trips every setting', async () => {
      const settings = createEverySetting();
      expect(Object.keys(settings).sort())
        .toEqual(Object.keys(DEFAULT_GRANDEMONIUM_SETTINGS).sort());

      await storage.save(settings);
      storeSettings(lastWrittenSettings());
      const reloaded = await storage.load();

      // Provider configuration is provider-owned and decoded by each provider;
      // one provider-owned value stands in for it here.
      const { providerConfigs: _reloadedProviders, ...reloadedSettings } = JSON.parse(
        JSON.stringify(reloaded),
      ) as GrandemoniumSettings;
      const { providerConfigs: _expectedProviders, ...expectedSettings } = createEverySetting();
      expect(reloadedSettings).toEqual(expectedSettings);
      expect(getClaudeProviderSettings(reloaded).agentName).toBe('opus-reviewer');
    });

    it('drops stored keys that are not settings and rewrites the file without them', async () => {
      storeSettings({
        userName: 'Ada',
        collabEnabled: true,
        collabProjectsFolder: 'Collab',
        show1MModel: true,
      });

      const loaded = await storage.load();

      expect(loaded.userName).toBe('Ada');
      expect(loaded).not.toHaveProperty('collabEnabled');
      expect(loaded).not.toHaveProperty('collabProjectsFolder');
      expect(loaded).not.toHaveProperty('show1MModel');
      const persisted = lastWrittenSettings();
      expect(persisted.userName).toBe('Ada');
      expect(persisted).not.toHaveProperty('collabEnabled');
      expect(persisted).not.toHaveProperty('collabProjectsFolder');
      expect(persisted).not.toHaveProperty('show1MModel');
    });

    it('saves only settings keys', async () => {
      await storage.save({
        ...DEFAULT_GRANDEMONIUM_SETTINGS,
        userName: 'Ada',
        collabGitPath: '/usr/bin/git',
      });

      const persisted = lastWrittenSettings();
      expect(persisted.userName).toBe('Ada');
      expect(persisted).not.toHaveProperty('collabGitPath');
    });
  });

  describe('load', () => {
    it('returns defaults when the file does not exist', async () => {
      const result = await storage.load();

      expect(result.model).toBe(DEFAULT_GRANDEMONIUM_SETTINGS.model);
      expect(result.thinkingBudget).toBe(DEFAULT_GRANDEMONIUM_SETTINGS.thinkingBudget);
      expect(result.permissionMode).toBe(DEFAULT_GRANDEMONIUM_SETTINGS.permissionMode);
      expect(result.requireCommandOrControlEnterToSend).toBe(false);
      expect(result.titleGenerationLocale).toBe('');
      expect(result.lastSelectedChatModel).toBeNull();
      expect(result.enableDualPane).toBe(true);
      expect(result.dualPaneSide).toBe('right');
      expect(result.restoreTabsOnStartup).toBe(true);
      expect(mockAdapter.read).not.toHaveBeenCalled();
    });

    it('merges stored values over defaults', async () => {
      storeSettings({
        model: 'claude-opus-4-5',
        userName: 'TestUser',
      });

      const result = await storage.load();

      expect(result.model).toBe('claude-opus-4-5');
      expect(result.userName).toBe('TestUser');
      expect(result.thinkingBudget).toBe(DEFAULT_GRANDEMONIUM_SETTINGS.thinkingBudget);
    });

    it('preserves an explicitly stored provider-qualified chat model selection', async () => {
      storeSettings({
        lastSelectedChatModel: {
          providerId: 'codex',
          model: 'codex/gpt-5',
        },
      });

      const result = await storage.load();

      expect(result.lastSelectedChatModel).toEqual({
        providerId: 'codex',
        model: 'codex/gpt-5',
      });
    });

    it('preserves an explicitly stored null chat model selection', async () => {
      storeSettings({
        lastSelectedChatModel: null,
      });

      const result = await storage.load();

      expect(result.lastSelectedChatModel).toBeNull();
      expect(mockAdapter.write).not.toHaveBeenCalled();
    });

    it('normalizes a malformed stored chat model selection to null', async () => {
      storeSettings({
        lastSelectedChatModel: {
          providerId: 'codex',
          model: 42,
        },
      });

      const result = await storage.load();

      expect(result.lastSelectedChatModel).toBeNull();
      expect(lastWrittenSettings().lastSelectedChatModel).toBeNull();
    });

    it('normalizes invalid chatViewPlacement values', async () => {
      storeSettings({
        chatViewPlacement: 'floating-window',
      });

      const result = await storage.load();

      expect(result.chatViewPlacement).toBe('right-sidebar');
      expect(lastWrittenSettings().chatViewPlacement).toBe('right-sidebar');
    });

    it('normalizes invalid dual-pane preferences', async () => {
      storeSettings({
        enableDualPane: 'yes',
        dualPaneSide: 'top',
      });

      const result = await storage.load();
      const persisted = lastWrittenSettings();

      expect(result.enableDualPane).toBe(true);
      expect(result.dualPaneSide).toBe('right');
      expect(persisted.enableDualPane).toBe(true);
      expect(persisted.dualPaneSide).toBe('right');
    });

    it('normalizes invalid startup tab restore values', async () => {
      storeSettings({
        restoreTabsOnStartup: 'yes',
      });

      const result = await storage.load();

      expect(result.restoreTabsOnStartup).toBe(true);
      expect(lastWrittenSettings().restoreTabsOnStartup).toBe(true);
    });

    it('preserves a disabled startup tab restore toggle', async () => {
      storeSettings({
        restoreTabsOnStartup: false,
      });

      const result = await storage.load();

      expect(result.restoreTabsOnStartup).toBe(false);
    });

    it('normalizes pinned Linked content paths and persists the canonical list', async () => {
      storeSettings({
        pinnedLinkedContentPaths: [
          'Projects\\Current',
          './Projects/Current',
          '../invalid',
        ],
      });

      const settings = await storage.load();

      expect(settings.pinnedLinkedContentPaths).toEqual(['Projects/Current']);
      expect(lastWrittenSettings().pinnedLinkedContentPaths).toEqual(['Projects/Current']);
    });

    it('preserves hostname-scoped provider settings without assigning them to the current device', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      mockGetHostnameKey.mockReturnValue('device-current');
      storeSettings({
        lastSelectedChatModel: null,
        providerConfigs: {
          claude: {
            cliPathsByHost: {
              'host-a': '/custom/claude-a',
              'host-b': '/custom/claude-b',
            },
          },
          codex: {
            cliPathsByHost: {
              'host-a': '/custom/codex-a',
              'host-b': '/custom/codex-b',
            },
            installationMethodsByHost: {
              'host-a': 'wsl',
              'host-b': 'native-windows',
            },
            wslDistroOverridesByHost: {
              'host-a': 'Ubuntu',
              'host-b': 'Debian',
            },
          },
          opencode: {
            cliPathsByHost: {
              'host-a': '/custom/opencode-a',
              'host-b': '/custom/opencode-b',
            },
          },
          pi: {
            cliPathsByHost: {
              'host-a': '/custom/pi-a',
              'host-b': '/custom/pi-b',
            },
          },
        },
      });

      const result = await storage.load();
      const codexSettings = getCodexProviderSettings(result);

      expect(getClaudeProviderSettings(result).cliPathsByHost).toEqual({
        'host-a': '/custom/claude-a',
        'host-b': '/custom/claude-b',
      });
      expect(codexSettings.cliPathsByHost).toEqual({
        'host-a': '/custom/codex-a',
        'host-b': '/custom/codex-b',
      });
      expect(codexSettings.installationMethod).toBe('native-windows');
      expect(codexSettings.installationMethodsByHost).toEqual({
        'host-a': 'wsl',
        'host-b': 'native-windows',
      });
      expect(codexSettings.wslDistroOverride).toBe('');
      expect(codexSettings.wslDistroOverridesByHost).toEqual({
        'host-a': 'Ubuntu',
        'host-b': 'Debian',
      });
      expect(getOpencodeProviderSettings(result).cliPathsByHost).toEqual({
        'host-a': '/custom/opencode-a',
        'host-b': '/custom/opencode-b',
      });
      expect(getPiProviderSettings(result).cliPathsByHost).toEqual({
        'host-a': '/custom/pi-a',
        'host-b': '/custom/pi-b',
      });
      expect(mockAdapter.write).not.toHaveBeenCalled();
    });

    it('clears Codex Windows installation settings on non-Windows hosts during normalization', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      storeSettings({
        providerConfigs: {
          codex: {
            cliPathsByHost: {
              'host-a': '/opt/homebrew/bin/codex',
            },
            installationMethodsByHost: {
              'host-a': 'native-windows',
              'host-b': 'wsl',
            },
            wslDistroOverridesByHost: {
              'host-a': 'Ubuntu',
              'host-b': 'Debian',
            },
          },
        },
      });

      const result = await storage.load();
      const codexSettings = getCodexProviderSettings(result);
      const persisted = lastWrittenSettings() as {
        providerConfigs: { codex: Record<string, unknown> };
      };

      expect(codexSettings.cliPathsByHost).toEqual({
        'host-a': '/opt/homebrew/bin/codex',
      });
      expect(codexSettings.installationMethodsByHost).toEqual({
        'host-b': 'wsl',
      });
      expect(codexSettings.wslDistroOverridesByHost).toEqual({
        'host-b': 'Debian',
      });
      expect(persisted.providerConfigs.codex.installationMethodsByHost).toEqual({
        'host-b': 'wsl',
      });
      expect(persisted.providerConfigs.codex.wslDistroOverridesByHost).toEqual({
        'host-b': 'Debian',
      });
    });

    it('preserves Grok hostname-scoped CLI and catalog maps', async () => {
      mockGetHostnameKey.mockReturnValue('device-current');
      storeSettings({
        providerConfigs: {
          grok: {
            catalogsByHost: {
              'host-a': {
                defaultModelId: 'grok-4.5',
                fingerprint: 'current',
                models: [{ displayName: 'Grok 4.5', rawId: 'grok-4.5' }],
                refreshedAt: 1,
              },
              'host-b': {
                defaultModelId: null,
                fingerprint: 'other',
                models: [],
                refreshedAt: 2,
              },
            },
            cliPathsByHost: {
              'host-a': '/custom/grok-a',
              'host-b': '/custom/grok-b',
            },
            enabled: true,
          },
        },
      });

      const result = await storage.load();
      const grokSettings = getGrokProviderSettings(result);
      const persisted = lastWrittenSettings() as {
        providerConfigs: { grok: Record<string, unknown> };
      };

      expect(grokSettings.cliPathsByHost).toEqual({
        'host-a': '/custom/grok-a',
        'host-b': '/custom/grok-b',
      });
      expect(grokSettings.catalogsByHost).toEqual(expect.objectContaining({
        'host-a': expect.objectContaining({ fingerprint: 'current' }),
        'host-b': expect.objectContaining({ fingerprint: 'other' }),
      }));
      expect(persisted.providerConfigs.grok.cliPathsByHost).toEqual({
        'host-a': '/custom/grok-a',
        'host-b': '/custom/grok-b',
      });
      expect(persisted.providerConfigs.grok.catalogsByHost).toEqual(expect.objectContaining({
        'host-a': expect.objectContaining({ fingerprint: 'current' }),
        'host-b': expect.objectContaining({ fingerprint: 'other' }),
      }));
    });

    it('defaults Codex installation method and WSL distro override when missing', async () => {
      storeSettings({});

      const result = await storage.load();

      expect(getCodexProviderSettings(result).installationMethod).toBe('native-windows');
      expect(getCodexProviderSettings(result).wslDistroOverride).toBe('');
    });

    it('loads a persisted Codex model catalog with hand-picked model IDs', async () => {
      storeSettings({
        providerConfigs: {
          codex: {
            enabled: true,
            discoveredModels: TEST_CODEX_CATALOG,
            visibleModels: ['gpt-5.4-mini'],
          },
        },
      });

      const result = await storage.load();
      const codexSettings = getCodexProviderSettings(result);

      expect(codexSettings.discoveredModels).toEqual(TEST_CODEX_CATALOG);
      expect(codexSettings.visibleModels).toEqual(['gpt-5.4-mini']);
    });

    it('does not inherit another host WSL selection from host-scoped provider config', async () => {
      storeSettings({
        providerConfigs: {
          codex: {
            installationMethodsByHost: {
              'host-b': 'wsl',
            },
            wslDistroOverridesByHost: {
              'host-b': 'Ubuntu',
            },
          },
        },
      });

      const result = await storage.load();

      expect(getCodexProviderSettings(result).installationMethod).toBe('native-windows');
      expect(getCodexProviderSettings(result).wslDistroOverride).toBe('');
    });

    it('normalizes stale scoped mixed env snippets back to unscoped on load', async () => {
      storeSettings({
        envSnippets: [{
          id: 'snippet-1',
          name: 'Mixed snippet',
          description: '',
          envVars: 'PATH=/usr/local/bin\nANTHROPIC_MODEL=claude-custom',
          scope: 'shared',
        }],
      });

      const result = await storage.load();
      const persisted = lastWrittenSettings() as {
        envSnippets: Array<Record<string, unknown>>;
      };

      expect(result.envSnippets).toEqual([{
        id: 'snippet-1',
        name: 'Mixed snippet',
        description: '',
        envVars: 'PATH=/usr/local/bin\nANTHROPIC_MODEL=claude-custom',
        scope: undefined,
        contextLimits: undefined,
        modelAliases: undefined,
      }]);
      expect(persisted.envSnippets[0].scope).toBeUndefined();
    });

    it('normalizes custom model aliases on load', async () => {
      storeSettings({
        customModelAliases: {
          ' custom-model ': '  Friendly model  ',
          empty: '   ',
          ignored: 123,
        },
        envSnippets: [{
          id: 'snippet-1',
          name: 'Aliased snippet',
          description: '',
          envVars: 'ANTHROPIC_MODEL=custom-model',
          modelAliases: {
            ' custom-model ': '  Snippet model  ',
            ignored: 123,
          },
        }],
      });

      const result = await storage.load();
      const persisted = lastWrittenSettings() as {
        customModelAliases: Record<string, string>;
        envSnippets: Array<{ modelAliases: Record<string, string> }>;
      };

      expect(result.customModelAliases).toEqual({
        'custom-model': 'Friendly model',
      });
      expect(result.envSnippets[0].modelAliases).toEqual({
        'custom-model': 'Snippet model',
      });
      expect(persisted.customModelAliases).toEqual({
        'custom-model': 'Friendly model',
      });
      expect(persisted.envSnippets[0].modelAliases).toEqual({
        'custom-model': 'Snippet model',
      });
    });

    it('throws on a JSON parse error', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue('invalid json');

      await expect(storage.load()).rejects.toThrow();
    });

    it('throws on a read error', async () => {
      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockRejectedValue(new Error('Read failed'));

      await expect(storage.load()).rejects.toThrow('Read failed');
    });
  });

  describe('save', () => {
    it('writes settings to the settings file', async () => {
      await storage.save({
        ...DEFAULT_GRANDEMONIUM_SETTINGS,
        model: 'claude-opus-4-5',
      });

      expect(mockAdapter.write).toHaveBeenCalledWith(
        GRANDEMONIUM_SETTINGS_PATH,
        expect.any(String),
      );
      const persisted = lastWrittenSettings() as {
        model: string;
        providerConfigs: { codex: Record<string, unknown> };
      };
      expect(persisted.model).toBe('claude-opus-4-5');
      expect(persisted.providerConfigs.codex).not.toHaveProperty('installationMethod');
      expect(persisted.providerConfigs.codex.installationMethodsByHost).toEqual({});
      expect(persisted.providerConfigs.codex).not.toHaveProperty('wslDistroOverride');
      expect(persisted.providerConfigs.codex.wslDistroOverridesByHost).toEqual({});
    });

    it('persists the Codex catalog with hand-picked model IDs', async () => {
      const settings = {
        ...DEFAULT_GRANDEMONIUM_SETTINGS,
        providerConfigs: {
          ...DEFAULT_GRANDEMONIUM_SETTINGS.providerConfigs,
          codex: {
            ...DEFAULT_GRANDEMONIUM_SETTINGS.providerConfigs.codex,
            discoveredModels: TEST_CODEX_CATALOG,
            visibleModels: ['gpt-5.4-mini'],
          },
        },
      };

      await storage.save(settings);

      const persisted = lastWrittenSettings() as {
        providerConfigs: { codex: Record<string, unknown> };
      };
      expect(persisted.providerConfigs.codex.discoveredModels).toEqual(TEST_CODEX_CATALOG);
      expect(persisted.providerConfigs.codex.visibleModels).toEqual(['gpt-5.4-mini']);
      expect(getCodexProviderSettings(settings).discoveredModels).toEqual(TEST_CODEX_CATALOG);
    });

    it('preserves Codex model aliases and catalog across restart', async () => {
      const settings = {
        ...DEFAULT_GRANDEMONIUM_SETTINGS,
        providerConfigs: {
          ...DEFAULT_GRANDEMONIUM_SETTINGS.providerConfigs,
          codex: {
            ...DEFAULT_GRANDEMONIUM_SETTINGS.providerConfigs.codex,
            discoveredModels: TEST_CODEX_CATALOG,
            modelAliases: {
              'gpt-5.5': 'Primary',
            },
            visibleModels: null,
          },
        },
      };

      await storage.save(settings);
      const persistedContent = mockAdapter.write.mock.calls[0][1];
      const persisted = JSON.parse(persistedContent) as {
        providerConfigs: { codex: Record<string, unknown> };
      };
      expect(persisted.providerConfigs.codex.discoveredModels).toEqual(TEST_CODEX_CATALOG);
      expect(persisted.providerConfigs.codex.modelAliases).toEqual({
        'gpt-5.5': 'Primary',
      });

      mockAdapter.exists.mockResolvedValue(true);
      mockAdapter.read.mockResolvedValue(persistedContent);
      const reloaded = await storage.load();

      expect(getCodexProviderSettings(reloaded).modelAliases).toEqual({
        'gpt-5.5': 'Primary',
      });
      expect(getCodexProviderSettings(reloaded).discoveredModels).toEqual(TEST_CODEX_CATALOG);
      updateCodexProviderSettings(reloaded, { discoveredModels: TEST_CODEX_CATALOG as never });
      expect(getCodexProviderSettings(reloaded).modelAliases).toEqual({
        'gpt-5.5': 'Primary',
      });
    });

    it('throws on a write error', async () => {
      mockAdapter.write.mockRejectedValue(new Error('Write failed'));

      await expect(storage.save(DEFAULT_GRANDEMONIUM_SETTINGS)).rejects.toThrow('Write failed');
    });
  });

  describe('exists', () => {
    it('returns true when the settings file exists', async () => {
      mockAdapter.exists.mockImplementation(async (path: string) => (
        path === GRANDEMONIUM_SETTINGS_PATH
      ));

      await expect(storage.exists()).resolves.toBe(true);
      expect(mockAdapter.exists).toHaveBeenCalledWith(GRANDEMONIUM_SETTINGS_PATH);
    });

    it('returns false when the settings file does not exist', async () => {
      await expect(storage.exists()).resolves.toBe(false);
    });
  });

  describe('update', () => {
    it('merges updates with existing settings', async () => {
      storeSettings({
        lastSelectedChatModel: null,
        model: 'claude-haiku-4-5',
        userName: 'ExistingUser',
      });

      await storage.update({ model: 'claude-opus-4-5' });

      const persisted = lastWrittenSettings();
      expect(persisted.model).toBe('claude-opus-4-5');
      expect(persisted.userName).toBe('ExistingUser');
    });
  });
});
