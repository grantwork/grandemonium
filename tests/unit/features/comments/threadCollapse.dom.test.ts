/** @jest-environment jsdom */

import { fireEvent, within } from '@testing-library/dom';
import { axe } from 'jest-axe';

import { renderCollapsedEntry } from '@/features/comments/threadCollapse';

HTMLElement.prototype.addClass = function (...classes) { this.classList.add(...classes); };

it('shows a collapsed reply as one line that expands when pressed', async () => {
  const parent = document.createElement('div');
  const onExpand = jest.fn();

  renderCollapsedEntry(parent, { author: 'claude', text: '**Two** options:\n\n1. Keep it' }, onExpand);

  const button = within(parent).getByRole('button', { name: 'Show comment by claude' });
  expect(button.getAttribute('aria-expanded')).toBe('false');
  expect(button.textContent).toContain('claude');
  expect(button.textContent).toContain('Two options: Keep it');
  fireEvent.click(button);
  expect(onExpand).toHaveBeenCalled();
  expect(await axe(parent)).toHaveNoViolations();
});
