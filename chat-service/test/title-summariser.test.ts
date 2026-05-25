/**
 * Unit tests for title-summariser.ts
 */

import { describe, it, expect, vi } from 'vitest';
import { summariseTitle } from '../src/core/title-summariser.js';
import type { ChatTurnRow } from '../src/types.js';

function makeTurn(overrides: Partial<ChatTurnRow>): ChatTurnRow {
  return {
    id: 'turn-1',
    session_id: 'sess-1',
    turn_index: 0,
    role: 'user',
    user_text: null,
    assistant_text: null,
    reasoning_json: null,
    tool_calls_json: null,
    artifacts_json: null,
    charts_json: null,
    input_tokens: null,
    output_tokens: null,
    cost_usd: null,
    skill: null,
    started_at: Date.now(),
    ended_at: null,
    system_prompt_text: null,
    model: null,
    ...overrides,
  };
}

describe('summariseTitle', () => {
  it('returns trimmed 3-word response from callLlm', async () => {
    const callLlm = vi.fn().mockResolvedValue('Revenue by Game');
    const turns: ChatTurnRow[] = [
      makeTurn({ turn_index: 0, role: 'user', user_text: 'Show me revenue' }),
      makeTurn({ turn_index: 1, role: 'assistant', assistant_text: 'Here it is' }),
    ];

    const result = await summariseTitle({ turns, deps: { callLlm } });

    expect(result).toBe('Revenue by Game');
    expect(callLlm).toHaveBeenCalledOnce();
  });

  it('passes a prompt containing the user messages', async () => {
    const callLlm = vi.fn().mockResolvedValue('Retention Analysis Report');
    const turns: ChatTurnRow[] = [
      makeTurn({ turn_index: 0, role: 'user', user_text: 'Show retention' }),
      makeTurn({ turn_index: 2, role: 'user', user_text: 'Break by country' }),
      makeTurn({ turn_index: 4, role: 'user', user_text: 'Compare last month' }),
    ];

    await summariseTitle({ turns, deps: { callLlm } });

    const prompt = callLlm.mock.calls[0][0] as string;
    expect(prompt).toContain('Show retention');
    expect(prompt).toContain('Break by country');
    expect(prompt).toContain('Compare last month');
  });

  it('truncates long LLM responses to 32 chars', async () => {
    const longResponse = 'A'.repeat(100);
    const callLlm = vi.fn().mockResolvedValue(longResponse);
    const turns: ChatTurnRow[] = [
      makeTurn({ turn_index: 0, role: 'user', user_text: 'Hello' }),
    ];

    const result = await summariseTitle({ turns, deps: { callLlm } });

    expect(result.length).toBeLessThanOrEqual(32);
  });

  it('collapses extra whitespace in LLM response', async () => {
    const callLlm = vi.fn().mockResolvedValue('  Revenue  by   Game  ');
    const turns: ChatTurnRow[] = [
      makeTurn({ turn_index: 0, role: 'user', user_text: 'Show revenue' }),
    ];

    const result = await summariseTitle({ turns, deps: { callLlm } });

    // Multiple spaces collapsed, leading/trailing stripped
    expect(result).toBe('Revenue by Game');
    expect(result).toBe(result.trim());
  });

  it('returns empty string when there are no user turns', async () => {
    const callLlm = vi.fn();
    const turns: ChatTurnRow[] = [
      makeTurn({ turn_index: 0, role: 'assistant', assistant_text: 'I am ready' }),
    ];

    const result = await summariseTitle({ turns, deps: { callLlm } });

    expect(result).toBe('');
    expect(callLlm).not.toHaveBeenCalled();
  });

  it('only uses first 3 user messages for the prompt', async () => {
    const callLlm = vi.fn().mockResolvedValue('Short Title');
    const turns: ChatTurnRow[] = Array.from({ length: 6 }, (_, i) =>
      makeTurn({ turn_index: i, role: 'user', user_text: `message ${i}` }),
    );

    await summariseTitle({ turns, deps: { callLlm } });

    const prompt = callLlm.mock.calls[0][0] as string;
    // message 0,1,2 should be included; message 3,4,5 should not
    expect(prompt).toContain('message 0');
    expect(prompt).toContain('message 1');
    expect(prompt).toContain('message 2');
    expect(prompt).not.toContain('message 3');
  });
});
