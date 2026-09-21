/** Offsets of a passage inside the document text. */
export interface SelectionRange {
  from: number;
  to: number;
}

export interface SelectionCommentContext extends SelectionRange {
  /** The "comment on selection" setting. */
  enabled: boolean;
  /** Length of the commentable prose, i.e. everything before the comment block. */
  proseLength: number;
  /** Passage the sidebar is already drafting against, when it resolves. */
  openDraftRange: SelectionRange | null;
}

/**
 * Decides whether releasing a selection should open a comment draft. A repeat
 * selection of the passage already being drafted is ignored, so re-selecting
 * text never discards what has been typed into the open draft.
 */
export function shouldStartSelectionComment(context: SelectionCommentContext): boolean {
  const { enabled, from, to, proseLength, openDraftRange } = context;
  if (!enabled) return false;
  if (from >= to) return false;
  if (to > proseLength) return false;
  if (openDraftRange && openDraftRange.from === from && openDraftRange.to === to) return false;
  return true;
}
