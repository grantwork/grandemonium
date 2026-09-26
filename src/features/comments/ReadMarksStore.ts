import { readMarkKey,type ReadMarks } from './inboxModel';

/**
 * Whether a thread has been read is personal and device-local, so it is kept
 * out of the shared comment block, beside the author override.
 */
export const READ_MARKS_KEY = 'grandemonium.comments.readMarks';

export interface ReadMarksStorage {
  load(key: string): unknown;
  save(key: string, value: unknown): void;
}

export interface ReadMark {
  filePath: string;
  id: string;
  /** Activity timestamp that was on screen, as epoch milliseconds. */
  at: number;
}

function decode(stored: unknown): Map<string, number> {
  const marks = new Map<string, number>();
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return marks;
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) marks.set(key, value);
  }
  return marks;
}

/** The last activity the reader has seen on each thread. */
export class ReadMarksStore {
  /** Read on first use: the store is built during plugin construction, before
   * the vault's local storage is necessarily there to be read. */
  private loaded: Map<string, number> | null = null;

  constructor(private readonly storage: ReadMarksStorage) {}

  marks(): ReadMarks {
    return this.entries();
  }

  private entries(): Map<string, number> {
    return (this.loaded ??= decode(this.storage.load(READ_MARKS_KEY)));
  }

  markRead(filePath: string, id: string, at: number): void {
    if (this.remember(filePath, id, at)) this.flush();
  }

  markAllRead(items: Iterable<ReadMark>): void {
    let changed = false;
    for (const item of items) {
      if (this.remember(item.filePath, item.id, item.at)) changed = true;
    }
    if (changed) this.flush();
  }

  rename(from: string, to: string): void {
    const prefix = `${from}\u0000`;
    let changed = false;
    for (const [key, at] of [...this.entries().entries()]) {
      if (!key.startsWith(prefix)) continue;
      this.entries().delete(key);
      this.entries().set(`${to}\u0000${key.slice(prefix.length)}`, at);
      changed = true;
    }
    if (changed) this.flush();
  }

  /** Drops marks for files that no longer exist, so the record stays bounded. */
  prune(livePaths: ReadonlySet<string>): void {
    let changed = false;
    for (const key of [...this.entries().keys()]) {
      const cut = key.indexOf('\u0000');
      if (cut === -1 || livePaths.has(key.slice(0, cut))) continue;
      this.entries().delete(key);
      changed = true;
    }
    if (changed) this.flush();
  }

  /** Later activity only: re-reading an old thread must not hide a newer reply. */
  private remember(filePath: string, id: string, at: number): boolean {
    if (!Number.isFinite(at)) return false;
    const key = readMarkKey(filePath, id);
    if ((this.entries().get(key) ?? 0) >= at) return false;
    this.entries().set(key, at);
    return true;
  }

  private flush(): void {
    this.storage.save(READ_MARKS_KEY, Object.fromEntries(this.entries()));
  }
}
