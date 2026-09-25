import { setIcon } from "obsidian";

import { plainText } from "./inbox-model";
import { renderErrorIcon } from "./thread-status";

/**
 * Which entries of a thread stay open. A long exchange is read for three
 * things: what was first asked, what the reader last said, and what the AIs
 * answered to it. Everything between is history, one click away.
 */
export function keptThreadEntries(
  thread: readonly { author: string }[],
  isAgentAuthor: (author: string) => boolean
): boolean[] {
  let lastHuman = 0;
  thread.forEach((entry, index) => {
    if (!isAgentAuthor(entry.author)) lastHuman = index;
  });
  return thread.map((_entry, index) => index === 0 || index >= lastHuman);
}

/** A folded entry: one line of its author and plain text, pressed to open it. */
export function renderCollapsedEntry(
  parent: HTMLElement,
  entry: { author: string; text: string; kind?: "error" },
  onExpand: () => void
): HTMLButtonElement {
  const error = entry.kind === "error";
  const button = parent.createEl("button", {
    cls: error ? "tc-entry-collapsed tc-entry-error" : "tc-entry-collapsed",
    attr: {
      "aria-expanded": "false",
      "aria-label": `Show ${error ? "error from" : "comment by"} ${entry.author}`,
      type: "button",
    },
  });
  setIcon(button.createSpan({ cls: "tc-entry-collapsed-icon" }), "chevron-right");
  if (error) renderErrorIcon(button);
  button.createSpan({ cls: "tc-author", text: entry.author });
  button.createSpan({
    cls: "tc-entry-collapsed-text",
    text: plainText(entry.text).replace(/\s+/g, " ").trim(),
  });
  button.onclick = onExpand;
  return button;
}
