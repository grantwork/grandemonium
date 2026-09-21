import { Setting, type TextComponent } from 'obsidian';

import { resolveAgentName } from '../../core/providers/agentName';

export interface ProviderAgentNameSettingOptions {
  container: HTMLElement;
  /** Name restored when the field is cleared. */
  defaultAgentName: string;
  description?: string;
  getValue: () => string;
  name: string;
  onChange: (agentName: string) => Promise<void> | void;
}

export interface ProviderAgentNameSettingControl {
  setting: Setting;
  text: TextComponent;
}

/**
 * Renders the provider's agent-name field. The name labels that provider's chat
 * tab and is the author it signs review comments with, so the field persists a
 * normalized value and falls back to the provider default when cleared.
 */
export function renderProviderAgentNameSetting(
  options: ProviderAgentNameSettingOptions,
): ProviderAgentNameSettingControl {
  let text!: TextComponent;
  const setting = new Setting(options.container)
    .setName(options.name)
    .setDesc(
      options.description
        ?? 'Shown on this AI\'s chat tab, and the author name it signs review comments with.',
    )
    .addText((component) => {
      text = component;
      component
        .setPlaceholder(options.defaultAgentName)
        .setValue(options.getValue())
        .onChange(async (value) => {
          const normalized = resolveAgentName(value, options.defaultAgentName);
          try {
            await options.onChange(normalized);
          } finally {
            component.setValue(options.getValue());
          }
        });
    });

  const inputElement = (text as TextComponent & { inputEl?: HTMLElement }).inputEl;
  inputElement?.setAttribute?.('aria-label', options.name);

  return { setting, text };
}
