import type { Plugin } from 'obsidian';

import { ConversationPersistenceStore } from '../../core/bootstrap/ConversationPersistenceStore';
import { SessionStorage } from '../../core/bootstrap/SessionStorage';
import type { SharedAppStorage } from '../../core/bootstrap/storage';
import { VaultFileAdapter } from '../../core/storage/VaultFileAdapter';
import { getHostnameKey } from '../../utils/env';
import { GrandemoniumSettingsStorage, type StoredGrandemoniumSettings } from '../settings/GrandemoniumSettingsStorage';

export class SharedStorageService implements SharedAppStorage {
  readonly grandemoniumSettings: GrandemoniumSettingsStorage;
  readonly sessions: SessionStorage;
  readonly conversationPersistence: ConversationPersistenceStore;

  private adapter: VaultFileAdapter;

  constructor(plugin: Plugin) {
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

  getAdapter(): VaultFileAdapter {
    return this.adapter;
  }
}
