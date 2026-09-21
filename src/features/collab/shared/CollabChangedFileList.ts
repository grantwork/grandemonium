import type { CollabChangedFile, CollabFileChangeKind } from '@claudian-collab/protocol';

export interface CollabChangedFileListOptions {
  readonly accessibleLabel: string;
  readonly container: HTMLElement;
  readonly files: readonly CollabChangedFile[];
  readonly focusOnSelect: boolean;
  readonly onSelect: (path: string) => void;
  readonly selectedPath?: string | null;
  readonly semantics: 'flat' | 'list';
}

export function renderCollabChangedFileList(
  options: CollabChangedFileListOptions,
): HTMLDivElement | HTMLUListElement {
  const list = options.semantics === 'list'
    ? options.container.createEl('ul', {
      attr: { 'aria-label': options.accessibleLabel },
      cls: 'grandemonium-collab-file-list grandemonium-collab-file-list--list',
    })
    : options.container.createDiv({
      attr: {
        'aria-label': options.accessibleLabel,
        role: 'group',
      },
      cls: 'grandemonium-collab-file-list grandemonium-collab-file-list--flat',
    });

  for (const file of options.files) {
    const row = options.semantics === 'list' ? list.createEl('li') : list;
    const button = row.createEl('button', {
      attr: {
        'aria-pressed': String(options.selectedPath === file.path),
        'data-path': file.path,
        type: 'button',
      },
      cls: 'grandemonium-collab-file-button',
    });
    button.createSpan({
      attr: { 'data-kind': file.kind },
      cls: 'grandemonium-collab-file-kind',
      text: collabFileKindCode(file.kind),
    });
    button.createSpan({
      cls: 'grandemonium-collab-file-path',
      text: file.path,
    });
    button.addEventListener('click', () => {
      updateSelection(list, file.path);
      options.onSelect(file.path);
      if (options.focusOnSelect) button.focus();
    });
  }

  return list;
}

function updateSelection(container: HTMLElement, selectedPath: string): void {
  for (const candidate of container.querySelectorAll<HTMLButtonElement>(
    '.grandemonium-collab-file-button[data-path]',
  )) {
    candidate.setAttribute(
      'aria-pressed',
      String(candidate.dataset.path === selectedPath),
    );
  }
}

function collabFileKindCode(kind: CollabFileChangeKind): string {
  switch (kind) {
    case 'added': return 'A';
    case 'modified': return 'M';
    case 'deleted': return 'D';
    case 'renamed': return 'R';
    case 'copied': return 'C';
    case 'type-changed': return 'T';
  }
}
