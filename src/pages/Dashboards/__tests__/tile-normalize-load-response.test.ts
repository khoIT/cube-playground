/**
 * Regression: a pinned tile must render through the SAME chart engine as the
 * QueryBuilder. The engine (ChartRenderer) reads `resultSet.loadResponse.results[0]`
 * directly, but some Cube backends return the legacy single-result shape
 * (`{ data, annotation, query }` at top level). `normalizeLoadResponse` must lift
 * that into the wrapper shape so the tile renders the real chart instead of
 * silently dropping to the legacy rows renderer.
 */

import { describe, expect, it } from 'vitest';
import { ResultSet } from '@cubejs-client/core';
import { normalizeLoadResponse } from '../tile';

const LEGACY_SINGLE_RESULT = {
  query: {
    measures: ['recharge.revenue_vnd', 'mf_users.user_count'],
    dimensions: ['recharge.os_platform'],
  },
  annotation: {
    measures: {
      'recharge.revenue_vnd': { title: 'Revenue', type: 'number' },
      'mf_users.user_count': { title: 'Users', type: 'number' },
    },
    dimensions: { 'recharge.os_platform': { title: 'Platform', type: 'string' } },
    timeDimensions: {},
    segments: {},
  },
  data: [
    { 'recharge.os_platform': 'IOS', 'recharge.revenue_vnd': 1530617000, 'mf_users.user_count': 1823 },
    { 'recharge.os_platform': 'Android', 'recharge.revenue_vnd': 943321000, 'mf_users.user_count': 1565 },
  ],
};

describe('normalizeLoadResponse', () => {
  it('lifts the legacy single-result shape into the engine wrapper shape', () => {
    const norm = normalizeLoadResponse(LEGACY_SINGLE_RESULT);
    expect(norm).not.toBeNull();
    // ChartRenderer reads this exact path — it must resolve.
    expect(Array.isArray((norm as any).results)).toBe(true);
    expect((norm as any).results[0].data).toHaveLength(2);
    expect((norm as any).queryType).toBe('regularQuery');
  });

  it('produces a ResultSet that drives chartPivot + seriesNames (engine parity)', () => {
    const norm = normalizeLoadResponse(LEGACY_SINGLE_RESULT)!;
    const rs = new ResultSet(norm as ConstructorParameters<typeof ResultSet>[0]);
    // The literal access ChartRenderer makes at render time.
    expect(rs.loadResponse.results[0].data[0]).toBeTruthy();
    expect(rs.chartPivot().length).toBeGreaterThan(0);
    // x=[dimension], y=[measures] → one series per measure.
    expect(rs.seriesNames().length).toBe(2);
    expect(rs.tablePivot()).toHaveLength(2);
  });

  it('passes the already-wrapper shape through unchanged', () => {
    const wrapper = { queryType: 'regularQuery', results: [LEGACY_SINGLE_RESULT], pivotQuery: {} };
    expect(normalizeLoadResponse(wrapper)).toBe(wrapper);
  });

  it('returns null for rows-only / unrenderable responses → legacy fallback', () => {
    expect(normalizeLoadResponse(null)).toBeNull();
    expect(normalizeLoadResponse(undefined)).toBeNull();
    expect(normalizeLoadResponse({ foo: 'bar' })).toBeNull();
    expect(normalizeLoadResponse({ results: [] })).toBeNull();
    expect(normalizeLoadResponse({ data: 'not-an-array' })).toBeNull();
  });
});
