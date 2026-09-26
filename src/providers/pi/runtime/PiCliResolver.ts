import { CachedProviderCliResolver } from '../../../core/providers/cli/CachedProviderCliResolver';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { getPiProviderSettings } from '../settings';

export class PiCliResolver {
  private readonly resolver = new CachedProviderCliResolver({
    binaryName: 'pi',
    getSettingsProjection: (settings) => {
      const providerSettings = getPiProviderSettings(settings);
      return {
        cliPathsByHost: providerSettings.cliPathsByHost,
        environmentText: getRuntimeEnvironmentText(settings, 'pi'),
      };
    },
    providerId: 'pi',
  });

  resolveFromSettings(settings: Record<string, unknown>): string | null {
    return this.resolver.resolveFromSettings(settings);
  }

  reset(): void {
    this.resolver.reset();
  }
}
