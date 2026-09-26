import { CachedProviderCliResolver } from '../../../core/providers/cli/CachedProviderCliResolver';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { getGrokProviderSettings } from '../settings';

export class GrokCliResolver {
  private readonly resolver = new CachedProviderCliResolver({
    binaryName: 'grok',
    getSettingsProjection: (settings) => {
      const providerSettings = getGrokProviderSettings(settings);
      return {
        cliPathsByHost: providerSettings.cliPathsByHost,
        environmentText: getRuntimeEnvironmentText(settings, 'grok'),
      };
    },
    providerId: 'grok',
  });

  resolveFromSettings(settings: Record<string, unknown>): string | null {
    return this.resolver.resolveFromSettings(settings);
  }

  reset(): void {
    this.resolver.reset();
  }
}
