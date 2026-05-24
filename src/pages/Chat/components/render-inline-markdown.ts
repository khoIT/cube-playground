/**
 * Inline-only markdown tokenizer for assistant chat text.
 *
 * Supported subset (matches what the agent actually emits in answers):
 *   `**bold**`           → strong
 *   `*italic*` / `_it_`  → em
 *   `` `code` ``         → inline code
 *
 * Out of scope on purpose (YAGNI for the chat surface):
 *   links, headers, lists, blockquotes, html, fenced code blocks, escapes.
 *
 * Composability: the tokenizer is purely a text → segment[] split. Each
 * segment's `text` is still raw — callers can run secondary transforms on
 * it (field chips, glossary linking) before wrapping in the right tag.
 */

export type MarkdownSegmentKind = 'text' | 'bold' | 'italic' | 'code';

export interface MarkdownSegment {
  kind: MarkdownSegmentKind;
  /** Inner content, with the surrounding markers stripped. */
  text: string;
}

// Single scan with branch alternates. Order matters:
//   - `**…**` BEFORE `*…*` so bold isn't eaten as two italics.
//   - inline code uses backticks; the inner pattern excludes backticks to
//     keep matches non-greedy on the same line.
//   - italic uses [^*]/[^_] (non-empty, non-marker) to avoid `**` collisions.
const INLINE_RX = /\*\*([^*]+?)\*\*|`([^`]+?)`|\*([^*\s][^*]*?)\*|_([^_\s][^_]*?)_/g;

export function tokenizeInlineMarkdown(text: string): MarkdownSegment[] {
  const out: MarkdownSegment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  INLINE_RX.lastIndex = 0;
  while ((match = INLINE_RX.exec(text)) !== null) {
    if (match.index > cursor) {
      out.push({ kind: 'text', text: text.slice(cursor, match.index) });
    }
    if (match[1] !== undefined)      out.push({ kind: 'bold',   text: match[1] });
    else if (match[2] !== undefined) out.push({ kind: 'code',   text: match[2] });
    else if (match[3] !== undefined) out.push({ kind: 'italic', text: match[3] });
    else if (match[4] !== undefined) out.push({ kind: 'italic', text: match[4] });
    cursor = INLINE_RX.lastIndex;
  }
  if (cursor < text.length) {
    out.push({ kind: 'text', text: text.slice(cursor) });
  }
  return out.length === 0 ? [{ kind: 'text', text }] : out;
}
