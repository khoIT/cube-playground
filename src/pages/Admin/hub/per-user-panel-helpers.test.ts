/**
 * Tests for the query-shape helpers: member summary + privacy-safe playground
 * deep-link. The shape is member NAMES only — the URL must carry exactly those
 * and nothing else (no filters/ranges exist to leak).
 */

import { describe, it, expect } from 'vitest';
import { summarizeShapeMembers, buildShapePlaygroundUrl, type QueryShape } from './per-user-panel-helpers';

const shape = (over: Partial<QueryShape> = {}): QueryShape => ({
  cubes: [], measures: [], dimensions: [], ...over,
});

describe('summarizeShapeMembers', () => {
  it('joins measures and dimensions by name', () => {
    expect(summarizeShapeMembers(shape({ measures: ['recharge.revenue_vnd'], dimensions: ['recharge.user_id'] })))
      .toBe('recharge.revenue_vnd, recharge.user_id');
  });

  it('falls back to cube names when no members', () => {
    expect(summarizeShapeMembers(shape({ cubes: ['recharge'] }))).toBe('recharge');
  });

  it('falls back to "query" when empty', () => {
    expect(summarizeShapeMembers(shape())).toBe('query');
  });
});

describe('buildShapePlaygroundUrl', () => {
  it('encodes measures and dimensions into a /build?query= URL', () => {
    const url = buildShapePlaygroundUrl(shape({
      cubes: ['recharge'], measures: ['recharge.revenue_vnd'], dimensions: ['recharge.user_id'],
    }))!;
    expect(url).toMatch(/^\/build\?query=/);
    const query = JSON.parse(decodeURIComponent(url.split('?query=')[1]));
    expect(query).toEqual({ measures: ['recharge.revenue_vnd'], dimensions: ['recharge.user_id'] });
  });

  it('omits an empty members array rather than sending []', () => {
    const url = buildShapePlaygroundUrl(shape({ measures: ['recharge.revenue_vnd'] }))!;
    const query = JSON.parse(decodeURIComponent(url.split('?query=')[1]));
    expect(query).toEqual({ measures: ['recharge.revenue_vnd'] });
    expect('dimensions' in query).toBe(false);
  });

  it('returns null when there is nothing selectable', () => {
    expect(buildShapePlaygroundUrl(shape({ cubes: ['recharge'] }))).toBeNull();
    expect(buildShapePlaygroundUrl(shape())).toBeNull();
  });
});
