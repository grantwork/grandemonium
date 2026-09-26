import { RepositoryThreadSession } from '@/core/auxiliary/RepositoryThreadSession';
import { ProviderExecutionLifecycleRegistry, type ProviderInteractionPort } from '@/core/execution';

import { FakeAuxiliaryBackend, waitFor } from './AuxiliaryExecutionTestHarness';

function createSession(port: Partial<ProviderInteractionPort> = {}) {
  const backend = new FakeAuxiliaryBackend();
  const interactionPort: ProviderInteractionPort = {
    askUserQuestion: async request => ({ answers: null, interactionId: request.interactionId }),
    dismissInteraction: () => undefined,
    requestApproval: async request => ({ decision: 'cancel', interactionId: request.interactionId }),
    ...port,
  };
  const session = new RepositoryThreadSession({
    resolveBackend: async () => backend,
    interactionPort,
    lifecycleRegistry: new ProviderExecutionLifecycleRegistry(),
    vaultWorkingDirectory: '/vault',
  });
  return { backend, session };
}

const NO_OP = { onActivity: () => undefined, onText: () => undefined, onUsage: () => undefined };

describe('RepositoryThreadSession', () => {
  it('keeps one provider session across turns, so a reply continues the conversation', async () => {
    const { backend, session } = createSession();

    const first = session.send({ prompt: 'add a persona group' }, NO_OP);
    await waitFor(() => backend.sessions[0]?.requests.length === 1, 'the first turn');
    backend.sessions[0].emitText('Done, see Personas.md');
    backend.sessions[0].complete();
    await expect(first.done).resolves.toEqual({ kind: 'completed', text: 'Done, see Personas.md' });

    const second = session.send({ prompt: 'also the privacy policy' }, NO_OP);
    await waitFor(() => backend.sessions[0].requests.length === 2, 'the second turn');
    backend.sessions[0].complete();
    await second.done;

    expect(backend.sessions).toHaveLength(1);
    expect(backend.sessions[0].requests[1].input).toEqual([
      { text: 'also the privacy policy', type: 'text' },
    ]);
  });

  it('is fresh until a turn completes, so the caller knows to resend the thread', async () => {
    const { backend, session } = createSession();
    expect(session.isFresh()).toBe(true);

    const turn = session.send({ prompt: 'go' }, NO_OP);
    await waitFor(() => backend.sessions[0]?.requests.length === 1, 'the turn');
    expect(session.isFresh()).toBe(true);
    backend.sessions[0].complete();
    await turn.done;

    expect(session.isFresh()).toBe(false);
  });

  it('sends the chosen model, effort and permission mode with the main-agent prompt', async () => {
    const { backend, session } = createSession();

    session.send(
      { model: 'gpt-6', permissionMode: 'yolo', prompt: 'go', reasoning: 'xhigh', serviceTier: 'fast' },
      NO_OP,
    );
    await waitFor(() => backend.sessions[0]?.requests.length === 1, 'the turn');

    const [request] = backend.sessions[0].requests;
    expect(request.configuration).toEqual({
      model: 'gpt-6',
      permissionMode: 'yolo',
      reasoning: 'xhigh',
      serviceTier: 'fast',
      systemInstructions: { kind: 'provider-default' },
    });
    expect(request.toolPolicy.kind).toBe('provider-default');
  });

  it('streams the reply, tool activity and usage while the turn runs', async () => {
    const { backend, session } = createSession();
    const texts: string[] = [];
    const activity: string[] = [];
    const usage: number[] = [];

    const turn = session.send({ prompt: 'go' }, {
      onActivity: label => activity.push(label),
      onText: text => texts.push(text),
      onUsage: info => usage.push(info.percentage),
    });
    await waitFor(() => backend.sessions[0]?.requests.length === 1, 'the turn');
    backend.sessions[0].emitText('Updating ');
    backend.sessions[0].emitText('files');
    backend.sessions[0].emit({
      input: { file_path: 'Personas.md' },
      name: 'Edit',
      toolCallId: 'tool-1',
      toolScope: { kind: 'main' },
      type: 'tool_started',
    });
    backend.sessions[0].emit({
      type: 'usage_updated',
      usage: { contextTokens: 12, contextWindow: 100, inputTokens: 12, percentage: 12 },
    });
    backend.sessions[0].complete();
    await turn.done;

    expect(texts).toEqual(['Updating ', 'Updating files']);
    expect(activity).toEqual(['Edit Personas.md']);
    expect(usage).toEqual([12]);
  });

  it('starts a new paragraph after a tool call or thinking, as a chat turn starts a new block', async () => {
    const { backend, session } = createSession();

    const turn = session.send({ prompt: 'push it' }, NO_OP);
    await waitFor(() => backend.sessions[0]?.requests.length === 1, 'the turn');
    backend.sessions[0].emit({
      input: { command: 'git remote -v' },
      name: 'Bash',
      toolCallId: 'tool-1',
      toolScope: { kind: 'main' },
      type: 'tool_started',
    });
    backend.sessions[0].emitText('Run `git status` to confirm: ');
    backend.sessions[0].emit({
      input: { command: 'git status' },
      name: 'Bash',
      toolCallId: 'tool-2',
      toolScope: { kind: 'main' },
      type: 'tool_started',
    });
    backend.sessions[0].emitText('All 14 commits are ');
    backend.sessions[0].emitText('pushed.');
    backend.sessions[0].emit({ text: 'Anything unstaged?', type: 'thinking_delta' });
    backend.sessions[0].emitText('AGENTS.md is unstaged.');
    backend.sessions[0].complete();

    await expect(turn.done).resolves.toEqual({
      kind: 'completed',
      text: 'Run `git status` to confirm:\n\nAll 14 commits are pushed.\n\nAGENTS.md is unstaged.',
    });
  });

  it('hands approvals to the thread, which has someone watching it', async () => {
    const requestApproval = jest.fn(async (request: { interactionId: string }) => ({
      decision: 'allow' as const,
      interactionId: request.interactionId,
    }));
    const { backend, session } = createSession({ requestApproval });

    session.send({ prompt: 'go' }, NO_OP);
    await waitFor(() => backend.sessions[0]?.requests.length === 1, 'the turn');
    const response = await backend.configs[0].interactionPort.requestApproval(
      {
        description: 'Edit Personas.md',
        input: {},
        interactionId: 'interaction-1',
        kind: 'approval',
        sessionInstanceId: 'session-1',
        toolName: 'Edit',
        turnId: 'turn-1',
      },
      new AbortController().signal,
    );

    expect(response).toEqual({ decision: 'allow', interactionId: 'interaction-1' });
  });

  it('reports a stop as cancelled and keeps what was already said', async () => {
    const { backend, session } = createSession();

    let streamed = '';
    const turn = session.send({ prompt: 'go' }, { ...NO_OP, onText: (text) => { streamed = text; } });
    await waitFor(() => backend.sessions[0]?.requests.length === 1, 'the turn');
    backend.sessions[0].emitText('Halfway');
    await waitFor(() => streamed === 'Halfway', 'the partial reply');
    turn.cancel();

    await expect(turn.done).resolves.toEqual({ kind: 'cancelled', text: 'Halfway' });
  });

  it('starts a clean session after a failure, and says so', async () => {
    const { backend, session } = createSession();

    const failed = session.send({ prompt: 'go' }, NO_OP);
    await waitFor(() => backend.sessions[0]?.requests.length === 1, 'the turn');
    backend.sessions[0].fail('Rate limit reached');
    await expect(failed.done).resolves.toEqual({
      kind: 'failed',
      message: 'Rate limit reached',
      text: '',
    });
    await waitFor(() => backend.sessions[0].disposeCalls > 0, 'the broken session to be released');
    expect(session.isFresh()).toBe(true);

    session.send({ prompt: 'again' }, NO_OP);
    await waitFor(() => backend.sessions.length === 2, 'a new session');
  });

  it('refuses a second turn while one is running', async () => {
    const { backend, session } = createSession();

    session.send({ prompt: 'go' }, NO_OP);
    await waitFor(() => backend.sessions[0]?.requests.length === 1, 'the turn');

    expect(() => session.send({ prompt: 'again' }, NO_OP)).toThrow();
  });

  it('releases the provider session when the thread is closed', async () => {
    const { backend, session } = createSession();

    const turn = session.send({ prompt: 'go' }, NO_OP);
    await waitFor(() => backend.sessions[0]?.requests.length === 1, 'the turn');
    backend.sessions[0].complete();
    await turn.done;
    await session.dispose();

    expect(backend.sessions[0].disposeCalls).toBeGreaterThan(0);
    expect(() => session.send({ prompt: 'again' }, NO_OP)).toThrow();
  });
});
