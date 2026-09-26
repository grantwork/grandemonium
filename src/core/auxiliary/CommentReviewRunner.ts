import type {
  ProviderExecutionRequest,
  ProviderExecutionRun,
  ProviderExecutionSessionLease,
  ProviderInteractionPort,
} from '../execution';
import type { DeferredAuxiliaryExecutionContext } from './AuxiliaryExecutionContext';
import { AuxiliaryExecutionError, TextResponseCollector } from './TextResponseCollector';

export type CommentReviewResult =
  | { readonly kind: 'completed' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly message: string };

export interface CommentReviewRun {
  /** When the review was asked for, so the age a reader sees includes any wait. */
  readonly startedAt: number;
  /** Settles once, and never rejects: every outcome is a result. */
  readonly done: Promise<CommentReviewResult>;
  cancel(): void;
}

export interface CommentReviewRunnerOptions {
  /** Reviews allowed to run at once; the rest wait for a slot. */
  readonly maxConcurrent?: number;
  readonly now?: () => number;
}

/**
 * Chat tabs used to serialise reviews, one turn at a time per provider. Without
 * them nothing else bounds how many agent processes a burst of comments starts,
 * so the runner restores a small limit of its own.
 */
const DEFAULT_MAX_CONCURRENT = 3;

interface PendingReview {
  readonly prompt: string;
  readonly settle: (result: CommentReviewResult) => void;
  abort: AbortController | null;
  run: ProviderExecutionRun | null;
  cancelled: boolean;
  settled: boolean;
  /** Set when the agent stopped to ask for something no one is there to give. */
  blocked: string | null;
}

/**
 * Runs comment reviews as disposable sessions: one per review, started clean,
 * released when it ends. A review used to be sent into a long-lived chat tab,
 * whose context grew with every comment in every note until it degraded.
 *
 * Nothing needs to carry over between reviews. The whole discussion lives in
 * the note's comment block, so a session that reads the note already has it.
 *
 * There is no one to answer an approval or a question, so both are refused and
 * the review is reported as failed with what it wanted, rather than letting it
 * finish silently having written nothing. Permission mode is left to the
 * provider's own settings, so a review has exactly the powers a chat turn has.
 */
export class CommentReviewRunner {
  private readonly collector = new TextResponseCollector();
  private readonly maxConcurrent: number;
  private readonly now: () => number;
  private readonly waiting: PendingReview[] = [];
  private active = 0;

  constructor(
    private readonly context: DeferredAuxiliaryExecutionContext,
    options: CommentReviewRunnerOptions = {},
  ) {
    this.maxConcurrent = Math.max(1, Math.trunc(options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT));
    this.now = options.now ?? Date.now;
  }

  start(prompt: string): CommentReviewRun {
    const startedAt = this.now();
    let settle!: (result: CommentReviewResult) => void;
    const done = new Promise<CommentReviewResult>((resolve) => {
      settle = resolve;
    });
    const review: PendingReview = {
      abort: null,
      blocked: null,
      cancelled: false,
      prompt,
      run: null,
      settle: (result) => {
        if (review.settled) return;
        review.settled = true;
        settle(result);
      },
      settled: false,
    };
    this.waiting.push(review);
    this.pump();
    return {
      cancel: () => this.cancel(review),
      done,
      startedAt,
    };
  }

  private cancel(review: PendingReview): void {
    if (review.settled || review.cancelled) return;
    review.cancelled = true;
    const queued = this.waiting.indexOf(review);
    if (queued !== -1) {
      this.waiting.splice(queued, 1);
      review.settle({ kind: 'cancelled' });
      return;
    }
    review.abort?.abort();
    review.run?.cancel();
  }

  private pump(): void {
    while (this.active < this.maxConcurrent && this.waiting.length > 0) {
      const review = this.waiting.shift();
      if (!review) return;
      this.active += 1;
      void this.execute(review).finally(() => {
        this.active -= 1;
        this.pump();
      });
    }
  }

  private async execute(review: PendingReview): Promise<void> {
    let lease: ProviderExecutionSessionLease;
    try {
      const backend = await this.context.resolveBackend();
      if (review.cancelled) {
        review.settle({ kind: 'cancelled' });
        return;
      }
      lease = this.context.lifecycleRegistry.acquire(
        backend,
        {
          interactionPort: this.refusing(review),
          lifecycle: 'ephemeral',
          nativePersistence: 'provider-default',
          vaultWorkingDirectory: this.context.vaultWorkingDirectory,
        },
        'comment-review',
      );
    } catch (error) {
      review.settle({ kind: 'failed', message: describe(error) });
      return;
    }
    const stopInvalidated = lease.onInvalidated(() => {
      review.blocked ??= 'The AI restarted while the review was running.';
      review.abort?.abort();
      review.run?.cancel();
    });
    try {
      review.abort = new AbortController();
      const request: ProviderExecutionRequest = {
        // The same main-agent prompt a chat turn gets, so a review reads the
        // vault and the comment block the way it did when it ran in a tab.
        configuration: { systemInstructions: { kind: 'provider-default' } },
        input: [{ text: review.prompt, type: 'text' }],
        signal: review.abort.signal,
        toolPolicy: { kind: 'provider-default' },
      };
      review.run = lease.session.execute(request);
      await this.collector.collect(review.run);
      review.settle(
        review.blocked ? { kind: 'failed', message: review.blocked } : { kind: 'completed' },
      );
    } catch (error) {
      if (review.cancelled) {
        review.settle({ kind: 'cancelled' });
      } else if (review.blocked) {
        review.settle({ kind: 'failed', message: review.blocked });
      } else {
        review.settle({ kind: 'failed', message: describe(error) });
      }
    } finally {
      stopInvalidated();
      review.run = null;
      review.abort = null;
      await lease.release().catch(() => undefined);
    }
  }

  /** Refuses what a headless session cannot be given, and remembers that it asked. */
  private refusing(review: PendingReview): ProviderInteractionPort {
    const inner = this.context.interactionPort;
    return {
      askUserQuestion: async (request, signal) => {
        review.blocked ??= 'The AI stopped to ask a question, which a background review cannot answer.';
        return inner.askUserQuestion(request, signal);
      },
      dismissInteraction: (interactionId, reason) => {
        inner.dismissInteraction(interactionId, reason);
      },
      requestApproval: async (request, signal) => {
        review.blocked ??=
          `The AI needed approval to use ${request.toolName}, which a background review cannot give. `
          + 'Allow edits for this AI in its settings.';
        return inner.requestApproval(request, signal);
      },
    };
  }
}

function describe(error: unknown): string {
  if (error instanceof AuxiliaryExecutionError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
