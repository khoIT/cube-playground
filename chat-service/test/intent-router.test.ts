/**
 * intent-router smoke tests (Phase 01 stub always returns explore).
 */

import { describe, it, expect } from 'vitest';
import { routeIntent } from '../src/core/intent-router.js';

describe('routeIntent', () => {
  it('returns explore for any message', () => {
    expect(routeIntent('show daily revenue last 7 days')).toMatchObject({
      skill: 'explore',
      confidence: 1,
      autoRoute: true,
    });
  });

  it('returns explore for empty string', () => {
    expect(routeIntent('')).toMatchObject({ skill: 'explore' });
  });

  it('returns explore for Vietnamese message', () => {
    expect(routeIntent('hiển thị doanh thu hàng ngày')).toMatchObject({ skill: 'explore' });
  });
});
