import { CommentReviewRunner } from '@/core/auxiliary/CommentReviewRunner';
import { ProviderExecutionLifecycleRegistry } from '@/core/execution';

import { FakeAuxiliaryBackend, waitFor } from './AuxiliaryExecutionTestHarness';

const PASSIVE_PORT = {
  askUserQuestion: async (request: { interactionId: string }) => ({
    answers: null,
    interactionId: request.interactionId,
  }),
  dismissInteraction: () => undefined,
  requestApproval: async (request: { interactionId: string }) => ({
    decision: 'cancel' as const,
    interactionId: request.interactionId,
  }),
};

function createRunner(options: { maxConcurrent?: number; now?: () => number } = {}) {
  const backend = new FakeAuxiliaryBackend();
  const runner = new CommentReviewRunner(
    {
      resolveBackend: async () => backend,
      interactionPort: PASSIVE_PORT,
      lifecycleRegistry: new ProviderExecutionLifecycleRegistry(),
      vaultWorkingDirectory: '/vault',
    },
    options,
  );
  return { backend, runner };
}

function approvalRequest(toolName: string) {
  return {
    description: `Run ${toolName}`,
    input: {},
    interactionId: 'interaction-1',
    kind: 'approval' as const,
    sessionInstanceId: 'session-1',
    toolName,
    turnId: 'turn-1',
  };
}

describe('CommentReviewRunner', () => {
  it('runs a review in its own session and reports completion', async () => {
    const { backend, runner } = createRunner();

    const run = runner.start('review Pricing.md');
    await waitFor(() => backend.sessions[0]?.requests.length === 1, 'the review to start');
    backend.sessions[0].complete();

    await expect(run.done).resolves.toEqual({ kind: 'completed' });
    await waitFor(() => backend.sessions[0].disposeCalls > 0, 'the session to be released');
  });

  it('gives every review a fresh session, so one thread never sees another', async () => {
    const { backend, runner } = createRunner({ maxConcurrent: 2 });

    runner.start('review A');
    runner.start('review B');
    await waitFor(() => backend.sessions.length === 2, 'both reviews to start');

    expect(backend.sessions[0]).not.toBe(backend.sessions[1]);
    expect(backend.sessions[0].requests[0].input).toEqual([{ text: 'review A', type: 'text' }]);
    expect(backend.sessions[1].requests[0].input).toEqual([{ text: 'review B', type: 'text' }]);
  });

  it('runs with the main-agent prompt and the provider\'s own tool rules', async () => {
    const { backend, runner } = createRunner();

    runner.start('review Pricing.md');
    await waitFor(() => backend.sessions[0]?.requests.length === 1, 'the review to start');

    const [request] = backend.sessions[0].requests;
    expect(request.configuration.systemInstructions.kind).toBe('provider-default');
    expect(request.toolPolicy.kind).toBe('provider-default');
  });

  it('reports the provider\'s own message when a review fails', async () => {
    const { backend, runner } = createRunner();

    const run = runner.start('review Pricing.md');
    await waitFor(() => backend.sessions[0]?.requests.length === 1, 'the review to start');
    backend.sessions[0].fail('Rate limit reached');

    await expect(run.done).resolves.toEqual({ kind: 'failed', message: 'Rate limit reached' });
  });

  it('reports a stop as cancelled rather than as a failure', async () => {
    const { backend, runner } = createRunner();

    const run = runner.start('review Pricing.md');
    await waitFor(() => backend.sessions[0]?.requests.length === 1, 'the review to start');
    run.cancel();

    await expect(run.done).resolves.toEqual({ kind: 'cancelled' });
  });

  it('fails naming the tool when a review stops to ask for approval it cannot get', async () => {
    const { backend, runner } = createRunner();

    const run = runner.start('review Pricing.md');
    await waitFor(() => backend.sessions[0]?.requests.length === 1, 'the review to start');
    const response = await backend.configs[0].interactionPort.requestApproval(
      approvalRequest('Edit'),
      new AbortController().signal,
    );
    backend.sessions[0].complete();

    expect(response.decision).toBe('cancel');
    const result = await run.done;
    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' && result.message).toContain('Edit');
  });

  it('holds a review until a slot frees once the limit is reached', async () => {
    const { backend, runner } = createRunner({ maxConcurrent: 1 });

    const first = runner.start('review A');
    runner.start('review B');
    await waitFor(() => backend.sessions.length === 1, 'the first review to start');
    expect(backend.sessions).toHaveLength(1);

    backend.sessions[0].complete();
    await first.done;
    await waitFor(() => backend.sessions.length === 2, 'the second review to start');

    expect(backend.sessions[1].requests[0].input).toEqual([{ text: 'review B', type: 'text' }]);
  });

  it('drops a waiting review that is stopped before it ever starts', async () => {
    const { backend, runner } = createRunner({ maxConcurrent: 1 });

    runner.start('review A');
    const waiting = runner.start('review B');
    await waitFor(() => backend.sessions.length === 1, 'the first review to start');
    waiting.cancel();

    await expect(waiting.done).resolves.toEqual({ kind: 'cancelled' });
    backend.sessions[0].complete();
    await new Promise(resolve => setImmediate(resolve));
    expect(backend.sessions).toHaveLength(1);
  });

  it('dates a review from when it was asked for, so its age includes any wait', () => {
    const { runner } = createRunner({ maxConcurrent: 1, now: () => 1_000 });

    runner.start('review A');
    const waiting = runner.start('review B');

    expect(waiting.startedAt).toBe(1_000);
  });
});
