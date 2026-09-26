import { shouldStartSelectionComment } from "@/features/comments/selectionComment";

const PROSE_LENGTH = 40;

function decision(overrides: Partial<Parameters<typeof shouldStartSelectionComment>[0]> = {}) {
  return shouldStartSelectionComment({
    enabled: true,
    from: 5,
    to: 12,
    proseLength: PROSE_LENGTH,
    openDraftRange: null,
    ...overrides,
  });
}

describe("shouldStartSelectionComment", () => {
  it("starts a draft for a prose selection while the setting is on", () => {
    expect(decision()).toBe(true);
  });

  it("stays out of the way while the setting is off", () => {
    expect(decision({ enabled: false })).toBe(false);
  });

  it("ignores a caret with nothing selected", () => {
    expect(decision({ from: 12, to: 12 })).toBe(false);
  });

  it("ignores a selection that reaches into the comment block", () => {
    expect(decision({ from: 30, to: PROSE_LENGTH + 1 })).toBe(false);
  });

  it("keeps a draft already open on the same passage", () => {
    expect(decision({ openDraftRange: { from: 5, to: 12 } })).toBe(false);
  });

  it("replaces a draft open on a different passage", () => {
    expect(decision({ openDraftRange: { from: 20, to: 26 } })).toBe(true);
  });
});
