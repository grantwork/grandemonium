import { FileView, TFile, TFolder } from 'obsidian';

import { LinkedContentController } from '@/features/chat/linked-content/LinkedContentController';

jest.mock('obsidian', () => {
  const actual = jest.requireActual('obsidian');
  return { ...actual, Notice: jest.fn(), setIcon: jest.fn() };
});

function createFile(path: string): TFile {
  const file = new TFile();
  Object.assign(file, {
    path,
    name: path.split('/').pop() ?? '',
    basename: (path.split('/').pop() ?? '').replace(/\.[^.]+$/, ''),
    extension: path.split('.').pop() ?? '',
  });
  return file;
}

function createFolder(path: string): TFolder {
  const folder = new TFolder();
  Object.assign(folder, { path, name: path.split('/').pop() ?? '' });
  return folder;
}

function createFileView(file: TFile): FileView {
  const view = Object.create(FileView.prototype) as FileView;
  Object.assign(view, { file });
  return view;
}

function createHarness(options: {
  entries?: Array<TFile | TFolder>;
  rootLeaves?: Array<{ view?: unknown }>;
} = {}) {
  const root = createFolder('');
  const entries = new Map((options.entries ?? []).map(entry => [entry.path, entry]));
  const openFile = jest.fn().mockResolvedValue(undefined);
  const revealInFolder = jest.fn().mockResolvedValue(undefined);
  const explorerLeaf = { view: { revealInFolder } };
  const app = {
    vault: {
      getRoot: jest.fn(() => root),
      getAbstractFileByPath: jest.fn((path: string) => entries.get(path) ?? null),
    },
    workspace: {
      getActiveFile: jest.fn(() => null),
      getLeaf: jest.fn(() => ({ openFile })),
      getLeavesOfType: jest.fn(() => [explorerLeaf]),
      getLeftLeaf: jest.fn(() => null),
      iterateRootLeaves: jest.fn((callback: (leaf: { view?: unknown }) => void) => {
        for (const leaf of options.rootLeaves ?? []) callback(leaf);
      }),
      revealLeaf: jest.fn().mockResolvedValue(undefined),
    },
    metadataCache: { getFileCache: jest.fn(() => null) },
  };
  const controller = new LinkedContentController({
    app: app as never,
    getExcludedTags: () => [],
    getCachedVaultFiles: () => [...entries.values()].filter(
      (entry): entry is TFile => entry instanceof TFile,
    ),
    getCachedVaultFolders: () => [...entries.values()].filter(
      (entry): entry is TFolder => entry instanceof TFolder,
    ),
  });
  return { app, controller, entries, explorerLeaf, openFile, revealInFolder };
}

describe('LinkedContentController DOM', () => {
  it('rejects Vault root as an explicit target', () => {
    const harness = createHarness();

    expect(() => harness.controller.selectExplicit('.'))
      .toThrow('Invalid Linked content path');
  });

  it('reveals the existing main editor tab showing the linked file', async () => {
    const image = createFile('Images/Diagram.png');
    const existingLeaf = { view: createFileView(image) };
    const harness = createHarness({ entries: [image], rootLeaves: [existingLeaf] });
    harness.controller.selectExplicit(image.path);

    await harness.controller.activateCurrentContent();

    expect(harness.app.workspace.revealLeaf).toHaveBeenCalledWith(existingLeaf);
    expect(harness.app.workspace.getLeaf).not.toHaveBeenCalled();
    expect(harness.openFile).not.toHaveBeenCalled();
  });

  it('reveals a deferred editor tab whose view state identifies the linked file', async () => {
    const note = createFile('Notes/Restored.md');
    const deferredLeaf = {
      getViewState: jest.fn(() => ({
        state: { file: note.path },
        type: 'markdown',
      })),
      isDeferred: true,
      view: {},
    };
    const harness = createHarness({ entries: [note], rootLeaves: [deferredLeaf] });
    harness.controller.selectExplicit(note.path);

    await harness.controller.activateCurrentContent();

    expect(harness.app.workspace.revealLeaf).toHaveBeenCalledWith(deferredLeaf);
    expect(harness.app.workspace.getLeaf).not.toHaveBeenCalled();
    expect(harness.openFile).not.toHaveBeenCalled();
  });

  it('opens the Files view before revealing a folder when no explorer leaf exists', async () => {
    const folder = createFolder('Projects');
    const harness = createHarness({ entries: [folder] });
    const setViewState = jest.fn().mockResolvedValue(undefined);
    const revealInFolder = jest.fn().mockResolvedValue(undefined);
    const fallbackLeaf = { setViewState, view: { revealInFolder } };
    harness.app.workspace.getLeavesOfType.mockReturnValue([]);
    (harness.app.workspace.getLeftLeaf as jest.Mock).mockReturnValue(fallbackLeaf);
    harness.controller.selectExplicit(folder.path);

    await harness.controller.activateCurrentContent();

    expect(setViewState).toHaveBeenCalledWith({ type: 'file-explorer', active: true });
    expect(harness.app.workspace.revealLeaf).toHaveBeenCalledWith(fallbackLeaf);
    expect(revealInFolder).toHaveBeenCalledWith(folder);
  });

});
