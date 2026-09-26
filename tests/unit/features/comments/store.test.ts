import { normalizeChanges, parseDocument, resolveAnchor, SCHEMA_HINT_LINES, serializeDocument } from '@/features/comments/store';
import type { CommentMap } from '@/features/comments/types';

const COMMENTS: CommentMap = {
  a1f3: {
    anchor: { exact: 'cut prices hard', prefix: 'we should ', suffix: ' in Q3', pos: 33 },
    status: 'open',
    thread: [{ author: 'Sam', ts: '2026-06-10T10:24:00Z', text: 'Too hard?' }],
  },
};

function block(json: string, hint = true): string {
  const hintStr = hint ? SCHEMA_HINT_LINES.join('\n') + '\n' : '';
  return '```grandemonium-comments\n' + hintStr + json + '\n```\n';
}

describe('parseDocument', () => {
  it('returns whole file as prose when no block exists', () => {
    const raw = '# Title\n\nWe cut prices.\n';
    expect(parseDocument(raw)).toEqual({ prose: raw, comments: {} });
  });

  it('splits prose and comments when block exists', () => {
    const prose = 'For the coming quarter we should cut prices hard in Q3.';
    const raw = prose + '\n' + block(JSON.stringify(COMMENTS, null, 2));
    const doc = parseDocument(raw);
    expect(doc.prose).toBe(prose);
    expect(doc.comments).toEqual(COMMENTS);
    expect(doc.error).toBeUndefined();
  });

  it('ignores // hint lines before the JSON', () => {
    const raw = 'Text.\n' + block(JSON.stringify(COMMENTS, null, 2), true);
    expect(parseDocument(raw).comments).toEqual(COMMENTS);
  });

  it('parses a block without hint lines', () => {
    const raw = 'Text.\n' + block(JSON.stringify(COMMENTS, null, 2), false);
    expect(parseDocument(raw).comments).toEqual(COMMENTS);
  });

  it('sets error and keeps raw as prose when JSON is broken', () => {
    const raw = 'Text.\n```grandemonium-comments\n{ broken\n```\n';
    const doc = parseDocument(raw);
    expect(doc.error).toBeTruthy();
    expect(doc.prose).toBe(raw);
    expect(doc.comments).toEqual({});
  });

  it('handles a file that is only a block (empty prose)', () => {
    const raw = block(JSON.stringify(COMMENTS, null, 2));
    const doc = parseDocument(raw);
    expect(doc.prose).toBe('');
    expect(doc.comments).toEqual(COMMENTS);
  });

  // Obsidian appends footnote definitions to the end of the file, after the block.
  it('parses the block when footnote definitions follow it', () => {
    const prose = 'For the coming quarter we should cut prices hard in Q3.[^1]';
    const raw = prose + '\n' + block(JSON.stringify(COMMENTS, null, 2)) + '\n[^1]: Source: pricing memo\n';
    const doc = parseDocument(raw);
    expect(doc.error).toBeUndefined();
    expect(doc.prose).toBe(prose);
    expect(doc.comments).toEqual(COMMENTS);
  });

  it('round-trips byte-exact when footnotes follow the block', () => {
    const raw =
      'Text[^1]\n' + block(JSON.stringify(COMMENTS, null, 2)) + '\n[^1]: Footnote\n[^2]: another one\n';
    const doc = parseDocument(raw);
    expect(doc.comments).toEqual(COMMENTS);
    expect(serializeDocument(doc, true)).toBe(raw);
  });

  it('finds its own closing fence when a code block follows in the trailing content', () => {
    const raw = 'Text\n' + block(JSON.stringify(COMMENTS, null, 2)) + '\n[^1]: see\n\n```js\nfoo()\n```\n';
    const doc = parseDocument(raw);
    expect(doc.error).toBeUndefined();
    expect(doc.prose).toBe('Text');
    expect(doc.comments).toEqual(COMMENTS);
    expect(serializeDocument(doc, true)).toBe(raw);
  });

  it('sets error (not silent blank) when JSON is broken and footnotes follow', () => {
    const raw = 'Text\n```grandemonium-comments\n{ broken\n```\n[^1]: Footnote\n';
    const doc = parseDocument(raw);
    expect(doc.error).toBeTruthy();
    expect(doc.prose).toBe(raw);
    expect(doc.comments).toEqual({});
  });

  it('parses a hand-written block as Claude would author it', () => {
    const raw = [
      'For the coming quarter we should cut prices hard in Q3.',
      '```grandemonium-comments',
      '// Schema: { "<id>": { anchor:{exact,prefix,suffix,pos?}, status:open|resolved, thread:[{author,ts,text}] } }',
      '// Anchor = quote from the prose. To locate: search for "exact", disambiguate via prefix/suffix.',
      '{',
      '  "7c2e": {',
      '    "anchor": { "exact": "cut prices hard", "prefix": "we should ", "suffix": " in Q3", "pos": 33 },',
      '    "status": "open",',
      '    "thread": [{ "author": "Claude", "ts": "2026-06-10T12:00:00Z", "text": "Suggestion: trim selectively." }]',
      '  }',
      '}',
      '```',
      '',
    ].join('\n');
    const doc = parseDocument(raw);
    expect(doc.error).toBeUndefined();
    expect(doc.prose).toBe('For the coming quarter we should cut prices hard in Q3.');
    expect(resolveAnchor(doc.prose, doc.comments['7c2e'].anchor)).toEqual({ kind: 'resolved', start: 33, end: 48 });
  });
});

describe('serializeDocument', () => {
  it('returns prose byte-exact when no comments exist', () => {
    const prose = 'No newline at the end';
    expect(serializeDocument({ prose, comments: {} }, true)).toBe(prose);
  });

  it('round-trips byte-exact (parse → serialize → parse)', () => {
    for (const prose of ['Without newline', 'With newline\n', 'Several\n\n\n', '']) {
      const out = serializeDocument({ prose, comments: COMMENTS }, true);
      const doc = parseDocument(out);
      expect(doc.prose).toBe(prose);
      expect(doc.comments).toEqual(COMMENTS);
      expect(serializeDocument(doc, true)).toBe(out);
    }
  });

  it('add + remove all comments restores the original file byte-exact', () => {
    const original = 'Prose without trailing newline';
    const withComments = serializeDocument({ prose: original, comments: COMMENTS }, true);
    const doc = parseDocument(withComments);
    expect(serializeDocument({ prose: doc.prose, comments: {} }, true)).toBe(original);
  });

  it('omits hint lines when schemaHint is false', () => {
    const out = serializeDocument({ prose: 'X', comments: COMMENTS }, false);
    expect(out).not.toContain('// Schema');
    expect(parseDocument(out).comments).toEqual(COMMENTS);
  });

  it('never emits a bare ``` line from comment text (JSON escapes newlines)', () => {
    const comments: CommentMap = {
      x1: {
        anchor: { exact: 'A' },
        status: 'open',
        thread: [{ author: 'Sam', ts: '2026-06-10T00:00:00Z', text: 'Code:\n```\nfoo\n```\nEnde' }],
      },
    };
    const out = serializeDocument({ prose: 'A B C', comments }, true);
    const doc = parseDocument(out);
    expect(doc.comments).toEqual(comments);
    expect(doc.prose).toBe('A B C');
  });

  it('keeps trailing footnotes when the last comment is removed', () => {
    const raw = 'Text[^1]\n' + block(JSON.stringify(COMMENTS, null, 2)) + '\n[^1]: Footnote\n';
    const doc = parseDocument(raw);
    expect(serializeDocument({ ...doc, comments: {} }, true)).toBe('Text[^1]\n[^1]: Footnote\n');
  });

  it('restores the separator supplied by the closing fence before trailing content', () => {
    const raw = 'Text[^1]\n' + block(JSON.stringify(COMMENTS, null, 2)) + '[^1]: Footnote\n';
    const doc = parseDocument(raw);
    expect(doc.trailing).toBe('[^1]: Footnote\n');
    expect(serializeDocument({ ...doc, comments: {} }, true)).toBe('Text[^1]\n[^1]: Footnote\n');
  });

  it('throws when asked to serialize a doc with parse error', () => {
    expect(() => serializeDocument({ prose: 'x', comments: {}, error: 'broken' }, true)).toThrow();
  });
});

describe('normalizeChanges', () => {
  // Applies CodeMirror-style simultaneous changes, in original coordinates, to a string.
  function applyChanges(raw: string, changes: { from: number; to: number; insert: string }[]): string {
    let out = raw;
    for (const c of [...changes].sort((a, b) => b.from - a.from)) {
      out = out.slice(0, c.from) + c.insert + out.slice(c.to);
    }
    return out;
  }

  function normalize(raw: string): string | null {
    const changes = normalizeChanges(raw, parseDocument(raw), true);
    return changes ? applyChanges(raw, changes) : null;
  }

  it('folds prose typed after the block back in front of it', () => {
    const prose = 'For the coming quarter we should cut prices hard in Q3.';
    const raw = prose + '\n' + block(JSON.stringify(COMMENTS, null, 2)) + 'New sentence.\n';
    const result = normalize(raw)!;
    const doc = parseDocument(result);
    expect(doc.prose).toBe(prose + '\nNew sentence.');
    expect(doc.comments).toEqual(COMMENTS);
    expect(doc.trailing ?? '').toBe('');
    // Idempotent: the result is canonical.
    expect(normalizeChanges(result, parseDocument(result), true)).toBeNull();
  });

  it('folds trailing text that has no final newline', () => {
    const raw = 'Prose.\n' + block(JSON.stringify(COMMENTS, null, 2)) + 'test';
    const doc = parseDocument(normalize(raw)!);
    expect(doc.prose).toBe('Prose.\ntest');
    expect(doc.comments).toEqual(COMMENTS);
  });

  it('folds footnote definitions too (block stays last)', () => {
    const raw = 'Text.[^1]\n' + block(JSON.stringify(COMMENTS, null, 2)) + '[^1]: Definition\n';
    const doc = parseDocument(normalize(raw)!);
    expect(doc.prose).toBe('Text.[^1]\n[^1]: Definition');
    expect(doc.trailing ?? '').toBe('');
  });

  it('handles a file that starts with the block (empty prose)', () => {
    const raw = block(JSON.stringify(COMMENTS, null, 2)) + 'test\n';
    const result = normalize(raw)!;
    const doc = parseDocument(result);
    expect(doc.prose).toBe('test');
    expect(doc.comments).toEqual(COMMENTS);
    expect(result.startsWith('\n')).toBe(false);
  });

  it('folds a trailing fenced code block back in front of the block', () => {
    const raw = 'Prose.\n' + block(JSON.stringify(COMMENTS, null, 2)) + '```js\ncode()\n```\n';
    const result = normalize(raw)!;
    const doc = parseDocument(result);
    expect(doc.prose).toBe('Prose.\n```js\ncode()\n```');
    expect(doc.comments).toEqual(COMMENTS);
    expect(doc.trailing ?? '').toBe('');
  });

  it('returns null when there is no trailing content', () => {
    const raw = 'Prose.\n' + block(JSON.stringify(COMMENTS, null, 2));
    expect(normalizeChanges(raw, parseDocument(raw), true)).toBeNull();
  });

  it('returns null for whitespace-only trailing', () => {
    const raw = 'Prose.\n' + block(JSON.stringify(COMMENTS, null, 2)) + '\n\n  \n';
    expect(normalizeChanges(raw, parseDocument(raw), true)).toBeNull();
  });

  it('returns null when the block has a parse error', () => {
    const raw = 'Prose.\n```grandemonium-comments\n{ broken\n```\ntest\n';
    expect(normalizeChanges(raw, parseDocument(raw), true)).toBeNull();
  });

  it('returns null when there is no block at all', () => {
    const raw = 'Only prose.\n';
    expect(normalizeChanges(raw, parseDocument(raw), true)).toBeNull();
  });
});

describe('notes with more than one comment block', () => {
  const FIRST: CommentMap = {
    c201: {
      anchor: { exact: 'cost falls on the licensee', prefix: '', suffix: '' },
      status: 'open',
      thread: [{ author: 'claude', ts: '2026-09-26T01:00:00Z', text: 'Is this sound?' }],
    },
  };
  const LAST: CommentMap = {
    c101: {
      anchor: { exact: 'hosting is included', prefix: '', suffix: '' },
      status: 'open',
      thread: [{ author: 'gpt', ts: '2026-09-26T00:58:26Z', text: 'Which costs?' }],
    },
  };
  const json = (comments: CommentMap) => JSON.stringify(comments, null, 2);
  // An agent put its comment in a block of its own under the passage, and
  // another agent appended the usual block at the end.
  const raw =
    'The cost falls on the licensee.\n\n' +
    block(json(FIRST), false) +
    '\nHosting is included.\n' +
    block(json(LAST));

  function applyChanges(text: string, changes: { from: number; to: number; insert: string }[]): string {
    let out = text;
    for (const c of [...changes].sort((a, b) => b.from - a.from)) {
      out = out.slice(0, c.from) + c.insert + out.slice(c.to);
    }
    return out;
  }

  it('reads the comments of every block, not only the last', () => {
    const doc = parseDocument(raw);
    expect(doc.error).toBeUndefined();
    expect(doc.comments).toEqual({ ...FIRST, ...LAST });
  });

  it('keeps the earlier blocks in the prose so editor offsets stay true', () => {
    const doc = parseDocument(raw);
    expect(raw.startsWith(doc.prose)).toBe(true);
    expect(doc.prose).toContain('c201');
  });

  it('writes one block at the end, with the earlier blocks removed', () => {
    const expected = 'The cost falls on the licensee.\n\nHosting is included.\n' + block(json({ ...FIRST, ...LAST }));
    expect(serializeDocument(parseDocument(raw), true)).toBe(expected);
  });

  it('normalises the note to the same single block, and is then canonical', () => {
    const changes = normalizeChanges(raw, parseDocument(raw), true);
    expect(changes).not.toBeNull();
    const result = applyChanges(raw, changes!);
    expect(result).toBe(serializeDocument(parseDocument(raw), true));
    expect(normalizeChanges(result, parseDocument(result), true)).toBeNull();
  });

  it('merges an id repeated with identical content', () => {
    const repeated = 'Text.\n\n' + block(json(LAST)) + '\nMore.\n' + block(json(LAST));
    const doc = parseDocument(repeated);
    expect(doc.error).toBeUndefined();
    expect(doc.comments).toEqual(LAST);
  });

  it('reports an id that two blocks use for different comments', () => {
    const clash: CommentMap = { c101: { ...LAST.c101, status: 'resolved' } };
    const conflicting = 'Text.\n\n' + block(json(clash)) + '\nMore.\n' + block(json(LAST));
    const doc = parseDocument(conflicting);
    expect(doc.error).toContain('c101');
    expect(doc.comments).toEqual({});
    expect(doc.prose).toBe(conflicting);
  });

  it('ignores a block quoted inside a longer fence', () => {
    const example = 'The format looks like this:\n\n````markdown\n' + block(json(FIRST)) + '````\n\nEnd.\n';
    expect(parseDocument(example)).toEqual({ prose: example, comments: {} });
  });
});

describe('the previous fence name', () => {
  const legacy = 'Text.\n```tandem-comments\n' + JSON.stringify(COMMENTS, null, 2) + '\n```\n';

  it('is still read', () => {
    const doc = parseDocument(legacy);
    expect(doc.prose).toBe('Text.');
    expect(doc.comments).toEqual(COMMENTS);
  });

  it('is rewritten under the current name by normalisation', () => {
    const changes = normalizeChanges(legacy, parseDocument(legacy), false);
    expect(changes).not.toBeNull();
    let out = legacy;
    for (const c of [...changes!].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
    expect(out).toBe('Text.\n' + block(JSON.stringify(COMMENTS, null, 2), false));
  });
});
