import { GRANDEMONIUM_SETTINGS_PATH } from '../../core/bootstrap/storagePaths';
import { normalizeLinkedContentPath } from '../../core/path/LinkedContentPath';
import { normalizeHiddenProviderCommands } from '../../core/providers/commands/hiddenCommands';
import {
  getSharedEnvironmentVariables,
  inferEnvironmentSnippetScope,
  resolveEnvironmentSnippetScope,
} from '../../core/providers/providerEnvironment';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import type { VaultFileAdapter } from '../../core/storage/VaultFileAdapter';
import {
  CHAT_VIEW_PLACEMENTS,
  type ChatViewPlacement,
  DUAL_PANE_SIDES,
  type DualPaneSide,
  type EnvironmentScope,
  type EnvSnippet,
  type GrandemoniumSettings,
  type ProviderConfigMap,
  type SessionManagerOrganization,
  type StoredChatModelSelection,
} from '../../core/types/settings';
import { DEFAULT_GRANDEMONIUM_SETTINGS } from './defaultSettings';

export { GRANDEMONIUM_SETTINGS_PATH };

export type StoredGrandemoniumSettings = GrandemoniumSettings;

function getProviderSettingsAdapters() {
  return ProviderRegistry.getRegisteredProviderIds().map(providerId => ({
    adapter: ProviderRegistry.getSettingsStorageAdapter(providerId),
    providerId,
  }));
}

function isSettingsKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(DEFAULT_GRANDEMONIUM_SETTINGS, key);
}

/** Keeps only the keys `GrandemoniumSettings` declares; everything else is dropped on save. */
function pickSettingsKeys(settings: Record<string, unknown>): Partial<StoredGrandemoniumSettings> {
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => isSettingsKey(key)),
  );
}

function hasStoredValueChanged(
  stored: Record<string, unknown>,
  key: string,
  normalized: unknown,
): boolean {
  return key in stored && JSON.stringify(stored[key]) !== JSON.stringify(normalized);
}

function isChatViewPlacement(value: unknown): value is ChatViewPlacement {
  return typeof value === 'string'
    && (CHAT_VIEW_PLACEMENTS as readonly string[]).includes(value);
}

function normalizeChatViewPlacement(value: unknown): ChatViewPlacement {
  return isChatViewPlacement(value)
    ? value
    : DEFAULT_GRANDEMONIUM_SETTINGS.chatViewPlacement;
}

function normalizeEnableDualPane(value: unknown): boolean {
  return typeof value === 'boolean'
    ? value
    : DEFAULT_GRANDEMONIUM_SETTINGS.enableDualPane;
}

function normalizeDualPaneSide(value: unknown): DualPaneSide {
  return typeof value === 'string'
    && (DUAL_PANE_SIDES as readonly string[]).includes(value)
    ? value as DualPaneSide
    : DEFAULT_GRANDEMONIUM_SETTINGS.dualPaneSide;
}

function normalizeRestoreTabsOnStartup(value: unknown): boolean {
  return typeof value === 'boolean'
    ? value
    : DEFAULT_GRANDEMONIUM_SETTINGS.restoreTabsOnStartup;
}

function normalizeSessionManagerOrganization(
  value: unknown,
): SessionManagerOrganization {
  return value === 'linked-content' || value === 'list'
    ? value
    : DEFAULT_GRANDEMONIUM_SETTINGS.sessionManagerOrganization ?? 'list';
}

function normalizePinnedLinkedContentPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const normalizedPaths: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    const path = normalizeLinkedContentPath(candidate);
    if (path === null || seen.has(path)) continue;
    seen.add(path);
    normalizedPaths.push(path);
  }
  return normalizedPaths;
}

function normalizeProviderConfigs(value: unknown): ProviderConfigMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: ProviderConfigMap = {};
  for (const [providerId, config] of Object.entries(value as Record<string, unknown>)) {
    if (config && typeof config === 'object' && !Array.isArray(config)) {
      result[providerId] = { ...(config as Record<string, unknown>) };
    }
  }
  return result;
}

function projectPersistableProviderConfigs(value: unknown): {
  changed: boolean;
  providerConfigs: ProviderConfigMap;
} {
  const providerConfigs = normalizeProviderConfigs(value);
  let changed = false;

  for (const { adapter, providerId } of getProviderSettingsAdapters()) {
    const fields = adapter.runtimeOnlyFields ?? [];
    const config = providerConfigs[providerId];
    if (!config) {
      continue;
    }

    for (const field of fields) {
      if (field in config) {
        delete config[field];
        changed = true;
      }
    }
  }

  return { changed, providerConfigs };
}

function hasHostScopedProviderConfigNormalization(
  original: ProviderConfigMap,
  normalized: unknown,
): boolean {
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    return false;
  }

  const normalizedConfigs = normalized as ProviderConfigMap;
  for (const { adapter, providerId } of getProviderSettingsAdapters()) {
    const fields = adapter.hostScopedFields ?? [];
    const originalConfig = original[providerId];
    const normalizedConfig = normalizedConfigs[providerId];
    if (!originalConfig || !normalizedConfig) {
      continue;
    }

    for (const field of fields) {
      if (
        field in originalConfig
        && JSON.stringify(originalConfig[field]) !== JSON.stringify(normalizedConfig[field])
      ) {
        return true;
      }
    }
  }

  return false;
}

function isEnvironmentScope(value: unknown): value is EnvironmentScope {
  return value === 'shared' || (typeof value === 'string' && value.startsWith('provider:'));
}

function normalizeContextLimits(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const result: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'number' && Number.isFinite(entry) && entry > 0) {
      result[key] = entry;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeModelAliases(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, alias] of Object.entries(value)) {
    if (typeof alias !== 'string') {
      continue;
    }

    const modelId = key.trim();
    const normalizedAlias = alias.trim();
    if (modelId && normalizedAlias) {
      result[modelId] = normalizedAlias;
    }
  }

  return result;
}

function normalizeEnvSnippets(value: unknown): EnvSnippet[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const snippets: EnvSnippet[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }

    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.id !== 'string'
      || typeof candidate.name !== 'string'
      || typeof candidate.description !== 'string'
      || typeof candidate.envVars !== 'string'
    ) {
      continue;
    }

    const modelAliases = 'modelAliases' in candidate
      ? normalizeModelAliases(candidate.modelAliases)
      : undefined;

    snippets.push({
      id: candidate.id,
      name: candidate.name,
      description: candidate.description,
      envVars: candidate.envVars,
      scope: resolveEnvironmentSnippetScope(
        candidate.envVars,
        isEnvironmentScope(candidate.scope)
          ? candidate.scope
          : inferEnvironmentSnippetScope(candidate.envVars),
      ),
      contextLimits: normalizeContextLimits(candidate.contextLimits),
      modelAliases,
    });
  }

  return snippets;
}

function trimStoredString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStoredChatModelSelection(
  value: unknown,
): StoredChatModelSelection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const providerId = trimStoredString(candidate.providerId);
  const model = trimStoredString(candidate.model);
  if (
    !providerId
    || !model
    || !ProviderRegistry.getRegisteredProviderIds().includes(providerId)
  ) {
    return null;
  }

  return { providerId, model };
}

export class GrandemoniumSettingsStorage {
  constructor(private adapter: VaultFileAdapter) {}

  async load(): Promise<StoredGrandemoniumSettings> {
    if (!(await this.adapter.exists(GRANDEMONIUM_SETTINGS_PATH))) {
      return this.getDefaults();
    }

    const content = await this.adapter.read(GRANDEMONIUM_SETTINGS_PATH);
    const stored = JSON.parse(content) as Record<string, unknown>;
    const lastSelectedChatModel = normalizeStoredChatModelSelection(stored.lastSelectedChatModel);
    const hiddenProviderCommands = normalizeHiddenProviderCommands(stored.hiddenProviderCommands);
    const envSnippets = normalizeEnvSnippets(stored.envSnippets);
    const customModelAliases = normalizeModelAliases(stored.customModelAliases);
    const {
      changed: didStripRuntimeProviderConfig,
      providerConfigs,
    } = projectPersistableProviderConfigs(stored.providerConfigs);
    const chatViewPlacement = normalizeChatViewPlacement(stored.chatViewPlacement);
    const enableDualPane = normalizeEnableDualPane(stored.enableDualPane);
    const dualPaneSide = normalizeDualPaneSide(stored.dualPaneSide);
    const restoreTabsOnStartup = normalizeRestoreTabsOnStartup(
      stored.restoreTabsOnStartup,
    );
    const pinnedLinkedContentPaths = normalizePinnedLinkedContentPaths(
      stored.pinnedLinkedContentPaths,
    );
    const sessionManagerOrganization = normalizeSessionManagerOrganization(
      stored.sessionManagerOrganization,
    );
    const storedProviderSettings = {
      ...stored,
      hiddenProviderCommands,
      providerConfigs,
    };

    const normalized = {
      sharedEnvironmentVariables: getSharedEnvironmentVariables(storedProviderSettings),
      envSnippets,
      customModelAliases,
      hiddenProviderCommands,
      providerConfigs,
      chatViewPlacement,
      enableDualPane,
      dualPaneSide,
      restoreTabsOnStartup,
      sessionManagerOrganization,
      pinnedLinkedContentPaths,
      lastSelectedChatModel,
    };

    const merged: StoredGrandemoniumSettings = {
      ...this.getDefaults(),
      ...pickSettingsKeys(stored),
      ...normalized,
    };

    let didNormalizeProviderSettings = false;
    for (const { adapter } of getProviderSettingsAdapters()) {
      didNormalizeProviderSettings = adapter.normalizeStored(
        merged,
        storedProviderSettings,
      ) || didNormalizeProviderSettings;
    }
    const didNormalizeHostScopedProviderConfigs = hasHostScopedProviderConfigNormalization(
      providerConfigs,
      merged.providerConfigs,
    );

    if (
      Object.keys(stored).some(key => !isSettingsKey(key))
      || Object.entries(normalized).some(([key, value]) => (
        key !== 'providerConfigs' && hasStoredValueChanged(stored, key, value)
      ))
      || didNormalizeProviderSettings
      || didStripRuntimeProviderConfig
      || didNormalizeHostScopedProviderConfigs
    ) {
      await this.save(merged);
    }

    return merged;
  }

  async save(settings: StoredGrandemoniumSettings): Promise<void> {
    const { providerConfigs } = projectPersistableProviderConfigs(settings.providerConfigs);
    const content = JSON.stringify(
      {
        ...pickSettingsKeys(settings),
        providerConfigs,
        sessionManagerOrganization: normalizeSessionManagerOrganization(
          settings.sessionManagerOrganization,
        ),
        pinnedLinkedContentPaths: normalizePinnedLinkedContentPaths(
          settings.pinnedLinkedContentPaths,
        ),
      },
      null,
      2,
    );
    await this.adapter.write(GRANDEMONIUM_SETTINGS_PATH, content);
  }

  async exists(): Promise<boolean> {
    return this.adapter.exists(GRANDEMONIUM_SETTINGS_PATH);
  }

  async update(updates: Partial<StoredGrandemoniumSettings>): Promise<void> {
    const current = await this.load();
    await this.save({ ...current, ...updates });
  }

  private getDefaults(): StoredGrandemoniumSettings {
    return DEFAULT_GRANDEMONIUM_SETTINGS;
  }
}
