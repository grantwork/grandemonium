import { buildImplementMessage } from "@/features/comments/implementMessage";

const TARGET = {
  commentId: "a1f3",
  filePath: "notes/pricing.md",
  quote: "cut prices hard",
  reply: "Use a 10% reduction instead.",
  thread: [
    { author: "grant", text: "Too aggressive?", ts: "2026-06-10T10:24:00Z" },
    { author: "gpt", text: "Use a 10% reduction instead.", ts: "2026-06-10T10:30:00Z" },
  ],
};

describe("buildImplementMessage", () => {
  it("leads with the configured prompt", () => {
    const message = buildImplementMessage("Implement your suggested changes", TARGET);

    expect(message.startsWith("Implement your suggested changes")).toBe(true);
  });

  it("identifies the one comment by id, file and quote", () => {
    const message = buildImplementMessage("Go ahead", TARGET);

    expect(message).toContain("a1f3");
    expect(message).toContain("notes/pricing.md");
    expect(message).toContain("cut prices hard");
  });

  it("tells the AI to leave every other comment alone", () => {
    const message = buildImplementMessage("Go ahead", TARGET);

    expect(message).toContain("only this comment");
  });

  it("carries the reply being actioned", () => {
    const message = buildImplementMessage("Go ahead", TARGET);

    expect(message).toContain("Use a 10% reduction instead.");
  });

  it("neutralizes a quote that would otherwise close the CDATA section", () => {
    const message = buildImplementMessage("Go ahead", {
      ...TARGET,
      quote: "a ]]> b",
    });

    // Splitting the quote's ]]> re-opens a section, so opens and closes stay
    // balanced however many sections the message has.
    expect(message).toContain("]]]]><![CDATA[>");
    expect(message.match(/<!\[CDATA\[/g)).toHaveLength(message.match(/]]>/g)!.length);
  });

  it("closes the target block after the quoted content", () => {
    const message = buildImplementMessage("Go ahead", {
      ...TARGET,
      quote: "a </comment_target> b",
    });

    expect(message.trimEnd().endsWith("other comment in the file.")).toBe(true);
    expect(message).toContain("</your_reply>\n</comment_target>");
  });
});

describe("thread context", () => {
  it("carries every earlier entry so the AI has the discussion", () => {
    const message = buildImplementMessage("Go ahead", TARGET);

    expect(message).toContain("Too aggressive?");
    expect(message).toContain("grant");
  });

  it("keeps the thread in order with each author named", () => {
    const message = buildImplementMessage("Go ahead", TARGET);

    expect(message.indexOf("Too aggressive?"))
      .toBeLessThan(message.indexOf("Use a 10% reduction instead."));
  });

  it("omits the thread block when the comment has no entries", () => {
    const message = buildImplementMessage("Go ahead", { ...TARGET, thread: [] });

    expect(message).not.toContain("<thread>");
  });
});
