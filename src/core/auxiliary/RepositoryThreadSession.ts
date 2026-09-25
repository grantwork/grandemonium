import type {
  ProviderExecutionRequest,
  ProviderExecutionRun,
  ProviderExecutionSessionLease,
} from '../execution';
import type { UsageInfo } from '../types';
import type { DeferredAuxiliaryExecutionContext } from './AuxiliaryExecutionContext';

export interface RepositoryTurnRequest {
  readonly prompt: string;
  readonly model?: string;
  readonly reasoning?: string;
  readonly permissionMode?: string;
  readonly serviceTier?: string;
}

export interface RepositoryTurnCallbacks {
  /** The reply so far, whole rather than as a delta. */
  onText(text: string): void;
  /** A short label for a tool the agent started, such as "Edit Personas.md". */
  onActivity(label: string): void;
  onUsage(usage: UsageInfo): void;
}

/** Every outcome carries what the agent had said by then, so nothing is lost. */
export type RepositoryTurnResult =
  | { readonly kind: 'completed'; readonly text: string }
  | { readonly kind: 'cancelled'; readonly text: string }
  | { readonly kind: 'failed'; readonly message: string; readonly text: string };

export interface RepositoryTurn {
  /** Settles once and never rejects. */
  readonly done: Promise<RepositoryTurnResult>;
  cancel(): void;
}

/** Keys a tool's input is most often about, in the order worth showing. */
const ACTIVITY_TARGET_KEYS = ['file_path', 'path', 'notebook_path', 'pattern', 'command', 'url'];
const ACTIVITY_TARGET_MAX = 60;

/**
 * One agent's side of a repository-level comment thread: a single provider
 * session that lives as long as the thread, so each reply continues the same
 * conversation instead of starting over. A file comment is different; its
 * review is disposable because the whole discussion sits in the note.
 *
 * The thread has a reader watching it, so approvals and questions go to the
 * interaction port the caller supplies rather than being refused.
 *
 * A failed turn releases the session, because what state the provider was left
 * in is unknown. The next turn starts clean, and `isFresh` tells the caller to
 * resend the thread so far.
 */
export class RepositoryThreadSession {
  private lease: ProviderExecutionSessionLease | null = null;
  private stopInvalidated: (() => void) | null = null;
  private running = false;
  private completedTurns = 0;
  private disposed = false;

  constructor(private readonly context: DeferredAuxiliaryExecutionContext) {}

  /** True while this session has not yet finished a turn it could remember. */
  isFresh(): boolean {
    return this.completedTurns === 0;
  }

  isRunning(): boolean {
    return this.running;
  }

  send(request: RepositoryTurnRequest, callbacks: RepositoryTurnCallbacks): RepositoryTurn {
    if (this.disposed) throw new Error('This repository thread has been closed.');
    if (this.running) throw new Error('The agent is still working on the last message.');
    this.running = true;

    const abort = new AbortController();
    let run: ProviderExecutionRun | null = null;
    let cancelled = false;
    let text = '';
    let segmentEnded = false;

    const execute = async (): Promise<RepositoryTurnResult> => {
      try {
        const lease = await this.acquire();
        const providerRequest: ProviderExecutionRequest = {
          configuration: {
            ...(request.model ? { model: request.model } : {}),
            ...(request.permissionMode ? { permissionMode: request.permissionMode } : {}),
            ...(request.reasoning ? { reasoning: request.reasoning } : {}),
            ...(request.serviceTier ? { serviceTier: request.serviceTier } : {}),
            systemInstructions: { kind: 'provider-default' },
          },
          input: [{ text: request.prompt, type: 'text' }],
          signal: abort.signal,
          toolPolicy: { kind: 'provider-default' },
        };
        run = lease.session.execute(providerRequest);
        if (cancelled) run.cancel();
        for await (const event of run.events) {
          if (event.type === 'text_delta') {
            // Text written either side of a tool call or thinking arrives as one
            // stream; a chat turn renders each as its own block, so part them here.
            if (segmentEnded && text) text = `${text.trimEnd()}\n\n`;
            segmentEnded = false;
            text += event.text;
            callbacks.onText(text);
          } else if (event.type === 'thinking_delta') {
            segmentEnded = true;
          } else if (event.type === 'tool_started') {
            segmentEnded = true;
            if (event.toolScope.kind === 'main') callbacks.onActivity(describeActivity(event.name, event.input));
          } else if (event.type === 'usage_updated') {
            callbacks.onUsage(event.usage);
          } else if (event.type === 'turn_completed') {
            this.completedTurns += 1;
            return { kind: 'completed', text };
          } else if (event.type === 'cancelled') {
            return { kind: 'cancelled', text };
          } else if (event.type === 'execution_error') {
            await this.releaseLease();
            return { kind: 'failed', message: event.message, text };
          }
        }
        await this.releaseLease();
        return cancelled
          ? { kind: 'cancelled', text }
          : { kind: 'failed', message: 'The agent stopped without finishing its reply.', text };
      } catch (error) {
        await this.releaseLease();
        if (cancelled) return { kind: 'cancelled', text };
        return { kind: 'failed', message: error instanceof Error ? error.message : String(error), text };
      } finally {
        this.running = false;
      }
    };

    return {
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        abort.abort();
        (run)?.cancel();
      },
      done: execute(),
    };
  }

  /** Ends the provider conversation. Safe to call more than once. */
  async dispose(): Promise<void> {
    this.disposed = true;
    await this.releaseLease();
  }

  private async acquire(): Promise<ProviderExecutionSessionLease> {
    if (this.lease?.isCurrent()) return this.lease;
    if (this.lease) void this.releaseLease();
    const backend = await this.context.resolveBackend();
    if (this.disposed) throw new Error('This repository thread has been closed.');
    const lease = this.context.lifecycleRegistry.acquire(
      backend,
      {
        interactionPort: this.context.interactionPort,
        lifecycle: 'persistent',
        nativePersistence: 'provider-default',
        vaultWorkingDirectory: this.context.vaultWorkingDirectory,
      },
      'repository-thread',
    );
    this.lease = lease;
    this.completedTurns = 0;
    // A provider restart ends the native conversation; the next turn must
    // start clean and resend the thread.
    this.stopInvalidated = lease.onInvalidated(() => {
      if (this.lease === lease) void this.releaseLease();
    });
    return lease;
  }

  private async releaseLease(): Promise<void> {
    const lease = this.lease;
    if (!lease) return;
    this.lease = null;
    this.completedTurns = 0;
    this.stopInvalidated?.();
    this.stopInvalidated = null;
    await lease.release().catch(() => undefined);
  }
}

function describeActivity(name: string, input: Readonly<Record<string, unknown>>): string {
  for (const key of ACTIVITY_TARGET_KEYS) {
    const value = input[key];
    if (typeof value !== 'string' || !value.trim()) continue;
    const target = value.trim().replace(/\s+/g, ' ');
    return `${name} ${target.length > ACTIVITY_TARGET_MAX ? `${target.slice(0, ACTIVITY_TARGET_MAX - 1)}…` : target}`;
  }
  return name;
}
