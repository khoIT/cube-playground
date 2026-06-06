/**
 * Pure helpers for the admin cost section: range→query-string mapping and
 * display formatting (USD precision, token abbreviation).
 */

import { describe, it, expect } from 'vitest';
import { costRangeQueryString } from '../cost-observability-data';
import { fmtUsd, fmtTokens } from '../cost-breakdown-section';

describe('costRangeQueryString', () => {
  const NOW = Date.parse('2026-06-07T00:00:00Z');

  it('omits from for all-time', () => {
    expect(costRangeQueryString('all', NOW)).toBe('');
  });

  it('maps 7d/30d/90d to an ISO from cutoff', () => {
    expect(costRangeQueryString('7d', NOW)).toBe('?from=2026-05-31T00%3A00%3A00.000Z');
    expect(costRangeQueryString('30d', NOW)).toContain('2026-05-08');
    expect(costRangeQueryString('90d', NOW)).toContain('2026-03-09');
  });
});

describe('formatting', () => {
  it('fmtUsd: 2dp at >=$1, 4dp below', () => {
    expect(fmtUsd(12.3456)).toBe('$12.35');
    expect(fmtUsd(0.0042)).toBe('$0.0042');
    expect(fmtUsd(0)).toBe('$0.0000');
  });

  it('fmtTokens: abbreviates k / M', () => {
    expect(fmtTokens(999)).toBe('999');
    expect(fmtTokens(1234)).toBe('1.2k');
    expect(fmtTokens(5_600_000)).toBe('5.6M');
  });
});
