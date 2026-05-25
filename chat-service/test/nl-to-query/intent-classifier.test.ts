/**
 * Unit tests for classifyIntent. Conservative regex rules — every
 * non-default case must require an unambiguous keyword.
 */

import { describe, it, expect } from 'vitest';
import { classifyIntent } from '../../src/nl-to-query/intent-classifier.js';

describe('classifyIntent', () => {
  it('defaults to aggregate with low confidence', () => {
    const r = classifyIntent('show me revenue last week');
    expect(r.slot.value).toBe('aggregate');
    expect(r.slot.confidence).toBeLessThan(0.7);
    expect(r.limit).toBeUndefined();
  });

  it('detects "top spenders" as leaderboard', () => {
    const r = classifyIntent('top spenders this week');
    expect(r.slot.value).toBe('leaderboard');
    expect(r.slot.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('detects "highest ARPU" as leaderboard', () => {
    expect(classifyIntent('highest ARPU by country').slot.value).toBe('leaderboard');
  });

  it('parses "top 5" as leaderboard with limit=5', () => {
    const r = classifyIntent('top 5 spenders this month');
    expect(r.slot.value).toBe('leaderboard');
    expect(r.limit).toBe(5);
  });

  it('clamps absurd limit values', () => {
    expect(classifyIntent('top 9999 spenders').limit).toBe(100);
  });

  it('does NOT match "top of the funnel" as leaderboard', () => {
    const r = classifyIntent('drop-off at top of the funnel');
    expect(r.slot.value).toBe('aggregate');
  });

  it('detects "trend" as trend intent', () => {
    expect(classifyIntent('show daily revenue trend').slot.value).toBe('trend');
  });

  it('detects "over time" as trend intent', () => {
    expect(classifyIntent('revenue over time').slot.value).toBe('trend');
  });

  it('detects "vs" as comparison intent', () => {
    expect(classifyIntent('iOS vs Android revenue').slot.value).toBe('comparison');
  });

  it('detects "compared to" as comparison intent', () => {
    expect(classifyIntent('this month compared to last month').slot.value).toBe('comparison');
  });

  it('detects Vietnamese "nhiều nhất" as leaderboard', () => {
    expect(classifyIntent('player nào nạp nhiều nhất tuần này').slot.value).toBe('leaderboard');
  });

  it('detects Vietnamese "xếp hạng" as leaderboard', () => {
    expect(classifyIntent('xếp hạng player theo doanh thu').slot.value).toBe('leaderboard');
  });

  it('detects Vietnamese "theo ngày" as trend', () => {
    expect(classifyIntent('doanh thu theo ngày').slot.value).toBe('trend');
  });

  it('detects Vietnamese "so với" as comparison', () => {
    expect(classifyIntent('tuần này so với tuần trước').slot.value).toBe('comparison');
  });

  it('comparison takes priority over leaderboard when both keywords present', () => {
    expect(classifyIntent('top spenders this week vs last week').slot.value).toBe('comparison');
  });

  it('emits alias + span for matched leaderboard phrase', () => {
    const r = classifyIntent('top spenders this week');
    expect(r.slot.alias?.toLowerCase()).toBe('top');
    expect(r.slot.span).toEqual([0, 3]);
  });
});
