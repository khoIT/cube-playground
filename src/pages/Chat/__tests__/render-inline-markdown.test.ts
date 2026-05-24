import { describe, it, expect } from 'vitest';
import { tokenizeInlineMarkdown } from '../components/render-inline-markdown';

describe('tokenizeInlineMarkdown', () => {
  it('returns a single text segment when no markers are present', () => {
    expect(tokenizeInlineMarkdown('hello world')).toEqual([
      { kind: 'text', text: 'hello world' },
    ]);
  });

  it('parses **bold** surrounded by plain text', () => {
    const out = tokenizeInlineMarkdown('baseline in the **16,500–18,700** range');
    expect(out).toEqual([
      { kind: 'text', text: 'baseline in the ' },
      { kind: 'bold', text: '16,500–18,700' },
      { kind: 'text', text: ' range' },
    ]);
  });

  it('parses multiple bold runs in one string', () => {
    const out = tokenizeInlineMarkdown('hit **27,600** on **May 16**');
    expect(out.filter((s) => s.kind === 'bold').map((s) => s.text)).toEqual([
      '27,600',
      'May 16',
    ]);
  });

  it('parses *italic* and _italic_', () => {
    const out = tokenizeInlineMarkdown('a *soft* tone and _another_ one');
    expect(out.filter((s) => s.kind === 'italic').map((s) => s.text)).toEqual([
      'soft',
      'another',
    ]);
  });

  it('parses inline `code`', () => {
    const out = tokenizeInlineMarkdown('the `players.dau` measure');
    expect(out.find((s) => s.kind === 'code')?.text).toBe('players.dau');
  });

  it('does NOT eat **bold** as two italics', () => {
    const out = tokenizeInlineMarkdown('**heavy**');
    expect(out).toEqual([{ kind: 'bold', text: 'heavy' }]);
  });

  it('keeps unclosed markers as plain text', () => {
    const out = tokenizeInlineMarkdown('this ** has no end');
    expect(out).toEqual([{ kind: 'text', text: 'this ** has no end' }]);
  });

  it('ignores * with leading whitespace inside (not real italic)', () => {
    // `* foo*` should NOT match — italic requires a non-space immediately
    // after the opening `*`. Without this the agent's bullet-style asterisks
    // would falsely render as italic.
    const out = tokenizeInlineMarkdown('* foo*');
    expect(out).toEqual([{ kind: 'text', text: '* foo*' }]);
  });
});
