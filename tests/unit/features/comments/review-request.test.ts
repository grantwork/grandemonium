import { Notice } from "obsidian";

import {
  CommentsController,
  describeImplementOutcome,
  describeReviewOutcome,
} from "@/features/comments/CommentsController";
import {
  DEFAULT_IMPLEMENT_PROMPT,
  DEFAULT_REVIEW_PROMPT,
  DEFAULT_SETTINGS,
} from "@/features/comments/settings-model";

function createController(): CommentsController {
  const plugin = {
    app: {},
    manifest: { id: "grandemonium", name: "Grandemonium" },
  };
  const controller = new CommentsController(plugin as never);
  controller.settings = { ...DEFAULT_SETTINGS };
  return controller;
}

describe("comment review requests", () => {
  beforeEach(() => {
    (Notice as unknown as jest.Mock).mockClear?.();
  });

  it("stays unavailable until a dispatcher is installed", () => {
    const controller = createController();

    expect(controller.canRequestReview()).toBe(false);

    controller.setAiPort({
      agentNames: () => [],
      request: async () => ({ queued: [], sent: [] }),
    });

    expect(controller.canRequestReview()).toBe(true);
  });

  it("sends the configured review prompt to the AIs", async () => {
    const controller = createController();
    const dispatch = jest.fn().mockResolvedValue({ queued: [], sent: ["claude", "gpt"] });
    controller.setAiPort({ agentNames: () => ["claude", "gpt"], request: dispatch });

    await controller.requestReview();

    expect(dispatch).toHaveBeenCalledWith(DEFAULT_REVIEW_PROMPT, undefined);
  });

  it("names the file so a tab linked elsewhere reviews the right note", async () => {
    const controller = createController();
    const dispatch = jest.fn().mockResolvedValue({ queued: [], sent: ["claude"] });
    controller.setAiPort({ agentNames: () => ["claude"], request: dispatch });

    await controller.requestReview("notes/pricing.md");

    const [message] = dispatch.mock.calls[0] as [string];
    expect(message).toContain("notes/pricing.md");
  });

  it("sends an edited prompt rather than the default", async () => {
    const controller = createController();
    const dispatch = jest.fn().mockResolvedValue({ queued: [], sent: ["claude"] });
    controller.setAiPort({ agentNames: () => ["claude"], request: dispatch });
    controller.settings = { ...DEFAULT_SETTINGS, reviewPrompt: "only answer my questions" };

    await controller.requestReview();

    expect(dispatch).toHaveBeenCalledWith("only answer my questions", undefined);
  });

  it("does not dispatch when no dispatcher is installed", async () => {
    const controller = createController();

    await expect(controller.requestReview()).resolves.toBeUndefined();
  });

  it("survives a dispatcher that rejects", async () => {
    const controller = createController();
    controller.setAiPort({
      agentNames: () => ["claude"],
      request: () => Promise.reject(new Error("no chat view")),
    });

    await expect(controller.requestReview()).resolves.toBeUndefined();
  });
});

describe("review outcome reporting", () => {
  it("names the AIs that started reviewing", () => {
    expect(describeReviewOutcome(["claude", "gpt"], [])).toBe(
      "Review requested from claude, gpt."
    );
  });

  it("reports a queued AI apart from one that started", () => {
    const message = describeReviewOutcome(["gpt"], ["claude"]);

    expect(message).toContain("Review requested from gpt.");
    expect(message).toContain("Queued behind current work for claude.");
  });

  it("does not claim success when every AI only queued the request", () => {
    expect(describeReviewOutcome([], ["claude"])).not.toContain("Review requested");
  });

  it("says so when no AI could take the request", () => {
    expect(describeReviewOutcome([], [])).toBe(
      "No enabled AI has a chat tab to review comments."
    );
  });
});

describe("implementation requests", () => {
  function controllerWith(dispatch: jest.Mock): CommentsController {
    const controller = createController();
    controller.setAiPort({ agentNames: () => ["claude", "gpt"], request: dispatch });
    return controller;
  }

  const TARGET = {
    commentId: "a1f3",
    filePath: "notes/pricing.md",
    quote: "cut prices hard",
    reply: "Use a 10% reduction instead.",
    thread: [{ author: "grant", text: "Too aggressive?", ts: "2026-06-10T10:24:00Z" }],
  };

  it("asks only the AI whose reply was acted on", async () => {
    const dispatch = jest.fn().mockResolvedValue({ queued: [], sent: ["gpt"] });

    await controllerWith(dispatch).requestImplementation("gpt", TARGET);

    expect(dispatch).toHaveBeenCalledWith(expect.any(String), "gpt");
  });

  it("scopes the request to the comment the action came from", async () => {
    const dispatch = jest.fn().mockResolvedValue({ queued: [], sent: ["gpt"] });

    await controllerWith(dispatch).requestImplementation("gpt", TARGET);

    const [message] = dispatch.mock.calls[0] as [string];
    expect(message).toContain(DEFAULT_IMPLEMENT_PROMPT);
    expect(message).toContain("a1f3");
    expect(message).toContain("only this comment");
  });

  it("recognizes an AI author regardless of case or padding", () => {
    const controller = controllerWith(jest.fn());

    expect(controller.isAgentAuthor(" GPT ")).toBe(true);
    expect(controller.isAgentAuthor("grant")).toBe(false);
  });

  it("reports that the AI started, queued, or had nowhere to run", () => {
    expect(describeImplementOutcome("gpt", ["gpt"], [])).toContain("is making the changes");
    expect(describeImplementOutcome("gpt", [], ["gpt"])).toContain("after its current work");
    expect(describeImplementOutcome("gpt", [], [])).toContain("no chat tab");
  });
});

describe("automatic review after a comment", () => {
  it("asks the AIs as soon as a comment is added", async () => {
    const controller = createController();
    const request = jest.fn().mockResolvedValue({ queued: [], sent: ["claude"] });
    controller.setAiPort({ agentNames: () => ["claude"], request });

    await controller.notifyUserCommentAdded("notes/pricing.md");

    const [message] = request.mock.calls[0] as [string];
    expect(message).toContain(DEFAULT_REVIEW_PROMPT);
    expect(message).toContain("notes/pricing.md");
  });

  it("stays quiet while the setting is off", async () => {
    const controller = createController();
    const request = jest.fn();
    controller.setAiPort({ agentNames: () => ["claude"], request });
    controller.settings = { ...DEFAULT_SETTINGS, reviewOnComment: false };

    await controller.notifyUserCommentAdded("notes/pricing.md");

    expect(request).not.toHaveBeenCalled();
  });

  it("stays quiet when no AI is connected", async () => {
    const controller = createController();

    await expect(controller.notifyUserCommentAdded("notes/pricing.md")).resolves.toBeUndefined();
  });
});

describe("addressing one AI with @name", () => {
  function controllerWith(request: jest.Mock): CommentsController {
    const controller = createController();
    controller.setAiPort({ agentNames: () => ["claude", "gpt"], request });
    return controller;
  }

  it("routes a tagged comment to that AI alone", async () => {
    const request = jest.fn().mockResolvedValue({ queued: [], sent: ["gpt"] });

    await controllerWith(request).notifyUserCommentAdded(
      "notes/pricing.md",
      "@gpt run your changes",
    );

    expect(request).toHaveBeenCalledWith(expect.any(String), "gpt");
  });

  it("still asks every AI when no one is tagged", async () => {
    const request = jest.fn().mockResolvedValue({ queued: [], sent: ["claude", "gpt"] });

    await controllerWith(request).notifyUserCommentAdded(
      "notes/pricing.md",
      "what do you both think",
    );

    expect(request).toHaveBeenCalledWith(expect.any(String), undefined);
  });

  it("ignores a tag that names nobody enabled", async () => {
    const request = jest.fn().mockResolvedValue({ queued: [], sent: ["claude", "gpt"] });

    await controllerWith(request).notifyUserCommentAdded(
      "notes/pricing.md",
      "@grant can you look",
    );

    expect(request).toHaveBeenCalledWith(expect.any(String), undefined);
  });
});
