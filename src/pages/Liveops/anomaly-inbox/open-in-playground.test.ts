/**
 * Tests for buildPlaygroundUrl — verifies URL format, dateRange centering,
 * and time-dimension inference.
 */

import { describe, it, expect } from 'vitest';
import { buildPlaygroundUrl } from './open-in-playground';
import type { AnomalyRow } from './use-anomalies';

function makeAnomaly(overrides: Partial<AnomalyRow> = {}): AnomalyRow {
  return {
    id: 1,
    game: 'cfm',
    metric: 'active_daily.dau',
    severity: 'high',
    baseline: 1000,
    observed: 5000,
    ts: '2024-01-15',
    status: 'open',
    snooze_until: null,
    created_at: '2024-01-15T00:00:00.000Z',
    updated_at: '2024-01-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildPlaygroundUrl', () => {
  it('produces a /build?query=<JSON> URL', () => {
    const url = buildPlaygroundUrl(makeAnomaly());
    expect(url).toMatch(/^\/build\?query=/);
  });

  it('encodes the metric as a measure in the query', () => {
    const url = buildPlaygroundUrl(makeAnomaly({ metric: 'active_daily.dau' }));
    const raw = decodeURIComponent(url.split('?query=')[1]);
    const query = JSON.parse(raw);
    expect(query.measures).toContain('active_daily.dau');
  });

  it('infers active_daily.log_date as time dimension for active_daily cube', () => {
    const url = buildPlaygroundUrl(makeAnomaly({ metric: 'active_daily.dau' }));
    const query = JSON.parse(decodeURIComponent(url.split('?query=')[1]));
    expect(query.timeDimensions[0].dimension).toBe('active_daily.log_date');
  });

  it('infers user_recharge_daily.log_date for recharge cube', () => {
    const url = buildPlaygroundUrl(
      makeAnomaly({ metric: 'user_recharge_daily.revenue_vnd_total' })
    );
    const query = JSON.parse(decodeURIComponent(url.split('?query=')[1]));
    expect(query.timeDimensions[0].dimension).toBe('user_recharge_daily.log_date');
  });

  it('dateRange spans 14 days: 7 before and 6 after anchor', () => {
    const url = buildPlaygroundUrl(makeAnomaly({ ts: '2024-01-15' }));
    const query = JSON.parse(decodeURIComponent(url.split('?query=')[1]));
    const [start, end] = query.timeDimensions[0].dateRange as [string, string];
    expect(start).toBe('2024-01-08'); // 7 days before Jan 15
    expect(end).toBe('2024-01-21');   // 6 days after Jan 15
  });

  it('granularity is day', () => {
    const url = buildPlaygroundUrl(makeAnomaly());
    const query = JSON.parse(decodeURIComponent(url.split('?query=')[1]));
    expect(query.timeDimensions[0].granularity).toBe('day');
  });

  it('falls back to <cube>.ts for unknown cube name', () => {
    const url = buildPlaygroundUrl(makeAnomaly({ metric: 'my_custom_cube.value' }));
    const query = JSON.parse(decodeURIComponent(url.split('?query=')[1]));
    expect(query.timeDimensions[0].dimension).toBe('my_custom_cube.ts');
  });

  it('handles ISO timestamp ts (uses only date part)', () => {
    const url = buildPlaygroundUrl(makeAnomaly({ ts: '2024-03-10T00:00:00.000Z' }));
    const query = JSON.parse(decodeURIComponent(url.split('?query=')[1]));
    const [start, end] = query.timeDimensions[0].dateRange as [string, string];
    expect(start).toBe('2024-03-03');
    expect(end).toBe('2024-03-16');
  });
});
