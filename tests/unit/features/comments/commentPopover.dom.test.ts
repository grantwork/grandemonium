/** @jest-environment jsdom */

import { fireEvent, within } from '@testing-library/dom';
import { axe } from 'jest-axe';

import {
  type CommentPopoverHost,
  renderCommentPopover,
} from '@/features/comments/commentPopover';
import type { ResolvedComment } from '@/features/comments/types';

HTMLElement.prototype.addClass = function (...classes) { this.classList.add(...classes); };
HTMLElement.prototype.removeClass = function (...classes) { this.classList.remove(...classes); };

const TS = '2026-09-18T09:41:00Z';

function comment(overrides: Partial<ResolvedComment['comment']> = {}): ResolvedComment {
  return {
    id: 'c1',
    comment: {
      anchor: { exact: 'Two weeks is optimistic' },
      status: 'open',
      thread: [
        { author: 'Grant', ts: TS, text: 'Optimistic by how much?' },
        { author: 'gpt', ts: TS, text: 'Closer to four, staged.' },
      ],
      ...overrides,
    },
    resolution: { kind: 'resolved', start: 0, end: 23 },
  };
}

function host(overrides: Partial<CommentPopoverHost> = {}): CommentPopoverHost {
  return {
    authorColorOverrides: {},
    colorAuthorNames: true,
    formatTimestamp: () => 'Yesterday 09:41',
    submitOnEnter: true,
    replyDraft: '',
    size: null,
    onReply: jest.fn(),
    onReplyDraftChange: jest.fn(),
    onSizeChange: jest.fn(),
    onResolve: jest.fn(),
    onAcceptSuggestion: jest.fn(),
    onDeclineSuggestion: jest.fn(),
    onOpenSidebar: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  document.body.replaceChildren();
});

it('shows the quote and every thread entry', () => {
  const card = renderCommentPopover(document.body, comment(), host());

  expect(card.textContent).toContain('Two weeks is optimistic');
  expect(card.textContent).toContain('Optimistic by how much?');
  expect(card.textContent).toContain('Closer to four, staged.');
  expect(card.textContent).toContain('gpt');
});

it('sends a reply and clears the box', () => {
  const onReply = jest.fn();
  const card = renderCommentPopover(document.body, comment(), host({ onReply }));
  const box = within(card).getByRole('textbox', { name: /reply/i }) as HTMLTextAreaElement;

  fireEvent.input(box, { target: { value: 'Four weeks, then.' } });
  fireEvent.click(within(card).getByRole('button', { name: /^reply$/i }));

  expect(onReply).toHaveBeenCalledWith('Four weeks, then.');
  expect(box.value).toBe('');
});

it('refuses to send an empty reply', () => {
  const onReply = jest.fn();
  const card = renderCommentPopover(document.body, comment(), host({ onReply }));

  fireEvent.input(within(card).getByRole('textbox', { name: /reply/i }), {
    target: { value: '   ' },
  });
  fireEvent.click(within(card).getByRole('button', { name: /^reply$/i }));

  expect(onReply).not.toHaveBeenCalled();
});

it('sends on Enter when that is the configured shortcut', () => {
  const onReply = jest.fn();
  const card = renderCommentPopover(document.body, comment(), host({ onReply }));
  const box = within(card).getByRole('textbox', { name: /reply/i });

  fireEvent.input(box, { target: { value: 'Agreed.' } });
  fireEvent.keyDown(box, { key: 'Enter' });

  expect(onReply).toHaveBeenCalledWith('Agreed.');
});

it('keeps Enter for newlines when the shortcut is Mod+Enter', () => {
  const onReply = jest.fn();
  const card = renderCommentPopover(
    document.body,
    comment(),
    host({ onReply, submitOnEnter: false }),
  );
  const box = within(card).getByRole('textbox', { name: /reply/i });

  fireEvent.input(box, { target: { value: 'Agreed.' } });
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(onReply).not.toHaveBeenCalled();

  fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
  expect(onReply).toHaveBeenCalledWith('Agreed.');
});

it('resolves the thread and hands off to the sidebar', () => {
  const onResolve = jest.fn();
  const onOpenSidebar = jest.fn();
  const card = renderCommentPopover(document.body, comment(), host({ onResolve, onOpenSidebar }));

  fireEvent.click(within(card).getByRole('button', { name: /resolve/i }));
  fireEvent.click(within(card).getByRole('button', { name: /open in sidebar/i }));

  expect(onResolve).toHaveBeenCalledTimes(1);
  expect(onOpenSidebar).toHaveBeenCalledTimes(1);
});

it('offers no reply box on a resolved thread', () => {
  const card = renderCommentPopover(document.body, comment({ status: 'resolved' }), host());

  expect(within(card).queryByRole('textbox', { name: /reply/i })).toBeNull();
  expect(within(card).queryByRole('button', { name: /resolve/i })).toBeNull();
});

it('has no accessibility violations', async () => {
  const card = renderCommentPopover(document.body, comment(), host());

  expect(await axe(card)).toHaveNoViolations();
});

describe('unsent reply', () => {
  it('restores a draft left behind when the popover was dismissed', () => {
    const card = renderCommentPopover(
      document.body,
      comment(),
      host({ replyDraft: 'Half a thought' }),
    );

    expect(
      (within(card).getByRole('textbox', { name: /reply/i }) as HTMLTextAreaElement).value,
    ).toBe('Half a thought');
  });

  it('reports the draft as it is typed', () => {
    const onReplyDraftChange = jest.fn();
    const card = renderCommentPopover(document.body, comment(), host({ onReplyDraftChange }));

    fireEvent.input(within(card).getByRole('textbox', { name: /reply/i }), {
      target: { value: 'Half a thou' },
    });

    expect(onReplyDraftChange).toHaveBeenLastCalledWith('Half a thou');
  });

  it('drops the draft once the reply is sent', () => {
    const onReplyDraftChange = jest.fn();
    const card = renderCommentPopover(document.body, comment(), host({ onReplyDraftChange }));

    fireEvent.input(within(card).getByRole('textbox', { name: /reply/i }), {
      target: { value: 'Sent.' },
    });
    fireEvent.click(within(card).getByRole('button', { name: /^reply$/i }));

    expect(onReplyDraftChange).toHaveBeenLastCalledWith('');
  });
});

describe('popover size', () => {
  it('opens at the size chosen on an earlier comment', () => {
    const card = renderCommentPopover(
      document.body,
      comment(),
      host({ size: { width: 420, height: 300 } }),
    );

    expect(card.style.width).toBe('420px');
    expect(card.style.height).toBe('300px');
  });

  it('reports a size the reader drags out', () => {
    const onSizeChange = jest.fn();
    const card = renderCommentPopover(document.body, comment(), host({ onSizeChange }));

    card.style.width = '480px';
    card.style.height = '360px';
    fireEvent.mouseUp(card);

    expect(onSizeChange).toHaveBeenCalledWith({ width: 480, height: 360 });
  });

  it('stays quiet when the card was not resized', () => {
    const onSizeChange = jest.fn();
    const card = renderCommentPopover(
      document.body,
      comment(),
      host({ onSizeChange, size: { width: 420, height: 300 } }),
    );

    fireEvent.mouseUp(card);

    expect(onSizeChange).not.toHaveBeenCalled();
  });

  it('lets a restored size override the default height cap', () => {
    const card = renderCommentPopover(
      document.body,
      comment(),
      host({ size: { width: 420, height: 300 } }),
    );

    expect(card.classList.contains('grandemonium-comment-popover-sized')).toBe(true);
  });
});

describe('hover preview', () => {
  it('shows the thread without offering to act on it', () => {
    const card = renderCommentPopover(document.body, comment(), host(), { compact: true });

    expect(card.textContent).toContain('Optimistic by how much?');
    expect(within(card).queryByRole('textbox', { name: /reply/i })).toBeNull();
    expect(within(card).queryByRole('button')).toBeNull();
  });
});

describe('edit suggestions', () => {
  function suggestion(
    overrides: {
      result?: 'accepted' | 'declined';
      replacement?: string;
      resolution?: ResolvedComment['resolution'];
    } = {},
  ): ResolvedComment {
    const base = comment();
    return {
      ...base,
      comment: {
        ...base.comment,
        suggestion: {
          replacement: overrides.replacement ?? 'Four weeks, staged',
          author: 'gpt',
          ts: TS,
          ...(overrides.result ? { result: overrides.result } : {}),
        },
      },
      resolution: overrides.resolution ?? base.resolution,
    };
  }

  it('offers Accept and Decline on an undecided suggestion', () => {
    const onAcceptSuggestion = jest.fn();
    const onDeclineSuggestion = jest.fn();
    const card = renderCommentPopover(
      document.body,
      suggestion(),
      host({ onAcceptSuggestion, onDeclineSuggestion }),
    );

    expect(card.textContent).toContain('Four weeks, staged');
    fireEvent.click(within(card).getByRole('button', { name: /accept/i }));
    fireEvent.click(within(card).getByRole('button', { name: /decline/i }));

    expect(onAcceptSuggestion).toHaveBeenCalledTimes(1);
    expect(onDeclineSuggestion).toHaveBeenCalledTimes(1);
  });

  it('replaces Resolve, which a suggestion does not offer', () => {
    const card = renderCommentPopover(document.body, suggestion(), host());

    expect(within(card).queryByRole('button', { name: /^resolve$/i })).toBeNull();
  });

  it('blocks Accept when the passage cannot be located exactly', () => {
    const orphaned = renderCommentPopover(
      document.body,
      suggestion({ resolution: { kind: 'orphaned' } }),
      host(),
    );
    expect(
      (within(orphaned).getByRole('button', { name: /accept/i }) as HTMLButtonElement).disabled,
    ).toBe(true);

    document.body.replaceChildren();
    const ambiguous = renderCommentPopover(
      document.body,
      suggestion({ resolution: { kind: 'resolved', start: 0, end: 23, ambiguous: true } }),
      host(),
    );
    expect(
      (within(ambiguous).getByRole('button', { name: /accept/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('blocks Accept when there is nothing to put in place', () => {
    const card = renderCommentPopover(document.body, suggestion({ replacement: '' }), host());

    expect(
      (within(card).getByRole('button', { name: /accept/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('offers nothing to decide once the suggestion has been answered', () => {
    const card = renderCommentPopover(
      document.body,
      suggestion({ result: 'accepted' }),
      host(),
    );

    expect(within(card).queryByRole('button', { name: /accept/i })).toBeNull();
    expect(within(card).queryByRole('button', { name: /decline/i })).toBeNull();
  });

  it('leaves a plain comment alone', () => {
    const card = renderCommentPopover(document.body, comment(), host());

    expect(within(card).queryByRole('button', { name: /accept/i })).toBeNull();
    expect(within(card).getByRole('button', { name: /^resolve$/i })).toBeTruthy();
  });
});
