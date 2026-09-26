import type { Plugin } from 'obsidian';

import { CommentsSettingsStore } from '@/features/comments/CommentsSettingsStore';

function pluginWith(initial: unknown): { plugin: Plugin; data: () => unknown } {
  let data = initial;
  const plugin = {
    loadData: async () => data,
    saveData: async (next: unknown) => {
      data = next;
    },
  } as unknown as Plugin;
  return { plugin, data: () => data };
}

it("stores the settings under the comments key, beside the chat side's data", async () => {
  const { plugin, data } = pluginWith({ tabManagerState: { tabs: [] } });
  const store = new CommentsSettingsStore(plugin);
  await store.write({ highlightColor: '#123456' } as never);
  expect(data()).toEqual({ tabManagerState: { tabs: [] }, comments: { highlightColor: '#123456' } });
  expect(await store.read()).toEqual({ highlightColor: '#123456' });
});

it('moves settings saved under the previous key to the comments key', async () => {
  const { plugin, data } = pluginWith({ tandemComments: { highlightColor: '#123456' }, tabManagerState: { tabs: [] } });
  const store = new CommentsSettingsStore(plugin);
  expect(await store.read()).toEqual({ highlightColor: '#123456' });
  expect(data()).toEqual({ tabManagerState: { tabs: [] }, comments: { highlightColor: '#123456' } });
});

it('reports no settings when none were saved', async () => {
  const { plugin } = pluginWith({ tabManagerState: { tabs: [] } });
  expect(await new CommentsSettingsStore(plugin).read()).toBeNull();
});
