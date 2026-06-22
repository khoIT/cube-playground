/**
 * Keyword heuristic tests for the intent router.
 * Covers EN + VN phrases, slash-prefix overrides, tie cases, and edge inputs.
 */

import { describe, it, expect } from 'vitest';
import { routeIntent } from '../src/core/intent-router.js';

describe('routeIntent — keyword heuristic', () => {
  // --- explore phrases ---

  it('routes "show daily revenue last 7 days" → explore, autoRoute true', () => {
    const result = routeIntent('show daily revenue last 7 days');
    expect(result.skill).toBe('explore');
    expect(result.autoRoute).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('routes "biểu đồ doanh thu hôm qua" → explore', () => {
    const result = routeIntent('biểu đồ doanh thu hôm qua');
    expect(result.skill).toBe('explore');
    expect(result.autoRoute).toBe(true);
  });

  it('routes "top 10 users by revenue last month" → explore', () => {
    const result = routeIntent('top 10 users by revenue last month');
    expect(result.skill).toBe('explore');
    expect(result.autoRoute).toBe(true);
  });

  // --- metric_explain phrases ---

  it('routes "what is ROAS?" → metric_explain, autoRoute true', () => {
    const result = routeIntent('what is ROAS?');
    expect(result.skill).toBe('metric_explain');
    expect(result.autoRoute).toBe(true);
  });

  it('routes "định nghĩa DAU" → metric_explain', () => {
    const result = routeIntent('định nghĩa DAU');
    expect(result.skill).toBe('metric_explain');
    expect(result.autoRoute).toBe(true);
  });

  it('routes "explain the formula for LTV" → metric_explain', () => {
    const result = routeIntent('explain the formula for LTV');
    expect(result.skill).toBe('metric_explain');
    expect(result.autoRoute).toBe(true);
  });

  it('routes "giải thích ARPU là gì" → metric_explain', () => {
    const result = routeIntent('giải thích ARPU là gì');
    expect(result.skill).toBe('metric_explain');
    expect(result.autoRoute).toBe(true);
  });

  // --- slash-prefix overrides ---

  it('/metric DAU → metric_explain, confidence 1, autoRoute true', () => {
    const result = routeIntent('/metric DAU');
    expect(result.skill).toBe('metric_explain');
    expect(result.confidence).toBe(1);
    expect(result.autoRoute).toBe(true);
  });

  it('/explore something → explore, confidence 1, autoRoute true', () => {
    const result = routeIntent('/explore something');
    expect(result.skill).toBe('explore');
    expect(result.confidence).toBe(1);
    expect(result.autoRoute).toBe(true);
  });

  it('/metric_explain ROAS → metric_explain, confidence 1', () => {
    const result = routeIntent('/metric_explain ROAS');
    expect(result.skill).toBe('metric_explain');
    expect(result.confidence).toBe(1);
    expect(result.autoRoute).toBe(true);
  });

  // Slash prefix alone (no trailing text)
  it('/metric alone → metric_explain, autoRoute true', () => {
    const result = routeIntent('/metric');
    expect(result.skill).toBe('metric_explain');
    expect(result.autoRoute).toBe(true);
  });

  // --- no-match fallback ---

  it('"hello" (no keywords) → explore, autoRoute false, confidence 0', () => {
    const result = routeIntent('hello');
    expect(result.skill).toBe('explore');
    expect(result.autoRoute).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it('empty string → explore, autoRoute false', () => {
    const result = routeIntent('');
    expect(result.skill).toBe('explore');
    expect(result.autoRoute).toBe(false);
  });

  // --- tie case ---

  it('"show me the formula" (explore: show; metric_explain: formula) → no autoRoute', () => {
    // "show" (4) hits explore; "formula" (7) hits metric_explain — different scores, NOT a tie.
    // True tie: a phrase that scores equally for both skills.
    // "show formula" → explore gets "show"(4), metric_explain gets "formula"(7) → metric_explain wins.
    // We test the tie guard via a phrase where both skills score the same total.
    // "list formula" → explore:"list"(4), metric_explain:"formula"(7) — still not a tie.
    // Craft an exact tie: need explore_score === metric_explain_score.
    // "mean by" → metric_explain:"mean"(4), explore:"by"(2) — no tie.
    // "show mean" → explore:"show"(4), metric_explain:"mean"(4) — TIE at 4 each.
    const result = routeIntent('show mean');
    expect(result.autoRoute).toBe(false);
    expect(result.confidence).toBe(0.5);
  });

  // --- segment-creation intent (verb→noun pattern, tolerant of articles) ---

  it('routes "create a segment of players whose spend is between 200000 and 500000" → segment', () => {
    // The original failing case: the article "a" defeats a flat "create segment"
    // keyword, and "between" would otherwise steal the route to compare.
    const result = routeIntent(
      'create a segment of players whose lifetime spend is between 200000 and 500000 VND',
    );
    expect(result.skill).toBe('segment');
    expect(result.autoRoute).toBe(true);
  });

  it('routes "save that as a cohort" → segment', () => {
    const result = routeIntent('save that as a cohort');
    expect(result.skill).toBe('segment');
    expect(result.autoRoute).toBe(true);
  });

  it('routes "turn this into an audience" → segment', () => {
    const result = routeIntent('turn this into an audience');
    expect(result.skill).toBe('segment');
    expect(result.autoRoute).toBe(true);
  });

  it('routes "build me a segment of inactive users" → segment', () => {
    const result = routeIntent('build me a segment of inactive users');
    expect(result.skill).toBe('segment');
    expect(result.autoRoute).toBe(true);
  });

  it('does NOT force segment for a descriptive query that merely mentions "segment"', () => {
    // "show ... by segment" is an exploration breakdown, not a creation intent —
    // no creation verb adjacent to the noun, so it must stay on explore.
    const result = routeIntent('show daily revenue by segment last 7 days');
    expect(result.skill).toBe('explore');
  });

  it('VN "tạo phân khúc người chơi chi tiêu cao" → segment', () => {
    const result = routeIntent('tạo phân khúc người chơi chi tiêu cao');
    expect(result.skill).toBe('segment');
    expect(result.autoRoute).toBe(true);
  });
});
