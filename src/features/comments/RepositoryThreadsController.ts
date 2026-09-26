import type {
  RepositoryTurn,
  RepositoryTurnCallbacks,
  RepositoryTurnResult,
} from '@/core/auxiliary/RepositoryThreadSession';
import type {
  ProviderApprovalInteractionRequest,
  ProviderApprovalInteractionResponse,
  ProviderInteractionPort,
} from '@/core/execution';
import type { ApprovalDecision, UsageInfo } from '@/core/types';

import { findAgentMention } from './agentMention';
import type { ResolveBehavior } from './CommentsSettings';
import {
  buildRepositoryMessage,
  fallbackThreadTitle,
  generateThreadId,
  parseRepositoryThreads,
  type RepositorySelection,
  type RepositoryThread,
  type RepositoryThreadEntry,
  serializeRepositoryThreads,
} from './RepositoryThread';

/** One agent's side of one thread, kept for as long as the thread is open. */
export interface RepositoryAgentSession {
  isFresh(): boolean;
  isRunning(): boolean;
  /** A null model leaves the provider's own default in place. */
  send(prompt: string, model: string | null, callbacks: RepositoryTurnCallbacks): RepositoryTurn;
  dispose(): Promise<void>;
}

export interface RepositoryComposerToolbar {
  refresh(): void;
  setUsage(usage: UsageInfo | null): void;
  destroy(): void;
}

export interface RepositoryToolbarBinding {
  getSelection(): RepositorySelection;
  onSelectionChange(selection: RepositorySelection): void;
}

/**
 * The AIs, as repository threads see them. Supplied by the composition root so
 * comments never import chat or provider code.
 */
export interface RepositoryAgentPort {
  /** Enabled AIs, by the name they sign comments with. */
  agents(): Array<{ name: string; providerId: string }>;
  /** Where a new thread goes: the named AI if enabled, else the first one. */
  defaultSelection(preferredAgentName: string): RepositorySelection | null;
  openSession(providerId: string, interactionPort: ProviderInteractionPort): RepositoryAgentSession;
  generateTitle(text: string): Promise<string | null>;
  mountToolbar(parent: HTMLElement, binding: RepositoryToolbarBinding): RepositoryComposerToolbar;
}

export interface RepositoryThreadsStorage {
  read(): Promise<unknown>;
  write(data: unknown): Promise<void>;
}

export interface RepositoryThreadsDeps {
  storage: RepositoryThreadsStorage;
  agents(): RepositoryAgentPort | null;
  author(): string;
  now(): string;
  /** A persistent notice stays until dismissed, for faults the reader must not miss. */
  notify(message: string, options?: { persistent?: boolean }): void;
  resolveBehavior(): ResolveBehavior;
  /** The standing reply target, used for a new thread's first AI. */
  preferredAgentName(): string;
}

export interface ApprovalChoice {
  label: string;
  description?: string;
  decision: ApprovalDecision;
}

export interface PendingApproval {
  readonly id: string;
  readonly agentName: string;
  readonly toolName: string;
  readonly description: string;
  readonly choices: readonly ApprovalChoice[];
}

/** An agent turn still running, as the panel shows it. */
export interface LiveTurn {
  readonly agentName: string;
  readonly startedAt: number;
  readonly text: string;
  /** Latest tool the agent started, such as "Edit Personas.md". */
  readonly activity: string | null;
}

export interface ThreadLiveState {
  turns: LiveTurn[];
  approvals: PendingApproval[];
  usage: UsageInfo | null;
}

interface RunningTurn {
  agentName: string;
  startedAt: number;
  text: string;
  activity: string | null;
  turn: RepositoryTurn | null;
}

interface ApprovalWaiter extends PendingApproval {
  readonly threadId: string;
  settle(decision: ApprovalDecision): void;
}

const DEFAULT_CHOICES: readonly ApprovalChoice[] = [
  { decision: 'allow', label: 'Allow' },
  { decision: 'allow-always', label: 'Always allow' },
  { decision: 'deny', label: 'Deny' },
];

const EMPTY_REPLY = '_Finished without a reply._';

/**
 * Repository threads: comments about the whole vault, each a conversation with
 * one or more agents that lasts until the thread is resolved. Resolving ends
 * those conversations. A file comment's review, by contrast, is a disposable
 * session, because its discussion lives in the note for the next one to read.
 *
 * Mutations are applied in memory first and written behind, in order, so the
 * panel never waits on disk to show what the reader just did.
 */
export class RepositoryThreadsController {
  private threads: RepositoryThread[] = [];
  private readonly sessions = new Map<string, RepositoryAgentSession>();
  private readonly running = new Map<string, Map<string, RunningTurn>>();
  private readonly approvals = new Map<string, ApprovalWaiter>();
  private readonly usage = new Map<string, UsageInfo>();
  private readonly listeners = new Set<(threadId: string | null) => void>();
  private writeQueue: Promise<void> = Promise.resolve();
  private approvalSequence = 0;
  private lastRedrawError: string | null = null;

  constructor(private readonly deps: RepositoryThreadsDeps) {}

  async load(): Promise<void> {
    this.threads = parseRepositoryThreads(await this.deps.storage.read());
    this.emit(null);
  }

  /** Called with a thread id for an update inside one thread, null for the list. */
  onChange(listener: (threadId: string | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(): RepositoryThread[] {
    return [...this.threads];
  }

  get(threadId: string): RepositoryThread | null {
    return this.threads.find((thread) => thread.id === threadId) ?? null;
  }

  isAvailable(): boolean {
    return this.deps.agents() !== null;
  }

  agentPort(): RepositoryAgentPort | null {
    return this.deps.agents();
  }

  defaultSelection(): RepositorySelection | null {
    return this.deps.agents()?.defaultSelection(this.deps.preferredAgentName()) ?? null;
  }

  live(threadId: string): ThreadLiveState {
    const turns = [...(this.running.get(threadId)?.values() ?? [])].map(
      ({ activity, agentName, startedAt, text }) => ({ activity, agentName, startedAt, text })
    );
    const approvals = [...this.approvals.values()]
      .filter((approval) => approval.threadId === threadId)
      .map(({ agentName, choices, description, id, toolName }) => ({
        agentName,
        choices,
        description,
        id,
        toolName,
      }));
    return { approvals, turns, usage: this.usage.get(threadId) ?? null };
  }

  isWorking(threadId: string): boolean {
    return (this.running.get(threadId)?.size ?? 0) > 0;
  }

  /** When the earliest turn still running was started, or null. */
  workingSince(threadId: string): number | null {
    const turns = [...(this.running.get(threadId)?.values() ?? [])];
    return turns.length ? Math.min(...turns.map((turn) => turn.startedAt)) : null;
  }

  /** Starts a thread and sends its first message to the chosen AI. */
  create(text: string, selection: RepositorySelection): RepositoryThread | null {
    const message = text.trim();
    if (!message) return null;
    const thread: RepositoryThread = {
      createdAt: this.deps.now(),
      id: generateThreadId(this.threads),
      selection,
      status: 'open',
      thread: [{ author: this.deps.author(), text: message, ts: this.deps.now() }],
      title: fallbackThreadTitle(message),
    };
    this.threads = [thread, ...this.threads];
    this.persist();
    this.emit(null);
    void this.nameThread(thread.id, message);
    this.dispatch(thread.id, message);
    return thread;
  }

  reply(threadId: string, text: string): void {
    const message = text.trim();
    const thread = this.get(threadId);
    if (!message || !thread || thread.status !== 'open') return;
    this.update(threadId, (current) => ({
      ...current,
      thread: [...current.thread, { author: this.deps.author(), text: message, ts: this.deps.now() }],
    }));
    this.dispatch(threadId, message);
  }

  setSelection(threadId: string, selection: RepositorySelection): void {
    this.update(threadId, (current) => ({ ...current, selection }));
  }

  rename(threadId: string, title: string): void {
    const trimmed = title.trim();
    if (trimmed) this.update(threadId, (current) => ({ ...current, title: trimmed }));
  }

  stop(threadId: string): void {
    for (const running of this.running.get(threadId)?.values() ?? []) running.turn?.cancel();
  }

  /** Resolving ends every agent conversation the thread started. */
  async resolve(threadId: string): Promise<void> {
    await this.closeSessions(threadId);
    if (this.deps.resolveBehavior() === 'remove') {
      this.threads = this.threads.filter((thread) => thread.id !== threadId);
      this.persist();
      this.emit(null);
      return;
    }
    this.update(threadId, (current) => ({ ...current, status: 'resolved' }), null);
  }

  reopen(threadId: string): void {
    this.update(threadId, (current) => ({ ...current, status: 'open' }), null);
  }

  async remove(threadId: string): Promise<void> {
    await this.closeSessions(threadId);
    this.threads = this.threads.filter((thread) => thread.id !== threadId);
    this.persist();
    this.emit(null);
  }

  answerApproval(approvalId: string, decision: ApprovalDecision): void {
    this.approvals.get(approvalId)?.settle(decision);
  }

  /** Ends every conversation and flushes pending writes, for plugin unload. */
  async dispose(): Promise<void> {
    for (const approval of [...this.approvals.values()]) approval.settle('cancel');
    for (const threadId of [...this.running.keys()]) this.stop(threadId);
    await Promise.all([...this.sessions.values()].map((session) => session.dispose().catch(() => undefined)));
    this.sessions.clear();
    await this.writeQueue.catch(() => undefined);
  }

  private dispatch(threadId: string, message: string): void {
    const port = this.deps.agents();
    const thread = this.get(threadId);
    if (!thread) return;
    if (!port) {
      this.deps.notify('No AI is available for repository comments.');
      return;
    }
    const agents = port.agents();
    // "@claude check this" brings another AI into the thread for one reply;
    // otherwise the thread's own choice answers.
    const mentioned = findAgentMention(message, agents.map((agent) => agent.name));
    const selection = thread.selection ?? port.defaultSelection(this.deps.preferredAgentName());
    const target = mentioned
      ? agents.find((agent) => agent.name === mentioned)
      : agents.find((agent) => agent.providerId === selection?.providerId);
    if (!target) {
      this.deps.notify('The AI this thread was using is not enabled. Pick another model below.');
      return;
    }
    const model = !mentioned && selection?.providerId === target.providerId ? selection.model : null;
    const key = sessionKey(threadId, target.providerId);
    let session = this.sessions.get(key);
    if (!session) {
      try {
        session = port.openSession(target.providerId, this.interactionPort(threadId, target.name));
      } catch (error) {
        this.failToStart(threadId, target.name, error);
        return;
      }
      this.sessions.set(key, session);
    }
    if (session.isRunning()) {
      this.deps.notify(`${target.name} is still working on this thread. Wait for it, or stop it first.`);
      return;
    }

    const prompt = buildRepositoryMessage({
      fresh: session.isFresh(),
      history: thread.thread.slice(0, -1),
      message,
      title: thread.title,
    });
    const running: RunningTurn = {
      activity: null,
      agentName: target.name,
      startedAt: Date.now(),
      text: '',
      turn: null,
    };
    let turns = this.running.get(threadId);
    if (!turns) {
      turns = new Map();
      this.running.set(threadId, turns);
    }
    turns.set(target.name, running);
    try {
      running.turn = session.send(prompt, model, {
        onActivity: (label) => {
          running.activity = label;
          this.emit(threadId);
        },
        onText: (text) => {
          running.text = text;
          this.emit(threadId);
        },
        onUsage: (usage) => {
          this.usage.set(threadId, usage);
          this.emit(threadId);
        },
      });
    } catch (error) {
      turns.delete(target.name);
      if (turns.size === 0) this.running.delete(threadId);
      this.failToStart(threadId, target.name, error);
      return;
    }
    void running.turn.done.then((result) => this.finishTurn(threadId, target.name, result));
    this.emit(null);
  }

  /** The reader's message is already saved; say under it why no AI picked it up. */
  private failToStart(threadId: string, agentName: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.appendEntries(threadId, [this.errorEntry(agentName, `Couldn't start: ${message}`)]);
  }

  private errorEntry(agentName: string, text: string): RepositoryThreadEntry {
    return { author: agentName, kind: 'error', text, ts: this.deps.now() };
  }

  private appendEntries(threadId: string, entries: RepositoryThreadEntry[]): void {
    if (!this.get(threadId)) {
      this.emit(null);
      return;
    }
    this.update(threadId, (current) => ({ ...current, thread: [...current.thread, ...entries] }), null);
  }

  private finishTurn(threadId: string, agentName: string, result: RepositoryTurnResult): void {
    const turns = this.running.get(threadId);
    turns?.delete(agentName);
    if (turns?.size === 0) this.running.delete(threadId);
    const reply = replyText(result);
    const entries: RepositoryThreadEntry[] = reply ? [{ author: agentName, text: reply, ts: this.deps.now() }] : [];
    if (result.kind === 'failed') entries.push(this.errorEntry(agentName, `Couldn't finish: ${result.message}`));
    this.appendEntries(threadId, entries);
  }

  private interactionPort(threadId: string, agentName: string): ProviderInteractionPort {
    return {
      askUserQuestion: async (request) => {
        // Questions need their own form; until the panel has one, the agent is
        // told to ask in its reply instead.
        return { answers: null, interactionId: request.interactionId };
      },
      dismissInteraction: (interactionId) => {
        for (const approval of this.approvals.values()) {
          if (approval.id.endsWith(`:${interactionId}`)) approval.settle('cancel');
        }
      },
      requestApproval: (request, signal) => this.awaitApproval(threadId, agentName, request, signal),
    };
  }

  private awaitApproval(
    threadId: string,
    agentName: string,
    request: ProviderApprovalInteractionRequest,
    signal: AbortSignal
  ): Promise<ProviderApprovalInteractionResponse> {
    return new Promise((resolve) => {
      const id = `${++this.approvalSequence}:${request.interactionId}`;
      const choices: ApprovalChoice[] = request.decisionOptions?.length
        ? request.decisionOptions.map((option) => ({
            decision: option.decision ?? { type: 'select-option', value: option.value },
            label: option.label,
            ...(option.description ? { description: option.description } : {}),
          }))
        : [...DEFAULT_CHOICES];
      const onAbort = (): void => waiter.settle('cancel');
      const waiter: ApprovalWaiter = {
        agentName,
        choices,
        description: request.description || request.toolName,
        id,
        settle: (decision) => {
          if (!this.approvals.delete(id)) return;
          signal.removeEventListener('abort', onAbort);
          resolve({ decision, interactionId: request.interactionId });
          this.emit(threadId);
        },
        threadId,
        toolName: request.toolName,
      };
      this.approvals.set(id, waiter);
      if (signal.aborted) {
        waiter.settle('cancel');
        return;
      }
      signal.addEventListener('abort', onAbort);
      this.emit(threadId);
    });
  }

  private async nameThread(threadId: string, text: string): Promise<void> {
    const port = this.deps.agents();
    if (!port) return;
    const title = await port.generateTitle(text).catch(() => null);
    if (title?.trim()) this.rename(threadId, title);
  }

  private async closeSessions(threadId: string): Promise<void> {
    for (const approval of [...this.approvals.values()]) {
      if (approval.threadId === threadId) approval.settle('cancel');
    }
    this.stop(threadId);
    const closing: Promise<void>[] = [];
    for (const [key, session] of this.sessions) {
      if (!key.startsWith(`${threadId}\u0000`)) continue;
      this.sessions.delete(key);
      closing.push(session.dispose().catch(() => undefined));
    }
    this.usage.delete(threadId);
    await Promise.all(closing);
  }

  private update(
    threadId: string,
    change: (thread: RepositoryThread) => RepositoryThread,
    scope: string | null = threadId
  ): void {
    let changed = false;
    this.threads = this.threads.map((thread) => {
      if (thread.id !== threadId) return thread;
      changed = true;
      return change(thread);
    });
    if (!changed) return;
    this.persist();
    this.emit(scope);
  }

  private persist(): void {
    const snapshot = serializeRepositoryThreads(this.threads);
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(() => this.deps.storage.write(snapshot))
      .catch(() => {
        this.deps.notify('Repository comments could not be saved.');
      });
  }

  /**
   * A view that throws must not abort the change that notified it: a send
   * would lose its reply handler and the reader's message would look ignored.
   */
  private emit(threadId: string | null): void {
    for (const listener of this.listeners) {
      try {
        listener(threadId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Streaming emits many times a second; one notice per distinct fault.
        if (message === this.lastRedrawError) continue;
        this.lastRedrawError = message;
        this.deps.notify(`Repository comments could not be redrawn: ${message}`, { persistent: true });
      }
    }
  }
}

function sessionKey(threadId: string, providerId: string): string {
  return `${threadId}\u0000${providerId}`;
}

function replyText(result: RepositoryTurnResult): string | null {
  const text = result.text.trim();
  switch (result.kind) {
    case 'completed':
      return text || EMPTY_REPLY;
    case 'cancelled':
      return text ? `${text}\n\n_Stopped._` : null;
    case 'failed':
      // The error follows as its own entry.
      return text || null;
  }
}
