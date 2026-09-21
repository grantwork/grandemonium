import type { Plugin } from 'obsidian';

import { ConversationPersistenceStore } from '../../core/bootstrap/ConversationPersistenceStore';
import { SessionStorage } from '../../core/bootstrap/SessionStorage';
import type { SharedAppStorage } from '../../core/bootstrap/storage';
import { normalizeTabManagerState } from '../../core/bootstrap/tabManagerState';
import type { AppTabManagerState } from '../../core/providers/types';
import { VaultFileAdapter } from '../../core/storage/VaultFileAdapter';
import { getHostnameKey } from '../../utils/env';
import { GrandemoniumSettingsStorage, type StoredGrandemoniumSettings } from '../settings/GrandemoniumSettingsStorage';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export class SharedStorageService implements SharedAppStorage {
  readonly grandemoniumSettings: GrandemoniumSettingsStorage;
  readonly sessions: SessionStorage;
  readonly conversationPersistence: ConversationPersistenceStore;

  private adapter: VaultFileAdapter;
  private plugin: Plugin;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.adapter = new VaultFileAdapter(plugin.app);
    const deviceKey = getHostnameKey();
    this.grandemoniumSettings = new GrandemoniumSettingsStorage(this.adapter);
    this.sessions = new SessionStorage(this.adapter, deviceKey);
    this.conversationPersistence = new ConversationPersistenceStore(this.adapter, deviceKey);
  }

  async initialize(): Promise<{ grandemonium: Record<string, unknown> }> {
    const grandemonium = await this.grandemoniumSettings.load();
    return { grandemonium };
  }

  async saveGrandemoniumSettings(settings: Record<string, unknown>): Promise<void> {
    await this.grandemoniumSettings.save(settings as StoredGrandemoniumSettings);
  }

  async getTabManagerState(): Promise<AppTabManagerState | null> {
    try {
      const data: unknown = await this.plugin.loadData();
      if (!isRecord(data) || !data.tabManagerState) {
        return null;
      }

      return normalizeTabManagerState(data.tabManagerState);
    } catch {
      return null;
    }
  }

  async clearTabManagerState(): Promise<void> {
    const loaded: unknown = await this.plugin.loadData();
    if (!isRecord(loaded) || !('tabManagerState' in loaded)) return;

    const data = { ...loaded };
    delete data.tabManagerState;
    await this.plugin.saveData(data);
  }

  getAdapter(): VaultFileAdapter {
    return this.adapter;
  }
}
