import { MarkdownRenderChild, type Plugin } from "obsidian";

import type { CommentsController } from "./CommentsController";
import { COMMENT_FENCE_NAMES, parseBlockBody } from "./store";

/**
 * Live Preview hides the block entirely: comments show up only as highlights
 * and in the sidebar, and normalisation keeps the block at the end of the file.
 * Reading View renders a "comment count" pill that also opens the sidebar.
 */
export function registerReadingView(plugin: Plugin, controller: CommentsController): void {
  for (const name of COMMENT_FENCE_NAMES) {
    plugin.registerMarkdownCodeBlockProcessor(name, (source, el, ctx) => {
      // The Live Preview and Reading View check needs the attached DOM, so this
      // runs as a render child whose onload fires after mounting.
      ctx.addChild(new BlockPill(el, source, controller));
    });
  }
}

class BlockPill extends MarkdownRenderChild {
  private unloaded = false;

  constructor(
    containerEl: HTMLElement,
    readonly source: string,
    readonly plugin: CommentsController
  ) {
    super(containerEl);
  }

  onload(): void {
    this.render();
  }

  onunload(): void {
    this.unloaded = true;
  }

  render(): void {
    const el = this.containerEl;
    el.empty();
    // On a mode switch (Cmd+E) onload can fire before the element is attached
    // to the DOM, and closest() then returns nothing. Wait a frame and recheck.
    if (!el.isConnected) {
      window.requestAnimationFrame(() => {
        if (!this.unloaded) this.render();
      });
      return;
    }
    // Only render the pill on positive evidence of Reading View; when in doubt
    // stay invisible, because a wrongly shown pill is obvious in Live Preview,
    // while a missing one in Reading View is healed on the next render.
    if (!el.closest(".markdown-preview-view")) {
      const widget = el.closest(".cm-embed-block");
      if (widget instanceof HTMLElement) widget.addClass("tc-lp-hidden");
      return;
    }
    let open = 0;
    let resolved = 0;
    try {
      for (const c of Object.values(parseBlockBody(this.source))) {
        if (c.status === "resolved") resolved++;
        else open++;
      }
    } catch {
      el.createDiv({ text: "💬 comments — invalid JSON", cls: "tc-pill tc-pill-error" });
      return;
    }
    // Only resolved history left, so stay completely invisible in Reading View.
    if (open === 0) return;
    const label =
      resolved > 0 ? `💬 ${open} open · ${resolved} resolved` : `💬 ${open} thread${open === 1 ? "" : "s"}`;
    const pill = el.createEl("button", { text: label, cls: "tc-pill" });
    pill.onclick = () => void this.plugin.openSidebar();
  }
}
