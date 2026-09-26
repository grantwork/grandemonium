import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderCliResolutionContext } from '../../../core/providers/types';
import { getHostnameKey } from '../../../utils/env';
import { getCodexProviderSettings } from '../settings';
import { resolveCodexCliPath } from './CodexBinaryLocator';
import { resolveCodexExecutionTargetAsync } from './CodexExecutionTargetResolver';
import type { CodexExecutionTarget } from './codexLaunchTypes';

export class CodexCliResolver {
  private resolvedPath: string | null = null;
  private lastHostnamePath = '';
  private lastEnvText = '';
  private lastExecutionTargetKey = '';
  private readonly cachedHostname = getHostnameKey();

  resolveFromSettings(
    settings: Record<string, unknown>,
    context: ProviderCliResolutionContext = {},
  ): string | null | Promise<string | null> {
    const codexSettings = getCodexProviderSettings(settings);
    const hostnamePath = (codexSettings.cliPathsByHost[this.cachedHostname] ?? '').trim();
    const envText = getRuntimeEnvironmentText(settings, 'codex');
    const executionTarget = getCodexExecutionTargetFromContext(context);
    if (executionTarget) {
      return this.resolveAndCache(hostnamePath, envText, executionTarget);
    }

    return resolveCodexExecutionTargetAsync({ settings }).then((resolvedTarget) => (
      this.resolveAndCache(hostnamePath, envText, resolvedTarget)
    ));
  }

  reset(): void {
    this.resolvedPath = null;
    this.lastHostnamePath = '';
    this.lastEnvText = '';
    this.lastExecutionTargetKey = '';
  }

  private resolveAndCache(
    hostnamePath: string,
    envText: string,
    executionTarget: CodexExecutionTarget,
  ): string | null {
    const executionTargetKey = getCodexExecutionTargetCacheKey(executionTarget);

    if (
      this.resolvedPath &&
      hostnamePath === this.lastHostnamePath &&
      envText === this.lastEnvText &&
      executionTargetKey === this.lastExecutionTargetKey
    ) {
      return this.resolvedPath;
    }

    this.lastHostnamePath = hostnamePath;
    this.lastEnvText = envText;
    this.lastExecutionTargetKey = executionTargetKey;

    this.resolvedPath = resolveCodexCliPath(hostnamePath, envText, {
      executionTarget,
    });
    return this.resolvedPath;
  }
}

function isCodexExecutionTarget(value: unknown): value is CodexExecutionTarget {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<CodexExecutionTarget>;
  return candidate.method === 'host-native'
    || candidate.method === 'native-windows'
    || candidate.method === 'wsl';
}

function getCodexExecutionTargetFromContext(
  context: ProviderCliResolutionContext,
): CodexExecutionTarget | null {
  return isCodexExecutionTarget(context.executionTarget)
    ? context.executionTarget
    : null;
}

function getCodexExecutionTargetCacheKey(target: CodexExecutionTarget): string {
  return [
    target.method,
    target.platformFamily,
    target.platformOs,
    target.distroName ?? '',
  ].join(':');
}
