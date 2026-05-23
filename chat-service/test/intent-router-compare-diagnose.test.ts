/**
 * Intent-router keyword tests for the compare and diagnose skills.
 * Covers EN + VN phrases, slash-prefix overrides, and tie/edge cases.
 */

import { describe, it, expect } from 'vitest';
import { routeIntent } from '../src/core/intent-router.js';

describe('routeIntent — compare skill', () => {
  it('"compare DAU in PT vs CFM" → compare, autoRoute true', () => {
    const result = routeIntent('compare DAU in PT vs CFM');
    expect(result.skill).toBe('compare');
    expect(result.autoRoute).toBe(true);
  });

  it('"revenue versus cost past 30 days" → compare', () => {
    // "versus" (6) > any single explore keyword; no explore keyword matches "past"
    const result = routeIntent('revenue versus cost past 30 days');
    expect(result.skill).toBe('compare');
    expect(result.autoRoute).toBe(true);
  });

  it('"so sánh doanh thu game A so với game B" → compare (Vietnamese)', () => {
    // "so với" is the multi-word Vietnamese keyword for compare
    const result = routeIntent('so sánh doanh thu game A so với game B');
    expect(result.skill).toBe('compare');
    expect(result.autoRoute).toBe(true);
  });

  it('"PT versus CFM retention" → compare', () => {
    const result = routeIntent('PT versus CFM retention');
    expect(result.skill).toBe('compare');
    expect(result.autoRoute).toBe(true);
  });

  it('"channel A against channel B revenue" → compare, autoRoute true', () => {
    const result = routeIntent('channel A against channel B revenue');
    expect(result.skill).toBe('compare');
    expect(result.autoRoute).toBe(true);
  });

  it('"/compare segment alpha and beta" → compare, confidence 1, autoRoute true (slash)', () => {
    const result = routeIntent('/compare segment alpha and beta');
    expect(result.skill).toBe('compare');
    expect(result.confidence).toBe(1);
    expect(result.autoRoute).toBe(true);
  });

  it('"/compare" alone → compare, autoRoute true (slash no args)', () => {
    const result = routeIntent('/compare');
    expect(result.skill).toBe('compare');
    expect(result.confidence).toBe(1);
    expect(result.autoRoute).toBe(true);
  });
});

describe('routeIntent — diagnose skill', () => {
  it('"why did revenue drop yesterday?" → diagnose, autoRoute true', () => {
    const result = routeIntent('why did revenue drop yesterday?');
    expect(result.skill).toBe('diagnose');
    expect(result.autoRoute).toBe(true);
  });

  it('"tại sao DAU giảm cuối tuần" → diagnose (Vietnamese)', () => {
    const result = routeIntent('tại sao DAU giảm cuối tuần');
    expect(result.skill).toBe('diagnose');
    expect(result.autoRoute).toBe(true);
  });

  it('"root cause of the spike in churn" → diagnose', () => {
    const result = routeIntent('root cause of the spike in churn');
    expect(result.skill).toBe('diagnose');
    expect(result.autoRoute).toBe(true);
  });

  it('"revenue surge anomaly last week" → diagnose', () => {
    const result = routeIntent('revenue surge anomaly last week');
    expect(result.skill).toBe('diagnose');
    expect(result.autoRoute).toBe(true);
  });

  it('"/diagnose checkout funnel" → diagnose, confidence 1, autoRoute true (slash)', () => {
    const result = routeIntent('/diagnose checkout funnel');
    expect(result.skill).toBe('diagnose');
    expect(result.confidence).toBe(1);
    expect(result.autoRoute).toBe(true);
  });

  it('"/diagnose" alone → diagnose, autoRoute true (slash no args)', () => {
    const result = routeIntent('/diagnose');
    expect(result.skill).toBe('diagnose');
    expect(result.confidence).toBe(1);
    expect(result.autoRoute).toBe(true);
  });
});

describe('routeIntent — edge cases with compare + diagnose in scope', () => {
  it('"hello there" (no keywords) → explore, autoRoute false', () => {
    const result = routeIntent('hello there');
    expect(result.skill).toBe('explore');
    expect(result.autoRoute).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it('"compare and explain metric" has both compare + metric_explain keywords — no autoRoute on tie or lower-scoring', () => {
    // "compare" scores for compare; "explain" is not a metric_explain keyword but "mean" etc. are.
    // "compare" (7) for compare, no metric_explain keyword matches → compare wins cleanly.
    // This test just validates compare still wins over explore here (not a tie).
    const result = routeIntent('compare and explain metric');
    expect(result.skill).toBe('compare');
  });
});
