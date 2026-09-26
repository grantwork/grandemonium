import { shouldSubmitComment } from '@/features/comments/sidebarPreferences';

function key(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: 'Enter',
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe('sidebar preferences', () => {
  it('supports Enter or Cmd/Ctrl+Enter submission', () => {
    expect(shouldSubmitComment(key(), 'enter')).toBe(true);
    expect(shouldSubmitComment(key({ shiftKey: true }), 'enter')).toBe(false);
    expect(shouldSubmitComment(key({ metaKey: true }), 'enter')).toBe(false);
    expect(shouldSubmitComment(key(), 'mod-enter')).toBe(false);
    expect(shouldSubmitComment(key({ metaKey: true }), 'mod-enter')).toBe(true);
    expect(shouldSubmitComment(key({ ctrlKey: true }), 'mod-enter')).toBe(true);
  });

  it('leaves Enter to dictation or an IME while it is still composing text', () => {
    expect(shouldSubmitComment(key({ isComposing: true }), 'enter')).toBe(false);
    expect(shouldSubmitComment(key({ isComposing: true, metaKey: true }), 'mod-enter')).toBe(false);
  });
});
