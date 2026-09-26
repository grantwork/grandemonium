import { CommentsController } from '@/features/comments/CommentsController';

function controllerWithLocalStorage(entries: Record<string, unknown>): {
  controller: CommentsController;
  local: Map<string, unknown>;
} {
  const local = new Map(Object.entries(entries));
  const plugin = {
    app: {
      loadLocalStorage: (key: string) => (local.has(key) ? local.get(key) : null),
      saveLocalStorage: (key: string, value: unknown) => {
        if (value === null) local.delete(key);
        else local.set(key, value);
      },
      vault: { getMarkdownFiles: () => [] },
      workspace: { getLeavesOfType: () => [] },
    },
    manifest: { id: 'grandemonium', name: 'Grandemonium' },
    loadData: async () => ({}),
    saveData: async () => undefined,
  };
  return { controller: new CommentsController(plugin as never), local };
}

it("keeps this device's display name and read marks across the storage rename", async () => {
  const marks = { 'Notes/Plan.md\u0000a1f3': 1_000 };
  const { controller, local } = controllerWithLocalStorage({
    'tandem-comments:author-name-override': 'Grant',
    'tandem-comments:read-marks': marks,
  });

  await controller.loadSettings();

  expect(controller.currentAuthor()).toBe('Grant');
  expect(Object.fromEntries(local)).toEqual({
    'grandemonium.comments.authorNameOverride': 'Grant',
    'grandemonium.comments.readMarks': marks,
  });
});
