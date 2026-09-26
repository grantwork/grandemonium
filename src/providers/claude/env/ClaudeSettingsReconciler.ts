import {
  type CliPathFingerprintInputs,
  createCliPathFingerprintInputs,
  hasCliPathFingerprintInputs,
} from '../../../core/providers/cli/CliPathFingerprintInputs';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { createRuntimeInputFingerprint } from '../../../core/providers/settings/RuntimeInputFingerprint';
import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { getHostnameKey, parseEnvironmentVariables } from '../../../utils/env';
import {
  findClaudeModelOptionForEnvironmentType,
  getClaudeModelOptions,
  resolveClaudeModelEnvironmentTypePreference,
  resolveClaudeModelSelection,
} from '../modelOptions';
import { toClaudeRuntimeModelId } from '../modelSelection';
import { isClaudeModelTier } from '../modelTiers';
import { getClaudeProviderSettings, updateClaudeProviderSettings } from '../settings';
import { normalizeLegacyClaudeModelAlias } from '../types/models';
import { clearClaudeResumeState } from '../types/providerState';
import { claudeChatUIConfig } from '../ui/ClaudeChatUIConfig';
import { CLAUDE_MODEL_ENV_KEYS } from './claudeModelEnv';

const ENV_HASH_PROVIDER_KEYS = ['ANTHROPIC_BASE_URL', 'PATH'];
const ALL_FINGERPRINT_ENV_KEYS = [...CLAUDE_MODEL_ENV_KEYS, ...ENV_HASH_PROVIDER_KEYS];

function getConfiguredCliPathInputs(
  settings: Record<string, unknown>,
): CliPathFingerprintInputs {
  const claudeSettings = getClaudeProviderSettings(settings);
  return createCliPathFingerprintInputs(
    claudeSettings.cliPathsByHost[getHostnameKey()],
  );
}

function computeRuntimeFingerprint(
  settings: Record<string, unknown>,
  environmentText: string = getRuntimeEnvironmentText(settings, 'claude'),
): string {
  return createRuntimeInputFingerprint({
    additionalInputs: getConfiguredCliPathInputs(settings),
    environmentKeys: ALL_FINGERPRINT_ENV_KEYS,
    environmentText,
  });
}

function hasFingerprintInputs(settings: Record<string, unknown>, environmentText: string): boolean {
  if (hasCliPathFingerprintInputs(getConfiguredCliPathInputs(settings))) {
    return true;
  }

  const environment = parseEnvironmentVariables(environmentText);
  return ALL_FINGERPRINT_ENV_KEYS
    .some(key => Object.prototype.hasOwnProperty.call(environment, key));
}

function invalidateClaudeConversationSessions(conversations: Conversation[]): Conversation[] {
  return conversations.filter(conv => (
    conv.providerId === 'claude' && clearClaudeResumeState(conv)
  ));
}

export const claudeSettingsReconciler: ProviderSettingsReconciler = {
  invalidateConversationSessions: invalidateClaudeConversationSessions,

  reconcileModelWithEnvironment(
    settings: Record<string, unknown>,
    conversations: Conversation[],
  ): { changed: boolean; invalidatedConversations: Conversation[] } {
    const envText = getRuntimeEnvironmentText(settings, 'claude');
    const currentHash = computeRuntimeFingerprint(settings, envText);
    const savedHash = getClaudeProviderSettings(settings).environmentHash;

    if (!savedHash && !hasFingerprintInputs(settings, envText)) {
      return { changed: false, invalidatedConversations: [] };
    }
    if (currentHash === savedHash) {
      return { changed: false, invalidatedConversations: [] };
    }

    const invalidatedConversations = invalidateClaudeConversationSessions(conversations);

    const currentModel = typeof settings.model === 'string' ? settings.model : '';
    const claudeSettings = getClaudeProviderSettings(settings);
    const modelOptions = getClaudeModelOptions(settings);
    const previousEnvironmentType = claudeSettings.modelEnvironmentType || undefined;
    const nextModel = resolveClaudeModelSelection(
      settings,
      currentModel,
      previousEnvironmentType,
    );
    if (nextModel) {
      settings.model = nextModel;
    }

    const derivedEnvironmentType = nextModel
      ? resolveClaudeModelEnvironmentTypePreference(
        modelOptions,
        nextModel,
        previousEnvironmentType ?? '',
      )
      : null;
    const selectedEnvironmentType = previousEnvironmentType ?? derivedEnvironmentType;
    const selectedTier = selectedEnvironmentType && isClaudeModelTier(selectedEnvironmentType)
      ? selectedEnvironmentType
      : undefined;

    const titleModel = typeof settings.titleGenerationModel === 'string'
      ? settings.titleGenerationModel
      : '';
    const previousTitleEnvironmentType = claudeSettings.titleModelEnvironmentType || undefined;
    if (previousTitleEnvironmentType) {
      const titleOption = findClaudeModelOptionForEnvironmentType(
        modelOptions,
        previousTitleEnvironmentType,
      );
      if (titleOption) {
        settings.titleGenerationModel = titleOption.value;
      }
    }
    const derivedTitleEnvironmentType = titleModel
      ? resolveClaudeModelEnvironmentTypePreference(
        modelOptions,
        titleModel,
        previousTitleEnvironmentType ?? '',
      )
      : null;
    const selectedTitleEnvironmentType = previousTitleEnvironmentType
      ?? derivedTitleEnvironmentType;

    updateClaudeProviderSettings(settings, {
      environmentHash: currentHash,
      modelEnvironmentType: selectedEnvironmentType ?? '',
      titleModelEnvironmentType: selectedTitleEnvironmentType ?? '',
      ...(selectedTier ? { lastModel: selectedTier } : {}),
    });
    return { changed: true, invalidatedConversations };
  },

  normalizeModelVariantSettings(settings: Record<string, unknown>): boolean {
    let changed = false;

    const normalize = (model: string): string => claudeChatUIConfig.normalizeModelVariant(model, settings);
    const claudeSettings = getClaudeProviderSettings(settings);
    const modelOptions = getClaudeModelOptions(settings);
    const hasEnvironmentModelOptions = modelOptions.some(option => option.environmentTypes);

    const model = settings.model as string;
    const shouldInferPrimaryEnvironmentType = settings.settingsProvider === undefined
      || settings.settingsProvider === 'claude';
    const modelEnvironmentType = claudeSettings.modelEnvironmentType
      || (shouldInferPrimaryEnvironmentType && hasEnvironmentModelOptions
        ? resolveClaudeModelEnvironmentTypePreference(modelOptions, model)
        : null);
    const normalizedModel = (
      modelEnvironmentType
        ? findClaudeModelOptionForEnvironmentType(modelOptions, modelEnvironmentType)?.value
        : undefined
    ) ?? normalize(model);
    if (model !== normalizedModel) {
      settings.model = normalizedModel;
      changed = true;
    }

    const titleModel = typeof settings.titleGenerationModel === 'string'
      ? settings.titleGenerationModel
      : '';
    const titleModelEnvironmentType = claudeSettings.titleModelEnvironmentType
      || (titleModel && hasEnvironmentModelOptions
        ? resolveClaudeModelEnvironmentTypePreference(modelOptions, titleModel)
        : null);
    const normalizedTitleModel = (
      titleModelEnvironmentType
        ? findClaudeModelOptionForEnvironmentType(
          modelOptions,
          titleModelEnvironmentType,
        )?.value
        : undefined
    ) ?? (titleModel ? normalize(titleModel) : '');
    if (titleModel !== normalizedTitleModel) {
      settings.titleGenerationModel = normalizedTitleModel;
      changed = true;
    }

    const lastClaudeModel = claudeSettings.lastModel;
    if (lastClaudeModel) {
      const normalizedLastClaudeModel = normalizeLegacyClaudeModelAlias(
        toClaudeRuntimeModelId(lastClaudeModel),
      );
      if (lastClaudeModel !== normalizedLastClaudeModel) {
        updateClaudeProviderSettings(settings, { lastModel: normalizedLastClaudeModel });
        changed = true;
      }
    }

    if (
      claudeSettings.modelEnvironmentType !== (modelEnvironmentType ?? '')
      || claudeSettings.titleModelEnvironmentType !== (titleModelEnvironmentType ?? '')
    ) {
      updateClaudeProviderSettings(settings, {
        modelEnvironmentType: modelEnvironmentType ?? '',
        titleModelEnvironmentType: titleModelEnvironmentType ?? '',
      });
      changed = true;
    }

    return changed;
  },
};
