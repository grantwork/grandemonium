import { FALLBACK_AUTHOR, resolveAuthorName } from '@/features/comments/author';

describe('resolveAuthorName', () => {
  it('prefers a non-empty override over the OS username', () => {
    expect(resolveAuthorName('Sam', 'felix')).toBe('Sam');
  });

  it('trims the override', () => {
    expect(resolveAuthorName('  Sam  ', 'felix')).toBe('Sam');
  });

  it('falls back to the OS username when the override is empty, blank, or unset', () => {
    expect(resolveAuthorName('', 'felix')).toBe('felix');
    expect(resolveAuthorName('   ', 'felix')).toBe('felix');
    expect(resolveAuthorName(null, 'felix')).toBe('felix');
    expect(resolveAuthorName(undefined, 'felix')).toBe('felix');
  });

  it('falls back to the generic default when neither override nor OS username is available', () => {
    expect(resolveAuthorName('', null)).toBe(FALLBACK_AUTHOR);
    expect(resolveAuthorName(null, null)).toBe(FALLBACK_AUTHOR);
  });
});
