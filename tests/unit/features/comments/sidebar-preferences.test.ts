import { shouldSubmitComment, sortSidebarComments } from "@/features/comments/sidebar-preferences";
import type { ResolvedComment } from "@/features/comments/types";

function key(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: "Enter",
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    ...overrides,
  } as KeyboardEvent;
}

function comment(id: string, start: number, ts: string): ResolvedComment {
  return {
    id,
    comment: {
      anchor: { exact: id },
      status: "open",
      thread: [{ author: "Leon", ts, text: id }],
    },
    resolution: { kind: "resolved", start, end: start + 1, ambiguous: false },
  };
}

describe("sidebar preferences", () => {
  it("supports Enter or Cmd/Ctrl+Enter submission", () => {
    expect(shouldSubmitComment(key(), "enter")).toBe(true);
    expect(shouldSubmitComment(key({ shiftKey: true }), "enter")).toBe(false);
    expect(shouldSubmitComment(key({ metaKey: true }), "enter")).toBe(false);
    expect(shouldSubmitComment(key(), "mod-enter")).toBe(false);
    expect(shouldSubmitComment(key({ metaKey: true }), "mod-enter")).toBe(true);
    expect(shouldSubmitComment(key({ ctrlKey: true }), "mod-enter")).toBe(true);
  });

  it("sorts by document position or activity without mutating the input", () => {
    const old = comment("old", 20, "2026-08-10T10:00:00Z");
    const recent = comment("recent", 5, "2026-08-11T10:00:00Z");
    const input = [old, recent];

    expect(sortSidebarComments(input, "document").map((item) => item.id)).toEqual(["recent", "old"]);
    expect(sortSidebarComments(input, "newest").map((item) => item.id)).toEqual(["recent", "old"]);
    expect(sortSidebarComments(input, "oldest").map((item) => item.id)).toEqual(["old", "recent"]);
    expect(input).toEqual([old, recent]);
  });

  it("uses suggestion activity when it is newer than the discussion", () => {
    const suggestion = comment("suggestion", 20, "2026-08-09T10:00:00Z");
    suggestion.comment.suggestion = {
      replacement: "Updated text",
      author: "Leon",
      ts: "2026-08-11T12:00:00Z",
    };
    const reply = comment("reply", 5, "2026-08-11T10:00:00Z");

    expect(sortSidebarComments([reply, suggestion], "newest").map((item) => item.id)).toEqual([
      "suggestion",
      "reply",
    ]);
  });
});
