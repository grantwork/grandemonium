/** @jest-environment jsdom */

import { fireEvent, screen } from '@testing-library/dom';

import { UnsentInputs } from '@/features/comments/UnsentInputs';

/**
 * Stands in for the sidebar: every redraw throws the old boxes away and builds
 * new ones, the way `CommentSidebar.render` does whenever any note is saved.
 */
function sidebar(inputs: UnsentInputs, keys: string[] = ['reply a']) {
  const root = document.body.appendChild(document.createElement('div'));
  let shown = keys;
  const redraw = (): void =>
    inputs.rebuild(() => {
      root.replaceChildren();
      for (const key of shown) {
        const box = root.appendChild(document.createElement('textarea'));
        box.setAttribute('aria-label', key);
        inputs.bind(key, box);
      }
    });
  redraw();
  return {
    redraw,
    show(next: string[]): void {
      shown = next;
    },
  };
}

function box(name: string): HTMLTextAreaElement {
  return screen.getByRole('textbox', { name }) as HTMLTextAreaElement;
}

function type(el: HTMLTextAreaElement, value: string): void {
  el.focus();
  fireEvent.input(el, { target: { value } });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  document.body.replaceChildren();
});

it('keeps a half written reply, its focus and its caret when the sidebar redraws', () => {
  const view = sidebar(new UnsentInputs());
  const reply = box('reply a');
  type(reply, 'I think the second paragraph');
  reply.setSelectionRange(8, 13);

  view.redraw();

  const rebuilt = box('reply a');
  expect(rebuilt).not.toBe(reply);
  expect(rebuilt.value).toBe('I think the second paragraph');
  expect(document.activeElement).toBe(rebuilt);
  expect([rebuilt.selectionStart, rebuilt.selectionEnd]).toEqual([8, 13]);
});

it('does not bring back text once it has been sent or cancelled', () => {
  const inputs = new UnsentInputs();
  const view = sidebar(inputs, ['draft']);
  type(box('draft'), 'Tighten this');

  inputs.forget('draft');
  view.redraw();

  expect(box('draft').value).toBe('');
});

it('holds a redraw until dictation has finished writing into the box', async () => {
  const view = sidebar(new UnsentInputs());
  const reply = box('reply a');
  type(reply, 'Move this under');
  fireEvent.compositionStart(reply);

  view.redraw();
  view.redraw();

  expect(box('reply a')).toBe(reply);
  fireEvent.input(reply, { target: { value: 'Move this under the heading' } });
  fireEvent.compositionEnd(reply);
  await flush();

  const rebuilt = box('reply a');
  expect(rebuilt).not.toBe(reply);
  expect(rebuilt.value).toBe('Move this under the heading');
  expect(document.activeElement).toBe(rebuilt);
});

it('does not hold redraws for a box that left the page mid-composition', () => {
  const view = sidebar(new UnsentInputs());
  const reply = box('reply a');
  fireEvent.compositionStart(reply);
  reply.remove();

  view.redraw();

  expect(box('reply a')).not.toBe(reply);
});
