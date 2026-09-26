import { buildSystemPrompt, type SystemPromptSettings } from '../../../core/prompt/mainAgent';
import { decodeGrokModelId } from '../models';

export interface GrokSessionMeta {
  modelId?: string;
  systemPromptOverride: string;
  yoloMode: boolean;
}

export interface GrokSessionMetaBuildOptions {
  model: string;
  permissionMode: unknown;
  promptSettings: SystemPromptSettings;
}

export function buildGrokSessionMeta(
  options: GrokSessionMetaBuildOptions,
): GrokSessionMeta {
  const modelId = decodeGrokModelId(options.model);
  return {
    ...(modelId ? { modelId } : {}),
    systemPromptOverride: buildSystemPrompt(options.promptSettings),
    yoloMode: options.permissionMode === 'yolo',
  };
}
