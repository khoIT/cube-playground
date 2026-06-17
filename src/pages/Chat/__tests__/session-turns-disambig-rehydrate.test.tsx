/**
 * Reload rehydration: persisted choice chips must survive a session reload, and
 * the option the user already picked (matched from the following user turn's
 * text) must be marked selected so the chip can render highlighted.
 *
 * Without this, disambig_options was live-only — on reload chips vanished, the
 * "the chips above…" prose dangled, and generic followups re-appeared.
 */
import { describe, it, expect } from 'vitest';
import { sessionTurnsToMessages } from '../chat-thread-page';

type Turn = Parameters<typeof sessionTurnsToMessages>[0][number];

const assistantWithChoices: Turn = {
  id: 'a1',
  role: 'assistant',
  text: 'Pick a direction',
  createdAt: '2026-06-17T03:00:00Z',
  disambig: {
    slot: 'choice',
    prompt: 'Pick a direction',
    options: [
      { label: 'Revenue trend', pinText: 'Show daily revenue last 90 days.' },
      { label: 'IAP vs Web', pinText: 'Compare IAP vs Web revenue last 30 days.' },
    ],
  },
};

describe('sessionTurnsToMessages — disambig rehydrate', () => {
  it('restores disambigOptions from the persisted turn', () => {
    const [msg] = sessionTurnsToMessages([assistantWithChoices]);
    expect(msg.role).toBe('assistant');
    if (msg.role !== 'assistant') return;
    expect(msg.disambigOptions?.slot).toBe('choice');
    expect(msg.disambigOptions?.options).toHaveLength(2);
    // Nothing picked yet (no following user turn) → no selection.
    expect(msg.disambigSelectedPinText).toBeNull();
  });

  it('marks the picked option when the next user turn equals its pinText', () => {
    const nextUser: Turn = {
      id: 'u2',
      role: 'user',
      text: 'Show daily revenue last 90 days.',
      createdAt: '2026-06-17T03:01:00Z',
    };
    const msgs = sessionTurnsToMessages([assistantWithChoices, nextUser]);
    const assistant = msgs[0];
    if (assistant.role !== 'assistant') throw new Error('expected assistant');
    expect(assistant.disambigSelectedPinText).toBe('Show daily revenue last 90 days.');
  });

  it('leaves selection null when the next user turn is unrelated free text', () => {
    const nextUser: Turn = {
      id: 'u2',
      role: 'user',
      text: 'actually show me retention instead',
      createdAt: '2026-06-17T03:01:00Z',
    };
    const msgs = sessionTurnsToMessages([assistantWithChoices, nextUser]);
    const assistant = msgs[0];
    if (assistant.role !== 'assistant') throw new Error('expected assistant');
    expect(assistant.disambigSelectedPinText).toBeNull();
  });

  it('assistant turn with no persisted disambig has null disambigOptions', () => {
    const plain: Turn = {
      id: 'a0',
      role: 'assistant',
      text: 'plain answer',
      createdAt: '2026-06-17T03:00:00Z',
    };
    const [msg] = sessionTurnsToMessages([plain]);
    if (msg.role !== 'assistant') throw new Error('expected assistant');
    expect(msg.disambigOptions).toBeNull();
    expect(msg.disambigSelectedPinText).toBeNull();
  });
});
