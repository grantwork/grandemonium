import type { VaultFileAdapter } from '../storage/VaultFileAdapter';
import type { SessionMetadataReader } from './SessionStorage';

/**
 * Minimal shared app storage contract.
 *
 * This interface covers only the storage concerns that are shared across
 * all providers: Grandemonium settings and session metadata.
 *
 * Provider-specific storage surfaces (CC settings, slash commands, skills,
 * agents, MCP config) live behind provider-owned modules.
 */
export interface SharedAppStorage {
  initialize(): Promise<{ grandemonium: Record<string, unknown> }>;
  saveGrandemoniumSettings(settings: Record<string, unknown>): Promise<void>;
  /** Read-only startup metadata access; conversation writers stay repository-private. */
  sessions: SessionMetadataReader;
  getAdapter(): VaultFileAdapter;
}
