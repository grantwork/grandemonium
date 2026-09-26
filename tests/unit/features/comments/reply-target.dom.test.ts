/** @jest-environment jsdom */

import { fireEvent, within } from "@testing-library/dom";
import { axe } from "jest-axe";

import { renderReplyTargets, type ReplyTargetHost } from "@/features/comments/reply-target";

HTMLElement.prototype.addClass = function (...classes) { this.classList.add(...classes); };
HTMLElement.prototype.removeClass = function (...classes) { this.classList.remove(...classes); };

function host(overrides: Partial<ReplyTargetHost> = {}): ReplyTargetHost {
  return {
    names: ["claude", "gpt"],
    selected: "",
    authorColorOverrides: {},
    colorAuthorNames: true,
    onSelect: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  document.body.replaceChildren();
});

it("offers every enabled AI plus a broadcast option", () => {
  const row = renderReplyTargets(document.body, host());

  expect(within(row).getAllByRole("button").map((b) => b.textContent)).toEqual([
    "Every AI",
    "claude",
    "gpt",
  ]);
});

it("marks the chosen target as pressed and the others as not", () => {
  const row = renderReplyTargets(document.body, host({ selected: "gpt" }));

  expect(within(row).getByRole("button", { name: "gpt" }).getAttribute("aria-pressed")).toBe("true");
  expect(within(row).getByRole("button", { name: "Every AI" }).getAttribute("aria-pressed")).toBe(
    "false"
  );
});

it("reports the agent name when one is picked", () => {
  const onSelect = jest.fn();
  const row = renderReplyTargets(document.body, host({ selected: "", onSelect }));

  fireEvent.click(within(row).getByRole("button", { name: "claude" }));

  expect(onSelect).toHaveBeenCalledWith("claude");
});

it("reports an empty target when broadcast is picked back", () => {
  const onSelect = jest.fn();
  const row = renderReplyTargets(document.body, host({ selected: "gpt", onSelect }));

  fireEvent.click(within(row).getByRole("button", { name: "Every AI" }));

  expect(onSelect).toHaveBeenCalledWith("");
});

it("keeps every chip a real non-submitting button", () => {
  const row = renderReplyTargets(document.body, host());

  for (const chip of within(row).getAllByRole("button")) {
    expect((chip as HTMLButtonElement).type).toBe("button");
  }
});

it("leaves the chips uncoloured when author colours are switched off", () => {
  const plain = renderReplyTargets(document.body, host({ colorAuthorNames: false }));

  expect(plain.querySelector(".tc-reply-chip-colored")).toBeNull();
});

it("has no detectable accessibility violations", async () => {
  // Inside a landmark, so the page-level "content must be in a region" rule
  // does not fire on a component rendered alone in a test document.
  const main = document.createElement("main");
  document.body.append(main);
  renderReplyTargets(main, host({ selected: "gpt" }));

  expect(await axe(main)).toHaveNoViolations();
});
