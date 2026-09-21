import { selectProviderBroadcastTargets } from '@/features/chat/tabs/promptBroadcast';

interface FakeTab {
  id: string;
  providerId: string;
}

function targets(
  tabs: FakeTab[],
  enabled: string[],
): string[] {
  return selectProviderBroadcastTargets(
    tabs,
    tab => tab.providerId as never,
    enabled as never[],
  ).map(tab => tab.id);
}

describe('selectProviderBroadcastTargets', () => {
  it('picks one tab for each enabled provider', () => {
    const tabs = [
      { id: 'a', providerId: 'claude' },
      { id: 'b', providerId: 'codex' },
    ];

    expect(targets(tabs, ['claude', 'codex'])).toEqual(['a', 'b']);
  });

  it('sends once per provider when several tabs share one', () => {
    const tabs = [
      { id: 'a', providerId: 'claude' },
      { id: 'b', providerId: 'claude' },
    ];

    expect(targets(tabs, ['claude'])).toEqual(['a']);
  });

  it('skips a provider that has no tab', () => {
    const tabs = [{ id: 'a', providerId: 'claude' }];

    expect(targets(tabs, ['claude', 'codex'])).toEqual(['a']);
  });

  it('ignores a tab whose provider is not enabled', () => {
    const tabs = [
      { id: 'a', providerId: 'grok' },
      { id: 'b', providerId: 'claude' },
    ];

    expect(targets(tabs, ['claude'])).toEqual(['b']);
  });

  it('follows the enabled order rather than tab order', () => {
    const tabs = [
      { id: 'a', providerId: 'codex' },
      { id: 'b', providerId: 'claude' },
    ];

    expect(targets(tabs, ['claude', 'codex'])).toEqual(['b', 'a']);
  });

  it('returns nothing when no provider is enabled', () => {
    expect(targets([{ id: 'a', providerId: 'claude' }], [])).toEqual([]);
  });
});
