/** @jest-environment jsdom */

import { screen } from "@testing-library/dom";
import type { MarkdownPostProcessorContext, MarkdownRenderChild, Plugin } from "obsidian";

import type { CommentsController } from "@/features/comments/CommentsController";
import { registerReadingView } from "@/features/comments/reading-view";

HTMLElement.prototype.empty = function () { this.replaceChildren(); };

type Processor = (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void;

function renderInReadingView(language: string, source: string): void {
  const processors = new Map<string, Processor>();
  const plugin = {
    registerMarkdownCodeBlockProcessor: (name: string, processor: Processor) => processors.set(name, processor),
  } as unknown as Plugin;
  registerReadingView(plugin, { openSidebar: async () => null } as unknown as CommentsController);
  const view = document.body.appendChild(document.createElement("div"));
  view.className = "markdown-preview-view";
  const el = view.appendChild(document.createElement("div"));
  const ctx = { addChild: (child: MarkdownRenderChild) => child.onload() } as unknown as MarkdownPostProcessorContext;
  processors.get(language)?.(source, el, ctx);
}

const ONE_OPEN = JSON.stringify({ a1f3: { anchor: { exact: "x" }, status: "open", thread: [] } });

afterEach(() => document.body.replaceChildren());

it.each(["grandemonium-comments", "tandem-comments"])("shows the thread count for a %s block", (language) => {
  renderInReadingView(language, ONE_OPEN);
  expect(screen.getByRole("button", { name: "💬 1 thread" })).toBeTruthy();
});
