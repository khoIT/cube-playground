/**
 * Basic smoke tests for the intent router — routing correctness and edge inputs.
 * Full keyword coverage lives in intent-router-keywords.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { routeIntent } from '../src/core/intent-router.js';

describe('routeIntent', () => {
  it('routes an explore phrase to explore', () => {
    const result = routeIntent('show daily revenue last 7 days');
    expect(result.skill).toBe('explore');
    expect(result.autoRoute).toBe(true);
  });

  it('returns explore for empty string (no keywords)', () => {
    const result = routeIntent('');
    expect(result.skill).toBe('explore');
    expect(result.autoRoute).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it('routes a Vietnamese explore phrase to explore', () => {
    const result = routeIntent('hiển thị doanh thu hàng ngày');
    expect(result.skill).toBe('explore');
    expect(result.autoRoute).toBe(true);
  });
});
