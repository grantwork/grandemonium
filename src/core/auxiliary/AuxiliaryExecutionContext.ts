import type {
  ProviderExecutionBackend,
  ProviderExecutionLifecycleRegistry,
  ProviderInteractionPort,
} from '../execution';

export interface AuxiliaryExecutionContext {
  readonly backend: ProviderExecutionBackend;
  readonly interactionPort: ProviderInteractionPort;
  readonly lifecycleRegistry: ProviderExecutionLifecycleRegistry;
  readonly vaultWorkingDirectory: string;
}

/**
 * For a runner created before its first turn. A provider's workspace starts
 * lazily and its backend cannot be built until it has, so the backend is
 * resolved as each turn starts rather than when the runner is created.
 */
export interface DeferredAuxiliaryExecutionContext extends Omit<AuxiliaryExecutionContext, 'backend'> {
  resolveBackend(): Promise<ProviderExecutionBackend>;
}
