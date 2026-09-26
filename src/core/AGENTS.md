# Core Infrastructure

`src/core/` is provider-neutral infrastructure. Features depend on core contracts; providers implement those contracts behind the registry boundary.

## Dependency Rules

- `bootstrap/` defines provider-neutral persistence contracts and normalization, including recovery-only native locators. It must not interpret provider-native session formats or make those locators resumable.
- `execution/` defines leases, sessions, requests, events, interactions, and lifecycle coordination. It must not construct concrete providers.
- `providers/` defines registries, capabilities, routing, workspace-service contracts, and provider-state boundaries. Registrations supply the concrete implementations.
- `process/` and `rpc/` provide mechanics only. Provider launch arguments, protocol extensions, retry policy, and message semantics stay provider-owned.
- `auxiliary/` may orchestrate provider-neutral executions through core contracts but must not special-case a concrete provider.

Core must consume provider data through explicit contracts. Do not branch on provider IDs when a capability can express the distinction or promote provider-native state into a shared type.

## State Ownership

- `ProviderExecutionLifecycleRegistry` is the source of truth for provider generations, transition fencing, and live session leases. It does not own per-tab turn state or impose a global execution-capacity policy.
- Provider execution sessions own native runtime interaction behind the `ProviderExecutionSession` contract.
- The provider-default main-agent system prompt is one shared Grandemonium prompt across all providers for the same settings. Provider adapters may differ in transport and replacement lifecycle, but must not select a provider-specific prompt profile or omit shared sections.
- Inline Edit uses one provider-neutral explicit system prompt across all providers. Its runtime context receives the host-provided current date and Vault absolute path; keep tool guidance capability-based, and do not append Custom Instructions.
- `ProviderExecutionRequest.context.linkedContent` is the canonical provider-neutral Linked content reference. New writes use one normalized path-only shape for Notes, folders, or missing content; the Vault root is not a valid target. A directory reference is context metadata, not a CWD or recursive-ingestion request.
- Bootstrap persistence stores Grandemonium metadata and input ledgers. Provider transcript files remain provider-owned and read-only. Session metadata and its deletion markers live in a device folder named by the same filesystem-safe opaque installation key used for host-scoped provider settings, without deriving a second identity, and construction fails closed unless its installation seed is durable. A device reads and writes only its own folder; never copy metadata between devices. Input ledgers sit outside the device folders at `.grandemonium/sessions/<id>.inputs.json`.
- Registries own registration and lookup; they do not absorb the lifecycle or storage responsibilities of the registered service.

## Routing Rules

- Title generation routes by the global `titleGenerationModel`, independently of the active chat provider. Core owns its shared prompt, parsing, cancellation, and callback flow over ephemeral execution sessions.
- For instruction refinement and inline edit, core owns multi-turn orchestration and response parsing; provider backends own native continuation, tools, and lifecycle behavior.
- `CommentReviewRunner` runs each comment review in its own ephemeral session with the provider-default system prompt and tool policy, and never overrides permission mode, so a background review has exactly the powers a chat turn has. No one can answer an approval or question there, so both are refused and the run reports `failed` naming what it wanted rather than completing having written nothing. Auxiliary leases carry no capacity policy, so the runner keeps a per-provider concurrency limit; keep it.
- `RepositoryThreadSession` is the one multi-turn auxiliary session: a persistent lease kept for the life of a repository comment thread, with the caller's interaction port. A failed turn or provider invalidation releases the lease and resets `isFresh`, so the caller resends the thread rather than assuming the provider remembers it.
- Provider workspaces start lazily and a backend cannot be built before its workspace has started. Runners created ahead of their first turn (`RepositoryThreadSession`, `CommentReviewRunner`) therefore take a `DeferredAuxiliaryExecutionContext` whose backend is resolved per turn after `ensureInitialized`. The comments panel can be used without any chat tab having started a provider, so never build their backend eagerly.
- Resolve provider workspace services through `ProviderWorkspaceRegistry`, not concrete providers.
- Chat model resolution distinguishes historical provider ownership from current enabled-option availability. Global future-tab fallback and conversation fallback may use only current provider options and a validated provider-owned default; opaque historical ownership alone is not availability.
- For an unavailable durable conversation selection, `ConversationModelResolution.model` remains the readable stored value and `modelToPersist` carries the desired fallback. Readers must not project `modelToPersist`; the application repository publishes it only after persistence succeeds.
- Provider alias canonicalization used during availability checks must not choose a fallback model. Fallback policy remains a separate ordered/default resolution step.
- Provider fallback order is the registry's explicit blank-tab display order. Do not derive fallback from display-name sorting, registration insertion order, or the current settings projection.

## Gotchas

- Missing historical model selections are recovered through `ProviderConversationHistoryService`; core defines the contract, providers interpret native history, and the application repository coordinates persistence and race fencing.
- Command discovery is provider-owned; do not normalize provider-specific discovery sources in feature code.
- Provider command caches and live snapshots are resource-generation fenced; cache identities contain only provider-owned non-secret fingerprints and monotonic generations.
