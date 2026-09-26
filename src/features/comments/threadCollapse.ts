import { setIcon } from 'obsidian';

import { plainText } from './inboxModel';
import { renderErrorIcon } from './threadStatus';

/**
 * Which entries of a thread stay open. A long exchange is read for three
 * things: what was first asked, what the reader last said, and what the AIs
 * answered to it. Everything between is history, one click away.
 */
export function keptThreadEntries(
  thread: readonly { author: string }[],
  isAgentAuthor: (author: string) => boolean
): boolean[] {
  let lastHuman = 0;
  thread.forEach((entry, index) => {
    if (!isAgentAuthor(entry.author)) lastHuman = index;
  });
  return thread.map((_entry, index) => index === 0 || index >= lastHuman);
}

/** A folded entry: one line of its author and plain text, pressed to open it. */
export function renderCollapsedEntry(
  parent: HTMLElement,
  entry: { author: string; text: string; kind?: 'error' },
  onExpand: () => void
): HTMLButtonElement {
  const error = entry.kind === 'error';
  const button = parent.createEl('button', {
    cls: error ? 'grandemonium-comment-entry-collapsed grandemonium-comment-entry-error' : 'grandemonium-comment-entry-collapsed',
    attr: {
      'aria-expanded': 'false',
      'aria-label': `Show ${error ? 'error from' : 'comment by'} ${entry.author}`,
      type: 'button',
    },
  });
  setIcon(button.createSpan({ cls: 'grandemonium-comment-entry-collapsed-icon' }), 'chevron-right');
  if (error) renderErrorIcon(button);
  button.createSpan({ cls: 'grandemonium-comment-author', text: entry.author });
  button.createSpan({
    cls: 'grandemonium-comment-entry-collapsed-text',
    text: plainText(entry.text).replace(/\s+/g, ' ').trim(),
  });
  button.onclick = onExpand;
  return button;
}

/**
 * The author and time of an entry the reader opened from its folded line,
 * pressed to fold it back. The caller fills it with the author and time, so it
 * reads as the entry's ordinary heading. Only history gets one: the entries
 * kept open are the ones the thread is read for.
 */
export function renderEntryFoldToggle(
  meta: HTMLElement,
  entry: { author: string; kind?: 'error' },
  onCollapse: () => void
): HTMLButtonElement {
  const button = meta.createEl('button', {
    cls: 'grandemonium-comment-entry-fold',
    attr: {
      'aria-expanded': 'true',
      'aria-label': `Hide ${entry.kind === 'error' ? 'error from' : 'comment by'} ${entry.author}`,
      type: 'button',
    },
  });
  setIcon(button.createSpan({ cls: 'grandemonium-comment-entry-collapsed-icon' }), 'chevron-down');
  button.onclick = onCollapse;
  return button;
}
