import type {
  RepositoryTurnCallbacks,
  RepositoryTurnResult,
} from '@/core/auxiliary/RepositoryThreadSession';
import type { ProviderInteractionPort } from '@/core/execution';
import {
  type RepositoryAgentPort,
  type RepositoryAgentSession,
  RepositoryThreadsController,
} from '@/features/comments/RepositoryThreadsController';

interface SentTurn {
  prompt: string;
  model: string | null;
  callbacks: RepositoryTurnCallbacks;
  finish(result: RepositoryTurnResult): void;
  cancelled: boolean;
}

class FakeSession implements RepositoryAgentSession {
  readonly turns: SentTurn[] = [];
  disposed = false;
  private completed = 0;
  private busy = false;

  constructor(readonly providerId: string, readonly port: ProviderInteractionPort) {}

  isFresh(): boolean {
    return this.completed === 0;
  }

  isRunning(): boolean {
    return this.busy;
  }

  send(prompt: string, model: string | null, callbacks: RepositoryTurnCallbacks) {
    this.busy = true;
    let settle!: (result: RepositoryTurnResult) => void;
    const done = new Promise<RepositoryTurnResult>((resolve) => {
      settle = resolve;
    });
    const turn: SentTurn = {
      callbacks,
      cancelled: false,
      finish: (result) => {
        this.busy = false;
        if (result.kind === 'completed') this.completed += 1;
        settle(result);
      },
      model,
      prompt,
    };
    this.turns.push(turn);
    return {
      cancel: () => {
        turn.cancelled = true;
        turn.finish({ kind: 'cancelled', text: '' });
      },
      done,
    };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}

function setup(options: {
  openError?: string;
  resolveBehavior?: 'keep' | 'remove';
  stored?: unknown;
  title?: string | null;
} = {}) {
  const sessions: FakeSession[] = [];
  const writes: unknown[] = [];
  const notices: string[] = [];
  const persistentNotices: string[] = [];
  const port: RepositoryAgentPort = {
    agents: () => [
      { name: 'gpt', providerId: 'codex' },
      { name: 'claude', providerId: 'claude' },
    ],
    defaultSelection: () => ({ model: 'gpt-6', providerId: 'codex' }),
    generateTitle: async () => options.title ?? null,
    mountToolbar: () => ({ destroy: () => undefined, refresh: () => undefined, setUsage: () => undefined }),
    openSession: (providerId, interactionPort) => {
      if (options.openError) throw new Error(options.openError);
      const session = new FakeSession(providerId, interactionPort);
      sessions.push(session);
      return session;
    },
  };
  const controller = new RepositoryThreadsController({
    agents: () => port,
    author: () => 'grant',
    notify: (message, options) => (options?.persistent ? persistentNotices : notices).push(message),
    now: () => '2026-09-23T01:00:00.000Z',
    preferredAgentName: () => '',
    resolveBehavior: () => options.resolveBehavior ?? 'keep',
    storage: {
      read: async () => options.stored,
      write: async (data) => {
        writes.push(data);
      },
    },
  });
  return { controller, notices, persistentNotices, sessions, writes };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('RepositoryThreadsController', () => {
  it("starts a thread by sending the request to the chosen AI with the thread's purpose", async () => {
    const { controller, sessions } = setup();

    const thread = controller.create('Add a persona group', { model: 'gpt-6', providerId: 'codex' });

    expect(thread?.thread).toEqual([
      { author: 'grant', text: 'Add a persona group', ts: '2026-09-23T01:00:00.000Z' },
    ]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].providerId).toBe('codex');
    expect(sessions[0].turns[0].model).toBe('gpt-6');
    expect(sessions[0].turns[0].prompt).toContain('<repository_thread');
    expect(sessions[0].turns[0].prompt.trim().endsWith('Add a persona group')).toBe(true);
  });

  it("posts the agent's reply under the thread when its turn ends", async () => {
    const { controller, sessions, writes } = setup();
    const thread = controller.create('Add a persona group', { model: 'gpt-6', providerId: 'codex' })!;

    sessions[0].turns[0].finish({ kind: 'completed', text: 'Added Personas/Group.md' });
    await flush();

    expect(controller.get(thread.id)?.thread.at(-1)).toEqual({
      author: 'gpt',
      text: 'Added Personas/Group.md',
      ts: '2026-09-23T01:00:00.000Z',
    });
    expect(controller.isWorking(thread.id)).toBe(false);
    expect(writes.length).toBeGreaterThan(0);
  });

  it('shows the reply streaming in while the agent works', () => {
    const { controller, sessions } = setup();
    const thread = controller.create('Go', { model: 'gpt-6', providerId: 'codex' })!;

    sessions[0].turns[0].callbacks.onText('Working on it');
    sessions[0].turns[0].callbacks.onActivity('Edit Personas.md');

    expect(controller.live(thread.id).turns).toEqual([
      expect.objectContaining({ activity: 'Edit Personas.md', agentName: 'gpt', text: 'Working on it' }),
    ]);
  });

  it('continues the same conversation on a reply', async () => {
    const { controller, sessions } = setup();
    const thread = controller.create('Add a persona group', { model: 'gpt-6', providerId: 'codex' })!;
    sessions[0].turns[0].finish({ kind: 'completed', text: 'Done' });
    await flush();

    controller.reply(thread.id, 'Now the privacy policy');

    expect(sessions).toHaveLength(1);
    expect(sessions[0].turns[1].prompt).toBe('Now the privacy policy');
  });

  it('brings in another AI when a reply mentions it, with the thread so far', async () => {
    const { controller, sessions } = setup();
    const thread = controller.create('Add a persona group', { model: 'gpt-6', providerId: 'codex' })!;
    sessions[0].turns[0].finish({ kind: 'completed', text: 'Done' });
    await flush();

    controller.reply(thread.id, "@claude check gpt's work");

    expect(sessions).toHaveLength(2);
    expect(sessions[1].providerId).toBe('claude');
    expect(sessions[1].turns[0].model).toBeNull();
    expect(sessions[1].turns[0].prompt).toContain('Add a persona group');
    expect(sessions[1].turns[0].prompt).toContain('Done');
  });

  it('ends every conversation the thread started when it is resolved', async () => {
    const { controller, sessions } = setup();
    const thread = controller.create('Go', { model: 'gpt-6', providerId: 'codex' })!;

    await controller.resolve(thread.id);

    expect(sessions[0].turns[0].cancelled).toBe(true);
    expect(sessions[0].disposed).toBe(true);
    expect(controller.get(thread.id)?.status).toBe('resolved');
  });

  it('removes a resolved thread when resolving is set to remove', async () => {
    const { controller } = setup({ resolveBehavior: 'remove' });
    const thread = controller.create('Go', { model: 'gpt-6', providerId: 'codex' })!;

    await controller.resolve(thread.id);

    expect(controller.get(thread.id)).toBeNull();
  });

  it('holds an approval in the thread until the reader answers it', async () => {
    const { controller, sessions } = setup();
    const thread = controller.create('Go', { model: 'gpt-6', providerId: 'codex' })!;

    const response = sessions[0].port.requestApproval(
      {
        description: 'Edit Personas.md',
        input: {},
        interactionId: 'i-1',
        kind: 'approval',
        sessionInstanceId: 's',
        toolName: 'Edit',
        turnId: 't',
      },
      new AbortController().signal
    );
    const [pending] = controller.live(thread.id).approvals;
    expect(pending.choices.map((choice) => choice.label)).toEqual(['Allow', 'Always allow', 'Deny']);

    controller.answerApproval(pending.id, 'allow');

    await expect(response).resolves.toEqual({ decision: 'allow', interactionId: 'i-1' });
    expect(controller.live(thread.id).approvals).toEqual([]);
  });

  it('names the thread once a title comes back', async () => {
    const { controller } = setup({ title: 'Persona group rollout' });
    const thread = controller.create('Add a persona group and update everything', {
      model: 'gpt-6',
      providerId: 'codex',
    })!;
    expect(thread.title).toBe('Add a persona group and update everything');

    await flush();

    expect(controller.get(thread.id)?.title).toBe('Persona group rollout');
  });

  it('keeps a reply and says in the thread why its AI could not be reached', async () => {
    const { controller, notices } = setup({
      openError: 'Claude is not configured',
      stored: {
        threads: [{
          createdAt: '2026-09-23T00:00:00.000Z',
          id: 'r1',
          selection: { model: 'gpt-6', providerId: 'codex' },
          status: 'open',
          thread: [{ author: 'grant', text: 'Go', ts: '2026-09-23T00:00:00.000Z' }],
          title: 'Go',
        }],
        version: 1,
      },
    });
    await controller.load();

    expect(() => controller.reply('r1', '@claude and again')).not.toThrow();

    expect(controller.get('r1')?.thread.slice(-2)).toEqual([
      { author: 'grant', text: '@claude and again', ts: '2026-09-23T01:00:00.000Z' },
      { author: 'claude', kind: 'error', text: "Couldn't start: Claude is not configured", ts: '2026-09-23T01:00:00.000Z' },
    ]);
    expect(notices).toEqual([]);
    expect(controller.isWorking('r1')).toBe(false);
  });

  it("posts a failed turn's error in the thread, after whatever the AI had said", async () => {
    const { controller, notices, sessions } = setup();
    const thread = controller.create('Go', { model: 'gpt-6', providerId: 'codex' })!;

    sessions[0].turns[0].finish({ kind: 'failed', message: 'process exited', text: 'Half done' });
    await flush();

    expect(controller.get(thread.id)?.thread.slice(1)).toEqual([
      { author: 'gpt', text: 'Half done', ts: '2026-09-23T01:00:00.000Z' },
      { author: 'gpt', kind: 'error', text: "Couldn't finish: process exited", ts: '2026-09-23T01:00:00.000Z' },
    ]);
    expect(notices).toEqual([]);
  });

  it("still posts the agent's reply when a view fails to redraw", async () => {
    const { controller, persistentNotices, sessions } = setup();
    let failing = true;
    controller.onChange(() => {
      if (failing) throw new Error('redraw failed');
    });

    const thread = controller.create('Go', { model: 'gpt-6', providerId: 'codex' })!;
    failing = false;
    sessions[0].turns[0].finish({ kind: 'completed', text: 'Done' });
    await flush();

    expect(controller.get(thread.id)?.thread.at(-1)?.text).toBe('Done');
    expect(persistentNotices).toEqual(['Repository comments could not be redrawn: redraw failed']);
  });

  it('does not send a second message to an AI still working', () => {
    const { controller, notices, sessions } = setup();
    const thread = controller.create('Go', { model: 'gpt-6', providerId: 'codex' })!;

    controller.reply(thread.id, 'and another thing');

    expect(sessions[0].turns).toHaveLength(1);
    expect(notices[0]).toContain('still working');
  });
});
