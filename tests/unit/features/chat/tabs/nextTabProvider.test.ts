import { selectNextTabProvider } from '@/features/chat/tabs/nextTabProvider';

describe('selectNextTabProvider', () => {
  it('opens the first enabled provider when nothing is open', () => {
    expect(selectNextTabProvider(['claude', 'codex'], [])).toBe('claude');
  });

  it('skips a provider that already owns a tab', () => {
    expect(selectNextTabProvider(['claude', 'codex'], ['claude'])).toBe('codex');
  });

  it('returns null once every enabled provider owns a tab', () => {
    expect(selectNextTabProvider(['claude', 'codex'], ['codex', 'claude'])).toBeNull();
  });

  it('returns null when no provider is enabled', () => {
    expect(selectNextTabProvider([], [])).toBeNull();
  });

  it('ignores open tabs whose provider is no longer enabled', () => {
    expect(selectNextTabProvider(['codex'], ['claude'])).toBe('codex');
  });
});
