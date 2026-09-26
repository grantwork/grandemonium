/**
 * Grandemonium - Context Utilities
 *
 * Note and context file formatting for prompts.
 */

import { escapePromptXmlAttribute, formatPromptXmlCdata } from './promptXml';

const LINKED_CONTENT_TAG = 'linked_content';

/**
 * Pattern to match XML context tags appended to prompts.
 * These tags are always preceded by \n\n separator.
 * Matches: linked_content, editor_selection (with attributes), editor_cursor (with attributes),
 * context_files, canvas_selection, browser_selection
 */
export const XML_CONTEXT_PATTERN = /\n\n<(?:linked_content|editor_selection|editor_cursor|context_files|canvas_selection|browser_selection)[\s>]/;

export function formatLinkedContent(contentPath: string): string {
  return `<${LINKED_CONTENT_TAG} path="${escapePromptXmlAttribute(contentPath)}" />`;
}

export function appendLinkedContent(prompt: string, contentPath: string): string {
  return `${prompt}\n\n${formatLinkedContent(contentPath)}`;
}

export function formatLinkedContentBody(contentPath: string, content: string): string {
  return `<${LINKED_CONTENT_TAG} path="${escapePromptXmlAttribute(contentPath)}">\n${formatPromptXmlCdata(
    content,
  )}\n</${LINKED_CONTENT_TAG}>`;
}

export function appendLinkedContentBody(
  prompt: string,
  contentPath: string,
  content: string,
): string {
  return `${prompt}\n\n${formatLinkedContentBody(contentPath, content)}`;
}

/**
 * Extracts user content that appears before XML context tags, which are
 * always appended after the user content with a \n\n separator.
 */
export function extractUserDisplayContent(text: string): string | undefined {
  if (!text) return undefined;

  const xmlMatch = text.match(XML_CONTEXT_PATTERN);
  if (xmlMatch?.index !== undefined) {
    return text.substring(0, xmlMatch.index).trim();
  }

  return undefined;
}

/**
 * Extracts the actual user query from an XML-wrapped prompt.
 * Used for comparing prompts during history deduplication.
 *
 * Always returns a string - falls back to stripping all XML tags if no
 * structured context is found.
 */
export function extractUserQuery(prompt: string): string {
  if (!prompt) return '';

  // Try to extract content before XML context
  const extracted = extractUserDisplayContent(prompt);
  if (extracted !== undefined) {
    return extracted;
  }

  // No XML context - return the whole prompt stripped of any remaining tags
  return prompt
    .replace(/<linked_content(?:\s[^>]*)?\s*\/>\s*/g, '')
    .replace(/<linked_content(?:\s[^>]*)?>[\s\S]*?<\/linked_content>\s*/g, '')
    .replace(/<editor_selection[\s\S]*?<\/editor_selection>\s*/g, '')
    .replace(/<editor_cursor[\s\S]*?<\/editor_cursor>\s*/g, '')
    .replace(/<context_files>[\s\S]*?<\/context_files>\s*/g, '')
    .replace(/<canvas_selection[\s\S]*?<\/canvas_selection>\s*/g, '')
    .replace(/<browser_selection[\s\S]*?<\/browser_selection>\s*/g, '')
    .trim();
}

function formatContextFilesLine(files: string[]): string {
  const entries = files
    .map(file => `<context_file path="${escapePromptXmlAttribute(file)}" />`)
    .join('\n');
  return `<context_files>\n${entries}\n</context_files>`;
}

export function appendContextFiles(prompt: string, files: string[]): string {
  return `${prompt}\n\n${formatContextFilesLine(files)}`;
}
