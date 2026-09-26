import { EditorState } from '@codemirror/state';

import {
  closeCommentPopover,
  commentPopoverTarget,
  openCommentPopover,
  popoverTargetAt,
  popoverTargetFor,
} from '@/features/comments/commentPopover';
import { makeAnchor, serializeDocument } from '@/features/comments/store';

const DOC = 'The quick brown fox jumps over the lazy dog.';
const QUOTE_FROM = DOC.indexOf('brown fox');
const QUOTE_TO = QUOTE_FROM + 'brown fox'.length;

function stateWithPopover(): EditorState {
  const state = EditorState.create({ doc: DOC, extensions: [commentPopoverTarget] });
  return state.update({
    effects: openCommentPopover.of({ id: 'c1', from: QUOTE_FROM, to: QUOTE_TO }),
  }).state;
}

it('pins the popover to the clicked comment', () => {
  expect(stateWithPopover().field(commentPopoverTarget)).toEqual({
    id: 'c1',
    from: QUOTE_FROM,
    to: QUOTE_TO,
  });
});

it('follows the quote when earlier text is edited', () => {
  const state = stateWithPopover().update({
    changes: { from: 0, to: 0, insert: 'Yesterday: ' },
  }).state;

  expect(state.field(commentPopoverTarget)).toEqual({
    id: 'c1',
    from: QUOTE_FROM + 'Yesterday: '.length,
    to: QUOTE_TO + 'Yesterday: '.length,
  });
});

it('keeps the quote pinned when the text inside it is rewritten', () => {
  const state = stateWithPopover().update({
    changes: { from: QUOTE_FROM + 'brown '.length, to: QUOTE_TO, insert: 'hound' },
  }).state;

  expect(state.field(commentPopoverTarget)).toEqual({
    id: 'c1',
    from: QUOTE_FROM,
    to: QUOTE_FROM + 'brown hound'.length,
  });
});

it('dismisses itself when the commented text is deleted', () => {
  const state = stateWithPopover().update({
    changes: { from: QUOTE_FROM, to: QUOTE_TO, insert: '' },
  }).state;

  expect(state.field(commentPopoverTarget)).toBeNull();
});

it('switches to another thread while one is already pinned', () => {
  const second = { id: 'c2', from: 0, to: 3 };
  const state = stateWithPopover().update({ effects: openCommentPopover.of(second) }).state;

  expect(state.field(commentPopoverTarget)).toEqual(second);
});

it('dismisses itself on request', () => {
  const state = stateWithPopover().update({ effects: closeCommentPopover.of(null) }).state;

  expect(state.field(commentPopoverTarget)).toBeNull();
});

describe('popoverTargetFor', () => {
  function docWithComment(prose: string, quote: string): string {
    const start = prose.indexOf(quote);
    return serializeDocument(
      {
        prose,
        comments: {
          c1: {
            anchor: makeAnchor(prose, start, start + quote.length),
            status: 'open',
            thread: [{ author: 'Grant', ts: '2026-09-18T09:41:00Z', text: 'Why?' }],
          },
        },
      },
      false,
    );
  }

  it('locates the commented passage in the live document', () => {
    const text = docWithComment(DOC, 'brown fox');

    expect(popoverTargetFor(text, 'c1')).toEqual({
      id: 'c1',
      from: QUOTE_FROM,
      to: QUOTE_TO,
    });
  });

  it('gives up on an orphaned anchor', () => {
    const text = docWithComment(DOC, 'brown fox').replace('brown fox', 'grey wolf');

    expect(popoverTargetFor(text, 'c1')).toBeNull();
  });

  it('gives up on a comment that is no longer in the document', () => {
    expect(popoverTargetFor(docWithComment(DOC, 'brown fox'), 'gone')).toBeNull();
  });
});

describe('popoverTargetAt', () => {
  function docWith(status: 'open' | 'resolved'): string {
    const start = DOC.indexOf('brown fox');
    return serializeDocument(
      {
        prose: DOC,
        comments: {
          c1: {
            anchor: makeAnchor(DOC, start, start + 'brown fox'.length),
            status,
            thread: [{ author: 'Grant', ts: '2026-09-18T09:41:00Z', text: 'Why?' }],
          },
        },
      },
      false,
    );
  }

  it('finds the thread under the pointer', () => {
    expect(popoverTargetAt(docWith('open'), QUOTE_FROM + 2)).toEqual({
      id: 'c1',
      from: QUOTE_FROM,
      to: QUOTE_TO,
    });
  });

  it('finds nothing beside the highlight', () => {
    expect(popoverTargetAt(docWith('open'), QUOTE_FROM - 2)).toBeNull();
    expect(popoverTargetAt(docWith('open'), QUOTE_TO + 2)).toBeNull();
  });

  it('ignores a resolved thread, which carries no highlight', () => {
    expect(popoverTargetAt(docWith('resolved'), QUOTE_FROM + 2)).toBeNull();
  });
});
