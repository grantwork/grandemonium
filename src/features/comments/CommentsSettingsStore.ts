import type { Plugin } from 'obsidian';

import type { CommentsSettings } from './settings-model';

/**
 * Reads and writes the comments settings inside the host plugin's shared
 * `data.json`, under a single namespaced key.
 *
 * The comments feature came from a standalone plugin that owned the whole
 * file. Here it shares `data.json` with the chat side of the plugin, so every
 * write merges into the existing document rather than replacing it.
 */
export const COMMENTS_SETTINGS_KEY = 'tandemComments';

/** Repository threads are data, not settings, so they sit under their own key. */
export const REPOSITORY_THREADS_KEY = 'repositoryThreads';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export class CommentsSettingsStore {
  constructor(private readonly plugin: Plugin) {}

  /** Returns the stored comments settings, or null when none have been saved. */
  async read(): Promise<unknown> {
    const data: unknown = await this.plugin.loadData();
    if (!isRecord(data)) return null;

    const namespaced = data[COMMENTS_SETTINGS_KEY];
    if (namespaced !== undefined) return namespaced;

    // Settings written by the standalone plugin sat at the document root.
    return 'schemaVersion' in data || 'highlightColor' in data ? data : null;
  }

  /** Merges the comments settings into `data.json`, leaving every other key intact. */
  async write(settings: CommentsSettings): Promise<void> {
    await this.writeKey(COMMENTS_SETTINGS_KEY, settings);
  }

  async readRepositoryThreads(): Promise<unknown> {
    const data: unknown = await this.plugin.loadData();
    return isRecord(data) ? data[REPOSITORY_THREADS_KEY] : undefined;
  }

  async writeRepositoryThreads(threads: unknown): Promise<void> {
    await this.writeKey(REPOSITORY_THREADS_KEY, threads);
  }

  private async writeKey(key: string, value: unknown): Promise<void> {
    const existing: unknown = await this.plugin.loadData();
    const document = isRecord(existing) ? { ...existing } : {};
    document[key] = value;
    await this.plugin.saveData(document);
  }
}
