import { escapePromptXmlAttribute, formatPromptXmlCdata } from '@/utils/promptXml';

import type { CommentStatus, ThreadEntry } from './types';

/** Which AI and model a thread's replies go to unless one names another AI. */
export interface RepositorySelection {
  providerId: string;
  model: string;
}

/**
 * One message in a repository thread. An AI's error is kept in the thread,
 * where the reader is looking, rather than in a notice that fades; the mark
 * lets the panel flag it and keeps it out of what a new session is sent.
 */
export interface RepositoryThreadEntry extends ThreadEntry {
  kind?: 'error';
}

/**
 * A comment about the whole vault rather than a passage in one note: a task
 * such as "add a persona group and update the privacy policy" that touches
 * many files. It has no anchor, so it cannot live in any one note's comment
 * block, and is kept in plugin data instead.
 */
export interface RepositoryThread {
  id: string;
  /** Short name for the list, generated from the first message. */
  title: string;
  status: CommentStatus;
  createdAt: string;
  thread: RepositoryThreadEntry[];
  selection: RepositorySelection | null;
}

export const REPOSITORY_THREADS_VERSION = 1;
const TITLE_MAX = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseEntry(raw: unknown): RepositoryThreadEntry | null {
  if (!isRecord(raw)) return null;
  const { author, text, ts } = raw;
  if (typeof author !== 'string' || typeof text !== 'string' || typeof ts !== 'string') return null;
  return raw.kind === 'error' ? { author, kind: 'error', text, ts } : { author, text, ts };
}

function parseSelection(raw: unknown): RepositorySelection | null {
  if (!isRecord(raw)) return null;
  const { model, providerId } = raw;
  if (typeof providerId !== 'string' || !providerId || typeof model !== 'string' || !model) {
    return null;
  }
  return { model, providerId };
}

function parseThread(raw: unknown): RepositoryThread | null {
  if (!isRecord(raw)) return null;
  const { createdAt, id, status, thread, title } = raw;
  if (typeof id !== 'string' || !id || typeof title !== 'string') return null;
  if (status !== 'open' && status !== 'resolved') return null;
  if (typeof createdAt !== 'string' || !Array.isArray(thread)) return null;
  const entries = thread.map(parseEntry);
  if (entries.some((entry) => entry === null)) return null;
  return {
    createdAt,
    id,
    selection: parseSelection(raw.selection),
    status,
    thread: entries as RepositoryThreadEntry[],
    title,
  };
}

/**
 * Stored data is untrusted: a thread that does not decode is dropped on its
 * own, so one bad entry never costs the reader every other thread.
 */
export function parseRepositoryThreads(raw: unknown): RepositoryThread[] {
  if (!isRecord(raw) || !Array.isArray(raw.threads)) return [];
  const seen = new Set<string>();
  const threads: RepositoryThread[] = [];
  for (const candidate of raw.threads) {
    const thread = parseThread(candidate);
    if (!thread || seen.has(thread.id)) continue;
    seen.add(thread.id);
    threads.push(thread);
  }
  return threads;
}

export function serializeRepositoryThreads(threads: readonly RepositoryThread[]): unknown {
  return { threads, version: REPOSITORY_THREADS_VERSION };
}

/** The title a thread shows until, or unless, a generated one arrives. */
export function fallbackThreadTitle(text: string): string {
  const firstLine = text.trim().split('\n')[0]?.trim() ?? '';
  if (firstLine.length <= TITLE_MAX) return firstLine || 'Repository task';
  return firstLine.slice(0, TITLE_MAX - 1) + '…';
}

export function generateThreadId(existing: readonly RepositoryThread[]): string {
  const taken = new Set(existing.map((thread) => thread.id));
  for (;;) {
    const id = 'r' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
    if (!taken.has(id)) return id;
  }
}

export interface RepositoryMessageInput {
  /** True when the agent's session is new and has none of the thread yet. */
  fresh: boolean;
  /** Everything said before this message. */
  history: readonly RepositoryThreadEntry[];
  message: string;
  title: string;
}

/**
 * The turn sent to an agent. A session that already holds the conversation
 * gets only the new message, as a chat would. A new one, whether this is the
 * first message or the old session was lost to a restart, gets the thread so
 * far and what the thread is for, since it cannot know either.
 */
export function buildRepositoryMessage(input: RepositoryMessageInput): string {
  const message = input.message.trim();
  if (!input.fresh) return message;
  const lines = [
    `<repository_thread title="${escapePromptXmlAttribute(input.title)}">`,
    ...input.history.filter((entry) => entry.kind !== 'error').map(
      (entry) =>
        `  <entry author="${escapePromptXmlAttribute(entry.author)}"` +
        ` ts="${escapePromptXmlAttribute(entry.ts)}">${formatPromptXmlCdata(entry.text)}</entry>`
    ),
    '</repository_thread>',
    '',
    'This request comes from a repository comment thread: a task about the whole' +
      ' vault, not one note. Carry it out across whichever files it needs.',
    'Your final message is posted to the thread as your reply, so end with a short' +
      ' summary of what you changed.',
    "Where a change needs the user's review or a decision, leave review comments on" +
      ' the relevant passages in the affected notes, signed with your name, rather' +
      ' than listing them in your reply. Those comments appear under their notes in' +
      ' the same panel.',
    '',
    message,
  ];
  return lines.join('\n');
}
