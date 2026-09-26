import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  OPENCODE_SAFE_MODE_ID,
  OPENCODE_YOLO_MODE_ID,
} from '../../../../src/providers/opencode/modes';
import {
  buildOpencodeManagedConfig,
  prepareOpencodeLaunchArtifacts,
} from '../../../../src/providers/opencode/runtime/OpencodeLaunchArtifacts';

describe('buildOpencodeManagedConfig', () => {
  it('pins OpenCode build, YOLO, and safe prompts to the managed prompt file', () => {
    expect(buildOpencodeManagedConfig({}, '/vault/.grandemonium/opencode/system.md', 'Yishen')).toEqual({
      $schema: 'https://opencode.ai/config.json',
      agent: {
        plan: { disable: true },
        build: {
          prompt: '{file:/vault/.grandemonium/opencode/system.md}',
        },
        [OPENCODE_YOLO_MODE_ID]: {
          mode: 'primary',
          permission: {
            plan_enter: 'deny',
            question: 'allow',
          },
          prompt: '{file:/vault/.grandemonium/opencode/system.md}',
        },
        [OPENCODE_SAFE_MODE_ID]: {
          mode: 'primary',
          permission: {
            bash: 'ask',
            edit: 'ask',
            plan_enter: 'deny',
            question: 'allow',
          },
          prompt: '{file:/vault/.grandemonium/opencode/system.md}',
        },
      },
      username: 'Yishen',
    });
  });

  it('can create a dedicated aux agent and default it for the process', () => {
    expect(buildOpencodeManagedConfig(
      {},
      '/vault/.grandemonium/opencode/auxiliary/system.md',
      undefined,
      [{
        definition: {
          mode: 'primary',
          permission: {
            '*': 'deny',
            read: 'allow',
          },
        },
        id: 'grandemonium-aux-readonly',
      }],
      'grandemonium-aux-readonly',
    )).toEqual({
      $schema: 'https://opencode.ai/config.json',
      agent: {
        plan: { disable: true },
        'grandemonium-aux-readonly': {
          mode: 'primary',
          permission: {
            '*': 'deny',
            read: 'allow',
          },
          prompt: '{file:/vault/.grandemonium/opencode/auxiliary/system.md}',
        },
      },
      default_agent: 'grandemonium-aux-readonly',
    });
  });

  it.each([
    undefined,
    [{ id: 'grandemonium-aux-readonly', definition: { permission: { '*': 'deny' } } }],
  ])('disables the native plan agent while preserving user agent configuration', (managedAgents) => {
    const baseConfig = {
      agent: {
        plan: { disable: false, model: 'anthropic/claude-sonnet-4' },
        reviewer: { description: 'Review changes', mode: 'subagent' },
      },
      command: { discuss: { agent: 'plan', template: 'Discuss the change' } },
    };

    const config = buildOpencodeManagedConfig(
      baseConfig,
      '/vault/.grandemonium/opencode/system.md',
      undefined,
      managedAgents,
    );

    expect(config.agent).toMatchObject({
      plan: { disable: true, model: 'anthropic/claude-sonnet-4' },
      reviewer: { description: 'Review changes', mode: 'subagent' },
    });
    expect(config.command).toEqual(baseConfig.command);
    expect(baseConfig.agent.plan.disable).toBe(false);
  });

  it('merges the user config instead of replacing it', () => {
    expect(buildOpencodeManagedConfig({
      agent: {
        build: {
          model: 'openai/gpt-5',
          permission: {
            bash: 'ask',
            edit: 'ask',
          },
        },
      },
      default_agent: 'build',
      providers: {
        openai: {
          api_key: 'test-key',
        },
      },
      username: 'Existing',
    }, '/vault/.grandemonium/opencode/system.md')).toEqual({
      $schema: 'https://opencode.ai/config.json',
      agent: {
        plan: { disable: true },
        build: {
          model: 'openai/gpt-5',
          permission: {
            bash: 'ask',
            edit: 'ask',
          },
          prompt: '{file:/vault/.grandemonium/opencode/system.md}',
        },
        [OPENCODE_YOLO_MODE_ID]: {
          mode: 'primary',
          permission: {
            plan_enter: 'deny',
            question: 'allow',
          },
          prompt: '{file:/vault/.grandemonium/opencode/system.md}',
        },
        [OPENCODE_SAFE_MODE_ID]: {
          mode: 'primary',
          permission: {
            bash: 'ask',
            edit: 'ask',
            plan_enter: 'deny',
            question: 'allow',
          },
          prompt: '{file:/vault/.grandemonium/opencode/system.md}',
        },
      },
      default_agent: 'build',
      providers: {
        openai: {
          api_key: 'test-key',
        },
      },
      username: 'Existing',
    });
  });
});

describe('prepareOpencodeLaunchArtifacts', () => {
  it('layers the managed prompt config on top of OPENCODE_CONFIG', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'grandemonium-opencode-artifacts-'));
    const baseConfigPath = path.join(tmpRoot, 'opencode.base.json');
    await fs.writeFile(baseConfigPath, JSON.stringify({
      agent: {
        build: {
          model: 'openai/gpt-5',
        },
      },
      default_agent: 'build',
      providers: {
        anthropic: {
          api_key: 'anthropic-key',
        },
      },
    }), 'utf8');

    const result = await prepareOpencodeLaunchArtifacts({
      runtimeEnv: {
        HOME: tmpRoot,
        OPENCODE_CONFIG: baseConfigPath,
      } as NodeJS.ProcessEnv,
      settings: {
        customPrompt: '',
        mediaFolder: '',
        userName: 'Yishen',
        vaultPath: tmpRoot,
      },
      workspaceRoot: tmpRoot,
    });

    expect(result.configPath).toBe(path.join(tmpRoot, '.grandemonium', 'opencode', 'config.json'));
    expect(result.systemPromptPath).toBe(path.join(tmpRoot, '.grandemonium', 'opencode', 'system.md'));
    expect(result.configContent).toContain(`"prompt": "{file:${result.systemPromptPath}}"`);
    const generatedConfig = JSON.parse(await fs.readFile(result.configPath, 'utf8'));
    expect(generatedConfig).toMatchObject({
      default_agent: 'build',
      providers: {
        anthropic: {
          api_key: 'anthropic-key',
        },
      },
      username: 'Yishen',
    });
    expect(generatedConfig.agent).toMatchObject({
      build: {
        model: 'openai/gpt-5',
        prompt: `{file:${result.systemPromptPath}}`,
      },
      [OPENCODE_YOLO_MODE_ID]: {
        mode: 'primary',
        permission: {
          plan_enter: 'deny',
          question: 'allow',
        },
        prompt: `{file:${result.systemPromptPath}}`,
      },
      [OPENCODE_SAFE_MODE_ID]: {
        mode: 'primary',
        permission: {
          bash: 'ask',
          edit: 'ask',
          plan_enter: 'deny',
          question: 'allow',
        },
        prompt: `{file:${result.systemPromptPath}}`,
      },
    });
  });

  it('keeps the launch key stable when the resolved default database is later passed as OPENCODE_DB', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'grandemonium-opencode-artifacts-'));
    const baseParams = {
      settings: {
        customPrompt: '',
        mediaFolder: '',
        userName: '',
        vaultPath: tmpRoot,
      },
      workspaceRoot: tmpRoot,
    };
    const first = await prepareOpencodeLaunchArtifacts({
      ...baseParams,
      runtimeEnv: {
        HOME: tmpRoot,
      } as NodeJS.ProcessEnv,
    });

    const second = await prepareOpencodeLaunchArtifacts({
      ...baseParams,
      runtimeEnv: {
        HOME: tmpRoot,
        OPENCODE_DB: first.databasePath ?? undefined,
      } as NodeJS.ProcessEnv,
    });

    expect(first.databasePath).toBe(second.databasePath);
    expect(first.launchKey).toBe(second.launchKey);
  });

  it('includes provider-default dynamic sections in the managed prompt and launch key', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'grandemonium-opencode-artifacts-'));
    const baseParams = {
      runtimeEnv: { HOME: tmpRoot } as NodeJS.ProcessEnv,
      settings: {
        customPrompt: '',
        mediaFolder: '',
        userName: '',
        vaultPath: tmpRoot,
      },
      workspaceRoot: tmpRoot,
    };

    const withoutAppendix = await prepareOpencodeLaunchArtifacts(baseParams);
    const withAppendix = await prepareOpencodeLaunchArtifacts({
      ...baseParams,
      dynamicSystemPromptSections: ['## Dynamic Section\nRuntime guidance.'],
    });
    const prompt = await fs.readFile(withAppendix.systemPromptPath, 'utf8');

    expect(prompt).toContain('## Runtime Context');
    expect(prompt).toContain('## Dynamic Section\nRuntime guidance.');
    expect(prompt.match(/## Dynamic Section/g)).toHaveLength(1);
    expect(withAppendix.launchKey).not.toBe(withoutAppendix.launchKey);
  });

  it('creates the resolved OpenCode database directory before launch', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'grandemonium-opencode-artifacts-'));
    const xdgDataHome = path.join(tmpRoot, 'xdg-data');
    const databaseDir = path.join(xdgDataHome, 'opencode');

    const result = await prepareOpencodeLaunchArtifacts({
      runtimeEnv: {
        HOME: path.join(tmpRoot, 'home'),
        XDG_DATA_HOME: xdgDataHome,
      } as NodeJS.ProcessEnv,
      settings: {
        customPrompt: '',
        mediaFolder: '',
        userName: '',
        vaultPath: tmpRoot,
      },
      workspaceRoot: tmpRoot,
    });

    expect(result.databasePath).toBe(path.join(databaseDir, 'opencode.db'));
    await expect(fs.access(databaseDir)).resolves.toBeUndefined();
  });
});
