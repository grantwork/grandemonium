import { buildInbox } from "@/features/comments/inbox-model";
import type { CommentEntry, ResolvedComment } from "@/features/comments/types";

function resolved(
  id: string,
  entry: Partial<CommentEntry> & { thread: CommentEntry["thread"] },
  start: number | null = 0
): ResolvedComment {
  return {
    id,
    comment: { anchor: { exact: id }, status: "open", ...entry },
    resolution:
      start === null ? { kind: "orphaned" } : { kind: "resolved", start, end: start + 1 },
  };
}

function reply(author: string, ts: string, text: string): CommentEntry["thread"][number] {
  return { author, ts, text };
}

const BASE = { readMarks: new Map<string, number>(), runningPaths: new Set<string>(), selfAuthor: "grant" };

describe("inbox model", () => {
  it("lists every file with open comments, most recent activity first", () => {
    const view = buildInbox({
      ...BASE,
      files: [
        {
          path: "Personal/Portal.md",
          comments: [resolved("stale", { thread: [reply("claude", "2026-09-20T09:00:00Z", "Older")] })],
        },
        {
          path: "Optizmo/Pricing.md",
          comments: [resolved("fresh", { thread: [reply("claude", "2026-09-21T09:00:00Z", "Newer")] })],
        },
      ],
    });

    expect(view.files.map((group) => group.filePath)).toEqual([
      "Optizmo/Pricing.md",
      "Personal/Portal.md",
    ]);
    expect(view.files[0].fileName).toBe("Pricing.md");
    expect(view.files[0].folder).toBe("Optizmo");
    expect(view.openCount).toBe(2);
  });

  it("keeps a thread listed once it has been read, marking it only as not new", () => {
    const view = buildInbox({
      ...BASE,
      files: [
        {
          path: "Optizmo/Pricing.md",
          comments: [
            resolved("read", { thread: [reply("claude", "2026-09-21T09:00:00Z", "Answered")] }),
            resolved("new", { thread: [reply("claude", "2026-09-21T10:00:00Z", "Fresh")] }, 40),
          ],
        },
      ],
      readMarks: new Map([["Optizmo/Pricing.md\u0000read", Date.parse("2026-09-21T09:00:00Z")]]),
    });

    const [group] = view.files;
    expect(group.items.map((item) => item.id).sort()).toEqual(["new", "read"]);
    expect(group.items.find((item) => item.id === "read")?.unread).toBe(false);
    expect(group.items.find((item) => item.id === "new")?.unread).toBe(true);
    expect(group.unreadCount).toBe(1);
  });

  it("never marks a thread unread when the reader spoke last", () => {
    const view = buildInbox({
      ...BASE,
      files: [
        {
          path: "Optizmo/Pricing.md",
          comments: [
            resolved("mine", {
              thread: [
                reply("claude", "2026-09-21T09:00:00Z", "Which figure?"),
                reply("grant", "2026-09-21T09:05:00Z", "The August one."),
              ],
            }),
          ],
        },
      ],
    });

    expect(view.files[0].items[0].unread).toBe(false);
    expect(view.files[0].unreadCount).toBe(0);
  });

  it("orders a file's threads by the reader's chosen sort", () => {
    const files = [
      {
        path: "Optizmo/Pricing.md",
        comments: [
          resolved("late", { thread: [reply("claude", "2026-09-21T11:00:00Z", "Newer")] }, 90),
          resolved("early", { thread: [reply("claude", "2026-09-21T10:00:00Z", "Older")] }, 10),
        ],
      },
    ];

    expect(
      buildInbox({ ...BASE, files, sortOrder: "document" }).files[0].items.map((i) => i.id)
    ).toEqual(["early", "late"]);
    expect(
      buildInbox({ ...BASE, files, sortOrder: "oldest" }).files[0].items.map((i) => i.id)
    ).toEqual(["early", "late"]);
    expect(
      buildInbox({ ...BASE, files, sortOrder: "newest" }).files[0].items.map((i) => i.id)
    ).toEqual(["late", "early"]);
  });

  it("titles a thread with the passage it is attached to, not its discussion", () => {
    const view = buildInbox({
      ...BASE,
      files: [
        {
          path: "canon/products/postlever.md",
          comments: [
            {
              id: "a",
              comment: {
                anchor: { exact: "**Standing:** Partially defined pricing model" },
                status: "open",
                thread: [reply("gpt", "2026-09-22T08:36:00Z", "Updated the draft.")],
              },
              resolution: { kind: "resolved", start: 0, end: 10 },
            },
          ],
        },
      ],
    });

    const item = view.files[0].items[0];
    expect(item.title).toBe("Standing: Partially defined pricing model");
    expect(item.blurb).toBe("Updated the draft.");
  });

  it("reads a blurb as prose, not as the markdown it was written in", () => {
    const view = buildInbox({
      ...BASE,
      files: [
        {
          path: "Optizmo/Pricing.md",
          comments: [
            resolved("md", {
              thread: [
                reply(
                  "claude",
                  "2026-09-21T09:00:00Z",
                  "**Rewritten:** [[canon/entries/analytics|analytics]] now uses `net30`, see [the MSA](https://x.test)."
                ),
              ],
            }),
          ],
        },
      ],
    });

    expect(view.files[0].items[0].blurb).toBe(
      "Rewritten: analytics now uses net30, see the MSA."
    );
  });

  it("names a file by its own folder rather than its whole path", () => {
    const view = buildInbox({
      ...BASE,
      files: [
        {
          path: "canon/operations/infrastructure/entries/analytics.md",
          comments: [resolved("a", { thread: [reply("claude", "2026-09-21T09:00:00Z", "Hi")] })],
        },
      ],
    });

    expect(view.files[0].folder).toBe("entries");
    expect(view.files[0].folderPath).toBe("canon/operations/infrastructure/entries");
  });

  it("classifies an undecided suggestion and blurbs its replacement", () => {
    const view = buildInbox({
      ...BASE,
      files: [
        {
          path: "Optizmo/Pricing.md",
          comments: [
            resolved("edit", {
              thread: [reply("claude", "2026-09-21T09:00:00Z", "Fourteen days contradicts the MSA.")],
              suggestion: {
                replacement: "net 30 from invoice date",
                author: "claude",
                ts: "2026-09-21T09:00:00Z",
              },
            }),
          ],
        },
      ],
    });

    const item = view.files[0].items[0];
    expect(item.kind).toBe("suggestion");
    expect(item.blurb).toBe('Suggests "net 30 from invoice date"');
  });

  it("classifies an open comment whose passage is gone as rewritten", () => {
    const view = buildInbox({
      ...BASE,
      files: [
        {
          path: "Optizmo/Pricing.md",
          comments: [
            resolved(
              "gone",
              { thread: [reply("claude", "2026-09-21T09:00:00Z", "Changed it to monthly.")] },
              null
            ),
          ],
        },
      ],
    });

    const item = view.files[0].items[0];
    expect(item.kind).toBe("rewritten");
    expect(item.blurb).toBe("Changed it to monthly.");
  });

  it("keeps resolved comments apart from the open list", () => {
    const view = buildInbox({
      ...BASE,
      files: [
        {
          path: "Optizmo/Pricing.md",
          comments: [
            resolved("done", {
              status: "resolved",
              thread: [reply("claude", "2026-09-21T09:00:00Z", "Handled.")],
            }),
            resolved("live", { thread: [reply("claude", "2026-09-21T10:00:00Z", "Still open.")] }),
          ],
        },
      ],
    });

    expect(view.files[0].items.map((item) => item.id)).toEqual(["live"]);
    expect(view.openCount).toBe(1);
    expect(view.resolvedGroups[0].items.map((item) => item.id)).toEqual(["done"]);
    expect(view.resolvedCount).toBe(1);
  });

  it("dates the one thread an agent is working on, and leaves its neighbours idle", () => {
    const view = buildInbox({
      ...BASE,
      files: [
        {
          path: "Optizmo/Pricing.md",
          comments: [
            resolved("asked", { thread: [reply("grant", "2026-09-22T09:00:00Z", "Check these.")] }),
            resolved("other", { thread: [reply("claude", "2026-09-22T08:00:00Z", "Done.")] }, 40),
          ],
        },
      ],
      runningPaths: new Set(["Optizmo/Pricing.md"]),
      runningThreads: new Map([["Optizmo/Pricing.md\u0000asked", 7_000]]),
    });

    const items = view.files[0].items;
    expect(items.find((item) => item.id === "asked")?.workingSince).toBe(7_000);
    expect(items.find((item) => item.id === "other")?.workingSince).toBeNull();
  });

  it("flags the file an agent is still working on", () => {
    const view = buildInbox({
      ...BASE,
      files: [
        {
          path: "Optizmo/Rates.md",
          comments: [resolved("asked", { thread: [reply("grant", "2026-09-21T09:00:00Z", "Check these.")] })],
        },
        {
          path: "Optizmo/Pricing.md",
          comments: [resolved("idle", { thread: [reply("claude", "2026-09-21T10:00:00Z", "Done.")] })],
        },
      ],
      runningPaths: new Set(["Optizmo/Rates.md"]),
    });

    expect(view.files.find((g) => g.filePath === "Optizmo/Rates.md")?.running).toBe(true);
    expect(view.files.find((g) => g.filePath === "Optizmo/Pricing.md")?.running).toBe(false);
    expect(view.runningCount).toBe(1);
  });

  it("counts a running file the sweep has not indexed yet", () => {
    const view = buildInbox({
      ...BASE,
      files: [],
      runningPaths: new Set(["Personal/Portal.md"]),
    });

    expect(view.runningCount).toBe(1);
    expect(view.files).toEqual([]);
  });
});
