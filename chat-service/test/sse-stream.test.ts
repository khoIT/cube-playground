/**
 * Tests for sse-stream mapSdkMessage() and writeSseEvent().
 */

import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { mapSdkMessage, writeSseEvent } from '../src/core/sse-stream.js';
import type { SdkMessage } from '../src/core/sse-stream.js';

describe('mapSdkMessage', () => {
  it('maps a text content block to a token event', () => {
    const msg: SdkMessage = {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Hello world' }],
      },
    };
    const events = mapSdkMessage(msg);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'token', data: { delta: 'Hello world' } });
  });

  it('maps a thinking content block to a thinking event', () => {
    const msg: SdkMessage = {
      type: 'assistant',
      message: {
        content: [{ type: 'thinking', thinking: 'Let me think...' }],
      },
    };
    const events = mapSdkMessage(msg);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'thinking', data: { delta: 'Let me think...' } });
  });

  it('maps a tool_use block to a tool_call event', () => {
    const msg: SdkMessage = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu_001',
            name: 'get_cube_meta',
            input: { scope: 'compact' },
          },
        ],
      },
    };
    const events = mapSdkMessage(msg);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'tool_call',
      data: { id: 'tu_001', name: 'get_cube_meta', args: { scope: 'compact' } },
    });
  });

  it('maps multiple content blocks in one assistant message', () => {
    const msg: SdkMessage = {
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'Thinking...' },
          { type: 'text', text: 'Result: ' },
          { type: 'tool_use', id: 'tu_002', name: 'preview_cube_query', input: {} },
        ],
      },
    };
    const events = mapSdkMessage(msg);
    expect(events).toHaveLength(3);
    expect(events[0].type).toBe('thinking');
    expect(events[1].type).toBe('token');
    expect(events[2].type).toBe('tool_call');
  });

  it('maps a user message with tool_result blocks', () => {
    const msg: SdkMessage = {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_001',
            content: [{ type: 'text', text: '{"cubes":[]}' }],
          },
        ],
      },
    };
    const events = mapSdkMessage(msg);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tool_result');
    expect((events[0].data as { id: string }).id).toBe('tu_001');
  });

  it('maps a result message', () => {
    const msg: SdkMessage = {
      type: 'result',
      result: 'The query artifact has been emitted.',
      total_cost_usd: 0.005,
      usage: { input_tokens: 100, output_tokens: 200 },
    };
    const events = mapSdkMessage(msg);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'result',
      data: {
        text: 'The query artifact has been emitted.',
        cost_usd: 0.005,
        input_tokens: 100,
        output_tokens: 200,
      },
    });
  });

  it('returns empty array for unknown message types', () => {
    const msg: SdkMessage = { type: 'system' };
    expect(mapSdkMessage(msg)).toHaveLength(0);
  });

  it('returns empty array for assistant message with no content blocks', () => {
    const msg: SdkMessage = {
      type: 'assistant',
      message: { content: [] },
    };
    expect(mapSdkMessage(msg)).toHaveLength(0);
  });

  it('skips unknown content block types silently', () => {
    const msg: SdkMessage = {
      type: 'assistant',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      message: { content: [{ type: 'unknown_block' } as any] },
    };
    expect(mapSdkMessage(msg)).toHaveLength(0);
  });
});

describe('writeSseEvent', () => {
  it('writes correct wire format to a stream', () => {
    const stream = new PassThrough();
    const chunks: string[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));

    writeSseEvent(stream, { type: 'token', data: { delta: 'hi' } });

    const output = chunks.join('');
    expect(output).toBe('event: token\ndata: {"delta":"hi"}\n\n');
  });

  it('serialises nested data correctly', () => {
    const stream = new PassThrough();
    const chunks: string[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));

    writeSseEvent(stream, {
      type: 'tool_call',
      data: { id: 'x', name: 'get_cube_meta', args: { scope: 'compact' } },
    });

    const output = chunks.join('');
    expect(output).toContain('event: tool_call');
    expect(output).toContain('"name":"get_cube_meta"');
    expect(output.endsWith('\n\n')).toBe(true);
  });
});
