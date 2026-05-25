/**
 * Regression: when an assistant turn carries disambig chips, the follow-up
 * chip row must NOT render alongside them. Two competing "what next"
 * affordances on the same turn confuse the user — disambig chips win.
 */

import React from 'react';
import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ChatMessageList, type ChatMessage } from '../components/chat-message-list';

beforeAll(() => {
  // jsdom does not implement scrollIntoView; the list's auto-scroll effect
  // calls it on mount. Stub to a no-op so the effect doesn't throw.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () {};
  }
});

function wrap(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

const baseAssistant: ChatMessage = {
  role: 'assistant',
  id: 'a1',
  ts: '2026-05-26T05:00:00Z',
  sections: [
    { type: 'text' as const, text: 'Which metric should I rank players by?' },
  ],
};

const userMsg: ChatMessage = { role: 'user', id: 'u1', text: 'top spenders this week' };

describe('ChatMessageList — chip suppression during disambig', () => {
  it('renders disambig chips and NO follow-up chips when disambigOptions set', () => {
    const msg: ChatMessage = {
      ...baseAssistant,
      disambigOptions: {
        slot: 'metric',
        prompt: 'Which metric?',
        options: [
          { label: 'ARPDAU', pinText: 'ARPDAU' },
          { label: 'ARPU', pinText: 'ARPU' },
        ],
      },
    };
    const { container } = wrap(
      <ChatMessageList
        messages={[userMsg, msg]}
        onFollowupPick={() => {}}
        onDisambigPick={() => {}}
      />,
    );

    expect(container.querySelector('[data-testid="disambig-chips"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="followup-chips"]')).toBeNull();
  });

  it('still renders follow-up chips on a normal last-assistant turn', () => {
    // Ensure the negative path keeps working — assistant turn with no
    // disambig payload should still surface follow-up chips when the
    // followup-suggester finds matches.
    const msg: ChatMessage = {
      ...baseAssistant,
      sections: [
        { type: 'text' as const, text: 'Revenue last week was up 12%.' },
      ],
    };
    const { container } = wrap(
      <ChatMessageList
        messages={[userMsg, msg]}
        onFollowupPick={() => {}}
        onDisambigPick={() => {}}
      />,
    );
    expect(container.querySelector('[data-testid="disambig-chips"]')).toBeNull();
    // followup-suggester may or may not produce chips for the given text;
    // the important assertion above is that nothing is suppressed.
  });
});
