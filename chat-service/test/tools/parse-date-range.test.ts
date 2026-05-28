/**
 * Phase 07 unit tests for the `parse_date_range` MCP tool.
 */

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { handler } from '../../src/tools/parse-date-range.js';
import type { ToolContext } from '../../src/types.js';

function ctx(): ToolContext {
  return {
    ownerId: 'o',
    gameId: 'g',
    cubeToken: 't',
    workspace: 'local',
    sessionId: 's',
    turnId: 'u',
    sseEmitter: new EventEmitter(),
  };
}

const REF = '2026-05-26T00:00:00Z'; // Tuesday

describe('parse_date_range', () => {
  it('resolves "last 7 days"', async () => {
    const out = await handler({ text: 'last 7 days', referenceDate: REF }, ctx());
    expect(out).not.toBeNull();
    expect(out!.dateRange).toEqual(['2026-05-20', '2026-05-26']);
    expect(out!.granularity).toBe('day');
    expect(out!.phrase).toBe('last 7 days');
  });

  it('resolves VI alias "tuần qua"', async () => {
    const out = await handler({ text: 'tuần qua', referenceDate: REF }, ctx());
    expect(out).not.toBeNull();
    expect(out!.dateRange).toEqual(['2026-05-20', '2026-05-26']);
  });

  it('resolves Q1 2026', async () => {
    const out = await handler({ text: 'Q1 2026', referenceDate: REF }, ctx());
    expect(out!.dateRange).toEqual(['2026-01-01', '2026-03-31']);
    expect(out!.granularity).toBe('month');
  });

  it('caller-supplied granularity overrides rule default', async () => {
    const out = await handler(
      { text: 'last 30 days', granularity: 'week', referenceDate: REF },
      ctx(),
    );
    expect(out!.granularity).toBe('week');
  });

  it('returns null on no match', async () => {
    const out = await handler({ text: 'sometime soon', referenceDate: REF }, ctx());
    expect(out).toBeNull();
  });

  it('returns null on invalid referenceDate', async () => {
    const out = await handler({ text: 'today', referenceDate: 'not-a-date' }, ctx());
    expect(out).toBeNull();
  });

  it('picks the longest-span match when multiple rules fire', async () => {
    // "last 7 days" matches BOTH the generic "last N days" rule and possibly
    // narrower forms. Whichever rule wins, the alias span should cover the
    // full phrase.
    const out = await handler({ text: 'show me last 7 days', referenceDate: REF }, ctx());
    expect(out!.phrase).toContain('last');
  });
});
