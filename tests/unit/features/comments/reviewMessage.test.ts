import { buildReviewMessage } from '@/features/comments/reviewMessage';

describe('buildReviewMessage', () => {
  it('leads with the configured prompt', () => {
    const message = buildReviewMessage('review open comments', 'notes/pricing.md');

    expect(message.startsWith('review open comments')).toBe(true);
  });

  it('names the file the comment was added to', () => {
    const message = buildReviewMessage('review open comments', 'notes/pricing.md');

    expect(message).toContain('notes/pricing.md');
  });

  it('keeps the prompt alone when no file is known', () => {
    expect(buildReviewMessage('review open comments', null)).toBe('review open comments');
  });

  it('escapes a path that would otherwise break the attribute', () => {
    const message = buildReviewMessage('go', 'notes/a"b.md');

    expect(message).toContain('&quot;');
    expect(message).not.toContain('path="notes/a"b.md"');
  });
});
