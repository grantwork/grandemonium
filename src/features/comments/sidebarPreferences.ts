import type { SubmitShortcut } from './CommentsSettings';

interface SubmitKeyEvent {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  isComposing?: boolean;
}

export function shouldSubmitComment(event: SubmitKeyEvent, shortcut: SubmitShortcut): boolean {
  // Enter mid-composition commits the dictated or IME text; it is not a send.
  if (event.key !== 'Enter' || event.isComposing) return false;
  return shortcut === 'enter'
    ? !event.shiftKey && !event.metaKey && !event.ctrlKey
    : event.metaKey || event.ctrlKey;
}
