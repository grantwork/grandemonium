import type { App } from 'obsidian';

import { GrandemoniumSettingsStorage, type StoredGrandemoniumSettings } from '../../../app/settings/GrandemoniumSettingsStorage';
import { GRANDEMONIUM_STORAGE_PATH, SESSIONS_PATH } from '../../../core/bootstrap/storagePaths';
import { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import type {
  SlashCommand,
} from '../../../core/types';
import {
  type CCPermissions,
  type CCSettings,
  createPermissionRule,
} from '../types/settings';
import { AGENTS_PATH, AgentVaultStorage } from './AgentVaultStorage';
import { CCSettingsStorage } from './CCSettingsStorage';
import { SKILLS_PATH, SkillStorage } from './SkillStorage';
import { COMMANDS_PATH, SlashCommandStorage } from './SlashCommandStorage';

export const CLAUDE_PATH = '.claude';

export interface CombinedSettings {
  cc: CCSettings;
  grandemonium: StoredGrandemoniumSettings;
}

interface StorageServicePlugin {
  readonly app: App;
}

export class StorageService {
  readonly ccSettings: CCSettingsStorage;
  readonly grandemoniumSettings: GrandemoniumSettingsStorage;
  readonly commands: SlashCommandStorage;
  readonly skills: SkillStorage;
  readonly agents: AgentVaultStorage;

  private adapter: VaultFileAdapter;
  private app: App;

  constructor(plugin: StorageServicePlugin, adapter?: VaultFileAdapter) {
    this.app = plugin.app;
    this.adapter = adapter ?? new VaultFileAdapter(this.app);
    this.ccSettings = new CCSettingsStorage(this.adapter);
    this.grandemoniumSettings = new GrandemoniumSettingsStorage(this.adapter);
    this.commands = new SlashCommandStorage(this.adapter);
    this.skills = new SkillStorage(this.adapter);
    this.agents = new AgentVaultStorage(this.adapter);
  }

  async initialize(): Promise<CombinedSettings> {
    await this.ensureDirectories();

    const cc = await this.ccSettings.load();
    const grandemonium = await this.grandemoniumSettings.load();

    return { cc, grandemonium };
  }

  async ensureDirectories(): Promise<void> {
    await this.adapter.ensureFolder(CLAUDE_PATH);
    await this.adapter.ensureFolder(GRANDEMONIUM_STORAGE_PATH);
    await this.adapter.ensureFolder(COMMANDS_PATH);
    await this.adapter.ensureFolder(SKILLS_PATH);
    await this.adapter.ensureFolder(SESSIONS_PATH);
    await this.adapter.ensureFolder(AGENTS_PATH);
  }

  async loadAllSlashCommands(): Promise<SlashCommand[]> {
    const commands = await this.commands.loadAll();
    const skills = await this.skills.loadAll();
    return [...commands, ...skills];
  }

  getAdapter(): VaultFileAdapter {
    return this.adapter;
  }

  async getPermissions(): Promise<CCPermissions> {
    return this.ccSettings.getPermissions();
  }

  async updatePermissions(permissions: CCPermissions): Promise<void> {
    return this.ccSettings.updatePermissions(permissions);
  }

  async addAllowRule(rule: string): Promise<void> {
    return this.ccSettings.addAllowRule(createPermissionRule(rule));
  }

  async addDenyRule(rule: string): Promise<void> {
    return this.ccSettings.addDenyRule(createPermissionRule(rule));
  }

  async removePermissionRule(rule: string): Promise<void> {
    return this.ccSettings.removeRule(createPermissionRule(rule));
  }

  async updateGrandemoniumSettings(updates: Partial<StoredGrandemoniumSettings>): Promise<void> {
    return this.grandemoniumSettings.update(updates);
  }

  async saveGrandemoniumSettings(settings: StoredGrandemoniumSettings): Promise<void> {
    return this.grandemoniumSettings.save(settings);
  }

  async loadGrandemoniumSettings(): Promise<StoredGrandemoniumSettings> {
    return this.grandemoniumSettings.load();
  }

}
