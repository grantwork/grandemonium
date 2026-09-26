import type { SidebarSortOrder } from "./CommentsSettings";
import type { AnchorResolution, CommentEntry, ResolvedComment } from "./types";

/**
 * How a row reads at a glance. Every open comment is waiting on the reader,
 * because a comment dispatches an agent that answers within minutes, so the
 * kind carries the distinction that ranking by "who is waiting" cannot.
 */
export type InboxItemKind = "comment" | "suggestion" | "rewritten";

export interface InboxItem {
  filePath: string;
  id: string;
  comment: CommentEntry;
  resolution: AnchorResolution;
  kind: InboxItemKind;
  /**
   * The passage the thread is attached to, which is what names it in the list:
   * a thread is about a place in the note, and the reader recognises that place
   * far faster than they recognise the last thing said about it.
   */
  title: string;
  /** The latest thing said, kept for the row's tooltip and the expanded card. */
  blurb: string;
  /** Author of the most recent activity. */
  author: string;
  /** Timestamp of the most recent activity, as stored. */
  ts: string;
  /** The same activity as epoch milliseconds, 0 when unparseable. */
  at: number;
  /** Activity the reader has not seen. A marker only: it never hides a row. */
  unread: boolean;
  /**
   * When the review this thread is waiting on was asked for, or null while no AI
   * is working on it. A time rather than a flag, so the row can show how long.
   */
  workingSince: number | null;
}

export interface InboxFileGroup {
  filePath: string;
  fileName: string;
  /** Immediate parent folder only, "" at the vault root. A deep path is more
   * text than a sidebar row can carry; the full one goes in the tooltip. */
  folder: string;
  /** The whole parent path, for the tooltip. */
  folderPath: string;
  items: InboxItem[];
  /** How many of those carry activity the reader has not seen. */
  unreadCount: number;
  /** An agent turn dispatched for this file has not answered yet. */
  running: boolean;
}

/**
 * The whole vault as one list to work through. Every open comment appears under
 * its file: the panel exists to be emptied, so nothing is filed away behind a
 * section the reader has to remember to open. Unread is a marker on a row, not
 * a place rows go. The note being read is not singled out either, so the list
 * does not rearrange when the reader opens a different note.
 */
export interface InboxView {
  files: InboxFileGroup[];
  /** Open comments across the whole vault. */
  openCount: number;
  /** Files with an agent turn in flight, counted even when not yet indexed. */
  runningCount: number;
  /** Shown only behind the resolved toggle. */
  resolvedGroups: InboxFileGroup[];
  resolvedCount: number;
}

export type ReadMarks = ReadonlyMap<string, number>;

export interface InboxFileInput {
  path: string;
  /** Already resolved against that file's own prose. */
  comments: ResolvedComment[];
}

export interface BuildInboxInput {
  files: InboxFileInput[];
  readMarks: ReadMarks;
  runningPaths: ReadonlySet<string>;
  /** Thread key to when its oldest unfinished review was asked for. */
  runningThreads?: ReadonlyMap<string, number>;
  /** The author label this device writes under. */
  selfAuthor: string;
  /** Mirrors the sidebar sort setting; defaults to document order. */
  sortOrder?: SidebarSortOrder;
}

const BLURB_LIMIT = 160;

/** Read state is per person, so it is keyed outside the shared comment block. */
export function readMarkKey(filePath: string, id: string): string {
  return `${filePath}\u0000${id}`;
}

export function fileNameOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}

export function folderOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

/** The one folder a file sits in, which is what a narrow row has room for. */
export function parentFolderOf(path: string): string {
  const folder = folderOf(path);
  const cut = folder.lastIndexOf("/");
  return cut === -1 ? folder : folder.slice(cut + 1);
}

/**
 * Comment text is Markdown, and a row shows one line of plain prose, so the
 * syntax is stripped rather than rendered: unrendered `**bold**` and
 * `[[long/wiki/link]]` are exactly the noise that makes a list unreadable.
 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1")
    .replace(/!?\[\[([^\]]*)\]\]/g, (_match, target: string) => target.split("/").pop() ?? target)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*\*|___)(.*?)\1/g, "$2")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(?<![\w*])[*_](?=\S)(.*?)(?<=\S)[*_](?![\w*])/g, "$1")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, "");
}

function parseTs(ts: string | undefined): number {
  if (!ts) return 0;
  const parsed = Date.parse(ts);
  return Number.isFinite(parsed) ? parsed : 0;
}

function suggestionOf(comment: CommentEntry): { replacement: string; decided: boolean } | null {
  const suggestion: unknown = comment.suggestion;
  if (typeof suggestion !== "object" || suggestion === null || Array.isArray(suggestion)) return null;
  const record = suggestion as Record<string, unknown>;
  const replacement = typeof record.replacement === "string" ? record.replacement : "";
  return { replacement, decided: record.result !== undefined };
}

/** The most recent thing that happened, whether a reply or the proposal itself. */
function latestActivity(comment: CommentEntry): { author: string; ts: string; at: number } {
  let best = { author: "", ts: "", at: 0 };
  const last = comment.thread[comment.thread.length - 1];
  if (last) best = { author: last.author, ts: last.ts, at: parseTs(last.ts) };
  const suggestion = comment.suggestion;
  if (suggestion) {
    const at = parseTs(suggestion.ts);
    if (at > best.at) best = { author: suggestion.author, ts: suggestion.ts, at };
  }
  return best;
}

function condense(text: string): string {
  const flat = plainText(text).replace(/\s+/g, " ").trim();
  return flat.length > BLURB_LIMIT ? `${flat.slice(0, BLURB_LIMIT - 1)}…` : flat;
}

function blurbOf(comment: CommentEntry, kind: InboxItemKind): string {
  if (kind === "suggestion") {
    const replacement = suggestionOf(comment)?.replacement ?? "";
    if (replacement) return `Suggests "${condense(replacement)}"`;
  }
  const last = comment.thread[comment.thread.length - 1];
  if (last?.text) return condense(last.text);
  return condense(comment.anchor.exact);
}

function kindOf(comment: CommentEntry, resolution: AnchorResolution): InboxItemKind {
  // An anchor that no longer matches usually means an agent rewrote the
  // passage, which is a result to confirm rather than a fault to repair. It
  // outranks a suggestion because that suggestion can no longer be applied.
  if (resolution.kind === "orphaned") return "rewritten";
  const suggestion = suggestionOf(comment);
  return suggestion && !suggestion.decided ? "suggestion" : "comment";
}

function toItem(
  filePath: string,
  resolved: ResolvedComment,
  readMarks: ReadMarks,
  selfAuthor: string,
  runningThreads: ReadonlyMap<string, number>
): InboxItem {
  const { comment, id, resolution } = resolved;
  const kind = kindOf(comment, resolution);
  const activity = latestActivity(comment);
  const seenAt = readMarks.get(readMarkKey(filePath, id)) ?? 0;
  return {
    filePath,
    id,
    comment,
    resolution,
    kind,
    title: condense(comment.anchor.exact),
    blurb: blurbOf(comment, kind),
    author: activity.author,
    ts: activity.ts,
    at: activity.at,
    // The reader's own reply is not news to them, and it lands before the
    // agent has had a chance to answer, so it must not light the row up.
    unread: activity.at > seenAt && activity.author !== selfAuthor,
    workingSince: runningThreads.get(readMarkKey(filePath, id)) ?? null,
  };
}

/** Mirrors the sidebar sort setting, over the fields a row already carries. */
function comparatorFor(order: SidebarSortOrder): (a: InboxItem, b: InboxItem) => number {
  if (order === "document") {
    const position = (item: InboxItem) =>
      item.resolution.kind === "resolved" ? item.resolution.start : Number.MAX_SAFE_INTEGER;
    return (a, b) => position(a) - position(b);
  }
  const direction = order === "newest" ? -1 : 1;
  return (a, b) => direction * (a.at - b.at);
}

function newestActivity(items: InboxItem[]): number {
  return items.reduce((newest, item) => Math.max(newest, item.at), 0);
}

function groupsOf(
  byFile: Map<string, InboxItem[]>,
  order: SidebarSortOrder,
  runningPaths: ReadonlySet<string>
): InboxFileGroup[] {
  const within = comparatorFor(order);
  return (
    [...byFile.entries()]
      .map(([filePath, items]) => ({
        filePath,
        fileName: fileNameOf(filePath),
        folder: parentFolderOf(filePath),
        folderPath: folderOf(filePath),
        items: [...items].sort(within),
        unreadCount: items.filter((item) => item.unread).length,
        running: runningPaths.has(filePath),
      }))
      // Files lead with the freshest activity: the reader is looking for what
      // just came back, whatever order they read a note in.
      .sort((a, b) => newestActivity(b.items) - newestActivity(a.items))
  );
}

export function buildInbox(input: BuildInboxInput): InboxView {
  const {
    files,
    readMarks,
    runningPaths,
    runningThreads = new Map<string, number>(),
    selfAuthor,
    sortOrder = "document",
  } = input;
  const openByFile = new Map<string, InboxItem[]>();
  const resolvedByFile = new Map<string, InboxItem[]>();

  const collect = (bucket: Map<string, InboxItem[]>, item: InboxItem): void => {
    const existing = bucket.get(item.filePath);
    if (existing) existing.push(item);
    else bucket.set(item.filePath, [item]);
  };

  for (const file of files) {
    for (const resolved of file.comments) {
      const item = toItem(file.path, resolved, readMarks, selfAuthor, runningThreads);
      collect(resolved.comment.status === "open" ? openByFile : resolvedByFile, item);
    }
  }

  const grouped = groupsOf(openByFile, sortOrder, runningPaths);
  const resolvedGroups = groupsOf(resolvedByFile, sortOrder, runningPaths);
  return {
    files: grouped,
    openCount: grouped.reduce((total, group) => total + group.items.length, 0),
    resolvedGroups,
    resolvedCount: resolvedGroups.reduce((total, group) => total + group.items.length, 0),
    runningCount: runningPaths.size,
  };
}
