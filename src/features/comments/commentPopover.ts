import { type Extension, StateEffect, StateField } from '@codemirror/state';
import { type EditorView, hoverTooltip, keymap, showTooltip } from '@codemirror/view';

import { type AuthorColorOverrides, resolveAuthorColor } from './authorColor';
import { parseDocument, resolveAnchor } from './store';
import type { ResolvedComment } from './types';

/** The comment thread pinned open in the editor, tracked in document positions. */
export interface CommentPopoverTarget {
  id: string;
  from: number;
  to: number;
}

export const openCommentPopover = StateEffect.define<CommentPopoverTarget>();
export const closeCommentPopover = StateEffect.define<null>();

/**
 * Holds the pinned thread across edits. Positions are mapped rather than
 * re-resolved from the anchor, so the popover keeps following its passage while
 * the quote is being rewritten and the stored anchor is still stale.
 */
export const commentPopoverTarget = StateField.define<CommentPopoverTarget | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(openCommentPopover)) return e.value;
      if (e.is(closeCommentPopover)) return null;
    }
    if (!value || !tr.docChanged) return value;
    const from = tr.changes.mapPos(value.from);
    const to = tr.changes.mapPos(value.to);
    // The commented passage itself is gone, so there is nothing left to point at.
    return to > from ? { id: value.id, from, to } : null;
  },
});

/** Everything the card needs from the plugin, kept narrow so it renders anywhere. */
export interface CommentPopoverHost {
  authorColorOverrides: AuthorColorOverrides;
  colorAuthorNames: boolean;
  /** Null when the timestampDisplay setting hides timestamps. */
  formatTimestamp(ts: string): string | null;
  /** Mirrors the submitShortcut setting: Enter sends, or Mod+Enter does. */
  submitOnEnter: boolean;
  /** Reply typed but not sent before the popover was last dismissed. */
  replyDraft: string;
  /** Card size the reader last dragged out, shared by every thread. */
  size: CommentPopoverSize | null;
  onReply(text: string): void;
  onReplyDraftChange(text: string): void;
  onSizeChange(size: CommentPopoverSize): void;
  onResolve(): void;
  onAcceptSuggestion(): void;
  onDeclineSuggestion(): void;
  onOpenSidebar(): void;
}

export interface CommentPopoverSize {
  width: number;
  height: number;
}

export interface CommentPopoverOptions {
  /** Hover preview: the thread only, with nothing to act on. */
  compact?: boolean;
}

/** A suggestion still waiting on the reader, rather than one already answered. */
function undecidedSuggestion(resolved: ResolvedComment): boolean {
  const suggestion = resolved.comment.suggestion;
  return !!suggestion && !suggestion.result && resolved.comment.status === 'open';
}

/**
 * Accepting rewrites the passage, so it needs one unambiguous place to write to
 * and something to write there. The sidebar applies the same three conditions.
 */
function canAcceptSuggestion(resolved: ResolvedComment): boolean {
  const replacement = resolved.comment.suggestion?.replacement;
  return (
    resolved.resolution.kind === 'resolved' &&
    !resolved.resolution.ambiguous &&
    typeof replacement === 'string' &&
    replacement.length > 0
  );
}

/**
 * Restores the card's remembered size and watches for a new one. The native
 * resize grip writes inline width and height and emits no event, so the gesture
 * is read off the element once the pointer is released.
 */
function applyPopoverSize(
  card: HTMLElement,
  host: CommentPopoverHost,
  options: CommentPopoverOptions
): void {
  // A hover preview is not resizable, so it never carries a stored size.
  if (options.compact) return;
  if (host.size) {
    card.style.width = `${host.size.width}px`;
    card.style.height = `${host.size.height}px`;
    // The default cap keeps an unsized card modest; an explicit size replaces it.
    card.addClass('grandemonium-comment-popover-sized');
  }
  let last = `${card.style.width}|${card.style.height}`;
  card.addEventListener('mouseup', () => {
    const next = `${card.style.width}|${card.style.height}`;
    if (next === last) return;
    last = next;
    const width = Number.parseFloat(card.style.width);
    const height = Number.parseFloat(card.style.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    card.addClass('grandemonium-comment-popover-sized');
    host.onSizeChange({ width: Math.round(width), height: Math.round(height) });
  });
}

function paintAuthor(el: HTMLElement, author: string, host: CommentPopoverHost): void {
  el.dataset.commentAuthor = author;
  if (!host.colorAuthorNames) return;
  el.style.setProperty(
    '--grandemonium-comment-author-color-light',
    resolveAuthorColor(author, host.authorColorOverrides, 'light')
  );
  el.style.setProperty(
    '--grandemonium-comment-author-color-dark',
    resolveAuthorColor(author, host.authorColorOverrides, 'dark')
  );
  el.addClass('grandemonium-comment-author-colored');
}

/**
 * Renders one thread as a self-contained card. The sidebar stays the full
 * surface: suggestions, entry menus, and deletion are reached through Open in
 * sidebar rather than duplicated here.
 */
export function renderCommentPopover(
  parent: HTMLElement,
  resolved: ResolvedComment,
  host: CommentPopoverHost,
  options: CommentPopoverOptions = {}
): HTMLElement {
  const card = parent.createDiv({ cls: 'grandemonium-comment-popover-card' });
  // A click inside the card must not read as a click away from the highlight,
  // which is what dismisses the popover.
  card.addEventListener('mousedown', (e) => e.stopPropagation());
  applyPopoverSize(card, host, options);

  card.createDiv({ cls: 'grandemonium-comment-popover-quote', text: resolved.comment.anchor.exact });
  if (undecidedSuggestion(resolved)) {
    const block = card.createDiv({ cls: 'grandemonium-comment-popover-suggestion' });
    block.createSpan({ cls: 'grandemonium-comment-suggestion-title', text: 'Suggested edit' });
    block.createDiv({
      cls: 'grandemonium-comment-popover-suggestion-text',
      text: resolved.comment.suggestion?.replacement ?? '',
    });
  }

  const thread = card.createDiv({ cls: 'grandemonium-comment-popover-thread' });
  for (const entry of resolved.comment.thread) {
    const item = thread.createDiv({ cls: 'grandemonium-comment-popover-entry' });
    const meta = item.createDiv({ cls: 'grandemonium-comment-meta' });
    paintAuthor(meta.createSpan({ text: entry.author, cls: 'grandemonium-comment-author' }), entry.author, host);
    const stamp = host.formatTimestamp(entry.ts);
    if (stamp) meta.createSpan({ text: stamp, cls: 'grandemonium-comment-time' });
    item.createDiv({ cls: 'grandemonium-comment-popover-text', text: entry.text });
  }

  if (options.compact) return card;

  const isOpen = resolved.comment.status === 'open';
  const box = isOpen
    ? card.createEl('textarea', {
        cls: 'grandemonium-comment-popover-reply',
        attr: { 'aria-label': 'Reply', placeholder: 'Reply…', rows: '2' },
      })
    : null;
  if (box) {
    box.value = host.replyDraft;
    box.addEventListener('input', () => host.onReplyDraftChange(box.value));
  }
  const send = (): void => {
    if (!box) return;
    const text = box.value.trim();
    if (!text) return;
    box.value = '';
    host.onReplyDraftChange('');
    host.onReply(text);
  };
  box?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const wantsSend = host.submitOnEnter ? !e.shiftKey : e.ctrlKey || e.metaKey;
    if (!wantsSend) return;
    e.preventDefault();
    send();
  });

  const actions = card.createDiv({ cls: 'grandemonium-comment-popover-actions' });
  const open = actions.createEl('button', {
    cls: 'grandemonium-comment-popover-button',
    text: 'Open in sidebar',
    attr: { type: 'button' },
  });
  open.onclick = () => host.onOpenSidebar();
  if (!isOpen) return card;

  if (undecidedSuggestion(resolved)) {
    const decline = actions.createEl('button', {
      cls: 'grandemonium-comment-popover-button',
      text: 'Decline',
      attr: { type: 'button' },
    });
    decline.onclick = () => host.onDeclineSuggestion();

    const accept = actions.createEl('button', {
      cls: 'grandemonium-comment-popover-button grandemonium-comment-popover-primary',
      text: 'Accept',
      attr: { type: 'button' },
    });
    accept.disabled = !canAcceptSuggestion(resolved);
    accept.onclick = () => host.onAcceptSuggestion();
  } else {
    const resolve = actions.createEl('button', {
      cls: 'grandemonium-comment-popover-button',
      text: 'Resolve',
      attr: { type: 'button' },
    });
    resolve.onclick = () => host.onResolve();
  }

  const reply = actions.createEl('button', {
    cls: 'grandemonium-comment-popover-button grandemonium-comment-popover-primary',
    text: 'Reply',
    attr: { type: 'button' },
  });
  reply.onclick = send;
  return card;
}

/**
 * Resolves a comment's anchor against the live document, so the popover opens
 * over the passage as it currently reads rather than where it was last saved.
 */
export function popoverTargetFor(text: string, id: string): CommentPopoverTarget | null {
  const doc = parseDocument(text);
  if (doc.error) return null;
  const comment = doc.comments[id];
  if (!comment) return null;
  const resolution = resolveAnchor(doc.prose, comment.anchor);
  return resolution.kind === 'resolved'
    ? { id, from: resolution.start, to: resolution.end }
    : null;
}

/**
 * The open thread whose highlight covers a position, for hover. Resolved
 * threads carry no highlight, so there is nothing there to hover over.
 */
export function popoverTargetAt(text: string, pos: number): CommentPopoverTarget | null {
  const doc = parseDocument(text);
  if (doc.error) return null;
  for (const [id, comment] of Object.entries(doc.comments)) {
    if (comment.status === 'resolved') continue;
    const resolution = resolveAnchor(doc.prose, comment.anchor);
    if (resolution.kind !== 'resolved') continue;
    if (pos >= resolution.start && pos <= resolution.end) {
      return { id, from: resolution.start, to: resolution.end };
    }
  }
  return null;
}

/** Reads one comment out of the live document, quote and thread together. */
export function resolvePopoverComment(text: string, id: string): ResolvedComment | null {
  const doc = parseDocument(text);
  if (doc.error) return null;
  const comment = doc.comments[id];
  return comment ? { id, comment, resolution: resolveAnchor(doc.prose, comment.anchor) } : null;
}

/** Supplies the actions a shown thread offers. */
export interface CommentPopoverSource {
  createHost(id: string, close: () => void): CommentPopoverHost;
  /** Read per hover, so the setting takes effect without reloading the editor. */
  hoverEnabled(): boolean;
}

const HOVER_DELAY_MS = 300;

export function showCommentPopover(view: EditorView, target: CommentPopoverTarget): void {
  view.dispatch({ effects: openCommentPopover.of(target) });
}

export function dismissCommentPopover(view: EditorView): boolean {
  if (!view.state.field(commentPopoverTarget, false)) return false;
  view.dispatch({ effects: closeCommentPopover.of(null) });
  return true;
}

/** The pinned thread, rendered as a CodeMirror tooltip over its own highlight. */
export function commentPopoverExtension(source: CommentPopoverSource): Extension {
  return [
    commentPopoverTarget,
    showTooltip.compute([commentPopoverTarget], (state) => {
      const target = state.field(commentPopoverTarget);
      if (!target) return null;
      return {
        pos: target.from,
        end: target.to,
        above: false,
        arrow: false,
        create: (view: EditorView) => {
          const dom = createDiv({ cls: 'grandemonium-comment-popover' });
          const resolved = resolvePopoverComment(view.state.doc.toString(), target.id);
          if (resolved) {
            renderCommentPopover(
              dom,
              resolved,
              source.createHost(target.id, () => dismissCommentPopover(view))
            );
          }
          return { dom, offset: { x: 0, y: 6 } };
        },
      };
    }),
    keymap.of([{ key: 'Escape', run: dismissCommentPopover }]),
    hoverTooltip(
      (view, pos) => {
        if (!source.hoverEnabled()) return null;
        // A pinned thread is the one the reader chose; a preview would sit on top.
        if (view.state.field(commentPopoverTarget, false)) return null;
        const text = view.state.doc.toString();
        const target = popoverTargetAt(text, pos);
        if (!target) return null;
        const resolved = resolvePopoverComment(text, target.id);
        if (!resolved) return null;
        return {
          pos: target.from,
          end: target.to,
          above: false,
          create: () => {
            const dom = createDiv({ cls: 'grandemonium-comment-popover' });
            renderCommentPopover(
              dom,
              resolved,
              source.createHost(target.id, () => undefined),
              { compact: true }
            );
            return { dom };
          },
        };
      },
      { hoverTime: HOVER_DELAY_MS }
    ),
  ];
}
