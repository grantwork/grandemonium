import * as fs from 'fs';

import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { getHostnameKey, parseEnvironmentVariables } from '../../../utils/env';
import { normalizeConfiguredCliPath } from '../../../utils/path';
import { findClaudeCLIPath } from '../cli/findClaudeCLIPath';
import { getClaudeProviderSettings } from '../settings';

export class ClaudeCliResolver {
  private resolvedPath: string | null = null;
  private lastHostnamePath = '';
  private lastEnvText = '';
  private readonly cachedHostname = getHostnameKey();

  /**
   * Resolves the CLI path from this device's configured path, then auto-detection.
   * @param settings Full app settings bag
   */
  resolveFromSettings(settings: Record<string, unknown>): string | null {
    const claudeSettings = getClaudeProviderSettings(settings);
    const hostnamePath = (claudeSettings.cliPathsByHost[this.cachedHostname] ?? '').trim();
    const normalizedEnv = getRuntimeEnvironmentText(settings, 'claude');

    if (
      this.resolvedPath &&
      hostnamePath === this.lastHostnamePath &&
      normalizedEnv === this.lastEnvText
    ) {
      return this.resolvedPath;
    }

    this.lastHostnamePath = hostnamePath;
    this.lastEnvText = normalizedEnv;

    this.resolvedPath = resolveClaudeCliPath(hostnamePath, normalizedEnv);
    return this.resolvedPath;
  }

  reset(): void {
    this.resolvedPath = null;
    this.lastHostnamePath = '';
    this.lastEnvText = '';
  }
}

function resolveConfiguredPath(rawPath: string | undefined): string | null {
  try {
    const expanded = normalizeConfiguredCliPath(rawPath);
    if (!expanded) return null;
    if (fs.existsSync(expanded) && fs.statSync(expanded).isFile()) {
      return expanded;
    }
  } catch {
    // Fall through
  }
  return null;
}

export function resolveClaudeCliPath(
  hostnamePath: string | undefined,
  envText: string,
): string | null {
  return (
    resolveConfiguredPath(hostnamePath) ??
    findClaudeCLIPath(parseEnvironmentVariables(envText || '').PATH)
  );
}
