import { CachedProviderCliResolver } from '../../../core/providers/cli/CachedProviderCliResolver';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { getOpencodeProviderSettings } from '../settings';

export class OpencodeCliResolver {
  private readonly resolver = new CachedProviderCliResolver({
    binaryName: 'opencode',
    getSettingsProjection: (settings) => {
      const providerSettings = getOpencodeProviderSettings(settings);
      return {
        cliPathsByHost: providerSettings.cliPathsByHost,
        environmentText: getRuntimeEnvironmentText(settings, 'opencode'),
      };
    },
    providerId: 'opencode',
  });

  resolveFromSettings(settings: Record<string, unknown>): string | null {
    return this.resolver.resolveFromSettings(settings);
  }

  reset(): void {
    this.resolver.reset();
  }
}
