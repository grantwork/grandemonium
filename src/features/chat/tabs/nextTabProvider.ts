import type { ProviderId } from '../../../core/providers/types';

/**
 * Picks the provider a new tab should open, given the enabled providers in
 * their presentation order and the providers that already own a tab.
 *
 * Tabs are one per enabled provider, so this returns null when every enabled
 * provider is already open and the New tab action has nothing left to create.
 */
export function selectNextTabProvider(
  enabledProviderIds: readonly ProviderId[],
  openProviderIds: readonly ProviderId[],
): ProviderId | null {
  const open = new Set(openProviderIds);
  return enabledProviderIds.find(providerId => !open.has(providerId)) ?? null;
}
