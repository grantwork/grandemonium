import { ChangeSet } from '@codemirror/state';

import { mapAnchors } from './reanchor';
import type {
  Anchor,
  AnchorResolution,
  CommentMap,
  CommentStatus,
  ParsedDoc,
  ResolvedComment,
  SuggestionResult,
  TextRange,
  ThreadEntry,
} from './types';

export const SCHEMA_HINT_LINES = [
  '// Schema: { "<id>": { anchor:{exact,prefix,suffix,pos?}, status:open|resolved, thread:[{author,ts,text}], suggestion?:{replacement,author,ts,result?} } }',
  '// Anchor = quote from the prose. To locate: search for "exact", disambiguate via prefix/suffix.',
];

/** The fenced code block language that marks a note's comment block. */
export const FENCE_NAME = 'grandemonium-comments';
/**
 * The name blocks were written under before the rename. Still read, because an
 * agent that learned the format from an older note may write it, and rewritten
 * under {@link FENCE_NAME} by normalisation.
 */
const PREVIOUS_FENCE_NAME = 'tandem-comments';
/** Every fence name a comment block is recognised by. */
export const COMMENT_FENCE_NAMES = [FENCE_NAME, PREVIOUS_FENCE_NAME] as const;
const FENCE_OPEN = '```' + FENCE_NAME;
const CONTEXT_LEN = 20;

export function parseBlockBody(body: string): CommentMap {
  const lines = body.split('\n');
  let i = 0;
  while (i < lines.length && (lines[i].startsWith('//') || lines[i].trim() === '')) i++;
  const data: unknown = JSON.parse(lines.slice(i).join('\n'));
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error("the comment block's top level must be an object");
  }
  return data as CommentMap;
}

interface BlockMatch {
  /** Offset of the opening fence line. */
  start: number;
  bodyStart: number;
  bodyEnd: number;
  /** Offset just past the closing fence line and its newline. */
  end: number;
  current: boolean;
}

/**
 * Every comment block in the note, in order. Only blocks at the top level
 * count: one quoted inside a longer fence (a note documenting the format) is
 * example text, not comments.
 */
function findBlocks(raw: string): BlockMatch[] {
  const blocks: BlockMatch[] = [];
  let outer: { char: string; length: number } | null = null;
  let pos = 0;
  while (pos < raw.length) {
    const newline = raw.indexOf('\n', pos);
    const lineEnd = newline < 0 ? raw.length : newline;
    const line = raw.slice(pos, lineEnd);
    let next = lineEnd + 1;
    if (outer) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1][0] === outer.char && close[1].length >= outer.length) outer = null;
    } else if (newline >= 0 && (line === FENCE_OPEN || line === '```' + PREVIOUS_FENCE_NAME)) {
      const bodyStart = lineEnd + 1;
      const rest = raw.slice(bodyStart);
      // The block's closing fence is the first complete ``` line; the body cannot
      // contain one (JSON escapes newlines and hint lines start with //).
      let closeIdx = rest.indexOf('\n```');
      while (closeIdx >= 0 && closeIdx + 4 < rest.length && rest[closeIdx + 4] !== '\n') {
        closeIdx = rest.indexOf('\n```', closeIdx + 1);
      }
      if (closeIdx < 0) break;
      const end = bodyStart + Math.min(closeIdx + 5, rest.length);
      blocks.push({ start: pos, bodyStart, bodyEnd: bodyStart + closeIdx, end, current: line === FENCE_OPEN });
      next = end;
    } else {
      const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (open) outer = { char: open[1][0], length: open[1].length };
    }
    pos = next;
  }
  return blocks;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key) => sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
  );
}

/**
 * The spans the earlier blocks are removed by. A blank line before and after a
 * block collapses to one, and a block right before the last one takes the
 * newlines ahead of it, so the prose around it keeps its spacing.
 */
function strayRanges(raw: string, blocks: BlockMatch[], proseEnd: number): TextRange[] {
  const ranges: TextRange[] = [];
  let floor = 0;
  for (const block of blocks) {
    let from = block.start;
    let to = Math.min(block.end, proseEnd);
    if (to === proseEnd) {
      while (from > floor && raw[from - 1] === '\n') from--;
    } else if (from >= floor + 2 && raw[from - 1] === '\n' && raw[from - 2] === '\n' && raw[to] === '\n') {
      to++;
    }
    ranges.push({ from, to });
    floor = to;
  }
  return ranges;
}

/**
 * A note holds one comment block, at its end. Agents sometimes write more (for
 * example one under each passage they comment on), so every block is read and
 * merged. The prose runs up to the last block and keeps any earlier ones as
 * text, so offsets into it stay offsets into the note; `strays` marks them for
 * removal when the note is next written.
 */
export function parseDocument(raw: string): ParsedDoc {
  const blocks = findBlocks(raw);
  if (blocks.length === 0) return { prose: raw, comments: {} };
  const last = blocks[blocks.length - 1];
  const proseEnd = last.start > 0 ? last.start - 1 : 0;
  try {
    const comments: CommentMap = {};
    for (const block of blocks) {
      for (const [id, comment] of Object.entries(parseBlockBody(raw.slice(block.bodyStart, block.bodyEnd)))) {
        if (id in comments && !sameValue(comments[id], comment)) {
          throw new Error(`comment id "${id}" is used by two blocks for different comments`);
        }
        comments[id] = comment;
      }
    }
    const doc: ParsedDoc = { prose: raw.slice(0, proseEnd), comments };
    const trailing = raw.slice(last.end);
    if (trailing) doc.trailing = trailing;
    if (blocks.length > 1) doc.strays = strayRanges(raw, blocks.slice(0, -1), proseEnd);
    if (!last.current) doc.outdatedFence = true;
    return doc;
  } catch (e) {
    return { prose: raw, comments: {}, error: e instanceof Error ? e.message : String(e) };
  }
}

function applyTextChanges(text: string, changes: readonly SuggestionTextChange[]): string {
  let out = text;
  for (const change of [...changes].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, change.from) + change.insert + out.slice(change.to);
  }
  return out;
}

function strayDeletions(doc: { strays?: TextRange[] }): SuggestionTextChange[] {
  return (doc.strays ?? []).map(({ from, to }) => ({ from, to, insert: '' }));
}

function blockText(comments: CommentMap, schemaHint: boolean): string {
  const hint = schemaHint ? SCHEMA_HINT_LINES.join('\n') + '\n' : '';
  return FENCE_OPEN + '\n' + hint + JSON.stringify(comments, null, 2) + '\n```\n';
}

/** Everything the note holds after `prose`: the block, if any comments remain, then the trailing content. */
function serializeTail(prose: string, comments: CommentMap, trailing: string, schemaHint: boolean): string {
  if (Object.keys(comments).length === 0) {
    const separator = prose && trailing && !prose.endsWith('\n') && !trailing.startsWith('\n') ? '\n' : '';
    return separator + trailing;
  }
  return '\n' + blockText(comments, schemaHint) + trailing;
}

export function serializeDocument(
  doc: { prose: string; comments: CommentMap; trailing?: string; strays?: TextRange[]; error?: string },
  schemaHint: boolean
): string {
  if (doc.error) throw new Error('refusing to serialize a document with a parse error: ' + doc.error);
  const prose = applyTextChanges(doc.prose, strayDeletions(doc));
  return prose + serializeTail(prose, doc.comments, doc.trailing ?? '', schemaHint);
}

/**
 * The editor changes that write `doc`'s comments back into `raw` as one block,
 * removing any earlier blocks, plus an optional edit to the prose. Coordinates
 * refer to `raw`, so they apply as one transaction. `doc.prose` must still be
 * the prose of `raw`.
 */
export function blockChanges(
  raw: string,
  doc: ParsedDoc,
  schemaHint: boolean,
  proseEdit?: SuggestionTextChange
): SuggestionTextChange[] {
  const proseChanges = [...strayDeletions(doc), ...(proseEdit ? [proseEdit] : [])].sort((a, b) => a.from - b.from);
  const prose = applyTextChanges(doc.prose, proseChanges);
  return [
    ...proseChanges,
    { from: doc.prose.length, to: raw.length, insert: serializeTail(prose, doc.comments, doc.trailing ?? '', schemaHint) },
  ];
}

/**
 * Plans the minimal changes that make the note canonical: one block, under the
 * current fence name, as the last element of the file. Content sitting after
 * the block (typed prose, footnote definitions appended by Obsidian) is folded
 * back in front of it with two partial changes (delete the block, append it
 * again at the end) instead of a whole replacement, so that CodeMirror maps the
 * cursor of a user who is currently typing correctly. Anchors are quote based
 * and survive the move. null means already canonical.
 * Invariant: doc must be parseDocument(raw) of the same raw, otherwise the
 * computed offsets are garbage.
 */
export function normalizeChanges(raw: string, doc: ParsedDoc, schemaHint: boolean): SuggestionTextChange[] | null {
  if (doc.error || doc.prose.length === raw.length) return null;
  const hasTrailing = !!doc.trailing && doc.trailing.trim() !== '';
  const rewrite = !!doc.strays || !!doc.outdatedFence;
  if (!rewrite && !hasTrailing) return null;
  const blockStart = doc.prose.length;
  const blockEnd = raw.length - (doc.trailing?.length ?? 0);
  if (rewrite && (!hasTrailing || Object.keys(doc.comments).length === 0)) return blockChanges(raw, doc, schemaHint);
  const block = raw.slice(blockStart, blockEnd);
  const text = rewrite ? blockText(doc.comments, schemaHint) : block.startsWith('\n') ? block.slice(1) : block;
  const sep = raw.endsWith('\n') ? '' : '\n';
  return [
    ...strayDeletions(doc),
    { from: blockStart, to: blockEnd, insert: blockStart === 0 ? '' : '\n' },
    { from: raw.length, to: raw.length, insert: sep + text },
  ];
}

/**
 * Strict context comparison. Prefixes and suffixes produced by makeAnchor are
 * clamped to the text that actually exists and therefore always match exactly;
 * truncated or vacuous matches (for example an empty prefix at the start of the
 * document) deliberately do NOT count as hits, because they would break
 * disambiguation.
 */
function contextMatches(prose: string, at: number, len: number, anchor: Anchor): boolean {
  if (anchor.prefix && prose.slice(Math.max(0, at - anchor.prefix.length), at) !== anchor.prefix) return false;
  if (anchor.suffix && prose.slice(at + len, at + len + anchor.suffix.length) !== anchor.suffix) return false;
  return true;
}

export function resolveAnchor(prose: string, anchor: Anchor): AnchorResolution {
  const exact = anchor.exact;
  if (!exact) return { kind: 'orphaned' };
  const matches: number[] = [];
  let i = prose.indexOf(exact);
  while (i !== -1) {
    matches.push(i);
    i = prose.indexOf(exact, i + 1);
  }
  if (matches.length === 0) return { kind: 'orphaned' };
  let cands = matches;
  if (cands.length > 1) {
    const filtered = cands.filter((m) => contextMatches(prose, m, exact.length, anchor));
    if (filtered.length > 0) cands = filtered;
  }
  if (cands.length === 1) return { kind: 'resolved', start: cands[0], end: cands[0] + exact.length };
  let best = cands[0];
  if (anchor.pos != null) {
    const pos = anchor.pos;
    best = cands.reduce((a, b) => (Math.abs(b - pos) < Math.abs(a - pos) ? b : a));
  }
  return { kind: 'resolved', start: best, end: best + exact.length, ambiguous: true };
}

export function makeAnchor(prose: string, start: number, end: number): Anchor {
  const anchor: Anchor = { exact: prose.slice(start, end), pos: start };
  const prefix = prose.slice(Math.max(0, start - CONTEXT_LEN), start);
  const suffix = prose.slice(end, Math.min(prose.length, end + CONTEXT_LEN));
  if (prefix) anchor.prefix = prefix;
  if (suffix) anchor.suffix = suffix;
  return anchor;
}

export function addComment(
  comments: CommentMap,
  id: string,
  anchor: Anchor,
  author: string,
  ts: string,
  text: string
): void {
  comments[id] = { anchor, status: 'open', thread: [{ author, ts, text }] };
}

export function addSuggestion(
  comments: CommentMap,
  id: string,
  anchor: Anchor,
  author: string,
  ts: string,
  replacement: string,
  note?: string
): void {
  comments[id] = {
    anchor,
    status: 'open',
    thread: note ? [{ author, ts, text: note }] : [],
    suggestion: { replacement, author, ts },
  };
}

export function addReply(comments: CommentMap, id: string, author: string, ts: string, text: string): void {
  const c = comments[id];
  if (!c) throw new Error(`unknown comment id "${id}"`);
  c.thread.push({ author, ts, text });
}

export function editThreadEntry(
  comments: CommentMap,
  id: string,
  index: number,
  expected: ThreadEntry,
  text: string
): { ok: true } | { ok: false; reason: 'missing' | 'conflict' } {
  const entry = comments[id]?.thread[index];
  if (!entry) return { ok: false, reason: 'missing' };
  if (entry.author !== expected.author || entry.ts !== expected.ts || entry.text !== expected.text) {
    return { ok: false, reason: 'conflict' };
  }
  entry.text = text;
  return { ok: true };
}

export function setStatus(comments: CommentMap, id: string, status: CommentStatus): void {
  const c = comments[id];
  if (!c) throw new Error(`unknown comment id "${id}"`);
  c.status = status;
}

export function removeThreadEntry(comments: CommentMap, id: string, index: number): void {
  const comment = comments[id];
  if (!comment) throw new Error(`unknown comment id "${id}"`);
  if (!comment.thread[index]) {
    throw new Error(`thread entry ${index} out of range for comment "${id}"`);
  }
  // A plain comment's first entry is its root, so deleting it removes the whole
  // thread. A suggestion's first entry is only its optional explanation.
  if (index === 0 && !comment.suggestion) {
    delete comments[id];
    return;
  }
  comment.thread.splice(index, 1);
}

export function removeComment(comments: CommentMap, id: string): void {
  delete comments[id];
}

export type SuggestionFailureReason =
  | 'missing'
  | 'no-editor'
  | 'invalid-document'
  | 'invalid-suggestion'
  | 'not-suggestion'
  | 'already-resolved'
  | 'empty-replacement'
  | 'orphaned'
  | 'ambiguous';

export type AcceptSuggestionResult =
  | { ok: true; start: number; end: number; replacement: string }
  | { ok: false; reason: SuggestionFailureReason };

export type DeclineSuggestionResult = { ok: true } | { ok: false; reason: SuggestionFailureReason };

export interface SuggestionTextChange {
  from: number;
  to: number;
  insert: string;
}

export type SuggestionAcceptancePlan =
  | {
      ok: true;
      changes: SuggestionTextChange[];
      cursor: number;
    }
  | { ok: false; reason: SuggestionFailureReason; error?: string };

function isSuggestionObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finishSuggestion(
  comments: CommentMap,
  id: string,
  result: SuggestionResult,
  behavior: 'keep' | 'remove'
): void {
  if (behavior === 'remove') {
    delete comments[id];
    return;
  }
  const comment = comments[id];
  const suggestion: unknown = comment?.suggestion;
  if (!comment || !isSuggestionObject(suggestion)) return;
  comment.status = 'resolved';
  suggestion.result = result;
}

/**
 * Applies an open replacement suggestion to a parsed document. The caller is
 * responsible for committing the returned prose + comment-block changes as one
 * editor transaction.
 */
export function acceptSuggestion(
  doc: ParsedDoc,
  id: string,
  behavior: 'keep' | 'remove'
): AcceptSuggestionResult {
  const comment = doc.comments[id];
  if (!comment) return { ok: false, reason: 'missing' };
  const suggestion: unknown = comment.suggestion;
  if (suggestion === undefined) return { ok: false, reason: 'not-suggestion' };
  if (!isSuggestionObject(suggestion)) return { ok: false, reason: 'invalid-suggestion' };
  if (comment.status !== 'open' || suggestion.result) {
    return { ok: false, reason: 'already-resolved' };
  }
  const replacement = suggestion.replacement;
  if (typeof replacement !== 'string') return { ok: false, reason: 'invalid-suggestion' };
  if (replacement.length === 0) return { ok: false, reason: 'empty-replacement' };

  const resolution = resolveAnchor(doc.prose, comment.anchor);
  if (resolution.kind === 'orphaned') return { ok: false, reason: 'orphaned' };
  if (resolution.ambiguous) return { ok: false, reason: 'ambiguous' };
  if (doc.prose.slice(resolution.start, resolution.end) !== comment.anchor.exact) {
    return { ok: false, reason: 'orphaned' };
  }

  const oldProse = doc.prose;
  const survivingAnchors = Object.entries(doc.comments).flatMap(([otherId, other]) => {
    if (otherId === id || other.status !== 'open') return [];
    const otherResolution = resolveAnchor(oldProse, other.anchor);
    return otherResolution.kind === 'resolved' && !otherResolution.ambiguous
      ? [{ id: otherId, from: otherResolution.start, to: otherResolution.end }]
      : [];
  });
  const replacementChange = ChangeSet.of(
    { from: resolution.start, to: resolution.end, insert: replacement },
    oldProse.length
  );
  doc.prose = oldProse.slice(0, resolution.start) + replacement + oldProse.slice(resolution.end);
  for (const mapped of mapAnchors(survivingAnchors, replacementChange)) {
    const surviving = doc.comments[mapped.id];
    if (surviving && mapped.to <= doc.prose.length) {
      surviving.anchor = makeAnchor(doc.prose, mapped.from, mapped.to);
    }
  }
  finishSuggestion(doc.comments, id, 'accepted', behavior);
  return { ok: true, start: resolution.start, end: resolution.end, replacement };
}

export function declineSuggestion(
  comments: CommentMap,
  id: string,
  behavior: 'keep' | 'remove'
): DeclineSuggestionResult {
  const comment = comments[id];
  if (!comment) return { ok: false, reason: 'missing' };
  const suggestion: unknown = comment.suggestion;
  if (suggestion === undefined) return { ok: false, reason: 'not-suggestion' };
  if (!isSuggestionObject(suggestion)) return { ok: false, reason: 'invalid-suggestion' };
  if (comment.status !== 'open' || suggestion.result) {
    return { ok: false, reason: 'already-resolved' };
  }
  finishSuggestion(comments, id, 'declined', behavior);
  return { ok: true };
}

/**
 * Plans the two simultaneous changes used by the editor: one replacement in
 * the prose and one rewrite of the comment region. All coordinates refer to
 * the original string, making the operation a single undoable transaction.
 */
export function planSuggestionAcceptance(
  raw: string,
  id: string,
  behavior: 'keep' | 'remove',
  schemaHint: boolean
): SuggestionAcceptancePlan {
  const doc = parseDocument(raw);
  if (doc.error) return { ok: false, reason: 'invalid-document', error: doc.error };
  const prose = doc.prose;
  const result = acceptSuggestion(doc, id, behavior);
  if (!result.ok) return result;
  const removedBefore = (doc.strays ?? [])
    .filter((range) => range.to <= result.start)
    .reduce((total, range) => total + range.to - range.from, 0);
  return {
    ok: true,
    changes: blockChanges(raw, { ...doc, prose }, schemaHint, {
      from: result.start,
      to: result.end,
      insert: result.replacement,
    }),
    cursor: result.start - removedBefore + result.replacement.length,
  };
}

export function generateId(existing: CommentMap): string {
  for (;;) {
    const id = Math.floor(Math.random() * 0xffff)
      .toString(16)
      .padStart(4, '0');
    if (!(id in existing)) return id;
  }
}

export function resolveAll(prose: string, comments: CommentMap): ResolvedComment[] {
  return Object.entries(comments).map(([id, comment]) => {
    const acceptedHistory =
      comment.status === 'resolved' &&
      isSuggestionObject(comment.suggestion) &&
      comment.suggestion.result === 'accepted';
    return {
      id,
      comment,
      // The retained anchor describes the text that was replaced, not a safe
      // navigation target in the resulting prose.
      resolution: acceptedHistory ? { kind: 'orphaned' } : resolveAnchor(prose, comment.anchor),
    };
  });
}
