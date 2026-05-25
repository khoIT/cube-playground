/**
 * Phase-03: mapSdkMessage — cache token extraction tests.
 * Verifies that cache_creation_input_tokens / cache_read_input_tokens from the
 * SDK result usage block are mapped to cache_creation_tokens / cache_read_tokens
 * on the SseEvent result data.
 */

import { describe, it, expect } from 'vitest';
import { mapSdkMessage } from '../core/sse-stream.js';

describe('mapSdkMessage — result event cache token extraction', () => {
  it('maps cache_creation_input_tokens and cache_read_input_tokens to result data', () => {
    const sdkMsg = {
      type: 'result',
      result: 'final answer',
      total_cost_usd: 0.001,
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_creation_input_tokens: 800,
        cache_read_input_tokens: 600,
      },
    };

    const events = mapSdkMessage(sdkMsg);
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev.type).toBe('result');
    if (ev.type !== 'result') return;

    expect(ev.data.input_tokens).toBe(1000);
    expect(ev.data.output_tokens).toBe(200);
    expect(ev.data.cache_creation_tokens).toBe(800);
    expect(ev.data.cache_read_tokens).toBe(600);
  });

  it('produces undefined cache fields when usage block is absent', () => {
    const sdkMsg = {
      type: 'result',
      result: 'ok',
    };

    const events = mapSdkMessage(sdkMsg);
    expect(events).toHaveLength(1);
    const ev = events[0];
    if (ev.type !== 'result') return;

    expect(ev.data.cache_creation_tokens).toBeUndefined();
    expect(ev.data.cache_read_tokens).toBeUndefined();
  });

  it('produces undefined cache fields when cache keys are absent from usage', () => {
    const sdkMsg = {
      type: 'result',
      result: 'ok',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    const events = mapSdkMessage(sdkMsg);
    const ev = events[0];
    if (ev.type !== 'result') return;

    expect(ev.data.cache_creation_tokens).toBeUndefined();
    expect(ev.data.cache_read_tokens).toBeUndefined();
    expect(ev.data.input_tokens).toBe(100);
    expect(ev.data.output_tokens).toBe(50);
  });

  it('handles zero cache tokens (no-cache model response)', () => {
    const sdkMsg = {
      type: 'result',
      result: 'ok',
      usage: {
        input_tokens: 500,
        output_tokens: 100,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    };

    const events = mapSdkMessage(sdkMsg);
    const ev = events[0];
    if (ev.type !== 'result') return;

    expect(ev.data.cache_creation_tokens).toBe(0);
    expect(ev.data.cache_read_tokens).toBe(0);
  });
});
