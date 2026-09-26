import * as fs from 'fs';
import * as path from 'path';

import { GrokCliResolver } from '@/providers/grok/runtime/GrokCliResolver';

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
    providerConfigs: { grok: { cliPathsByHost } },
  };
}

describe('GrokCliResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
  });

  it('prefers the current host path over synced paths', () => {
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === '/current/grok' || filePath === '/other/grok') {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });

    expect(new GrokCliResolver().resolveFromSettings(settingsWith({
      'current-host': '/current/grok',
      'other-host': '/other/grok',
    }))).toBe('/current/grok');
  });

  it('falls back to the PATH binary named grok', () => {
    const pathBinary = path.join('/provider/bin', 'grok');
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === pathBinary) {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });
    expect(new GrokCliResolver().resolveFromSettings(settingsWith({}, 'PATH=/provider/bin')))
      .toBe(pathBinary);
  });

  it('uses merged provider settings, caches the result, and can be reset', () => {
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === '/configured/grok') {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });
    const settings = {
      providerConfigs: {
        grok: {
          cliPathsByHost: { 'current-host': '/configured/grok' },
        },
      },
    };
    const resolver = new GrokCliResolver();

    expect(resolver.resolveFromSettings(settings)).toBe('/configured/grok');
    expect(resolver.resolveFromSettings(settings)).toBe('/configured/grok');
    expect(mockedStat.mock.calls.filter(([filePath]) => filePath === '/configured/grok'))
      .toHaveLength(1);

    resolver.reset();
    expect(resolver.resolveFromSettings(settings)).toBe('/configured/grok');
    expect(mockedStat.mock.calls.filter(([filePath]) => filePath === '/configured/grok'))
      .toHaveLength(2);
  });

  it('caches null settings resolutions until reset', () => {
    mockedStat.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const resolver = new GrokCliResolver();
    const settings = { providerConfigs: { grok: {} } };

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
