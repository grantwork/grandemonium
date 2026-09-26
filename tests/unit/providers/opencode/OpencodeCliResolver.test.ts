import * as fs from 'fs';
import * as path from 'path';

import { OpencodeCliResolver } from '@/providers/opencode/runtime/OpencodeCliResolver';

jest.mock('fs');
jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => 'current-host',
}));

const mockedStat = fs.statSync as jest.Mock;

function settingsWith(
  cliPathsByHost: Record<string, string>,
  envText = '',
): Record<string, unknown> {
  return {
    sharedEnvironmentVariables: envText,
    providerConfigs: { opencode: { cliPathsByHost } },
  };
}

describe('OpencodeCliResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
  });

  it('uses the current host path instead of another synced host path', () => {
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === '/current/opencode') {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });

    const resolver = new OpencodeCliResolver();
    const resolved = resolver.resolveFromSettings(settingsWith({
      'other-host': '/other/opencode',
      'current-host': '/current/opencode',
    }));

    expect(resolved).toBe('/current/opencode');
  });

  it('returns null when only another host has a path and PATH has no binary', () => {
    mockedStat.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const resolver = new OpencodeCliResolver();
    const resolved = resolver.resolveFromSettings(settingsWith({
      'other-host': '/other/opencode',
    }));

    expect(resolved).toBeNull();
  });

  it('falls back to PATH lookup when no OpenCode CLI path is configured', () => {
    const pathDir = '/custom/bin';
    const pathBinary = path.join(pathDir, 'opencode');
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === pathBinary) {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });

    const resolver = new OpencodeCliResolver();
    const resolved = resolver.resolveFromSettings(settingsWith({}, `PATH=${pathDir}`));

    expect(resolved).toBe(pathBinary);
  });

  it('caches null settings resolutions until reset', () => {
    mockedStat.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const resolver = new OpencodeCliResolver();
    const settings = { providerConfigs: { opencode: {} } };

    expect(resolver.resolveFromSettings(settings)).toBeNull();
    const firstCallCount = mockedStat.mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);
    expect(resolver.resolveFromSettings(settings)).toBeNull();
    expect(mockedStat).toHaveBeenCalledTimes(firstCallCount);

    resolver.reset();
    expect(resolver.resolveFromSettings(settings)).toBeNull();
    expect(mockedStat.mock.calls.length).toBeGreaterThan(firstCallCount);
  });
});
