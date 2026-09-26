import type { EditorView } from "@codemirror/view";

import type { TrackedAnchor } from "./reanchor";

/**
 * Live Preview renders tables as a widget, replacing the source text with a
 * <table>. CodeMirror `mark` decorations inside a replaced range are not drawn,
 * so the highlight disappears in tables. This module finds the cell an anchor
 * sits in and applies the highlight directly in the rendered table DOM (see
 * Issue #3).
 */

/** Raw cell: source offsets of the content between two pipes, untrimmed. */
export interface Cell {
  /** 0-based row number within the table block (delimiter row = 1, which has no cells). */
  row: number;
  /** 0-based column number. */
  col: number;
  from: number;
  to: number;
}

export interface ParsedTable {
  from: number;
  to: number;
  cells: Cell[];
}

/** Delimiter row of a GFM table, for example `| --- | :--: |`. */
const DELIMITER = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

interface Line {
  text: string;
  from: number;
}

function splitLines(text: string, limit: number): Line[] {
  const lines: Line[] = [];
  let from = 0;
  for (const part of text.slice(0, limit).split("\n")) {
    lines.push({ text: part, from });
    from += part.length + 1; // +1 for the removed "\n"
  }
  return lines;
}

/**
 * Splits a table row into cell content spans, with offsets relative to the
 * document. Leading and trailing whitespace segments produced by enclosing
 * pipes are discarded, so columns count 0-based from the first real cell.
 */
function splitRow(line: Line): { from: number; to: number }[] {
  const segments: { start: number; end: number }[] = [];
  let start = 0;
  for (let i = 0; i < line.text.length; i++) {
    if (line.text[i] === "\\") {
      i++; // skip an escaped pipe (\|)
      continue;
    }
    if (line.text[i] === "|") {
      segments.push({ start, end: i });
      start = i + 1;
    }
  }
  segments.push({ start, end: line.text.length });
  // Enclosing pipes produce empty edge segments, so discard them.
  if (segments.length > 1 && line.text.slice(segments[0].start, segments[0].end).trim() === "") {
    segments.shift();
  }
  if (segments.length > 1) {
    const last = segments[segments.length - 1];
    if (line.text.slice(last.start, last.end).trim() === "") segments.pop();
  }
  return segments.map((s) => ({ from: line.from + s.start, to: line.from + s.end }));
}

/** Finds all GFM table blocks in the prose range [0, limit). */
export function findTables(text: string, limit: number = text.length): ParsedTable[] {
  const lines = splitLines(text, limit);
  const tables: ParsedTable[] = [];
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i];
    const delim = lines[i + 1];
    if (!delim || !header.text.includes("|") || !DELIMITER.test(delim.text)) continue;
    // GFM requires the same column count in header and delimiter, which rules
    // out, for example, a Setext heading (`some | text` followed by `---`) that
    // would otherwise pass as a single-column table.
    if (splitRow(header).length !== splitRow(delim).length) continue;

    let end = i; // last line belonging to the block
    for (let j = i + 2; j < lines.length; j++) {
      if (lines[j].text.trim() === "" || !lines[j].text.includes("|")) break;
      end = j;
    }
    if (end < i + 2) end = i; // header + delimiter only, no body, still valid

    const cells: Cell[] = [];
    for (let r = i; r <= end; r++) {
      if (r === i + 1) continue; // the delimiter row has no cells
      const rowIndex = r - i;
      splitRow(lines[r]).forEach((span, col) => cells.push({ row: rowIndex, col, ...span }));
    }
    const last = lines[end];
    tables.push({ from: header.from, to: last.from + last.text.length, cells });
    i = end;
  }
  return tables;
}

/**
 * Checks whether any of the changed spans touches a table block. Obsidian
 * reformats edited tables (column alignment, new rows), which makes position
 * mapping unreliable. In that case anchors should be re-resolved by exact text
 * rather than rewritten, otherwise comments are orphaned.
 */
export function rangesTouchTable(
  text: string,
  proseLen: number,
  ranges: { from: number; to: number }[]
): boolean {
  const tables = findTables(text, proseLen);
  return tables.some((t) => ranges.some((r) => r.from <= t.to && r.to >= t.from));
}

/** The cell whose content span contains the position, or null (for example on a delimiter row). */
export function locateCell(table: ParsedTable, pos: number): Cell | null {
  for (const c of table.cells) {
    if (pos >= c.from && pos < c.to) return c;
  }
  return null;
}

/**
 * Visible text of an inline Markdown span: syntax is stripped so it matches the
 * rendered textContent of the cell (for example `**Price**` becomes `Price`).
 * The anchor's `exact` comes from the source text, including syntax, while the
 * table DOM holds only the rendered text, so that is what must be searched for.
 */
export function visibleText(md: string): string {
  return md
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2") // [[target|alias]] to alias
    .replace(/\[\[([^\]]+)\]\]/g, "$1") // [[target]] to target
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // [label](url) / ![alt](url) to label
    .replace(/(\*\*|__)(.+?)\1/g, "$2") // **bold** / __bold__
    .replace(/(\*|_)(.+?)\1/g, "$2") // *italic* / _italic_
    .replace(/~~(.+?)~~/g, "$1") // ~~strikethrough~~
    .replace(/==(.+?)==/g, "$1") // ==highlighted==
    .replace(/`([^`]+)`/g, "$1"); // `code`
}

/** Finds the DOM <table> whose source position falls within the table block's range. */
function findDomTable(view: EditorView, table: ParsedTable): HTMLTableElement | null {
  const tables = view.contentDOM.querySelectorAll("table");
  for (const el of Array.from(tables)) {
    let pos: number;
    try {
      pos = view.posAtDOM(el);
    } catch {
      continue;
    }
    if (pos >= table.from && pos <= table.to) return el;
  }
  return null;
}

/** Returns the rendered cell for a source (row, col): row 0 = header, row >= 2 = body row row-2. */
function domCell(domTable: HTMLTableElement, cell: Cell): HTMLTableCellElement | null {
  if (cell.row === 0) {
    const headerRow = domTable.tHead?.rows[0] ?? domTable.rows[0];
    return (headerRow?.cells[cell.col]) ?? null;
  }
  const body = domTable.tBodies[0];
  return (body?.rows[cell.row - 2]?.cells[cell.col]) ?? null;
}

/** Wraps [start, start+len) in the element with <span class="tc-highlight">, across text nodes. */
function wrapRange(
  root: HTMLElement,
  start: number,
  len: number,
  id: string,
  onClick: (id: string) => void
): boolean {
  const doc = root.ownerDocument;
  const end = start + len;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: { node: Text; s: number; e: number }[] = [];
  let pos = 0;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const node = n as Text;
    const nodeLen = node.nodeValue?.length ?? 0;
    const nodeStart = pos;
    const nodeEnd = pos + nodeLen;
    if (nodeEnd > start && nodeStart < end) {
      targets.push({ node, s: Math.max(0, start - nodeStart), e: Math.min(nodeLen, end - nodeStart) });
    }
    pos = nodeEnd;
    if (pos >= end) break;
  }
  if (targets.length === 0) return false;
  for (const t of targets) {
    const range = doc.createRange();
    range.setStart(t.node, t.s);
    range.setEnd(t.node, t.e);
    // Detached span in the table's own document, so popout windows stay correct.
    const span = doc.createElement("span");
    span.className = "tc-highlight";
    span.dataset.tcId = id;
    span.dataset.tcTable = "1";
    // CodeMirror eventHandlers do not fire inside the table's widget DOM, so
    // attach listeners directly to the span. The event is swallowed so the table
    // widget does NOT switch into interactive edit mode: the highlight would
    // disappear there, because CodeMirror mark decorations do not render in the
    // table editor. To edit, click elsewhere in the cell.
    const swallow = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    span.addEventListener("pointerdown", (e) => {
      swallow(e);
      onClick(id);
    });
    span.addEventListener("mousedown", swallow);
    span.addEventListener("click", swallow);
    try {
      range.surroundContents(span);
    } catch {
      return false;
    }
  }
  return true;
}

/** Removes all table highlights we injected, before every re-apply. */
export function clearTableHighlights(view: EditorView): void {
  view.contentDOM.querySelectorAll<HTMLElement>("span.tc-highlight[data-tc-table]").forEach((span) => {
    const parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    parent.normalize();
  });
}

/**
 * For every anchor that sits inside a table rendered as a widget, applies the
 * highlight directly in the table DOM. Idempotent: it cleans up first.
 */
export function applyTableHighlights(
  view: EditorView,
  anchors: TrackedAnchor[],
  text: string,
  proseLen: number,
  onClick: (id: string) => void
): void {
  clearTableHighlights(view);
  const tables = findTables(text, proseLen);
  if (tables.length === 0) return;
  for (const a of anchors) {
    // Guard per anchor, so one edge case does not kill the remaining highlights.
    try {
      const table = tables.find((t) => a.from >= t.from && a.to <= t.to);
      if (!table) continue;
      const cell = locateCell(table, a.from);
      if (!cell) continue;
      const domTable = findDomTable(view, table);
      if (!domTable) continue;
      const cellEl = domCell(domTable, cell);
      if (!cellEl) continue;
      // Source offsets do not line up with the rendered cell text: inline
      // Markdown (**bold**, [label](url) and so on) is shortened when rendered,
      // and syntax *before* the anchor shifts the offset. So search the rendered
      // text for the visible text instead of computing a position.
      const visible = visibleText(text.slice(a.from, a.to));
      if (!visible) continue;
      const k = cellEl.textContent?.indexOf(visible) ?? -1;
      if (k >= 0) wrapRange(cellEl, k, visible.length, a.id, onClick);
    } catch {
      // Ignore: this anchor is simply not highlighted in this pass.
    }
  }
}
