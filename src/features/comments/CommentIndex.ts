import type { InboxFileInput } from './inboxModel';
import { parseDocument, resolveAll } from './store';
import type { ResolvedComment } from './types';

export interface IndexedFile {
  path: string;
  /** Modification time, used to skip files that cannot have changed. */
  mtime: number;
}

/**
 * The vault, as the index needs it. Narrow on purpose: the index owns parsing
 * and anchor resolution, so the boundary only has to list and read.
 */
export interface CommentIndexSource {
  listFiles(): IndexedFile[];
  /** Null when the file has gone or cannot be read. */
  read(path: string): Promise<string | null>;
}

interface IndexEntry {
  mtime: number;
  comments: ResolvedComment[];
}

/**
 * Every commented file in the vault, so the sidebar can show work waiting in
 * notes that are not open. Comments live in a fenced block inside each note,
 * and Obsidian's metadata cache does not record fence languages, so finding
 * them means reading the files; modification times keep that to changed ones.
 */
export class CommentIndex {
  private readonly entries = new Map<string, IndexEntry>();

  constructor(private readonly source: CommentIndexSource) {}

  /** Files that currently carry at least one comment, in path order. */
  files(): InboxFileInput[] {
    return [...this.entries.entries()]
      .map(([path, entry]) => ({ path, comments: entry.comments }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Sweeps the vault, reading only what changed since the last sweep. */
  async refresh(): Promise<void> {
    const listed = this.source.listFiles();
    const seen = new Set<string>();
    for (const file of listed) {
      seen.add(file.path);
      const known = this.entries.get(file.path);
      if (known && known.mtime === file.mtime) continue;
      await this.refreshFile(file.path, file.mtime);
    }
    for (const path of [...this.entries.keys()]) {
      if (!seen.has(path)) this.entries.delete(path);
    }
  }

  /**
   * Re-reads one file, dropping it when it no longer holds usable comments.
   * Resolves false when the file neither had comments nor has them now, so a
   * save to an ordinary note does not redraw every open comment panel.
   */
  async refreshFile(path: string, mtime: number): Promise<boolean> {
    const had = this.entries.has(path);
    const raw = await this.source.read(path);
    if (raw === null) {
      this.entries.delete(path);
      return had;
    }
    const doc = parseDocument(raw);
    // A malformed block would otherwise surface as a file with no comments,
    // which reads as resolved work rather than as something needing repair.
    if (doc.error) {
      this.entries.delete(path);
      return had;
    }
    const comments = resolveAll(doc.prose, doc.comments);
    if (comments.length === 0) {
      this.entries.delete(path);
      return had;
    }
    this.entries.set(path, { comments, mtime });
    return true;
  }

  forget(path: string): void {
    this.entries.delete(path);
  }

  rename(from: string, to: string): void {
    const entry = this.entries.get(from);
    if (!entry) return;
    this.entries.delete(from);
    this.entries.set(to, entry);
  }

  clear(): void {
    this.entries.clear();
  }
}
