import * as fs from 'fs';
import * as path from 'path';

import { PiCliResolver } from '@/providers/pi/runtime/PiCliResolver';

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
    providerConfigs: { pi: { cliPathsByHost } },
  };
}

describe('PiCliResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
  });

  it('resolves the current host path instead of another synced host path', () => {
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === '/current/pi') {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });

    const resolver = new PiCliResolver();

    expect(resolver.resolveFromSettings(settingsWith({
      'current-host': '/current/pi',
      'other-host': '/other/pi',
    }))).toBe('/current/pi');
  });

  it('falls back to PATH lookup when no Pi CLI path is configured', () => {
    const pathDir = '/custom/bin';
    const pathBinary = path.join(pathDir, 'pi');
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === pathBinary) {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });

    const resolver = new PiCliResolver();

    expect(resolver.resolveFromSettings(settingsWith({}, `PATH=${pathDir}`))).toBe(pathBinary);
  });

  it('invalidates cached resolutions when provider environment changes', () => {
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === '/current/pi') {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });

    const resolver = new PiCliResolver();
    const firstSettings = {
      providerConfigs: {
        pi: {
          cliPathsByHost: {
            'current-host': '/current/pi',
          },
          environmentVariables: 'PI_OFFLINE=0',
        },
      },
    };
    const secondSettings = {
      providerConfigs: {
        pi: {
          cliPathsByHost: {
            'current-host': '/current/pi',
          },
          environmentVariables: 'PI_OFFLINE=1',
        },
      },
    };

    expect(resolver.resolveFromSettings(firstSettings)).toBe('/current/pi');
    expect(resolver.resolveFromSettings(firstSettings)).toBe('/current/pi');
    expect(mockedStat).toHaveBeenCalledTimes(1);

    expect(resolver.resolveFromSettings(secondSettings)).toBe('/current/pi');
    expect(mockedStat).toHaveBeenCalledTimes(2);
  });

  it('caches null settings resolutions until reset', () => {
    mockedStat.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const resolver = new PiCliResolver();
    const settings = { providerConfigs: { pi: {} } };

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
