/** @jest-environment jsdom */

import { within } from '@testing-library/dom';
import { axe } from 'jest-axe';

import { renderThreadActivity } from '@/features/comments/threadStatus';

HTMLElement.prototype.addClass = function (...classes) { this.classList.add(...classes); };

const host = { formatTimestamp: () => 'just now', paintAuthor: () => undefined };

it("shows a failed review's error under the thread, then each AI still replying", async () => {
  const parent = document.createElement('div');

  renderThreadActivity(
    parent,
    {
      errors: [{ author: 'gpt', text: "Couldn't finish: Rate limit reached", ts: '2026-09-25T03:00:00.000Z' }],
      replying: ['claude'],
    },
    host
  );

  const error = within(parent).getByText("Couldn't finish: Rate limit reached").closest<HTMLElement>('.grandemonium-comment-entry')!;
  expect(within(error).getByRole('img', { name: 'Error' })).toBeTruthy();
  expect(within(error).getByText('gpt')).toBeTruthy();
  const replying = within(parent).getByRole('status', { name: 'claude is replying' });
  expect(replying.closest('.grandemonium-comment-entry')?.textContent).toContain('claude');
  // A component checked on its own has no page landmarks around it.
  expect(await axe(parent, { rules: { region: { enabled: false } } })).toHaveNoViolations();
});
