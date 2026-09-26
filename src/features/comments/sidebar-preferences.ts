import type { SidebarSortOrder, SubmitShortcut } from "./settings-model";
import type { ResolvedComment } from "./types";

interface SubmitKeyEvent {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  isComposing?: boolean;
}

export function shouldSubmitComment(event: SubmitKeyEvent, shortcut: SubmitShortcut): boolean {
  // Enter mid-composition commits the dictated or IME text; it is not a send.
  if (event.key !== "Enter" || event.isComposing) return false;
  return shortcut === "enter"
    ? !event.shiftKey && !event.metaKey && !event.ctrlKey
    : event.metaKey || event.ctrlKey;
}

function activityTimestamp(item: ResolvedComment): number {
  const threadTs = item.comment.thread[item.comment.thread.length - 1]?.ts;
  const suggestionTs = item.comment.suggestion?.ts;
  const parsedThreadTs = threadTs ? Date.parse(threadTs) : 0;
  const parsedSuggestionTs = suggestionTs ? Date.parse(suggestionTs) : 0;
  return Math.max(
    Number.isFinite(parsedThreadTs) ? parsedThreadTs : 0,
    Number.isFinite(parsedSuggestionTs) ? parsedSuggestionTs : 0
  );
}

export function sortSidebarComments(
  items: ResolvedComment[],
  order: SidebarSortOrder
): ResolvedComment[] {
  if (order === "document") {
    return [...items].sort(
      (a, b) =>
        (a.resolution.kind === "resolved" ? a.resolution.start : Number.MAX_SAFE_INTEGER) -
        (b.resolution.kind === "resolved" ? b.resolution.start : Number.MAX_SAFE_INTEGER)
    );
  }
  const direction = order === "newest" ? -1 : 1;
  return [...items].sort((a, b) => direction * (activityTimestamp(a) - activityTimestamp(b)));
}
