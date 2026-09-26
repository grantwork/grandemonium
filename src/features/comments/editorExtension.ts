import { Annotation, type Extension, RangeSetBuilder, Transaction } from "@codemirror/state";
import type { DecorationSet, EditorView, ViewUpdate } from "@codemirror/view";
import { Decoration, ViewPlugin } from "@codemirror/view";

import {
  commentPopoverExtension,
  type CommentPopoverTarget,
  dismissCommentPopover,
  popoverTargetFor,
  showCommentPopover,
} from "./commentPopover";
import type { CommentsController } from "./CommentsController";
import {
  changesTouchCommentBlock,
  isFullReplace,
  mapAnchors,
  mergePendingAnchors,
  shouldPreservePendingAnchors,
  type TrackedAnchor,
} from "./reanchor";
import { blockChanges, makeAnchor, normalizeChanges, parseDocument, resolveAnchor } from "./store";
import { applyTableHighlights, rangesTouchTable } from "./tableHighlight";

/** Marks transactions dispatched by the plugin itself (block rewrite). */
export const selfEdit = Annotation.define<boolean>();

const REANCHOR_DEBOUNCE_MS = 800;
const NORMALIZE_DEBOUNCE_MS = 500;

export interface EditorExtensionHost {
  settings: { schemaHint: boolean; commentPopover: boolean };
  isApplyingSuggestion(): boolean;
  /** Whether a comment sidebar is on screen to expand the thread in. */
  isSidebarOpen(): boolean;
  openSidebar(id?: string): unknown;
}

export type HighlightClick =
  | { kind: "popover"; target: CommentPopoverTarget }
  | { kind: "sidebar" };

/**
 * Where a click on a highlight sends the reader. An open sidebar wins: showing
 * the thread twice at once is noise, and the sidebar is the fuller surface. The
 * popover covers the case where the sidebar is closed, and is also the fallback
 * an orphaned anchor cannot use, having no passage to sit over.
 */
export function resolveHighlightClick(
  plugin: EditorExtensionHost,
  text: string,
  id: string
): HighlightClick {
  if (plugin.isSidebarOpen() || !plugin.settings.commentPopover) return { kind: "sidebar" };
  const target = popoverTargetFor(text, id);
  return target ? { kind: "popover", target } : { kind: "sidebar" };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOpenSuggestion(value: unknown): boolean {
  if (!isObject(value) || value.status !== "open") return false;
  const suggestion = value.suggestion;
  return isObject(suggestion) && suggestion.result == null;
}

function isAcceptedSuggestion(value: unknown): boolean {
  if (!isObject(value) || value.status !== "resolved") return false;
  const suggestion = value.suggestion;
  return isObject(suggestion) && suggestion.result === "accepted";
}

/**
 * Detects Undo/Redo transitions across an accepted suggestion from document
 * semantics rather than change-range shape. End-of-prose acceptance may be
 * coalesced into a single large range, indistinguishable from a full replace.
 */
export function isSuggestionAcceptanceHistoryUpdate(u: ViewUpdate, oldText: string, text: string): boolean {
  if (!u.transactions.some((tr) => tr.isUserEvent("undo") || tr.isUserEvent("redo"))) return false;
  const oldDoc = parseDocument(oldText);
  const newDoc = parseDocument(text);
  if (oldDoc.error || newDoc.error || oldDoc.prose === newDoc.prose) return false;
  const ids = new Set([...Object.keys(oldDoc.comments), ...Object.keys(newDoc.comments)]);
  for (const id of ids) {
    const before = oldDoc.comments[id];
    const after = newDoc.comments[id];
    if (
      (isOpenSuggestion(before) && (after === undefined || isAcceptedSuggestion(after))) ||
      (isOpenSuggestion(after) && (before === undefined || isAcceptedSuggestion(before)))
    ) {
      return true;
    }
  }
  return false;
}

function editorAnchorTrackerClass(plugin: EditorExtensionHost) {
  return (
    class {
      decorations: DecorationSet;
      anchors: TrackedAnchor[] = [];
      dirty = false;
      timer: number | null = null;
      normalizeTimer: number | null = null;

      constructor(readonly view: EditorView) {
        this.syncFromDoc(view.state.doc.toString());
        this.decorations = this.buildDecorations();
        this.scheduleTableHighlight();
        this.scheduleNormalize();
      }

      destroy(): void {
        if (this.timer !== null) window.clearTimeout(this.timer);
        if (this.normalizeTimer !== null) window.clearTimeout(this.normalizeTimer);
      }

      syncFromDoc(text: string): void {
        const doc = parseDocument(text);
        this.anchors = [];
        this.dirty = false;
        if (doc.error) return;
        for (const [id, c] of Object.entries(doc.comments)) {
          if (c.status === "resolved") continue;
          const r = resolveAnchor(doc.prose, c.anchor);
          if (r.kind === "resolved") this.anchors.push({ id, from: r.start, to: r.end });
        }
        this.anchors.sort((a, b) => a.from - b.from);
      }

      update(u: ViewUpdate): void {
        // Table widgets appear and disappear on selection and viewport changes
        // too (cursor moving in and out), not only on document changes.
        if (u.docChanged || u.selectionSet || u.viewportChanged) this.scheduleTableHighlight();
        if (!u.docChanged) return;
        this.scheduleNormalize();
        const text = u.state.doc.toString();
        const isSelf = u.transactions.some((tr) => tr.annotation(selfEdit));
        const oldText = u.startState.doc.toString();
        const oldProseLen = parseDocument(oldText).prose.length;
        const newProseLen = parseDocument(text).prose.length;
        const fullReplace = isFullReplace(u.changes);
        const touchesBlock = changesTouchCommentBlock(u.changes, oldProseLen, newProseLen);
        const acceptanceHistory = isSuggestionAcceptanceHistoryUpdate(u, oldText, text);
        const preservePending = shouldPreservePendingAnchors(
          u.changes,
          oldProseLen,
          plugin.isApplyingSuggestion() || acceptanceHistory
        );
        const pending =
          (this.dirty || acceptanceHistory) && touchesBlock && preservePending
            ? mapAnchors(this.anchors, u.changes).filter((anchor) => anchor.to <= newProseLen)
            : [];
        if (isSelf || fullReplace || touchesBlock) {
          this.syncFromDoc(text);
          if (pending.length > 0) {
            const doc = parseDocument(text);
            if (!doc.error) {
              const recoverable = new Set(
                Object.entries(doc.comments)
                  .filter(
                    ([, comment]) =>
                      comment.status === "open" &&
                      resolveAnchor(doc.prose, comment.anchor).kind === "orphaned"
                  )
                  .map(([id]) => id)
              );
              const merged = mergePendingAnchors(this.anchors, pending, recoverable);
              if (merged.length > this.anchors.length) {
                this.anchors = merged;
                this.dirty = true;
                this.scheduleReanchor();
              }
            }
          }
        } else {
          const ranges: { from: number; to: number }[] = [];
          u.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
            ranges.push({ from: fromB, to: toB });
          });
          if (rangesTouchTable(text, newProseLen, ranges)) {
            // Table edit: map positions through the change, so anchors follow real
            // text edits the same way they do in prose. Anchors that collapse during
            // Obsidian's table reformatting (a whole-block replace) are restored by
            // exact text instead of being lost. performReanchor only rewrites when
            // the exact text is genuinely gone, which guards against corruption.
            const mapped = mapAnchors(this.anchors, u.changes);
            const survived = new Set(mapped.map((a) => a.id));
            this.anchors = mapped;
            const doc = parseDocument(text);
            for (const [id, c] of Object.entries(doc.comments)) {
              if (c.status === "resolved" || survived.has(id)) continue;
              const r = resolveAnchor(doc.prose, c.anchor);
              if (r.kind === "resolved") this.anchors.push({ id, from: r.start, to: r.end });
            }
            this.anchors.sort((a, b) => a.from - b.from);
            this.dirty = true;
            this.scheduleReanchor();
          } else {
            this.anchors = mapAnchors(this.anchors, u.changes);
            this.dirty = true;
            this.scheduleReanchor();
          }
        }
        this.decorations = this.buildDecorations();
      }

      buildDecorations(): DecorationSet {
        const b = new RangeSetBuilder<Decoration>();
        const len = this.view.state.doc.length;
        for (const a of this.anchors) {
          if (a.from >= a.to || a.to > len) continue;
          b.add(a.from, a.to, Decoration.mark({ class: "tc-highlight", attributes: { "data-tc-id": a.id } }));
        }
        return b.finish();
      }

      /**
       * Highlights inside rendered table widgets must be written directly into
       * the DOM, because CodeMirror mark decorations are swallowed there. This
       * runs in the measure/write phase, after Obsidian has built the widgets.
       */
      scheduleTableHighlight(): void {
        this.view.requestMeasure({
          key: "tc-table-highlight",
          read: () => null,
          write: () => {
            const text = this.view.state.doc.toString();
            const proseLen = parseDocument(text).prose.length;
            applyTableHighlights(this.view, this.anchors, text, proseLen, (id) => void plugin.openSidebar(id));
          },
        });
      }

      scheduleNormalize(): void {
        if (this.normalizeTimer !== null) window.clearTimeout(this.normalizeTimer);
        this.normalizeTimer = window.setTimeout(() => {
          this.normalizeTimer = null;
          this.performNormalize();
        }, NORMALIZE_DEBOUNCE_MS);
      }

      /**
       * Makes the note canonical: folds content that sits after the block (typed
       * prose, footnote definitions) back in front of it, so that text does not
       * end up in the non-commentable trailing region, and merges any extra
       * blocks or an outdated fence name into the one current block.
       */
      performNormalize(): void {
        // Flush a pending reanchor first: otherwise syncFromDoc (via update())
        // rebuilds the anchors from the not yet rewritten block, the anchor being
        // edited is lost, and the later reanchor becomes a no-op.
        if (this.dirty) this.performReanchor();
        const text = this.view.state.doc.toString();
        const changes = normalizeChanges(text, parseDocument(text), plugin.settings.schemaHint);
        if (!changes) return;
        this.view.dispatch({
          changes,
          annotations: [selfEdit.of(true), Transaction.addToHistory.of(false)],
        });
      }

      scheduleReanchor(): void {
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => {
          this.timer = null;
          this.performReanchor();
        }, REANCHOR_DEBOUNCE_MS);
      }

      /**
       * After prose has been edited, writes the current quotes and contexts of
       * the surviving anchors back into the block (only the block region is
       * replaced).
       */
      performReanchor(): void {
        if (!this.dirty) return;
        this.dirty = false;
        const text = this.view.state.doc.toString();
        const doc = parseDocument(text);
        if (doc.error || Object.keys(doc.comments).length === 0) return;
        let changed = false;
        for (const t of this.anchors) {
          const c = doc.comments[t.id];
          if (!c || c.status === "resolved") continue;
          if (t.to > doc.prose.length) continue;
          const cur = c.anchor;
          // Only rewrite when the previous exact text can no longer be found,
          // meaning the quote itself was edited. If it is still there, the change
          // was only around it (for example Obsidian's table reformatting), and a
          // rewrite from possibly shifted positions would corrupt the anchor.
          if (resolveAnchor(doc.prose, cur).kind === "resolved") continue;
          const next = makeAnchor(doc.prose, t.from, t.to);
          if (
            next.exact &&
            (next.exact !== cur.exact ||
              next.prefix !== cur.prefix ||
              next.suffix !== cur.suffix ||
              next.pos !== cur.pos)
          ) {
            c.anchor = next;
            changed = true;
          }
        }
        if (!changed) return;
        this.view.dispatch({
          changes: blockChanges(text, doc, plugin.settings.schemaHint),
          annotations: [selfEdit.of(true), Transaction.addToHistory.of(false)],
        });
      }
    }
  );
}

export function createEditorAnchorTracker(view: EditorView, plugin: EditorExtensionHost) {
  const Tracker = editorAnchorTrackerClass(plugin);
  return new Tracker(view);
}

/**
 * The browser settles a drag selection after the pointer is released, so the
 * CodeMirror state only carries the final range on the next tick. A plain click
 * leaves a caret behind and is dropped here, before the document is read.
 */
function scheduleSelectionComment(view: EditorView, plugin: CommentsController): void {
  window.setTimeout(() => {
    const { from, to } = view.state.selection.main;
    if (from >= to) return;
    plugin.startSelectionComment(view.state.doc.toString(), from, to);
  }, 0);
}

export function buildEditorExtension(plugin: CommentsController): Extension {
  return [
    buildAnchorViewPlugin(plugin),
    commentPopoverExtension({
      createHost: (id, close) => plugin.commentPopoverHost(id, close),
      hoverEnabled: () => plugin.settings.commentPopover && plugin.settings.commentPopoverHover,
    }),
  ];
}

function buildAnchorViewPlugin(plugin: CommentsController) {
  return ViewPlugin.fromClass(editorAnchorTrackerClass(plugin), {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown(e: MouseEvent, view: EditorView) {
        const target = e.target as HTMLElement;
        const el = target.closest?.(".tc-highlight");
        if (!el) {
          // Clicking away from every highlight is how the popover is dismissed.
          dismissCommentPopover(view);
          return false;
        }
        const id = el.getAttribute("data-tc-id");
        if (!id) return false;
        const click = resolveHighlightClick(plugin, view.state.doc.toString(), id);
        if (click.kind === "popover") {
          showCommentPopover(view, click.target);
          return false;
        }
        void plugin.openSidebar(id);
        return false;
      },
      mouseup(_e: MouseEvent, view: EditorView) {
        scheduleSelectionComment(view, plugin);
        return false;
      },
      touchend(_e: TouchEvent, view: EditorView) {
        scheduleSelectionComment(view, plugin);
        return false;
      },
    },
  });
}
