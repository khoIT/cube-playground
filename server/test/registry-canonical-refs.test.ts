/**
 * Locks in the contract that the chat → metric → playground workflow needs:
 * for the canonical "always-works against ballistar" metric set, every
 * formula ref must resolve as a Cube member that exists in the ballistar
 * model. If someone re-edits one of these yamls to point at a non-existent
 * measure (e.g. reverts dau back to `mf_users.dau`), this test fails loudly
 * before the chat agent ships a query Cube can't run.
 *
 * The ballistar measure set is a hand-maintained snapshot of
 * `cube-dev/cube/model/cubes/ballistar/*.yml` — keep in sync when measures
 * are added/removed there. The richer per-game live check lives in
 * `scripts/check-metric-drift.ts`.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import {
  clearCache,
  getAll,
  loadAll,
} from '../src/services/business-metrics-loader.js';
import {
  snapshotFromMeta,
  validateRefs,
} from '../src/services/metric-ref-validator.js';

// Hand-maintained from cube-dev/cube/model/cubes/ballistar/*.yml. Update when
// measures land or are removed in that repo.
const BALLISTAR_META = {
  cubes: [
    {
      name: 'mf_users',
      measures: [
        'user_count',
        'user_count_approx',
        'ltv_total_vnd',
        'ltv_total_usd',
        'ltv_30d_total_vnd',
        'paying_users',
        'paying_users_30d',
        'whales_count',
        'lapsed_this_month_count',
        'arpu_vnd',
        'arppu_vnd',
        'paying_rate',
        'paying_rate_30d',
      ].map((m) => ({ name: `mf_users.${m}` })),
    },
    {
      name: 'active_daily',
      measures: [
        'rows',
        'dau',
        'dau_exact',
        'active_servers',
        'total_online_time_sec',
        'mau',
        'mau_prev_month',
      ].map((m) => ({ name: `active_daily.${m}` })),
    },
    {
      name: 'recharge',
      measures: [
        'transactions',
        'revenue_vnd',
        'paying_users',
        'paying_users_exact',
        'arppu_vnd',
        'arpt_vnd',
      ].map((m) => ({ name: `recharge.${m}` })),
    },
    {
      name: 'user_recharge_daily',
      measures: [
        'rows',
        'revenue_vnd_total',
        'revenue_usd_total',
        'txn_count_total',
        'paying_users',
      ].map((m) => ({ name: `user_recharge_daily.${m}` })),
    },
  ],
};

// Metric ids that the chat → metric → playground flow exercises today.
// Every ref these reach must resolve against the ballistar snapshot — if
// new measures are added that depend on cubes ballistar doesn't ship yet,
// they belong in a separate "aspirational" list (or behind trust=draft),
// not here.
const MUST_RESOLVE_AGAINST_BALLISTAR = [
  'dau',
  'mau',
  'arpdau',
  'arpu',
  'arppu',
  'gross_bookings',
  'paying_rate',
  'paying_rate_30d',
  'paying_users',
  'paying_users_30d',
  'revenue',
  'transactions',
];

describe('canonical business-metric refs resolve against ballistar', () => {
  beforeAll(async () => {
    clearCache();
    await loadAll();
  });

  it('every metric in the canonical set has refs that exist in /meta', () => {
    const snapshot = snapshotFromMeta(BALLISTAR_META);
    const registry = getAll();
    const subset = registry.filter((m) => MUST_RESOLVE_AGAINST_BALLISTAR.includes(m.id));

    // Sanity-check we matched everything we expected — catches typos in the
    // expectation list or yamls that got renamed.
    expect(subset.map((m) => m.id).sort()).toEqual(
      [...MUST_RESOLVE_AGAINST_BALLISTAR].sort(),
    );

    const unresolved = validateRefs(subset, snapshot);
    if (unresolved.length > 0) {
      const rows = unresolved
        .map((u) => `  • ${u.metricId} → ${u.ref} (${u.reason})`)
        .join('\n');
      throw new Error(
        `Canonical metrics reference measures that don't exist on ballistar:\n${rows}\n` +
          'Either: (a) re-point the yaml ref to an existing measure, ' +
          '(b) add the measure to cube-dev/cube/model/cubes/ballistar/, or ' +
          '(c) move the metric out of MUST_RESOLVE_AGAINST_BALLISTAR if it should not be a hard guarantee.',
      );
    }
  });
});
