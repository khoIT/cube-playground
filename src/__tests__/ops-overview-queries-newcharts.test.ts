/**
 * Contract guard for the Ops Console power-up query builders + the members-list
 * builder. Static inspection of the exported builders:
 *  - no-PII boundary: the Overview power-up builders (spend / dau / cs / payer-
 *    tier / heatmap) carry NO per-user member; ONLY topPayersQuery does.
 *  - jus heatmap filters currency='VND'; cfm does not (mixed-currency rule).
 *  - heatmap has NO granularity (period total per hour×dow cell, not a series).
 *  - daily-trend builders carry day granularity.
 *  - topPayersQuery: has user_id, orders by LTV desc, applies a limit.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import type { Query } from '@cubejs-client/core';
import {
  spendDailyTrendQuery,
  dauDailyQuery,
  csTrendDailyQuery,
  payerTierConcentrationQuery,
  purchaseHeatmapQuery,
} from '../pages/OpsConsole/ops-overview-queries';
import { topPayersQuery } from '../pages/OpsConsole/ops-members-queries';

const R = { start: '2026-05-16', end: '2026-06-14' };
const PII = ['user_id', 'member_user_id', 'ingame_name', 'vip_id'];

function membersOf(q: Query): string[] {
  return [
    ...(q.measures ?? []),
    ...(q.dimensions ?? []),
    ...((q.filters ?? []) as { member?: string }[]).map((f) => f.member ?? ''),
    ...(q.timeDimensions ?? []).map((t) => t.dimension),
  ];
}

const hasVndFilter = (q: Query) =>
  (q.filters ?? []).some((f) => (f as { member?: string }).member === 'billing_detail.currency');

function overviewPowerups(gameId: string): Query[] {
  return [
    spendDailyTrendQuery(R),
    dauDailyQuery(R),
    csTrendDailyQuery(R),
    payerTierConcentrationQuery(),
    purchaseHeatmapQuery(gameId, R),
  ];
}

describe('Overview power-up query contract', () => {
  it('no power-up Overview builder references a PII member', () => {
    for (const gameId of ['cfm_vn', 'jus_vn']) {
      for (const q of overviewPowerups(gameId)) {
        for (const m of membersOf(q)) {
          for (const pii of PII) {
            expect(m.endsWith(`.${pii}`)).toBe(false);
          }
        }
      }
    }
  });

  it('jus heatmap filters currency=VND; cfm does not', () => {
    expect(hasVndFilter(purchaseHeatmapQuery('jus_vn', R))).toBe(true);
    expect((purchaseHeatmapQuery('cfm_vn', R).filters ?? []).length).toBe(0);
  });

  it('heatmap groups by hour+dow with NO granularity (cell total, not a series)', () => {
    const q = purchaseHeatmapQuery('cfm_vn', R);
    expect(q.dimensions).toEqual(['billing_detail.hour_of_day', 'billing_detail.day_of_week']);
    expect(q.measures).toEqual(['billing_detail.cash_charged_gross']);
    expect((q.timeDimensions ?? []).every((t) => !t.granularity)).toBe(true);
    expect((q.timeDimensions ?? [])[0]?.dateRange).toEqual([R.start, R.end]);
  });

  it('daily-trend builders carry day granularity', () => {
    for (const q of [spendDailyTrendQuery(R), dauDailyQuery(R), csTrendDailyQuery(R)]) {
      expect((q.timeDimensions ?? [])[0]?.granularity).toBe('day');
    }
  });

  it('cs trend exposes volume + negative-sentiment measures', () => {
    expect(csTrendDailyQuery(R).measures).toEqual([
      'cs_ticket_detail.total_tickets',
      'cs_ticket_detail.negative_sentiment_tickets',
    ]);
  });
});

describe('Members top-payers query', () => {
  it('carries user_id (the deliberate per-user exception)', () => {
    expect(topPayersQuery().dimensions).toContain('mf_users.user_id');
  });

  it('orders by LTV desc and applies a limit', () => {
    const q = topPayersQuery(50);
    expect(q.order).toEqual({ 'mf_users.ltv_total_vnd': 'desc' });
    expect(q.limit).toBe(50);
    expect(topPayersQuery(10).limit).toBe(10);
  });

  it('is a snapshot (no time window) — LTV/tier are as-of', () => {
    expect(topPayersQuery().timeDimensions ?? []).toEqual([]);
  });
});
