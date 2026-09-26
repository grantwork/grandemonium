import { setTooltip } from 'obsidian';

import { type AuthorColorOverrides, resolveAuthorColor } from './authorColor';

/** Standing choice of who a reply goes to, shown wherever a reply is written. */
export interface ReplyTargetHost {
  /** Agent names of the enabled AIs, in the order they should be offered. */
  names: readonly string[];
  /** The chosen agent name, or "" for every enabled AI. */
  selected: string;
  authorColorOverrides: AuthorColorOverrides;
  colorAuthorNames: boolean;
  onSelect(target: string): void;
}

const EVERY = '';

/**
 * Who the next reply is addressed to, as one row of chips under the box.
 *
 * A picker per reply rather than one for the panel: the reader switches
 * provider mid-thread, most often to have a second AI check the first one's
 * work. Chips rather than a dropdown because that switch is a single click,
 * and each carries its author's colour so it matches the rail the reply it
 * produces will be drawn with. A dropdown would read better past four or five
 * providers, where a row of chips starts to wrap.
 */
export function renderReplyTargets(parent: HTMLElement, host: ReplyTargetHost): HTMLElement {
  const row = parent.createDiv({
    cls: 'grandemonium-comment-reply-targets',
    attr: { 'aria-label': 'Send this reply to', role: 'group' },
  });
  const options = [EVERY, ...host.names];
  for (const name of options) {
    const chosen = name === host.selected;
    const chip = row.createEl('button', {
      cls: 'grandemonium-comment-reply-chip',
      text: name || 'Every AI',
      attr: { 'aria-pressed': String(chosen), type: 'button' },
    });
    if (chosen) chip.addClass('grandemonium-comment-reply-chip-on');
    if (name && host.colorAuthorNames) {
      chip.style.setProperty(
        '--grandemonium-comment-author-color-light',
        resolveAuthorColor(name, host.authorColorOverrides, 'light')
      );
      chip.style.setProperty(
        '--grandemonium-comment-author-color-dark',
        resolveAuthorColor(name, host.authorColorOverrides, 'dark')
      );
      chip.addClass('grandemonium-comment-reply-chip-colored');
    }
    setTooltip(chip, name ? `Send replies to ${name}` : 'Send replies to every enabled AI');
    chip.onclick = () => host.onSelect(name);
  }
  return row;
}
