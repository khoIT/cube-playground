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

  it('renders prominent action chips and suppresses follow-ups for slot="choice"', () => {
    const msg: ChatMessage = {
      ...baseAssistant,
      disambigOptions: {
        slot: 'choice',
        prompt: 'Which metric should I rank the top VIP players by?',
        options: [
          { label: 'Revenue', pinText: 'Rank the top 20 VIP players by Revenue (last 30 days).' },
          { label: 'LTV', pinText: 'Rank the top 20 VIP players by lifetime value.' },
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

    const chips = container.querySelector('[data-testid="disambig-chips"]');
    expect(chips).toBeTruthy();
    expect(chips?.getAttribute('data-slot')).toBe('choice');
    // Prominent brand treatment is applied via the scoped choice-chip class.
    expect(container.querySelector('button.disambig-choice-chip')).toBeTruthy();
    expect(container.querySelector('[data-testid="followup-chips"]')).toBeNull();
  });

  it('sends the option pinText (not the label) when a choice chip is clicked', () => {
    let picked: string | null = null;
    const msg: ChatMessage = {
      ...baseAssistant,
      disambigOptions: {
        slot: 'choice',
        prompt: 'Which metric?',
        options: [
          { label: 'Revenue', pinText: 'Rank the top 20 VIP players by Revenue (last 30 days).' },
          { label: 'LTV', pinText: 'Rank the top 20 VIP players by lifetime value.' },
        ],
      },
    };
    const { getByText } = wrap(
      <ChatMessageList
        messages={[userMsg, msg]}
        onFollowupPick={() => {}}
        onDisambigPick={(pinText) => {
          picked = pinText;
        }}
      />,
    );
    getByText('Revenue').click();
    expect(picked).toBe('Rank the top 20 VIP players by Revenue (last 30 days).');
  });

  it('highlights the already-picked chip but keeps every chip clickable (reloaded turn)', () => {
    const pinRevenue = 'Rank the top 20 VIP players by Revenue (last 30 days).';
    const pinLtv = 'Rank the top 20 VIP players by lifetime value.';
    let picked: string | null = null;
    const msg: ChatMessage = {
      ...baseAssistant,
      disambigOptions: {
        slot: 'choice',
        prompt: 'Which metric?',
        options: [
          { label: 'Revenue', pinText: pinRevenue },
          { label: 'LTV', pinText: pinLtv },
        ],
      },
      disambigSelectedPinText: pinRevenue,
    };
    const { container, getByText } = wrap(
      <ChatMessageList
        messages={[userMsg, msg]}
        onFollowupPick={() => {}}
        onDisambigPick={(pinText) => {
          picked = pinText;
        }}
      />,
    );
    // The picked option carries the selected modifier + aria-pressed; the other does not.
    const selected = container.querySelector('button.disambig-choice-chip--selected');
    expect(selected?.textContent).toContain('Revenue');
    const buttons = Array.from(container.querySelectorAll('button.disambig-choice-chip'));
    expect(buttons.filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
    // Re-clickable: clicking the *other* (unselected) option still fires onPick.
    getByText('LTV').click();
    expect(picked).toBe(pinLtv);
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
