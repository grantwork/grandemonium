import { setIcon, setTooltip } from 'obsidian';

import type { InboxFileGroup, InboxItem, InboxItemKind } from './inboxModel';

/** What a collapsed row asks of the reader, at a glance. */
export const INBOX_ICONS: Record<InboxItemKind, string> = {
  comment: 'message-square',
  rewritten: 'pencil-line',
  suggestion: 'replace',
};

/** Everything a row needs from the plugin, kept narrow so it renders anywhere. */
export interface InboxRowHost {
  /** The author, the latest reply and its timestamp, for the tooltip. */
  describe(item: InboxItem): string;
  now(): number;
  /** Opens the thread in place, below its row. */
  onExpand(): void;
  onResolve(): void;
  /** Opens the note the thread lives in, on its passage. */
  onReveal(): void;
  /** Stops the AIs working on this thread, once the reader has confirmed. */
  onStop(): void;
}

/**
 * How long an AI has been at it. Reviews run for a minute or several, so the
 * first minute is counted in seconds, where it shows the run is alive, and the
 * rest in minutes, where seconds would only flicker.
 */
export function formatWorkingAge(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * Brings every working age under a root up to date in place. The panel cannot
 * simply redraw on a timer: a redraw would throw away a reply being typed.
 */
export function refreshWorkingAges(root: HTMLElement, now: number): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-comment-working-since]'))) {
    const since = Number(el.dataset.commentWorkingSince);
    if (Number.isFinite(since)) el.textContent = formatWorkingAge(now - since);
  }
}

/** Offered only while an AI is working on the thread; it confirms before acting. */
export function renderStopButton(parent: HTMLElement, onStop: () => void): HTMLElement {
  const stop = parent.createEl('button', {
    cls: 'grandemonium-comment-entry-action clickable-icon grandemonium-comment-inbox-stop',
    attr: { 'aria-label': 'Stop the review', type: 'button' },
  });
  setIcon(stop, 'square');
  setTooltip(stop, 'Stop the review');
  stop.onclick = () => onStop();
  return stop;
}

/**
 * One thread, on one line: the passage it marks, and how old it is. The panel is
 * a queue to empty, so a row carries only what picks it out of a list of fifty.
 * The discussion, the author and the full timestamp are one click away in the
 * expanded card, and putting them here is what made the list unreadable.
 */
export function renderInboxRow(
  parent: HTMLElement,
  item: InboxItem,
  host: InboxRowHost
): HTMLElement {
  const wrapper = parent.createDiv({ cls: `grandemonium-comment-inbox-item grandemonium-comment-inbox-${item.kind}` });
  if (item.unread) wrapper.addClass('grandemonium-comment-inbox-unread');

  const row = wrapper.createEl('button', { cls: 'grandemonium-comment-inbox-row', attr: { type: 'button' } });
  setIcon(row.createSpan({ cls: 'grandemonium-comment-inbox-icon' }), INBOX_ICONS[item.kind]);
  row.createSpan({ cls: 'grandemonium-comment-inbox-blurb', text: item.title });
  renderThreadStatus(row, item, host.now());
  setTooltip(row, host.describe(item));

  const actions = wrapper.createDiv({ cls: 'grandemonium-comment-inbox-actions' });
  // A run in flight is the one thing on a row that may need stopping now, so
  // its control is always shown rather than waiting for the pointer.
  if (item.workingSince !== null) {
    wrapper.addClass('grandemonium-comment-inbox-busy');
    renderStopButton(actions, () => host.onStop());
  }
  const resolve = actions.createEl('button', {
    cls: 'grandemonium-comment-entry-action clickable-icon',
    attr: { 'aria-label': 'Resolve', type: 'button' },
  });
  setIcon(resolve, 'check');
  setTooltip(resolve, 'Resolve');
  resolve.onclick = () => host.onResolve();

  const reveal = actions.createEl('button', {
    cls: 'grandemonium-comment-entry-action clickable-icon',
    attr: { 'aria-label': 'Open in note', type: 'button' },
  });
  setIcon(reveal, 'square-arrow-out-up-right');
  setTooltip(reveal, 'Open in note');
  reveal.onclick = () => host.onReveal();

  row.onclick = () => host.onExpand();
  return wrapper;
}

/**
 * Whether the thread has a reply the reader has not seen, and whether an agent
 * is still working on it. A timestamp answered neither question: the reader
 * wants to know which rows have come back, not when they were written.
 */
function renderThreadStatus(row: HTMLElement, item: InboxItem, now: number): void {
  const state = row.createSpan({ cls: 'grandemonium-comment-inbox-status' });
  const unread = state.createSpan({
    cls: item.unread ? 'grandemonium-comment-inbox-read-mark grandemonium-comment-inbox-read-mark-new' : 'grandemonium-comment-inbox-read-mark',
    attr: { 'aria-label': item.unread ? 'New reply' : 'Read' },
  });
  setIcon(unread, item.unread ? 'mail' : 'mail-open');
  // Idle is the resting state of every row, so drawing it would say nothing and
  // cost a column; only work in flight earns a mark.
  if (item.workingSince === null) return;
  const working = state.createSpan({
    cls: 'grandemonium-comment-inbox-working',
    attr: { 'aria-label': 'AI working on this' },
  });
  setIcon(working.createSpan({ cls: 'grandemonium-comment-inbox-working-icon' }), 'loader');
  const age = working.createSpan({
    cls: 'grandemonium-comment-inbox-working-age',
    text: formatWorkingAge(now - item.workingSince),
  });
  age.dataset.commentWorkingSince = String(item.workingSince);
}

/** The head of an opened thread: the same line, still clickable to close it. */
export function renderExpandedHeader(
  parent: HTMLElement,
  item: InboxItem,
  onCollapse: () => void,
  now: () => number = Date.now
): HTMLElement {
  const head = parent.createEl('button', {
    cls: 'grandemonium-comment-inbox-row grandemonium-comment-inbox-expanded-head',
    attr: { 'aria-expanded': 'true', type: 'button' },
  });
  setIcon(head.createSpan({ cls: 'grandemonium-comment-inbox-icon' }), INBOX_ICONS[item.kind]);
  head.createSpan({ cls: 'grandemonium-comment-inbox-blurb', text: item.title });
  renderThreadStatus(head, item, now());
  setIcon(head.createSpan({ cls: 'grandemonium-comment-inbox-collapse' }), 'chevron-up');
  head.onclick = () => onCollapse();
  return head;
}

export interface InboxFileHeaderHost {
  collapsed: boolean;
  onToggle(): void;
}

/**
 * The file a run of threads belongs to. Only the immediate folder is shown: a
 * path like canon/operations/infrastructure/entries is wider than the panel and
 * tells the reader nothing the last segment does not.
 */
export function renderFileHeader(
  parent: HTMLElement,
  group: InboxFileGroup,
  host: InboxFileHeaderHost
): HTMLElement {
  const head = parent.createEl('button', {
    cls: 'grandemonium-comment-file-group',
    attr: { 'aria-expanded': String(!host.collapsed), type: 'button' },
  });
  setIcon(
    head.createSpan({ cls: 'grandemonium-comment-file-chevron' }),
    host.collapsed ? 'chevron-right' : 'chevron-down'
  );
  head.createSpan({ cls: 'grandemonium-comment-file-name', text: group.fileName.replace(/\.md$/, '') });
  if (group.folder) head.createSpan({ cls: 'grandemonium-comment-file-folder', text: group.folder });
  if (group.running) {
    const spinner = head.createSpan({ cls: 'grandemonium-comment-file-running', attr: { 'aria-label': 'Agent working' } });
    setIcon(spinner, 'loader');
  }
  const count = head.createSpan({ cls: 'grandemonium-comment-file-count', text: String(group.items.length) });
  if (group.unreadCount > 0) count.addClass('grandemonium-comment-file-count-unread');
  setTooltip(head, group.folderPath ? `${group.folderPath}/${group.fileName}` : group.fileName);
  head.onclick = () => host.onToggle();
  return head;
}
