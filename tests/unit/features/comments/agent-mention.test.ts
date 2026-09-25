import { findAgentMention, resolveReplyTarget } from "@/features/comments/agent-mention";

const AGENTS = ["claude", "gpt"];

describe("findAgentMention", () => {
  it("routes to the agent named at the start of a comment", () => {
    expect(findAgentMention("@gpt run your changes", AGENTS)).toBe("gpt");
  });

  it("finds a mention later in the comment", () => {
    expect(findAgentMention("can @claude take this one", AGENTS)).toBe("claude");
  });

  it("matches regardless of case", () => {
    expect(findAgentMention("@GPT please look", AGENTS)).toBe("gpt");
  });

  it("returns null when no agent is mentioned", () => {
    expect(findAgentMention("someone should look at this", AGENTS)).toBeNull();
  });

  it("ignores an @ that names something else", () => {
    expect(findAgentMention("@grant can you check", AGENTS)).toBeNull();
  });

  it("ignores a name that is not preceded by @", () => {
    expect(findAgentMention("gpt said this already", AGENTS)).toBeNull();
  });

  it("does not match an agent name embedded in a longer word", () => {
    expect(findAgentMention("@gpteroids are cool", AGENTS)).toBeNull();
  });

  it("takes the first mention when several agents are named", () => {
    expect(findAgentMention("@claude and @gpt both", AGENTS)).toBe("claude");
  });

  it("matches an email-like string without treating it as a mention", () => {
    expect(findAgentMention("mail me at grant@gpt.com", AGENTS)).toBeNull();
  });
});

describe("choosing which AI a reply goes to", () => {
  const AGENTS = ["claude", "gpt"];

  it("broadcasts when nothing is chosen and nobody is tagged", () => {
    expect(resolveReplyTarget("looks fine to me", AGENTS, "")).toBeNull();
  });

  it("uses the standing choice so the reader stops typing a tag", () => {
    expect(resolveReplyTarget("looks fine to me", AGENTS, "gpt")).toBe("gpt");
  });

  it("lets a tag override the standing choice for one reply", () => {
    expect(resolveReplyTarget("@claude take this one", AGENTS, "gpt")).toBe("claude");
  });

  it("matches the standing choice regardless of case or padding", () => {
    expect(resolveReplyTarget("hello", AGENTS, " GPT ")).toBe("gpt");
  });

  it("broadcasts when the chosen AI is no longer enabled", () => {
    expect(resolveReplyTarget("hello", ["claude"], "gpt")).toBeNull();
  });
});
