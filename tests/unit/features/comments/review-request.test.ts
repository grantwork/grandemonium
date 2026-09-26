import { Notice, TFile } from "obsidian";

import {
  type CommentAiPort,
  type CommentReviewHandle,
  type CommentReviewResult,
  CommentsController,
} from "@/features/comments/CommentsController";
import {
  DEFAULT_IMPLEMENT_PROMPT,
  DEFAULT_REVIEW_PROMPT,
  DEFAULT_SETTINGS,
} from "@/features/comments/settings-model";

const NOTE = "Optizmo/Pricing.md";

/** A comment block with one open thread per id, anchored to text in the prose. */
function noteWith(ids: string[]): string {
  const comments = Object.fromEntries(
    ids.map((id) => [
      id,
      {
        anchor: { exact: `passage ${id}` },
        status: "open",
        thread: [{ author: "grant", text: `please look at ${id}`, ts: "2026-09-23T09:00:00Z" }],
      },
    ])
  );
  const prose = ids.map((id) => `The passage ${id} is here.`).join("\n");
  return `${prose}\n\`\`\`tandem-comments\n${JSON.stringify(comments)}\n\`\`\`\n`;
}

function createController(notes: Record<string, string> = {}): CommentsController {
  const files = Object.keys(notes).map((path) =>
    Object.assign(new TFile(), { extension: "md", path, stat: { mtime: 1 } })
  );
  const plugin = {
    app: {
      loadLocalStorage: () => null,
      saveLocalStorage: () => undefined,
      vault: {
        cachedRead: async (file: TFile) => notes[file.path] ?? "",
        getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
        getMarkdownFiles: () => files,
      },
      workspace: { getLeavesOfType: () => [] },
    },
    manifest: { id: "grandemonium", name: "Grandemonium" },
  };
  const controller = new CommentsController(plugin as never);
  controller.settings = { ...DEFAULT_SETTINGS };
  return controller;
}

interface FakeHandle extends CommentReviewHandle {
  readonly cancel: jest.Mock;
  finish(result: CommentReviewResult): void;
}

/** The composition root's side: one controllable run per AI a review reaches. */
class FakeReviews {
  readonly calls: Array<{ prompt: string; target: string | undefined }> = [];
  readonly handles: FakeHandle[] = [];

  constructor(private readonly names: string[], private readonly startedAt = 1_000) {}

  port(): CommentAiPort {
    return {
      agentNames: () => this.names,
      review: (prompt, target) => {
        this.calls.push({ prompt, target });
        const reached = target ? this.names.filter((name) => name === target) : this.names;
        return reached.map((agentName) => this.handle(agentName));
      },
    };
  }

  private handle(agentName: string): FakeHandle {
    let finish!: (result: CommentReviewResult) => void;
    const done = new Promise<CommentReviewResult>((resolve) => {
      finish = resolve;
    });
    const handle: FakeHandle = {
      agentName,
      cancel: jest.fn(() => finish({ kind: "cancelled" })),
      done,
      finish: (result) => finish(result),
      startedAt: this.startedAt,
    };
    this.handles.push(handle);
    return handle;
  }
}

async function settle(): Promise<void> {
  for (let tick = 0; tick < 5; tick += 1) await new Promise((resolve) => setImmediate(resolve));
}

function noticeMessages(): string[] {
  return (Notice as unknown as jest.Mock).mock.calls.map(([message]) => String(message));
}

beforeEach(() => {
  (Notice as unknown as jest.Mock).mockClear?.();
});

describe("comment review requests", () => {
  it("stays unavailable until a dispatcher is installed", () => {
    const controller = createController();

    expect(controller.canRequestReview()).toBe(false);

    controller.setAiPort(new FakeReviews([]).port());

    expect(controller.canRequestReview()).toBe(true);
  });

  it("sends the configured review prompt to every enabled AI", async () => {
    const controller = createController();
    const reviews = new FakeReviews(["claude", "gpt"]);
    controller.setAiPort(reviews.port());

    await controller.requestReview();

    expect(reviews.calls).toEqual([{ prompt: DEFAULT_REVIEW_PROMPT, target: undefined }]);
  });

  it("names the file so the review reads the right note", async () => {
    const controller = createController();
    const reviews = new FakeReviews(["claude"]);
    controller.setAiPort(reviews.port());

    await controller.requestReview("notes/pricing.md");

    expect(reviews.calls[0].prompt).toContain("notes/pricing.md");
  });

  it("sends an edited prompt rather than the default", async () => {
    const controller = createController();
    const reviews = new FakeReviews(["claude"]);
    controller.setAiPort(reviews.port());
    controller.settings = { ...DEFAULT_SETTINGS, reviewPrompt: "only answer my questions" };

    await controller.requestReview();

    expect(reviews.calls[0].prompt).toBe("only answer my questions");
  });

  it("does not dispatch when no dispatcher is installed", async () => {
    const controller = createController();

    await expect(controller.requestReview()).resolves.toBeUndefined();
  });

  it("survives a dispatcher that throws, and says why", async () => {
    const controller = createController();
    controller.setAiPort({
      agentNames: () => ["claude"],
      review: () => {
        throw new Error("no provider backend");
      },
    });

    await expect(controller.requestReview()).resolves.toBeUndefined();
    expect(noticeMessages().some((message) => message.includes("no provider backend"))).toBe(true);
  });

  it("says so when no AI could take the review", async () => {
    const controller = createController();
    controller.setAiPort(new FakeReviews(["claude"]).port());

    await controller.requestReview(NOTE, "gpt");

    expect(noticeMessages()).toHaveLength(1);
  });
});

describe("implementation requests", () => {
  const TARGET = {
    commentId: "a1f3",
    filePath: "notes/pricing.md",
    quote: "cut prices hard",
    reply: "Use a 10% reduction instead.",
    thread: [{ author: "grant", text: "Too aggressive?", ts: "2026-06-10T10:24:00Z" }],
  };

  it("asks only the AI whose reply was acted on", async () => {
    const controller = createController();
    const reviews = new FakeReviews(["claude", "gpt"]);
    controller.setAiPort(reviews.port());

    await controller.requestImplementation("gpt", TARGET);

    expect(reviews.calls[0].target).toBe("gpt");
  });

  it("scopes the request to the comment the action came from", async () => {
    const controller = createController();
    const reviews = new FakeReviews(["gpt"]);
    controller.setAiPort(reviews.port());

    await controller.requestImplementation("gpt", TARGET);

    const [{ prompt }] = reviews.calls;
    expect(prompt).toContain(DEFAULT_IMPLEMENT_PROMPT);
    expect(prompt).toContain("a1f3");
    expect(prompt).toContain("only this comment");
  });

  it("recognizes an AI author regardless of case or padding", () => {
    const controller = createController();
    controller.setAiPort(new FakeReviews(["claude", "gpt"]).port());

    expect(controller.isAgentAuthor(" GPT ")).toBe(true);
    expect(controller.isAgentAuthor("grant")).toBe(false);
  });
});

describe("automatic review after a comment", () => {
  it("asks the AIs as soon as a comment is added", async () => {
    const controller = createController();
    const reviews = new FakeReviews(["claude"]);
    controller.setAiPort(reviews.port());

    await controller.notifyUserCommentAdded("notes/pricing.md");

    expect(reviews.calls[0].prompt).toContain(DEFAULT_REVIEW_PROMPT);
    expect(reviews.calls[0].prompt).toContain("notes/pricing.md");
  });

  it("stays quiet while the setting is off", async () => {
    const controller = createController();
    const reviews = new FakeReviews(["claude"]);
    controller.setAiPort(reviews.port());
    controller.settings = { ...DEFAULT_SETTINGS, reviewOnComment: false };

    await controller.notifyUserCommentAdded("notes/pricing.md");

    expect(reviews.calls).toEqual([]);
  });

  it("stays quiet when no AI is connected", async () => {
    const controller = createController();

    await expect(controller.notifyUserCommentAdded("notes/pricing.md")).resolves.toBeUndefined();
  });
});

describe("addressing one AI with @name", () => {
  it("routes a tagged comment to that AI alone", async () => {
    const controller = createController();
    const reviews = new FakeReviews(["claude", "gpt"]);
    controller.setAiPort(reviews.port());

    await controller.notifyUserCommentAdded("notes/pricing.md", "@gpt run your changes");

    expect(reviews.calls[0].target).toBe("gpt");
  });

  it("still asks every AI when no one is tagged", async () => {
    const controller = createController();
    const reviews = new FakeReviews(["claude", "gpt"]);
    controller.setAiPort(reviews.port());

    await controller.notifyUserCommentAdded("notes/pricing.md", "what do you both think");

    expect(reviews.calls[0].target).toBeUndefined();
  });

  it("ignores a tag that names nobody enabled", async () => {
    const controller = createController();
    const reviews = new FakeReviews(["claude", "gpt"]);
    controller.setAiPort(reviews.port());

    await controller.notifyUserCommentAdded("notes/pricing.md", "@grant can you look");

    expect(reviews.calls[0].target).toBeUndefined();
  });
});

describe("a review running in the background", () => {
  async function controllerWithThreads(reviews: FakeReviews, ids: string[]) {
    const controller = createController({ [NOTE]: noteWith(ids) });
    controller.setAiPort(reviews.port());
    await controller.refreshIndex();
    return controller;
  }

  function thread(controller: CommentsController, id: string) {
    return controller.inbox().files[0].items.find((item) => item.id === id);
  }

  it("marks the thread working from the moment the review is asked for", async () => {
    const reviews = new FakeReviews(["claude"], 5_000);
    const controller = await controllerWithThreads(reviews, ["a1"]);

    await controller.requestReview(NOTE, null, "a1");

    expect(thread(controller, "a1")?.workingSince).toBe(5_000);
    expect(controller.inbox().runningCount).toBe(1);
  });

  it("clears only the thread whose own review finished, not its neighbours", async () => {
    const reviews = new FakeReviews(["claude"]);
    const controller = await controllerWithThreads(reviews, ["a1", "b2"]);
    await controller.requestReview(NOTE, null, "a1");
    await controller.requestReview(NOTE, null, "b2");

    reviews.handles[0].finish({ kind: "completed" });
    await settle();

    expect(thread(controller, "a1")?.workingSince).toBeNull();
    expect(thread(controller, "b2")?.workingSince).not.toBeNull();
  });

  it("keeps a thread working until every AI it was sent to has finished", async () => {
    const reviews = new FakeReviews(["claude", "gpt"]);
    const controller = await controllerWithThreads(reviews, ["a1"]);
    await controller.requestReview(NOTE, null, "a1");

    reviews.handles[0].finish({ kind: "completed" });
    await settle();
    expect(thread(controller, "a1")?.workingSince).not.toBeNull();

    reviews.handles[1].finish({ kind: "completed" });
    await settle();
    expect(thread(controller, "a1")?.workingSince).toBeNull();
  });

  it("lists each AI still replying in the thread until its own review ends", async () => {
    const reviews = new FakeReviews(["claude", "gpt"]);
    const controller = await controllerWithThreads(reviews, ["a1", "b2"]);
    await controller.requestReview(NOTE, null, "a1");

    expect(controller.threadActivity(NOTE, "a1").replying).toEqual(["claude", "gpt"]);
    expect(controller.threadActivity(NOTE, "b2").replying).toEqual([]);

    reviews.handles[0].finish({ kind: "completed" });
    await settle();

    expect(controller.threadActivity(NOTE, "a1").replying).toEqual(["gpt"]);
  });

  it("keeps a failed review's error in its thread rather than a popup that fades", async () => {
    const reviews = new FakeReviews(["gpt"]);
    const controller = await controllerWithThreads(reviews, ["a1"]);
    await controller.requestReview(NOTE, null, "a1");

    reviews.handles[0].finish({ kind: "failed", message: "Rate limit reached" });
    await settle();

    expect(controller.threadActivity(NOTE, "a1").errors).toEqual([
      { author: "gpt", text: "Couldn't finish: Rate limit reached", ts: expect.any(String) },
    ]);
    expect(noticeMessages()).toEqual([]);
  });

  it("clears a thread's errors when it is asked again", async () => {
    const reviews = new FakeReviews(["gpt"]);
    const controller = await controllerWithThreads(reviews, ["a1"]);
    await controller.requestReview(NOTE, null, "a1");
    reviews.handles[0].finish({ kind: "failed", message: "Rate limit reached" });
    await settle();

    await controller.requestReview(NOTE, null, "a1");

    expect(controller.threadActivity(NOTE, "a1")).toEqual({ errors: [], replying: ["gpt"] });
  });

  it("reports a failed review of a whole note in a popup that stays until dismissed", async () => {
    const reviews = new FakeReviews(["gpt"]);
    const controller = await controllerWithThreads(reviews, ["a1"]);
    await controller.requestReview(NOTE, null);

    reviews.handles[0].finish({ kind: "failed", message: "Rate limit reached" });
    await settle();

    const calls = (Notice as unknown as jest.Mock).mock.calls as Array<[string, number]>;
    const failure = calls.find(([message]) => message.includes("Rate limit reached"));
    expect(failure?.[0]).toContain("gpt");
    expect(failure?.[0]).toContain("Pricing");
    expect(failure?.[1]).toBe(0);
  });

  it("stays quiet when the reader stopped the review themselves", async () => {
    const reviews = new FakeReviews(["gpt"]);
    const controller = await controllerWithThreads(reviews, ["a1"]);
    await controller.requestReview(NOTE, null, "a1");

    reviews.handles[0].finish({ kind: "cancelled" });
    await settle();

    expect(noticeMessages()).toEqual([]);
    expect(thread(controller, "a1")?.workingSince).toBeNull();
  });

  it("stops every AI still working on a thread, and leaves other threads running", async () => {
    const reviews = new FakeReviews(["claude", "gpt"]);
    const controller = await controllerWithThreads(reviews, ["a1", "b2"]);
    await controller.requestReview(NOTE, null, "a1");
    await controller.requestReview(NOTE, null, "b2");
    const [claudeOnA, gptOnA, claudeOnB] = reviews.handles;

    controller.stopReviews(NOTE, "a1");
    await settle();

    expect(claudeOnA.cancel).toHaveBeenCalled();
    expect(gptOnA.cancel).toHaveBeenCalled();
    expect(claudeOnB.cancel).not.toHaveBeenCalled();
    expect(thread(controller, "a1")?.workingSince).toBeNull();
    expect(thread(controller, "b2")?.workingSince).not.toBeNull();
  });
});
