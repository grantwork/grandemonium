import { keptThreadEntries } from "@/features/comments/thread-collapse";

const isAgent = (author: string) => author === "claude";
const at = (...authors: string[]) => authors.map((author) => ({ author }));

it("keeps the opening comment, the last human comment and the replies to it", () => {
  const kept = keptThreadEntries(at("grant", "claude", "grant", "claude", "grant", "claude", "claude"), isAgent);

  expect(kept).toEqual([true, false, false, false, true, true, true]);
});

it("keeps everything when the opening comment is the only human one", () => {
  expect(keptThreadEntries(at("grant", "claude", "claude"), isAgent)).toEqual([true, true, true]);
});

it("collapses earlier replies when the thread ends on a human comment", () => {
  expect(keptThreadEntries(at("grant", "claude", "grant"), isAgent)).toEqual([true, false, true]);
});

it("keeps agent-opened threads' first entry and anything after the last human", () => {
  expect(keptThreadEntries(at("claude", "grant", "claude", "grant", "claude"), isAgent)).toEqual([
    true,
    false,
    false,
    true,
    true,
  ]);
});
