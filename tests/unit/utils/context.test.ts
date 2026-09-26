import {
  appendContextFiles,
  appendLinkedContent,
  appendLinkedContentBody,
  extractUserDisplayContent,
  extractUserQuery,
  formatLinkedContent,
  XML_CONTEXT_PATTERN,
} from '../../../src/utils/context';

describe('formatLinkedContent', () => {
  it('formats a content path as a canonical XML attribute', () => {
    expect(formatLinkedContent('notes/test.md')).toBe(
      '<linked_content path="notes/test.md" />'
    );
  });

  it('escapes paths with XML special characters', () => {
    expect(formatLinkedContent('notes/my "file" & <draft>.md')).toBe(
      '<linked_content path="notes/my &quot;file&quot; &amp; &lt;draft&gt;.md" />'
    );
  });
});

describe('appendLinkedContentBody', () => {
  it('appends an escaped path while preserving literal content', () => {
    const result = appendLinkedContentBody(
      'Query',
      'notes/my "file".md',
      'Body\n</linked_content>\nMore',
    );

    expect(result).toBe(
      'Query\n\n<linked_content path="notes/my &quot;file&quot;.md">\n<![CDATA[Body\n</linked_content>\nMore]]>\n</linked_content>',
    );
  });
});

describe('appendLinkedContent', () => {
  it('appends Linked content with a double newline separator', () => {
    const result = appendLinkedContent('Hello', 'notes/test.md');
    expect(result).toBe(
      'Hello\n\n<linked_content path="notes/test.md" />'
    );
  });

  it('preserves original prompt content', () => {
    const result = appendLinkedContent('Multi\nline\nprompt', 'test.md');
    expect(result.startsWith('Multi\nline\nprompt\n\n')).toBe(true);
  });
});

describe('XML_CONTEXT_PATTERN', () => {
  it('matches linked_content tag', () => {
    const text = 'Query\n\n<linked_content path="Projects/Research" />';
    expect(XML_CONTEXT_PATTERN.test(text)).toBe(true);
  });

  it('matches editor_selection tag with attributes', () => {
    const text = 'Query\n\n<editor_selection path="test.md">\nselected text\n</editor_selection>';
    expect(XML_CONTEXT_PATTERN.test(text)).toBe(true);
  });

  it('matches editor_cursor tag', () => {
    const text = 'Query\n\n<editor_cursor path="test.md">\n</editor_cursor>';
    expect(XML_CONTEXT_PATTERN.test(text)).toBe(true);
  });

  it('matches context_files tag', () => {
    const text = 'Query\n\n<context_files>\nfile1.md, file2.md\n</context_files>';
    expect(XML_CONTEXT_PATTERN.test(text)).toBe(true);
  });

  it('matches canvas_selection tag', () => {
    const text = 'Query\n\n<canvas_selection path="my.canvas">\nnode1, node2\n</canvas_selection>';
    expect(XML_CONTEXT_PATTERN.test(text)).toBe(true);
  });

  it('matches browser_selection tag', () => {
    const text = 'Query\n\n<browser_selection source="surfing-view">\nselected web content\n</browser_selection>';
    expect(XML_CONTEXT_PATTERN.test(text)).toBe(true);
  });

  it('does not match without double newline separator', () => {
    const text = 'Query\n<linked_content path="test.md" />';
    expect(XML_CONTEXT_PATTERN.test(text)).toBe(false);
  });

  it('does not match other XML tags', () => {
    const text = 'Query\n\n<other_tag>\ncontent\n</other_tag>';
    expect(XML_CONTEXT_PATTERN.test(text)).toBe(false);
  });
});

describe('extractUserDisplayContent', () => {
  describe('user content first', () => {
    it('extracts content before linked_content tag', () => {
      const prompt = 'User query\n\n<linked_content path="test.md" />';
      expect(extractUserDisplayContent(prompt)).toBe('User query');
    });

    it('extracts content before editor_selection tag', () => {
      const prompt = 'Edit this\n\n<editor_selection path="test.md">\nselected\n</editor_selection>';
      expect(extractUserDisplayContent(prompt)).toBe('Edit this');
    });

    it('extracts content before editor_cursor tag', () => {
      const prompt = 'Insert here\n\n<editor_cursor path="test.md">\n</editor_cursor>';
      expect(extractUserDisplayContent(prompt)).toBe('Insert here');
    });

    it('extracts content before context_files tag', () => {
      const prompt = 'Use these files\n\n<context_files>\nfile1.md\n</context_files>';
      expect(extractUserDisplayContent(prompt)).toBe('Use these files');
    });

    it('handles multiple context tags - extracts before first one', () => {
      const prompt = 'Query\n\n<linked_content path="test.md" />\n\n<editor_selection path="x">\ny\n</editor_selection>';
      expect(extractUserDisplayContent(prompt)).toBe('Query');
    });

    it('extracts content before browser_selection tag', () => {
      const prompt = 'Summarize this\n\n<browser_selection source="surfing-view">\nselected web content\n</browser_selection>';
      expect(extractUserDisplayContent(prompt)).toBe('Summarize this');
    });

    it('trims whitespace from extracted content', () => {
      const prompt = '  spaced query  \n\n<linked_content path="test.md" />';
      expect(extractUserDisplayContent(prompt)).toBe('spaced query');
    });
  });

  describe('edge cases', () => {
    it('returns undefined for empty string', () => {
      expect(extractUserDisplayContent('')).toBeUndefined();
    });

    it('returns undefined for plain text without XML context', () => {
      expect(extractUserDisplayContent('Just a plain prompt')).toBeUndefined();
    });

    it('does not hide ordinary XML-like user text', () => {
      expect(extractUserDisplayContent('What does <xml> mean?')).toBeUndefined();
    });

    it('returns undefined for null-ish input', () => {
      expect(extractUserDisplayContent(null as unknown as string)).toBeUndefined();
      expect(extractUserDisplayContent(undefined as unknown as string)).toBeUndefined();
    });
  });
});

describe('extractUserQuery', () => {
  describe('with XML context (delegates to extractUserDisplayContent)', () => {
    it('extracts content before XML context tags', () => {
      const prompt = 'User query\n\n<linked_content path="test.md" />';
      expect(extractUserQuery(prompt)).toBe('User query');
    });
  });

  describe('fallback tag stripping', () => {
    it('strips self-closing linked_content tags', () => {
      const prompt = 'Query <linked_content path="test.md" /> continues';
      expect(extractUserQuery(prompt)).toBe('Query continues');
    });

    it('strips paired linked_content tags', () => {
      const prompt = 'Query <linked_content path="test.md">body</linked_content> continues';
      expect(extractUserQuery(prompt)).toBe('Query continues');
    });

    it('strips editor_selection tags', () => {
      const prompt = 'Query <editor_selection path="x">text</editor_selection> end';
      expect(extractUserQuery(prompt)).toBe('Query end');
    });

    it('strips editor_cursor tags', () => {
      const prompt = 'Query <editor_cursor path="x"></editor_cursor> end';
      expect(extractUserQuery(prompt)).toBe('Query end');
    });

    it('strips context_files tags', () => {
      const prompt = 'Query <context_files>file.md</context_files> end';
      expect(extractUserQuery(prompt)).toBe('Query end');
    });

    it('strips canvas_selection tags', () => {
      const prompt = 'Query <canvas_selection path="x.canvas">node1</canvas_selection> end';
      expect(extractUserQuery(prompt)).toBe('Query end');
    });

    it('strips browser_selection tags', () => {
      const prompt = 'Query <browser_selection source="surfing-view">selection</browser_selection> end';
      expect(extractUserQuery(prompt)).toBe('Query end');
    });

    it('strips multiple tag types', () => {
      const prompt = '<linked_content path="a.md" />Query<context_files>b.md</context_files>';
      expect(extractUserQuery(prompt)).toBe('Query');
    });
  });

  describe('edge cases', () => {
    it('returns empty string for empty input', () => {
      expect(extractUserQuery('')).toBe('');
    });

    it('returns empty string for null-ish input', () => {
      expect(extractUserQuery(null as unknown as string)).toBe('');
      expect(extractUserQuery(undefined as unknown as string)).toBe('');
    });

    it('returns trimmed plain text when no tags present', () => {
      expect(extractUserQuery('  plain query  ')).toBe('plain query');
    });
  });
});

describe('appendContextFiles', () => {
  it('appends context files in XML format', () => {
    const result = appendContextFiles('Query', ['file1.md', 'file2.md']);
    expect(result).toBe(
      'Query\n\n<context_files>\n<context_file path="file1.md" />\n<context_file path="file2.md" />\n</context_files>',
    );
  });

  it('escapes special characters in file paths', () => {
    const result = appendContextFiles('Query', ['my "file" & notes.md']);
    expect(result).toBe(
      'Query\n\n<context_files>\n<context_file path="my &quot;file&quot; &amp; notes.md" />\n</context_files>',
    );
  });

  it('handles empty file array', () => {
    const result = appendContextFiles('Query', []);
    expect(result).toBe('Query\n\n<context_files>\n\n</context_files>');
  });
});
