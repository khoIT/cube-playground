/**
 * The normalizer isolates SDK message shapes from the rest of the system.
 * It must map known shapes and ignore unknown ones without throwing.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeSdkMessage,
  mapResultSubtype,
  stopReasonToErrorCode,
} from '../src/advisor/agent/agent-event-normalizer.js';

describe('mapResultSubtype', () => {
  it('maps known subtypes', () => {
    expect(mapResultSubtype('success')).toBe('end_turn');
    expect(mapResultSubtype('error_max_turns')).toBe('max_turns');
    expect(mapResultSubtype('error_timeout')).toBe('timeout');
    expect(mapResultSubtype('something_else')).toBe('error');
    expect(mapResultSubtype(undefined)).toBe('error');
  });
});

describe('stopReasonToErrorCode', () => {
  it('returns null only for a clean end_turn', () => {
    expect(stopReasonToErrorCode('end_turn')).toBeNull();
    expect(stopReasonToErrorCode('max_turns')).toBe('max_turns');
    expect(stopReasonToErrorCode('timeout')).toBe('timeout');
    expect(stopReasonToErrorCode('error')).toBe('sdk_error');
  });
});

describe('normalizeSdkMessage', () => {
  it('maps assistant text + tool_use blocks', () => {
    const events = normalizeSdkMessage({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Looking at whales…' },
          { type: 'tool_use', name: 'mcp__advisor__echo', id: 'call-1' },
          { type: 'text', text: '' }, // empty text dropped
        ],
      },
    });
    expect(events).toEqual([
      { type: 'assistant_delta', text: 'Looking at whales…' },
      { type: 'tool_call', tool: 'mcp__advisor__echo', callId: 'call-1' },
    ]);
  });

  it('maps tool_result on a user message', () => {
    const events = normalizeSdkMessage({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'call-1', is_error: false }] },
    });
    expect(events).toEqual([{ type: 'tool_result', tool: 'tool', callId: 'call-1', ok: true }]);
  });

  it('maps a successful result to cost + done (no error)', () => {
    const events = normalizeSdkMessage({ type: 'result', subtype: 'success', total_cost_usd: 0.012 });
    expect(events).toEqual([
      { type: 'cost', usd: 0.012 },
      { type: 'done', usd: 0.012, stopReason: 'end_turn' },
    ]);
  });

  it('maps a max-turns result to cost + error + done', () => {
    const events = normalizeSdkMessage({ type: 'result', subtype: 'error_max_turns', total_cost_usd: 0.5 });
    expect(events[0]).toEqual({ type: 'cost', usd: 0.5 });
    expect(events[1]).toMatchObject({ type: 'error', code: 'max_turns' });
    expect(events[2]).toMatchObject({ type: 'done', stopReason: 'max_turns', usd: 0.5 });
  });

  it('returns no events for unknown/empty messages', () => {
    expect(normalizeSdkMessage({ type: 'system' })).toEqual([]);
    expect(normalizeSdkMessage({})).toEqual([]);
    expect(normalizeSdkMessage({ type: 'assistant' })).toEqual([]);
  });
});
