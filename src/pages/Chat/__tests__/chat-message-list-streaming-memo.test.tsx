/**
 * Regression: committed turns must NOT re-render (and re-parse their markdown)
 * on every streamed token of the live turn.
 *
 * Each SSE token appends a delta to the live turn and re-renders the whole
 * thread. Without memoizing the message components, every committed turn in
 * the session re-parses its full markdown via ReactMarkdown on every token —
 * a per-token cost that grows with history length, saturating the main thread
 * and freezing input (the "Stop generating" button stops responding). The fix
 * memoizes AssistantMessage/UserMessage; this test proves a committed turn's
 * markdown is parsed exactly once even as the live turn keeps updating.
 */

import React from 'react';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Count markdown parses per text so a re-parse of a committed turn is visible.
const markdownRenders: string[] = [];
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => {
    markdownRenders.push(children);
    return <div data-md>{children}</div>;
  },
}));
vi.mock('remark-gfm', () => ({ default: () => undefined }));

import { ChatMessageList, type ChatMessage } from '../components/chat-message-list';
import { _resetGlossaryCache } from '../components/use-glossary-linker';

beforeAll(() => {
  // jsdom lacks scrollIntoView; the list's auto-scroll effect calls it.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () {};
  }
});

beforeEach(() => {
  markdownRenders.length = 0;
  _resetGlossaryCache();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ terms: [] }),
    } as unknown as Response),
  );
});

// Stable committed turn — its object + sections refs never change across the
// stream, so a memoized message component bails out of re-render.
const committed: ChatMessage = {
  role: 'assistant',
  id: 'committed-1',
  ts: '2026-06-05T05:00:00Z',
  sections: [{ type: 'text', text: 'COMMITTED ANSWER' }],
};

// The live turn rebuilds its sections each token — must keep re-rendering.
function liveTurn(text: string): ChatMessage {
  return { role: 'assistant', id: '__streaming__', sections: [{ type: 'text', text }] };
}

describe('ChatMessageList — committed turns stay memoized during streaming', () => {
  it('parses a committed turn markdown once even as the live turn updates', () => {
    // Stable handlers so message props stay shallow-equal across re-renders.
    const onFollowupPick = () => {};
    const onDisambigPick = () => {};

    const { rerender } = render(
      <MemoryRouter>
        <ChatMessageList
          messages={[committed, liveTurn('STREAM v1')]}
          streaming
          onFollowupPick={onFollowupPick}
          onDisambigPick={onDisambigPick}
        />
      </MemoryRouter>,
    );

    expect(markdownRenders.filter((t) => t === 'COMMITTED ANSWER')).toHaveLength(1);
    expect(markdownRenders.filter((t) => t === 'STREAM v1')).toHaveLength(1);

    // A token lands: live turn text grows, committed turn untouched.
    rerender(
      <MemoryRouter>
        <ChatMessageList
          messages={[committed, liveTurn('STREAM v1 plus more')]}
          streaming
          onFollowupPick={onFollowupPick}
          onDisambigPick={onDisambigPick}
        />
      </MemoryRouter>,
    );

    // Committed turn must NOT have been re-parsed — memo held.
    expect(markdownRenders.filter((t) => t === 'COMMITTED ANSWER')).toHaveLength(1);
    // Live turn re-parsed with the new text.
    expect(markdownRenders.filter((t) => t === 'STREAM v1 plus more')).toHaveLength(1);
  });
});
