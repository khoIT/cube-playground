/**
 * Unit tests for phrase-resolver. Frozen `now` so re-resolution is
 * deterministic across day/week/month boundaries.
 */

import { describe, it, expect } from 'vitest';
import { resolveTimePhrase } from '../../src/nl-to-query/phrase-resolver.js';

// Anchor: Wednesday 2026-05-27 00:00 UTC. Lets us exercise mid-week math.
const WED = Date.UTC(2026, 4, 27);

describe('phrase-resolver', () => {
  it('returns null for empty / unrecognised phrases', () => {
    expect(resolveTimePhrase(undefined, WED)).toBeNull();
    expect(resolveTimePhrase('', WED)).toBeNull();
    expect(resolveTimePhrase('whenever feels right', WED)).toBeNull();
  });

  it('resolves "today" to a single-day range with granularity=day', () => {
    const r = resolveTimePhrase('today', WED);
    expect(r).not.toBeNull();
    expect(r!.dateRange).toEqual(['2026-05-27', '2026-05-27']);
    expect(r!.granularity).toBe('day');
  });

  it('resolves "yesterday" to the prior day', () => {
    const r = resolveTimePhrase('yesterday', WED);
    expect(r!.dateRange).toEqual(['2026-05-26', '2026-05-26']);
  });

  it('resolves "last 7 days" to the inclusive trailing window', () => {
    const r = resolveTimePhrase('last 7 days', WED);
    expect(r!.dateRange).toEqual(['2026-05-21', '2026-05-27']);
    expect(r!.granularity).toBe('day');
  });

  it('resolves "last week" (alias) to a 7-day trailing window', () => {
    const r = resolveTimePhrase('last week', WED);
    expect(r!.dateRange).toEqual(['2026-05-21', '2026-05-27']);
  });

  it('resolves Vietnamese "hôm nay" the same as "today"', () => {
    const r = resolveTimePhrase('hôm nay', WED);
    expect(r!.dateRange).toEqual(['2026-05-27', '2026-05-27']);
  });

  it('resolves Vietnamese "tuần trước" the same as "last week"', () => {
    const r = resolveTimePhrase('tuần trước', WED);
    expect(r!.dateRange).toEqual(['2026-05-21', '2026-05-27']);
  });

  it('rolls forward across day boundary when re-resolved next day', () => {
    const THU = Date.UTC(2026, 4, 28);
    expect(resolveTimePhrase('today', WED)!.dateRange).toEqual(['2026-05-27', '2026-05-27']);
    expect(resolveTimePhrase('today', THU)!.dateRange).toEqual(['2026-05-28', '2026-05-28']);
  });

  it('rolls forward across month boundary for "last 7 days"', () => {
    const MAY_3 = Date.UTC(2026, 4, 3);
    const r = resolveTimePhrase('last 7 days', MAY_3);
    expect(r!.dateRange).toEqual(['2026-04-27', '2026-05-03']);
  });
});
