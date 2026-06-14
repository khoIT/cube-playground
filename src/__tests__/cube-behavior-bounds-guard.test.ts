/**
 * Guardrail contract test for the cube service's behavior / high-volume scan
 * guard (cube-dev/cube/behavior-bounds-guard.cjs), invoked from cube.js
 * queryRewrite. Imports the REAL module (no mirror → no drift) so a query that
 * would full-scan a huge cube is rejected before it reaches Trino.
 *
 * Focus: billing_detail (~58.6M txn rows, time dim order_date) must require a
 * <= 31d bound just like the etl_* event streams — while user-grain cubes
 * (mf_users, billing_lifetime) stay unguarded so single-user lookups are free.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

const requireCjs = createRequire(import.meta.url);
// Absolute path from the repo root (vitest cwd) — keeps the cross-service import
// runtime-only so tsc (which scopes to src/) never tries to resolve the .cjs.
const guard = requireCjs(
  path.resolve(process.cwd(), 'cube-dev/cube/behavior-bounds-guard.cjs'),
) as {
  enforceBehaviorBounds: (q: unknown) => void;
  BIG_TXN_VIEWS: Set<string>;
  isGuarded: (cube: string) => boolean;
};

const bound30d = (dimension: string) => ({
  timeDimensions: [{ dimension, dateRange: ['2026-05-01', '2026-05-30'] }],
});

describe('behavior-bounds guard — billing_detail (red-team #6)', () => {
  it('guards both the bare cube and its 360 panel view', () => {
    expect(guard.BIG_TXN_VIEWS.has('billing_detail')).toBe(true);
    expect(guard.BIG_TXN_VIEWS.has('user_billing_detail_panel')).toBe(true);
    expect(guard.isGuarded('billing_detail')).toBe(true);
    expect(guard.isGuarded('user_billing_detail_panel')).toBe(true);
  });

  it('rejects an unbounded billing_detail query (would scan ~58.6M rows)', () => {
    expect(() =>
      guard.enforceBehaviorBounds({ measures: ['billing_detail.cash_charged_gross'] }),
    ).toThrow(/high-volume cube\/view "billing_detail"/);
  });

  it('rejects an unbounded query via the panel view', () => {
    expect(() =>
      guard.enforceBehaviorBounds({ dimensions: ['user_billing_detail_panel.store'] }),
    ).toThrow(/high-volume/);
  });

  it('accepts a billing_detail query bounded to <= 31 days on order_date', () => {
    expect(() =>
      guard.enforceBehaviorBounds({
        measures: ['billing_detail.cash_charged_gross'],
        ...bound30d('billing_detail.order_date'),
      }),
    ).not.toThrow();
  });

  it('rejects a billing_detail query spanning more than 31 days', () => {
    expect(() =>
      guard.enforceBehaviorBounds({
        measures: ['billing_detail.cash_charged_gross'],
        timeDimensions: [{ dimension: 'billing_detail.order_date', dateRange: ['2026-01-01', '2026-05-30'] }],
      }),
    ).toThrow(/spans \d+ days/);
  });
});

describe('behavior-bounds guard — scope is correct', () => {
  it('still guards the etl_* event streams and their panels', () => {
    expect(() => guard.enforceBehaviorBounds({ dimensions: ['etl_money_flow.delta'] })).toThrow();
    expect(() => guard.enforceBehaviorBounds({ measures: ['user_matches_panel.rows'] })).toThrow();
  });

  it('leaves user-grain cubes unguarded (single-user lookups stay free)', () => {
    // mf_users: the join spine, queried by user_id equality — tiny, no date dim.
    expect(() => guard.enforceBehaviorBounds({ dimensions: ['mf_users.country'] })).not.toThrow();
    // billing_lifetime: user×product reconciliation, no order_date dim to bound.
    expect(() =>
      guard.enforceBehaviorBounds({ dimensions: ['user_billing_lifetime_panel.lifetime_vnd'] }),
    ).not.toThrow();
  });
});
