/** @jest-environment jsdom */

import { fireEvent, within } from '@testing-library/dom';
import { axe } from 'jest-axe';

import type { InboxFileGroup, InboxItem } from '@/features/comments/inboxModel';
import {
  formatWorkingAge,
  type InboxRowHost,
  refreshWorkingAges,
  renderExpandedHeader,
  renderFileHeader,
  renderInboxRow,
} from '@/features/comments/inboxRow';

HTMLElement.prototype.addClass = function (...classes) { this.classList.add(...classes); };
HTMLElement.prototype.removeClass = function (...classes) { this.classList.remove(...classes); };

const TS = '2026-09-21T09:41:00Z';
const NOW = Date.parse('2026-09-23T10:00:00Z');

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    filePath: 'Optizmo/Pricing.md',
    id: 'c1',
    comment: {
      anchor: { exact: 'billed annually' },
      status: 'open',
      thread: [{ author: 'claude', ts: TS, text: 'Which figure is authoritative?' }],
    },
    resolution: { kind: 'resolved', start: 0, end: 15 },
    kind: 'comment',
    title: 'billed annually at the rate in force',
    blurb: 'Which figure is authoritative?',
    author: 'claude',
    ts: TS,
    at: Date.parse(TS),
    unread: true,
    workingSince: null,
    ...overrides,
  };
}

function host(overrides: Partial<InboxRowHost> = {}): InboxRowHost {
  return {
    describe: () => 'Which figure is authoritative?\n\nclaude · 21 September 2026 09:41',
    now: () => NOW,
    onExpand: jest.fn(),
    onStop: jest.fn(),
    onResolve: jest.fn(),
    onReveal: jest.fn(),
    ...overrides,
  };
}

function group(overrides: Partial<InboxFileGroup> = {}): InboxFileGroup {
  return {
    filePath: 'canon/operations/entries/analytics.md',
    fileName: 'analytics.md',
    folder: 'entries',
    folderPath: 'canon/operations/entries',
    items: [item(), item({ id: 'c2' })],
    unreadCount: 1,
    running: false,
    ...overrides,
  };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('a thread row', () => {
  it('names the thread by its passage, with no date and no discussion', () => {
    const row = renderInboxRow(document.body, item(), host());

    expect(row.textContent).toBe('billed annually at the rate in force');
    expect(row.textContent).not.toContain('claude');
    expect(row.textContent).not.toContain('Which figure');
  });

  it('says whether a thread has a reply the reader has not seen', () => {
    const fresh = renderInboxRow(document.body, item({ unread: true }), host());
    const seen = renderInboxRow(document.body, item({ id: 'c2', unread: false }), host());

    expect(within(fresh).getByLabelText('New reply')).toBeTruthy();
    expect(within(seen).getByLabelText('Read')).toBeTruthy();
  });

  it('shows how long an AI has been working on a thread', () => {
    const row = renderInboxRow(document.body, item({ workingSince: NOW - 90_000 }), host());

    expect(within(row).getByLabelText('AI working on this')).toBeTruthy();
    expect(row.textContent).toContain('1m');
  });

  it('offers a stop while an AI is working, and reports it when pressed', () => {
    const onStop = jest.fn();
    const row = renderInboxRow(document.body, item({ workingSince: NOW - 5_000 }), host({ onStop }));

    fireEvent.click(within(row).getByRole('button', { name: 'Stop the review' }));

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('offers no stop on a thread nobody is working on', () => {
    const row = renderInboxRow(document.body, item({ workingSince: null }), host());

    expect(within(row).queryByRole('button', { name: 'Stop the review' })).toBeNull();
    expect(row.querySelector('.grandemonium-comment-inbox-working')).toBeNull();
  });

  it('keeps the age current without redrawing the row', () => {
    const row = renderInboxRow(document.body, item({ workingSince: NOW - 5_000 }), host());
    expect(row.textContent).toContain('5s');

    refreshWorkingAges(document.body, NOW + 55_000);

    expect(row.textContent).toContain('1m');
  });

  it('opens the thread when the row is activated', () => {
    const onExpand = jest.fn();
    const row = renderInboxRow(document.body, item(), host({ onExpand }));

    fireEvent.click(within(row).getByRole('button', { name: /billed annually/i }));

    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it('keeps naming the passage once opened, and closes from that same line', () => {
    const onCollapse = jest.fn();
    const head = renderExpandedHeader(document.body, item(), onCollapse, () => NOW);

    expect(head.textContent).toContain('billed annually at the rate in force');
    expect(head.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(head);

    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it('offers resolve and open as separate named actions', () => {
    const onResolve = jest.fn();
    const onReveal = jest.fn();
    const row = renderInboxRow(document.body, item(), host({ onResolve, onReveal }));

    fireEvent.click(within(row).getByRole('button', { name: 'Resolve' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Open in note' }));

    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onReveal).toHaveBeenCalledTimes(1);
  });

  it('marks an unread thread and leaves a read one unmarked', () => {
    const unread = renderInboxRow(document.body, item({ unread: true }), host());
    const read = renderInboxRow(document.body, item({ id: 'c2', unread: false }), host());

    expect(unread.classList.contains('grandemonium-comment-inbox-unread')).toBe(true);
    expect(read.classList.contains('grandemonium-comment-inbox-unread')).toBe(false);
  });

  it('distinguishes a suggestion and a rewritten passage from a plain comment', () => {
    const suggestion = renderInboxRow(document.body, item({ kind: 'suggestion' }), host());
    const rewritten = renderInboxRow(document.body, item({ id: 'c2', kind: 'rewritten' }), host());

    expect(suggestion.classList.contains('grandemonium-comment-inbox-suggestion')).toBe(true);
    expect(rewritten.classList.contains('grandemonium-comment-inbox-rewritten')).toBe(true);
  });

  it('keeps every control reachable as a real button', () => {
    const row = renderInboxRow(document.body, item(), host());

    for (const button of within(row).getAllByRole('button')) {
      expect((button as HTMLButtonElement).type).toBe('button');
    }
  });
});

describe('the working age', () => {
  it('counts seconds, then minutes, then hours', () => {
    expect(formatWorkingAge(12_000)).toBe('12s');
    expect(formatWorkingAge(90_000)).toBe('1m');
    expect(formatWorkingAge(3_900_000)).toBe('1h 5m');
  });

  it('never reads as negative when a clock runs behind', () => {
    expect(formatWorkingAge(-4_000)).toBe('0s');
  });
});

describe('a file header', () => {
  it('names the note by its own folder, without the extension or the full path', () => {
    const head = renderFileHeader(document.body, group(), { collapsed: false, onToggle: jest.fn() });

    expect(head.textContent).toBe('analyticsentries2');
  });

  it('reports whether it is open and toggles when activated', () => {
    const onToggle = jest.fn();
    const head = renderFileHeader(document.body, group(), { collapsed: true, onToggle });

    expect(head.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(head);

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('marks the count only while something in the file is unread', () => {
    const fresh = renderFileHeader(document.body, group(), { collapsed: false, onToggle: jest.fn() });
    const stale = renderFileHeader(document.body, group({ unreadCount: 0 }), {
      collapsed: false,
      onToggle: jest.fn(),
    });

    expect(fresh.querySelector('.grandemonium-comment-file-count-unread')).toBeTruthy();
    expect(stale.querySelector('.grandemonium-comment-file-count-unread')).toBeNull();
  });

  it('shows a working marker only while an agent is running on that file', () => {
    const busy = renderFileHeader(document.body, group({ running: true }), {
      collapsed: false,
      onToggle: jest.fn(),
    });
    const idle = renderFileHeader(document.body, group(), { collapsed: false, onToggle: jest.fn() });

    expect(within(busy).getByLabelText('Agent working')).toBeTruthy();
    expect(idle.querySelector('.grandemonium-comment-file-running')).toBeNull();
  });
});

it('has no detectable accessibility violations', async () => {
  const list = document.body.createDiv();
  renderFileHeader(list, group(), { collapsed: false, onToggle: jest.fn() });
  renderInboxRow(list, item(), host());

  expect(await axe(document.body)).toHaveNoViolations();
});
