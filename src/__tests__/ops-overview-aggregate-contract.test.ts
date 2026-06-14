/**
 * Contract guard for the Ops Console Overview queries (red-team A1/A2/A10).
 * Inspects the EXPORTED query builders statically:
 *  - A10: no query carries a PII member (user_id / member_user_id / ingame_name /
 *    vip_id) in filters OR dimensions → aggregate-only → no PII surface.
 *  - A1: the headline (paying_users) query has NO day granularity (the distinct
 *    measure is non-additive — must be one windowed query, never summed daily).
 *  - A2: jus billing money queries filter currency='VND'; cfm does not.
 *  - billing queries are bounded by a window dateRange (≤31d scan guard).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import type { Query } from '@cubejs-client/core';
import {
  billingHeadlineQuery,
  billingDailyTrendQuery,
  gatewayTrendQuery,
  supportQuery,
  lifetimeQuery,
  ingameLtvQuery,
  geoQuery,
  acquisitionQuery,
} from '../pages/OpsConsole/ops-overview-queries';

const R = { start: '2026-05-16', end: '2026-06-14' };
const PII = ['user_id', 'member_user_id', 'ingame_name', 'vip_id'];

function allQueries(gameId: string): Query[] {
  return [
    billingHeadlineQuery(gameId, R),
    billingDailyTrendQuery(gameId, R),
    gatewayTrendQuery(gameId, R),
    supportQuery(R),
    lifetimeQuery(),
    ingameLtvQuery(),
    geoQuery(),
    acquisitionQuery(R),
  ];
}

const hasVndFilter = (q: Query) =>
  (q.filters ?? []).some((f) => (f as { member?: string }).member === 'billing_detail.currency');

function membersOf(q: Query): string[] {
  return [
    ...(q.measures ?? []),
    ...(q.dimensions ?? []),
    ...((q.filters ?? []) as { member?: string }[]).map((f) => f.member ?? ''),
    ...(q.timeDimensions ?? []).map((t) => t.dimension),
  ];
}

describe('Overview query contract', () => {
  it('A10 — no query references a PII member (aggregate-only)', () => {
    for (const gameId of ['cfm_vn', 'jus_vn']) {
      for (const q of allQueries(gameId)) {
        for (const m of membersOf(q)) {
          for (const pii of PII) {
            // member is `cube.field`; forbid any field ending in a PII name.
            expect(m.endsWith(`.${pii}`)).toBe(false);
          }
        }
      }
    }
  });

  it('A1 — headline carries no day granularity (distinct not summed daily)', () => {
    const q = billingHeadlineQuery('cfm_vn', R);
    expect(q.measures).toContain('billing_detail.paying_users');
    expect((q.timeDimensions ?? []).every((t) => !t.granularity)).toBe(true);
  });

  it('A2 — every jus billing query filters currency=VND; cfm none do', () => {
    const jusBilling = [
      billingHeadlineQuery('jus_vn', R),
      billingDailyTrendQuery('jus_vn', R),
      gatewayTrendQuery('jus_vn', R),
    ];
    for (const q of jusBilling) expect(hasVndFilter(q)).toBe(true);

    const cfmBilling = [
      billingHeadlineQuery('cfm_vn', R),
      billingDailyTrendQuery('cfm_vn', R),
      gatewayTrendQuery('cfm_vn', R),
    ];
    for (const q of cfmBilling) expect((q.filters ?? []).length).toBe(0);
  });

  it('billing queries are bounded by a window dateRange (≤31d scan guard)', () => {
    for (const q of [billingHeadlineQuery('cfm_vn', R), gatewayTrendQuery('cfm_vn', R)]) {
      const td = (q.timeDimensions ?? [])[0];
      expect(td?.dimension).toBe('billing_detail.order_date');
      expect(td?.dateRange).toEqual([R.start, R.end]);
    }
  });

  it('money never uses recharge.revenue_vnd (9× inflated units)', () => {
    for (const gameId of ['cfm_vn', 'jus_vn']) {
      for (const q of allQueries(gameId)) {
        expect(q.measures ?? []).not.toContain('recharge.revenue_vnd');
      }
    }
  });
});
