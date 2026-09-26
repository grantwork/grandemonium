import { normalizeLinkedContentPath } from '@/core/path/LinkedContentPath';

describe('normalizeLinkedContentPath', () => {
  it.each([
    ['Notes/Plan.md', 'Notes/Plan.md'],
    ['Notes\\Plan.md', 'Notes/Plan.md'],
    ['./Projects//Roadmap/./Draft.md/', 'Projects/Roadmap/Draft.md'],
    ['Missing/Future.md', 'Missing/Future.md'],
  ])('normalizes %p to %p', (input, expected) => {
    expect(normalizeLinkedContentPath(input)).toBe(expected);
  });

  it.each([
    '',
    '.',
    './',
    '/absolute/path',
    'C:\\Vault\\Note.md',
    '\\outside\\Note.md',
    '\\\\server\\share\\Note.md',
    '../escape.md',
    'Notes/../escape.md',
    'Notes/\u0000bad.md',
    'Notes/\u001fbad.md',
  ])('rejects unsafe path %p', (input) => {
    expect(normalizeLinkedContentPath(input)).toBeNull();
  });
});
