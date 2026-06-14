/**
 * Pure display mappers added for the advisor-audit observability fields:
 * compact token formatting, auth-lane label, and the per-turn think-vs-tool
 * time split (the signal behind the headline 120s-timeout shape).
 */

import { describe, it, expect } from 'vitest';
import { formatTokens, authLaneLabel, turnTimeSplit } from '../advisor-audit-data';

describe('formatTokens', () => {
  it('renders —, raw, k, and M scales', () => {
    expect(formatTokens(null)).toBe('—');
    expect(formatTokens(980)).toBe('980');
    expect(formatTokens(1234)).toBe('1.2k');
    expect(formatTokens(50_000)).toBe('50k');
    expect(formatTokens(2_400_000)).toBe('2.4M');
  });
});

describe('authLaneLabel', () => {
  it('joins lane + source, falls back to lane, then —', () => {
    expect(authLaneLabel({ authLane: 'subscription', authSource: 'CLAUDE_CODE_OAUTH_TOKEN' })).toBe(
      'subscription · CLAUDE_CODE_OAUTH_TOKEN',
    );
    expect(authLaneLabel({ authLane: 'subscription', authSource: null })).toBe('subscription');
    expect(authLaneLabel({ authLane: null, authSource: null })).toBe('—');
  });
});

describe('turnTimeSplit', () => {
  it('splits wall-clock into tool time and remaining think time', () => {
    const turn = {
      durationMs: 120_000,
      toolCalls: [
        { durationMs: 100 },
        { durationMs: 4_400 },
        { durationMs: null }, // missing duration contributes 0
      ],
    } as Parameters<typeof turnTimeSplit>[0];
    const { toolMs, thinkMs } = turnTimeSplit(turn);
    expect(toolMs).toBe(4_500);
    expect(thinkMs).toBe(115_500);
  });

  it('never returns negative think time', () => {
    const turn = { durationMs: 100, toolCalls: [{ durationMs: 500 }] } as Parameters<typeof turnTimeSplit>[0];
    expect(turnTimeSplit(turn).thinkMs).toBe(0);
  });
});
