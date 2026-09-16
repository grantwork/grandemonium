import type { ChangeSet } from "@codemirror/state";

export interface TrackedAnchor {
  id: string;
  from: number;
  to: number;
}

/**
 * Maps anchor ranges through an editor change. `from` sticks to the character
 * after it (assoc 1), `to` to the character before it (assoc -1), so insertions
 * exactly at the edges do not grow into the anchor. Fully deleted ranges are
 * dropped and are treated as orphaned later.
 */
export function mapAnchors(anchors: TrackedAnchor[], changes: ChangeSet): TrackedAnchor[] {
  return anchors
    .map((a) => ({ id: a.id, from: changes.mapPos(a.from, 1), to: changes.mapPos(a.to, -1) }))
    .filter((a) => a.to > a.from);
}

/**
 * Heuristic: if a change replaces more than 50% of the old document, it is
 * probably an external full replace (for example vault.modify), so position
 * mapping is untrustworthy and state must be reparsed from the document.
 */
export function isFullReplace(changes: ChangeSet): boolean {
  let covered = 0;
  changes.iterChangedRanges((fromA, toA) => {
    covered += toA - fromA;
  });
  return changes.length > 0 && covered / changes.length > 0.5;
}

/**
 * Whether a transaction changes the tandem-comments region in either its old
 * or new coordinate space. Mixed prose + block transactions (such as accepting
 * a suggestion) must rebuild anchors from the resulting document instead of
 * retaining IDs that may have been removed from the block.
 */
export function changesTouchCommentBlock(changes: ChangeSet, oldProseLength: number, newProseLength: number): boolean {
  let touches = false;
  changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (
      fromA >= oldProseLength ||
      toA > oldProseLength ||
      fromB >= newProseLength ||
      toB > newProseLength
    ) {
      touches = true;
    }
  });
  return touches;
}

/**
 * Whether tracked anchors can be mapped safely through a block-touching
 * transaction. Explicit mixed transactions and block-only rewrites retain
 * meaningful change coordinates; a single large prose replacement does not.
 */
export function canPreservePendingAnchors(changes: ChangeSet, oldProseLength: number): boolean {
  let ranges = 0;
  let touchesProse = false;
  changes.iterChangedRanges((fromA) => {
    ranges++;
    if (fromA < oldProseLength) touchesProse = true;
  });
  return !isFullReplace(changes) || ranges > 1 || !touchesProse;
}

export function shouldPreservePendingAnchors(
  changes: ChangeSet,
  oldProseLength: number,
  isSuggestionAcceptance: boolean
): boolean {
  return isSuggestionAcceptance || canPreservePendingAnchors(changes, oldProseLength);
}

/**
 * Restores in-memory anchors that disappeared only because a block rewrite
 * serialized stale quote data before the reanchor debounce could flush.
 */
export function mergePendingAnchors(
  current: TrackedAnchor[],
  pending: TrackedAnchor[],
  recoverableIds: ReadonlySet<string>
): TrackedAnchor[] {
  const result = [...current];
  const present = new Set(current.map((anchor) => anchor.id));
  for (const anchor of pending) {
    if (present.has(anchor.id) || !recoverableIds.has(anchor.id) || anchor.to <= anchor.from) continue;
    result.push(anchor);
    present.add(anchor.id);
  }
  result.sort((a, b) => a.from - b.from);
  return result;
}
