import { GRANDEMONIUM_COLLAB_LIMITS } from '@/core/collab/GrandemoniumCollabConstants';
import {
  MarkdownDraftEditor,
  type MarkdownDraftMemberSuggestion,
  type MarkdownDraftTicketSuggestion,
} from '@/features/collab/shared/markdown/MarkdownDraftEditor';
import { renderMarkdownWithTicketReferences } from '@/features/collab/shared/markdown/MarkdownTicketReferences';
import { t } from '@/i18n/i18n';

export interface CollabCommentPresentation {
  readonly authorName: string;
  readonly body: string;
  readonly context?: string;
  readonly createdAt: string;
}

export interface CollabCommentRenderOptions {
  readonly onOpenTicket?: (ticketNumber: number) => Promise<void> | void;
  readonly renderMarkdown: (markdown: string, host: HTMLElement) => Promise<void>;
}

export interface CollabCommentComposerOptions extends CollabCommentRenderOptions {
  readonly actionName: string;
  readonly ariaLabel: string;
  readonly dataField: string;
  readonly label: string;
  readonly memberSuggestions?: readonly MarkdownDraftMemberSuggestion[];
  readonly onSubmit: (
    body: string,
    button: HTMLButtonElement,
    status: HTMLElement,
  ) => Promise<void> | void;
  readonly statusEl?: HTMLElement;
  readonly submitAction: string;
  readonly submitLabel: string;
  readonly ticketSuggestions?: readonly MarkdownDraftTicketSuggestion[];
}

export function renderCollabComment(
  item: HTMLElement,
  comment: CollabCommentPresentation,
  options: CollabCommentRenderOptions,
): void {
  const metadata = item.createDiv({ cls: 'grandemonium-collab-comment-meta' });
  metadata.createSpan({ text: comment.authorName });
  if (comment.context) {
    metadata.createSpan({ cls: 'grandemonium-collab-comment-context', text: comment.context });
  }
  metadata.createEl('time', {
    attr: { datetime: comment.createdAt },
    text: new Date(comment.createdAt).toLocaleString(),
  });
  const body = item.createDiv({ cls: 'grandemonium-collab-comment-markdown' });
  void renderMarkdownWithTicketReferences({
    host: body,
    markdown: comment.body,
    ...(options.onOpenTicket ? { onOpenTicket: options.onOpenTicket } : {}),
    renderMarkdown: options.renderMarkdown,
  }).catch(() => body.setText(comment.body));
}

export class CollabCommentComposer {
  readonly editor: MarkdownDraftEditor;
  private readonly statusEl: HTMLElement;

  constructor(root: HTMLElement, private readonly options: CollabCommentComposerOptions) {
    const composer = root.createDiv({ cls: 'grandemonium-collab-comment-composer' });
    const header = composer.createDiv({ cls: 'grandemonium-collab-comment-composer-header' });
    header.createSpan({ text: options.label });
    const modes = header.createDiv({ cls: 'grandemonium-collab-comment-modes' });
    const editorRoot = composer.createDiv({
      attr: {
        'aria-label': options.ariaLabel,
        'data-field': options.dataField,
      },
    });
    this.editor = new MarkdownDraftEditor(editorRoot, {
      actionName: options.actionName,
      ariaLabel: options.ariaLabel,
      ...(options.onOpenTicket ? { onOpenTicket: options.onOpenTicket } : {}),
      renderMarkdown: options.renderMarkdown,
      ...(options.memberSuggestions ? { memberSuggestions: options.memberSuggestions } : {}),
      ...(options.ticketSuggestions ? { ticketSuggestions: options.ticketSuggestions } : {}),
      toolbarEl: modes,
    });
    this.statusEl = options.statusEl ?? composer.createDiv({
      attr: { 'aria-live': 'polite' },
      cls: 'grandemonium-collab-comment-status',
    });
    const submit = modes.createEl('button', {
      attr: { 'data-action': options.submitAction, type: 'button' },
      cls: 'grandemonium-collab-comment-submit',
      text: options.submitLabel,
    });
    submit.addEventListener('click', () => this.submit(submit));
  }

  destroy(): void {
    this.editor.destroy();
  }

  private submit(button: HTMLButtonElement): void {
    const body = this.editor.getValue().trim();
    if (body.length === 0) {
      this.editor.setInvalid(true);
      this.editor.focus();
      this.statusEl.setText(t('collab.comments.required'));
      return;
    }
    if (new TextEncoder().encode(body).byteLength > GRANDEMONIUM_COLLAB_LIMITS.maxCommentBytes) {
      this.editor.setInvalid(true);
      this.statusEl.setText(t('collab.comments.tooLarge'));
      return;
    }
    this.editor.setInvalid(false);
    this.statusEl.setText('');
    void this.options.onSubmit(body, button, this.statusEl);
  }
}
