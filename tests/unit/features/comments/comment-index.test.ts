import { CommentIndex, type CommentIndexSource, type IndexedFile } from "@/features/comments/comment-index";

function block(comments: Record<string, unknown>): string {
  return "```grandemonium-comments\n" + JSON.stringify(comments) + "\n```\n";
}

function thread(text: string): unknown {
  return {
    anchor: { exact: "anchored" },
    status: "open",
    thread: [{ author: "claude", ts: "2026-09-21T09:00:00Z", text }],
  };
}

class FakeVault implements CommentIndexSource {
  readonly reads: string[] = [];
  private files = new Map<string, { mtime: number; raw: string }>();

  put(path: string, raw: string, mtime = 1): void {
    this.files.set(path, { mtime, raw });
  }

  drop(path: string): void {
    this.files.delete(path);
  }

  listFiles(): IndexedFile[] {
    return [...this.files.entries()].map(([path, file]) => ({ path, mtime: file.mtime }));
  }

  async read(path: string): Promise<string | null> {
    this.reads.push(path);
    return this.files.get(path)?.raw ?? null;
  }
}

describe("comment index", () => {
  it("keeps only the files that carry a comment block", async () => {
    const vault = new FakeVault();
    vault.put("Plain.md", "Just prose, anchored here.");
    vault.put("Commented.md", "Prose with anchored text.\n" + block({ a: thread("Look at this") }));
    const index = new CommentIndex(vault);

    await index.refresh();

    expect(index.files().map((file) => file.path)).toEqual(["Commented.md"]);
    expect(index.files()[0].comments.map((item) => item.id)).toEqual(["a"]);
  });

  it("resolves each file's anchors against its own prose", async () => {
    const vault = new FakeVault();
    vault.put("Moved.md", "The passage was rewritten.\n" + block({ a: thread("Changed it") }));
    const index = new CommentIndex(vault);

    await index.refresh();

    expect(index.files()[0].comments[0].resolution).toEqual({ kind: "orphaned" });
  });

  it("does not re-read a file whose modification time is unchanged", async () => {
    const vault = new FakeVault();
    vault.put("Commented.md", "anchored\n" + block({ a: thread("First") }), 5);
    const index = new CommentIndex(vault);

    await index.refresh();
    await index.refresh();

    expect(vault.reads).toEqual(["Commented.md"]);
  });

  it("re-reads and replaces a file whose modification time moved", async () => {
    const vault = new FakeVault();
    vault.put("Commented.md", "anchored\n" + block({ a: thread("First") }), 5);
    const index = new CommentIndex(vault);
    await index.refresh();

    vault.put("Commented.md", "anchored\n" + block({ a: thread("Second") }), 6);
    await index.refresh();

    const entry = index.files()[0].comments[0];
    expect(entry.comment.thread[0].text).toBe("Second");
    expect(vault.reads).toHaveLength(2);
  });

  it("drops a file once its last comment is gone", async () => {
    const vault = new FakeVault();
    vault.put("Commented.md", "anchored\n" + block({ a: thread("First") }), 5);
    const index = new CommentIndex(vault);
    await index.refresh();

    vault.put("Commented.md", "anchored, no block any more", 6);
    await index.refresh();

    expect(index.files()).toEqual([]);
  });

  it("reports a save as a change only when the file has or had comments", async () => {
    const vault = new FakeVault();
    vault.put("Plain.md", "Just prose, anchored here.");
    vault.put("Commented.md", "anchored\n" + block({ a: thread("First") }));
    const index = new CommentIndex(vault);
    await index.refresh();

    const plainSaved = await index.refreshFile("Plain.md", 2);
    const commentedSaved = await index.refreshFile("Commented.md", 2);
    vault.put("Commented.md", "anchored, no block any more", 3);
    const lastCommentRemoved = await index.refreshFile("Commented.md", 3);

    expect([plainSaved, commentedSaved, lastCommentRemoved]).toEqual([false, true, true]);
  });

  it("drops a file that left the vault, and follows one that was renamed", async () => {
    const vault = new FakeVault();
    vault.put("Old.md", "anchored\n" + block({ a: thread("First") }));
    vault.put("Gone.md", "anchored\n" + block({ b: thread("Second") }));
    const index = new CommentIndex(vault);
    await index.refresh();

    index.forget("Gone.md");
    index.rename("Old.md", "New.md");

    expect(index.files().map((file) => file.path)).toEqual(["New.md"]);
  });

  it("ignores a file it cannot read rather than caching an empty entry", async () => {
    const vault = new FakeVault();
    vault.put("Commented.md", "anchored\n" + block({ a: thread("First") }), 5);
    const index = new CommentIndex(vault);
    await index.refresh();

    vault.drop("Commented.md");
    await index.refreshFile("Commented.md", 9);

    expect(index.files()).toEqual([]);
  });

  it("leaves a file with a broken block out rather than reporting bad comments", async () => {
    const vault = new FakeVault();
    vault.put("Broken.md", "anchored\n```grandemonium-comments\n{ not json\n```\n");
    const index = new CommentIndex(vault);

    await index.refresh();

    expect(index.files()).toEqual([]);
  });
});
