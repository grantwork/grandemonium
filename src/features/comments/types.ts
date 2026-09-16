export interface Anchor {
  /** Exact quote of the commented range. */
  exact: string;
  /** A few characters before the quote, used for disambiguation. */
  prefix?: string;
  /** A few characters after the quote, used for disambiguation. */
  suffix?: string;
  /** Character offset into the prose, used as a fallback when the quote is ambiguous. */
  pos?: number;
}

export interface ThreadEntry {
  author: string;
  ts: string;
  text: string;
}

export type CommentStatus = "open" | "resolved";

export type SuggestionResult = "accepted" | "declined";

export interface EditSuggestion {
  /** Replacement text proposed for the anchored passage. */
  replacement: string;
  /** Author and timestamp belong to the proposal itself, independently of its discussion thread. */
  author: string;
  ts: string;
  /** Present only when resolved suggestions are retained as history. */
  result?: SuggestionResult;
}

export interface CommentEntry {
  anchor: Anchor;
  status: CommentStatus;
  thread: ThreadEntry[];
  /** Presence turns this comment into a replacement-only edit suggestion. */
  suggestion?: EditSuggestion;
}

export type CommentMap = Record<string, CommentEntry>;

export interface ParsedDoc {
  prose: string;
  comments: CommentMap;
  /**
   * Content after the closing fence line, byte exact (for example footnote
   * definitions that Obsidian appends to the end of the file, Issue #2).
   */
  trailing?: string;
  /** Set when a tandem-comments block exists but its JSON is broken. */
  error?: string;
}

export type AnchorResolution =
  | { kind: "resolved"; start: number; end: number; ambiguous?: boolean }
  | { kind: "orphaned" };

export interface ResolvedComment {
  id: string;
  comment: CommentEntry;
  resolution: AnchorResolution;
}
