import { getProviderSettingsSnapshotWithModel, normalizeProviderModelSelection } from '../../../core/providers/conversationModel';
import { getEnabledProviderForModel } from '../../../core/providers/modelRouting';
import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import type { ProviderChatUIConfig, ProviderId } from '../../../core/providers/types';
import type { UsageInfo } from '../../../core/types';
import type { FeatureHost } from '../../FeatureHost';
import { getBlankTabModelOptions, type TabProviderSettings } from '../tabs/TabProviderState';
import { createInputToolbar } from './InputToolbar';

export interface StandaloneComposerSelection {
  readonly providerId: ProviderId;
  readonly model: string;
}

export interface StandaloneComposerBinding {
  getSelection(): StandaloneComposerSelection;
  /** A model from another provider moves the selection to that provider. */
  onSelectionChange(selection: StandaloneComposerSelection): void;
}

export interface StandaloneComposerToolbar {
  /** Redraws every control from the current selection and settings. */
  refresh(): void;
  setUsage(usage: UsageInfo | null): void;
  destroy(): void;
}

/**
 * The chat composer's toolbar for a surface with no chat tab behind it, such
 * as a repository comment thread. The model picker offers every enabled
 * provider, as a blank tab's does, because the surface is not bound to one.
 *
 * Only the model belongs to the surface. Effort, permission mode, service tier
 * and mode are the provider's settings, written exactly as a chat tab writes
 * them, so switching YOLO here switches it for that provider's chats as well.
 */
export function mountStandaloneComposerToolbar(
  parentEl: HTMLElement,
  host: FeatureHost,
  binding: StandaloneComposerBinding,
): StandaloneComposerToolbar {
  const toolbarEl = parentEl.createDiv({ cls: 'grandemonium-input-toolbar' });
  let usage: UsageInfo | null = null;

  const providerId = (): ProviderId => binding.getSelection().providerId;
  const uiConfig = (): ProviderChatUIConfig => ({
    ...ProviderRegistry.getChatUIConfig(providerId()),
    getModelOptions: (settings: Record<string, unknown>) => getBlankTabModelOptions(settings),
  });
  const snapshot = (): TabProviderSettings => getProviderSettingsSnapshotWithModel(
    host.settings,
    providerId(),
    binding.getSelection().model,
  );

  const updateProviderSettings = async (update: (settings: TabProviderSettings) => void): Promise<void> => {
    const target = providerId();
    const model = binding.getSelection().model;
    await host.mutateSettings((settings) => {
      const writable = getProviderSettingsSnapshotWithModel(settings, target, model) as TabProviderSettings;
      update(writable);
      ProviderSettingsCoordinator.commitProviderSettingsSnapshot(settings, target, writable);
    });
    refresh();
  };

  const components = createInputToolbar(toolbarEl, {
    getCapabilities: () => ProviderRegistry.getCapabilities(providerId()),
    getEnvironmentVariables: () => host.getActiveEnvironmentVariables(providerId()),
    getSettings: snapshot,
    getUIConfig: uiConfig,
    onEffortLevelChange: effort => updateProviderSettings((settings) => {
      settings.effortLevel = effort;
      ProviderRegistry.getChatUIConfig(providerId())
        .applyReasoningSelection?.(settings.model, effort, settings);
    }),
    onModeChange: mode => updateProviderSettings((settings) => {
      ProviderRegistry.getChatUIConfig(providerId()).applyModeSelection?.(mode, settings);
    }),
    onModelChange: async (model) => {
      const target = getEnabledProviderForModel(model, host.settings, providerId());
      const normalized = normalizeProviderModelSelection(target, host.settings, model) ?? model;
      binding.onSelectionChange({ model: normalized, providerId: target });
      usage = null;
      await ProviderRegistry.getChatUIConfig(target).prepareModelMetadata?.(
        normalized,
        getProviderSettingsSnapshotWithModel(host.settings, target, normalized),
        { plugin: host.providerHost },
      );
      refresh();
    },
    onPermissionModeChange: mode => updateProviderSettings((settings) => {
      const config = ProviderRegistry.getChatUIConfig(providerId());
      if (config.applyPermissionMode) config.applyPermissionMode(mode, settings);
      else settings.permissionMode = mode;
    }),
    onServiceTierChange: serviceTier => updateProviderSettings((settings) => {
      settings.serviceTier = serviceTier;
    }),
    onThinkingBudgetChange: budget => updateProviderSettings((settings) => {
      settings.thinkingBudget = budget;
      ProviderRegistry.getChatUIConfig(providerId())
        .applyReasoningSelection?.(settings.model, budget, settings);
    }),
  });

  function refresh(): void {
    components.modelSelector.updateDisplay();
    components.modelSelector.renderOptions();
    components.modeSelector.updateDisplay();
    components.modeSelector.renderOptions();
    components.thinkingBudgetSelector.updateDisplay();
    components.serviceTierToggle.updateDisplay();
    components.permissionToggle.setVisible(
      Boolean(ProviderRegistry.getChatUIConfig(providerId()).getPermissionModeToggle?.()),
    );
    components.permissionToggle.updateDisplay();
    components.contextUsageMeter.update(usage);
    toolbarEl.closest<HTMLElement>('.grandemonium-container')?.setAttr('data-provider', providerId());
  }

  refresh();

  return {
    destroy: () => {
      components.layoutController.destroy();
      toolbarEl.remove();
    },
    refresh,
    setUsage: (next) => {
      usage = next;
      components.contextUsageMeter.update(usage);
    },
  };
}
