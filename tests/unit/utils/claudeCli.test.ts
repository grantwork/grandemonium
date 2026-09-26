import * as fs from 'fs';

import { findClaudeCLIPath } from '@/providers/claude/cli/findClaudeCLIPath';
import { ClaudeCliResolver, resolveClaudeCliPath } from '@/providers/claude/runtime/ClaudeCliResolver';
import { getHostnameKey } from '@/utils/env';

jest.mock('fs');
jest.mock('@/utils/env', () => {
  const actual = jest.requireActual('@/utils/env');
  return {
    ...actual,
    getHostnameKey: jest.fn(() => 'test-host'),
  };
});
jest.mock('@/providers/claude/cli/findClaudeCLIPath', () => {
  const actual = jest.requireActual('@/providers/claude/cli/findClaudeCLIPath');
  return {
    ...actual,
    findClaudeCLIPath: jest.fn(),
  };
});

const mockedExists = fs.existsSync as jest.Mock;
const mockedStat = fs.statSync as jest.Mock;
const mockedFind = findClaudeCLIPath as jest.Mock;
const mockedDeviceKey = getHostnameKey as jest.Mock;

function settingsWith(
  cliPathsByHost: Record<string, string>,
  envText = '',
): Record<string, unknown> {
  return {
    sharedEnvironmentVariables: envText,
    providerConfigs: { claude: { cliPathsByHost } },
  };
}

describe('ClaudeCliResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedDeviceKey.mockReturnValue('test-host');
  });

  describe('hostname-based resolution', () => {
    it('should use the current host path when available', () => {
      mockedExists.mockImplementation((p: string) => p === '/hostname/claude');
      mockedStat.mockReturnValue({ isFile: () => true });

      const resolver = new ClaudeCliResolver();
      const resolved = resolver.resolveFromSettings(settingsWith({
        'other-host': '/other/claude',
        'test-host': '/hostname/claude',
      }));

      expect(resolved).toBe('/hostname/claude');
    });

    it('should auto-detect when only another host has a path', () => {
      mockedExists.mockReturnValue(false);
      mockedFind.mockReturnValue('/auto/claude');

      const resolver = new ClaudeCliResolver();
      const resolved = resolver.resolveFromSettings(settingsWith({
        'other-host': '/other/claude',
      }));

      expect(resolved).toBe('/auto/claude');
      expect(mockedExists).not.toHaveBeenCalledWith('/other/claude');
    });

    it('should auto-detect when no paths configured', () => {
      mockedExists.mockReturnValue(false);
      mockedFind.mockReturnValue('/auto/claude');

      const resolver = new ClaudeCliResolver();
      const resolved = resolver.resolveFromSettings(settingsWith({}));

      expect(resolved).toBe('/auto/claude');
      expect(mockedFind).toHaveBeenCalled();
    });
  });

  describe('caching', () => {
    it('should cache resolved path and return same result', () => {
      mockedExists.mockImplementation((p: string) => p === '/hostname/claude');
      mockedStat.mockReturnValue({ isFile: () => true });

      const resolver = new ClaudeCliResolver();
      const settings = settingsWith({ 'test-host': '/hostname/claude' });
      const first = resolver.resolveFromSettings(settings);
      const second = resolver.resolveFromSettings(settings);

      expect(first).toBe('/hostname/claude');
      expect(second).toBe('/hostname/claude');
      // existsSync should be called only once due to caching
      expect(mockedExists).toHaveBeenCalledTimes(1);
    });

    it('should invalidate cache when hostname path changes', () => {
      mockedExists.mockReturnValue(true);
      mockedStat.mockReturnValue({ isFile: () => true });

      const resolver = new ClaudeCliResolver();
      const first = resolver.resolveFromSettings(settingsWith({ 'test-host': '/hostname/claude1' }));
      const second = resolver.resolveFromSettings(settingsWith({ 'test-host': '/hostname/claude2' }));

      expect(first).toBe('/hostname/claude1');
      expect(second).toBe('/hostname/claude2');
    });

    it('should clear cache on reset()', () => {
      mockedExists.mockReturnValue(true);
      mockedStat.mockReturnValue({ isFile: () => true });

      const resolver = new ClaudeCliResolver();
      const settings = settingsWith({ 'test-host': '/hostname/claude' });
      resolver.resolveFromSettings(settings);

      resolver.reset();

      resolver.resolveFromSettings(settings);

      // Should be called twice because cache was cleared
      expect(mockedExists).toHaveBeenCalledTimes(2);
    });
  });
});

describe('resolveClaudeCliPath', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return hostname path when valid file exists', () => {
    mockedExists.mockImplementation((p: string) => p === '/hostname/claude');
    mockedStat.mockReturnValue({ isFile: () => true });

    const result = resolveClaudeCliPath('/hostname/claude', '');

    expect(result).toBe('/hostname/claude');
  });

  it('should skip hostname path if it is a directory', () => {
    mockedExists.mockReturnValue(true);
    mockedStat.mockReturnValue({ isFile: () => false });
    mockedFind.mockReturnValue('/auto/claude');

    const result = resolveClaudeCliPath('/hostname/claude', '');

    expect(result).toBe('/auto/claude');
  });

  it('should trim whitespace from paths', () => {
    mockedExists.mockImplementation((p: string) => p === '/hostname/claude');
    mockedStat.mockReturnValue({ isFile: () => true });

    const result = resolveClaudeCliPath('  /hostname/claude  ', '');

    expect(result).toBe('/hostname/claude');
  });

  it('should handle an undefined hostname path', () => {
    mockedExists.mockReturnValue(false);
    mockedFind.mockReturnValue('/auto/claude');

    const result = resolveClaudeCliPath(undefined, '');

    expect(result).toBe('/auto/claude');
  });

  it('should fall through hostname path when existsSync returns false', () => {
    mockedExists.mockReturnValue(false);
    mockedFind.mockReturnValue('/auto/claude');

    const result = resolveClaudeCliPath('/nonexistent/claude', '');

    expect(result).toBe('/auto/claude');
  });

  it('should fall through hostname path when existsSync throws', () => {
    mockedExists.mockImplementation(() => {
      throw new Error('Access denied');
    });
    mockedFind.mockReturnValue('/auto/claude');

    const result = resolveClaudeCliPath('/nonexistent/claude', '');

    expect(result).toBe('/auto/claude');
  });

  it('should pass env PATH to findClaudeCLIPath', () => {
    mockedExists.mockReturnValue(false);
    mockedFind.mockReturnValue(null);

    resolveClaudeCliPath('', 'PATH=/custom/bin');

    expect(mockedFind).toHaveBeenCalledWith('/custom/bin');
  });
});
