/**
 * Tests for the offer_choices tool handler + schema.
 * - Emits one 'disambig_options' SSE frame with slot 'choice', preserving the
 *   agent-authored label/pinText and returning an ack.
 * - Rejects option counts outside 2–6 (zod).
 * - Is a no-op-safe ack when no SSE emitter is bound (cache replay).
 */
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { z } from 'zod';
import type { ToolContext } from '../src/types.js';
import { handler, inputSchema, name } from '../src/tools/offer-choices.js';

function makeCtx(emitter?: EventEmitter): ToolContext {
  return {
    ownerId: 'owner1',
    gameId: 'ballistar',
    cubeToken: 'Bearer test-token',
    workspace: 'local',
    sessionId: 'sess-1',
    turnId: 'sess-1:1',
    sseEmitter: emitter as EventEmitter,
  };
}

const schema = z.object(inputSchema);

interface ChoiceFrame {
  slot: string;
  prompt: string;
  options: Array<{ label: string; pinText: string; confidence?: number }>;
}

describe('offer_choices handler', () => {
  it('emits one disambig_options frame with slot=choice and preserves pinText', async () => {
    const emitter = new EventEmitter();
    const frames: ChoiceFrame[] = [];
    emitter.on('disambig_options', (d: ChoiceFrame) => frames.push(d));

    const result = await handler(
      {
        prompt: 'Which metric should I rank the top VIP players by?',
        options: [
          { label: 'Revenue', pinText: 'Rank the top 20 VIP players by Revenue (last 30 days).' },
          { label: 'LTV', pinText: 'Rank the top 20 VIP players by lifetime value.' },
          { label: 'ARPU', pinText: 'Rank the top 20 VIP players by ARPU.' },
        ],
      },
      makeCtx(emitter),
    );

    expect(result).toEqual({ emitted: true, count: 3 });
    expect(frames).toHaveLength(1);
    expect(frames[0].slot).toBe('choice');
    expect(frames[0].prompt).toMatch(/rank the top VIP players/i);
    expect(frames[0].options.map((o) => o.label)).toEqual(['Revenue', 'LTV', 'ARPU']);
    expect(frames[0].options[0].pinText).toContain('Revenue');
    // Confidence descends slightly by position so the FE keeps ordering.
    expect(frames[0].options[0].confidence).toBeGreaterThan(frames[0].options[2].confidence!);
  });

  it('is a no-op-safe ack when no SSE emitter is bound (cache replay)', async () => {
    const result = await handler(
      {
        prompt: 'Pick one',
        options: [
          { label: 'A', pinText: 'Do A' },
          { label: 'B', pinText: 'Do B' },
        ],
      },
      makeCtx(undefined),
    );
    expect(result).toEqual({ emitted: false, count: 2 });
  });

  it('rejects fewer than 2 options', () => {
    const r = schema.safeParse({ prompt: 'Pick', options: [{ label: 'A', pinText: 'Do A' }] });
    expect(r.success).toBe(false);
  });

  it('rejects more than 6 options', () => {
    const opts = Array.from({ length: 7 }, (_, i) => ({ label: `L${i}`, pinText: `Do ${i}` }));
    const r = schema.safeParse({ prompt: 'Pick', options: opts });
    expect(r.success).toBe(false);
  });

  it('rejects an over-long pinText', () => {
    const r = schema.safeParse({
      prompt: 'Pick',
      options: [
        { label: 'A', pinText: 'x'.repeat(301) },
        { label: 'B', pinText: 'Do B' },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('exposes the registered tool name', () => {
    expect(name).toBe('offer_choices');
  });
});
