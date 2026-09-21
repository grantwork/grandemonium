import type { ProviderId } from '../../../core/providers/types';

/**
 * Picks the tabs a broadcast prompt should reach: one per enabled provider, so
 * each AI answers once under its own name. Providers without a tab are skipped,
 * and extra tabs sharing a provider do not receive a duplicate.
 */
export function selectProviderBroadcastTargets<T>(
  tabs: readonly T[],
  providerIdOf: (tab: T) => ProviderId,
  enabledProviderIds: readonly ProviderId[],
): T[] {
  const targets: T[] = [];
  for (const providerId of enabledProviderIds) {
    const tab = tabs.find(candidate => providerIdOf(candidate) === providerId);
    if (tab) targets.push(tab);
  }
  return targets;
}
