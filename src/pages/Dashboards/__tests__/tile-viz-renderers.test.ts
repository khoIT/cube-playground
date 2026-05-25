/**
 * Regression: dashboard KPI tile must show the numeric measure, not the
 * ISO date string of the time dimension. Cube returns time + measure in the
 * same row, with time dim first; the extractor needs to prefer measures.
 */

import { describe, it, expect } from 'vitest';
import type { ResultSet } from '@cubejs-client/core';
import { extractKpiValue } from '../tile-viz-renderers';

function makeRs(rows: Array<Record<string, unknown>>): ResultSet {
  return { rawData: () => rows } as unknown as ResultSet;
}

describe('extractKpiValue', () => {
  it('returns the numeric measure when both time-dim and measure are present', () => {
    const rs = makeRs([
      {
        'active_daily.log_date.day': '2026-05-11T00:00:00.000',
        'active_daily.dau': '16954',
        'active_daily.log_date': '2026-05-11T00:00:00.000',
      },
      {
        'active_daily.log_date.day': '2026-05-12T00:00:00.000',
        'active_daily.dau': '24230',
        'active_daily.log_date': '2026-05-12T00:00:00.000',
      },
    ]);
    expect(extractKpiValue(rs)).toBe('24,230');
  });

  it('uses the latest row, not the first', () => {
    const rs = makeRs([
      { 'cube.metric': 100 },
      { 'cube.metric': 200 },
      { 'cube.metric': 300 },
    ]);
    expect(extractKpiValue(rs)).toBe('300');
  });

  it('handles native-number values', () => {
    const rs = makeRs([{ 'cube.measure': 1351 }]);
    expect(extractKpiValue(rs)).toBe('1,351');
  });

  it('returns an em-dash for empty result sets', () => {
    expect(extractKpiValue(makeRs([]))).toBe('–');
  });

  it('falls back to em-dash when no usable column exists', () => {
    const rs = makeRs([{ 'cube.label': '' }]);
    expect(extractKpiValue(rs)).toBe('–');
  });

  it('survives a malformed ResultSet', () => {
    const bad = { rawData: () => { throw new Error('boom'); } } as unknown as ResultSet;
    expect(extractKpiValue(bad)).toBe('–');
  });
});
