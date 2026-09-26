import { setIcon } from "obsidian";

/**
 * What a thread shows beyond its saved entries: the AIs still replying, and
 * errors from reviews that failed. Errors are held for the session rather than
 * written into the note, whose comment block the AIs read and follow.
 */
export interface ThreadActivity {
  readonly replying: readonly string[];
  readonly errors: ReadonlyArray<{ readonly author: string; readonly text: string; readonly ts: string }>;
}

export interface ThreadStatusHost {
  formatTimestamp(ts: string): string | null;
  /** `rail` colours an entry's left edge; otherwise the author's name. */
  paintAuthor(el: HTMLElement, author: string, rail: boolean): void;
}

/** The alert that marks an AI's error, before its author's name. */
export function renderErrorIcon(parent: HTMLElement): void {
  const icon = parent.createSpan({ cls: "tc-entry-error-icon", attr: { "aria-label": "Error", role: "img" } });
  setIcon(icon, "alert-triangle");
}

/** A placeholder reply, as a chat shows one, until the AI's first words arrive. */
export function renderTypingDots(parent: HTMLElement, agentName: string): void {
  const dots = parent.createDiv({
    cls: "tc-typing",
    attr: { "aria-label": `${agentName} is replying`, role: "status" },
  });
  for (let i = 0; i < 3; i++) dots.createSpan({ cls: "tc-typing-dot", attr: { "aria-hidden": "true" } });
}

/** Below a thread's saved entries: errors from reviews that failed, then each AI still replying. */
export function renderThreadActivity(parent: HTMLElement, activity: ThreadActivity, host: ThreadStatusHost): void {
  for (const error of activity.errors) {
    const row = parent.createDiv({ cls: "tc-entry tc-entry-agent tc-entry-error" });
    host.paintAuthor(row, error.author, true);
    const meta = row.createDiv({ cls: "tc-meta" });
    renderErrorIcon(meta);
    host.paintAuthor(meta.createSpan({ cls: "tc-author", text: error.author }), error.author, false);
    const ts = host.formatTimestamp(error.ts);
    if (ts) meta.createSpan({ cls: "tc-ts", text: ts });
    row.createDiv({ cls: "tc-text", text: error.text });
  }
  for (const agentName of activity.replying) {
    const row = parent.createDiv({ cls: "tc-entry tc-entry-agent" });
    host.paintAuthor(row, agentName, true);
    const meta = row.createDiv({ cls: "tc-meta" });
    host.paintAuthor(meta.createSpan({ cls: "tc-author", text: agentName }), agentName, false);
    renderTypingDots(row, agentName);
  }
}
