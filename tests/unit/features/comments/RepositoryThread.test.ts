import {
  buildRepositoryMessage,
  fallbackThreadTitle,
  parseRepositoryThreads,
} from '@/features/comments/RepositoryThread';

describe('parseRepositoryThreads', () => {
  it('reads stored threads', () => {
    const stored = {
      threads: [
        {
          createdAt: '2026-09-23T01:00:00.000Z',
          id: 'r1',
          selection: { model: 'gpt-6', providerId: 'codex' },
          status: 'open',
          thread: [{ author: 'grant', text: 'Add a persona group', ts: '2026-09-23T01:00:00.000Z' }],
          title: 'Add persona group',
        },
      ],
      version: 1,
    };

    expect(parseRepositoryThreads(stored)).toEqual(stored.threads);
  });

  it("keeps an AI's error marked as one, and ignores a mark it does not know", () => {
    const entry = (extra: object) => ({ author: 'claude', text: "Couldn't start", ts: '2026-09-23T01:00:00.000Z', ...extra });
    const [thread] = parseRepositoryThreads({
      threads: [{
        createdAt: '2026-09-23T01:00:00.000Z',
        id: 'r1',
        status: 'open',
        thread: [entry({ kind: 'error' }), entry({ kind: 'shout' })],
        title: 'Go',
      }],
      version: 1,
    });

    expect(thread.thread).toEqual([entry({ kind: 'error' }), entry({})]);
  });

  it('starts empty when nothing has been saved', () => {
    expect(parseRepositoryThreads(undefined)).toEqual([]);
    expect(parseRepositoryThreads('junk')).toEqual([]);
  });

  it('drops a malformed thread rather than the whole list', () => {
    const threads = parseRepositoryThreads({
      threads: [
        { id: 'bad', status: 'open', thread: 'not a list', title: 'x' },
        {
          createdAt: '2026-09-23T01:00:00.000Z',
          id: 'good',
          selection: null,
          status: 'resolved',
          thread: [],
          title: 'Kept',
        },
      ],
      version: 1,
    });

    expect(threads.map((thread) => thread.id)).toEqual(['good']);
  });

  it('forgets a selection that does not name a provider and model', () => {
    const [thread] = parseRepositoryThreads({
      threads: [
        {
          createdAt: '2026-09-23T01:00:00.000Z',
          id: 'r1',
          selection: { providerId: 'codex' },
          status: 'open',
          thread: [],
          title: 'T',
        },
      ],
      version: 1,
    });

    expect(thread.selection).toBeNull();
  });
});

describe('fallbackThreadTitle', () => {
  it('uses the first line of the request, shortened', () => {
    expect(fallbackThreadTitle('Update the privacy policy\nand the personas')).toBe(
      'Update the privacy policy'
    );
    expect(fallbackThreadTitle('x'.repeat(100))).toHaveLength(60);
  });
});

describe('buildRepositoryMessage', () => {
  it('sends only the new message once the agent already has the conversation', () => {
    expect(
      buildRepositoryMessage({
        fresh: false,
        history: [{ author: 'grant', text: 'earlier', ts: 't' }],
        message: 'Now do the privacy policy',
        title: 'Personas',
      })
    ).toBe('Now do the privacy policy');
  });

  it('explains the thread and replays it when the session is new', () => {
    const message = buildRepositoryMessage({
      fresh: true,
      history: [
        { author: 'grant', text: 'Add a persona group', ts: '2026-09-23T01:00:00.000Z' },
        { author: 'gpt', text: 'Added it', ts: '2026-09-23T01:05:00.000Z' },
      ],
      message: 'Now the privacy policy',
      title: 'Persona <group>',
    });

    expect(message).toContain('<repository_thread title="Persona &lt;group&gt;">');
    expect(message).toContain('<entry author="grant" ts="2026-09-23T01:00:00.000Z"><![CDATA[Add a persona group]]></entry>');
    expect(message).toContain('<entry author="gpt"');
    expect(message).toMatch(/leave review comments/i);
    expect(message.trim().endsWith('Now the privacy policy')).toBe(true);
  });

  it("leaves an AI's errors out of the thread a new session is sent", () => {
    const message = buildRepositoryMessage({
      fresh: true,
      history: [
        { author: 'grant', text: 'Add a persona group', ts: '2026-09-23T01:00:00.000Z' },
        { author: 'claude', kind: 'error', text: "Couldn't start: not signed in", ts: '2026-09-23T01:01:00.000Z' },
      ],
      message: 'Try again',
      title: 'Personas',
    });

    expect(message).toContain('Add a persona group');
    expect(message).not.toContain('not signed in');
  });
});
