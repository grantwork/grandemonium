/** @jest-environment jsdom */

jest.mock('obsidian', () => {
  class MockTextComponent {
    inputEl = document.createElement('input');
    value = '';
    private callback: ((value: string) => Promise<void> | void) | null = null;

    onChange(callback: (value: string) => Promise<void> | void): this {
      this.callback = callback;
      return this;
    }

    setPlaceholder(value: string): this {
      this.inputEl.placeholder = value;
      return this;
    }

    setValue(value: string): this {
      this.value = value;
      this.inputEl.value = value;
      return this;
    }

    async trigger(value: string): Promise<void> {
      this.inputEl.value = value;
      await this.callback?.(value);
    }
  }

  class MockSetting {
    desc = '';
    name = '';
    settingEl = document.createElement('div');

    constructor(container: HTMLElement) {
      container.appendChild(this.settingEl);
    }

    addText(callback: (text: MockTextComponent) => void): this {
      callback(new MockTextComponent());
      return this;
    }

    setDesc(desc: string): this {
      this.desc = desc;
      return this;
    }

    setName(name: string): this {
      this.name = name;
      return this;
    }
  }

  return { Setting: MockSetting };
});

import { renderProviderAgentNameSetting } from '@/shared/settings/ProviderAgentNameSetting';

interface TriggerableText {
  inputEl: HTMLInputElement;
  trigger(value: string): Promise<void>;
  value: string;
}

describe('provider agent name setting', () => {
  it('shows the stored name and persists an edited one', async () => {
    let persisted = 'codex';
    const control = renderProviderAgentNameSetting({
      container: document.createElement('div'),
      defaultAgentName: 'codex',
      getValue: () => persisted,
      name: 'Agent name',
      onChange: (agentName) => {
        persisted = agentName;
      },
    });
    const text = control.text as unknown as TriggerableText;

    expect(text.value).toBe('codex');
    expect(text.inputEl.getAttribute('aria-label')).toBe('Agent name');

    await text.trigger('gpt');

    expect(persisted).toBe('gpt');
  });

  it('restores the provider default when the field is cleared', async () => {
    let persisted = 'gpt';
    const control = renderProviderAgentNameSetting({
      container: document.createElement('div'),
      defaultAgentName: 'codex',
      getValue: () => persisted,
      name: 'Agent name',
      onChange: (agentName) => {
        persisted = agentName;
      },
    });
    const text = control.text as unknown as TriggerableText;

    await text.trigger('   ');

    expect(persisted).toBe('codex');
    expect(text.value).toBe('codex');
  });

  it('normalizes a name that would break a badge or a comment author', async () => {
    let persisted = 'claude';
    const control = renderProviderAgentNameSetting({
      container: document.createElement('div'),
      defaultAgentName: 'claude',
      getValue: () => persisted,
      name: 'Agent name',
      onChange: (agentName) => {
        persisted = agentName;
      },
    });
    const text = control.text as unknown as TriggerableText;

    await text.trigger('  big   brain \n');

    expect(persisted).toBe('big brain');
  });
});
