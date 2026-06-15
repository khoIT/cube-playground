/**
 * Outcome reader — asserts the cube query SHAPE (measures/dims/filters/window),
 * per-arm aggregation (distinct payers, summed gross), jus USD→VND
 * normalization, and the cumulative daily series. The cube client is mocked, so
 * this runs with no Trino.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/cube-client.js', () => ({ loadWithCtx: vi.fn() }));

import { loadWithCtx } from '../src/services/cube-client.js';
import { readOutcomes } from '../src/experiments/experiment-outcome-reader.js';

const mockLoad = loadWithCtx as unknown as ReturnType<typeof vi.fn>;
const ctx = { cubeApiUrl: 'http://stub', token: null };

interface CubeQuery {
  measures: string[];
  dimensions: string[];
  filters: { member: string; operator: string; values: string[] }[];
  timeDimensions: { dimension: string; dateRange: [string, string]; granularity?: string }[];
}

beforeEach(() => mockLoad.mockReset());

describe('readOutcomes', () => {
  it('builds the right per-arm query and aggregates distinct payers + gross', async () => {
    const seen: CubeQuery[] = [];
    mockLoad.mockImplementation((q: CubeQuery) => {
      if (!q) return Promise.resolve({ data: [] }); // vitest cleanup invokes the spy with no args
      seen.push(q);
      const isSeries = q.timeDimensions[0]?.granularity === 'day';
      const isTreatment = q.filters[0]?.values.includes('t1');
      if (isSeries) {
        return Promise.resolve({ data: [] }); // series asserted separately
      }
      if (isTreatment) {
        return Promise.resolve({
          data: [
            { 'billing_detail.user_id': 't1', 'billing_detail.currency': 'VND', 'billing_detail.cash_charged_gross': '100000', 'billing_detail.txn_count_total': '2' },
            { 'billing_detail.user_id': 't2', 'billing_detail.currency': 'VND', 'billing_detail.cash_charged_gross': '0', 'billing_detail.txn_count_total': '0' },
          ],
        });
      }
      return Promise.resolve({
        data: [
          { 'billing_detail.user_id': 'c1', 'billing_detail.currency': 'VND', 'billing_detail.cash_charged_gross': '50000', 'billing_detail.txn_count_total': '1' },
        ],
      });
    });

    const bundle = await readOutcomes(ctx, ['t1', 't2'], ['c1'], '2026-06-01T00:00:00Z', 14);

    const treat = bundle.arms.find((a) => a.arm === 'treatment')!;
    const ctrl = bundle.arms.find((a) => a.arm === 'control')!;
    expect(treat.assigned).toBe(2);
    expect(treat.payers).toBe(1); // only t1 has gross > 0
    expect(treat.grossVnd).toBe(100000);
    expect(treat.txns).toBe(2);
    expect(ctrl.payers).toBe(1);
    expect(ctrl.grossVnd).toBe(50000);

    // Query shape: gross + txn measures, user_id + currency dims, equals filter,
    // 14-day window from the assignment date.
    const arm = seen.find((q) => !q.timeDimensions[0]?.granularity)!;
    expect(arm.measures).toContain('billing_detail.cash_charged_gross');
    expect(arm.dimensions).toContain('billing_detail.user_id');
    expect(arm.dimensions).toContain('billing_detail.currency');
    expect(arm.filters[0]).toMatchObject({ member: 'billing_detail.user_id', operator: 'equals' });
    expect(arm.timeDimensions[0].dimension).toBe('billing_detail.order_date');
    expect(arm.timeDimensions[0].dateRange).toEqual(['2026-06-01', '2026-06-14']);
  });

  it('normalizes USD gross to VND at the configured rate', async () => {
    process.env.EXPERIMENT_USD_TO_VND = '25000';
    mockLoad.mockImplementation((q: CubeQuery) => {
      if (!q) return Promise.resolve({ data: [] });
      if (q.timeDimensions[0]?.granularity === 'day') return Promise.resolve({ data: [] });
      return Promise.resolve({
        data: [
          { 'billing_detail.user_id': 'j1', 'billing_detail.currency': 'USD', 'billing_detail.cash_charged_gross': '4', 'billing_detail.txn_count_total': '1' },
          { 'billing_detail.user_id': 'j1', 'billing_detail.currency': 'VND', 'billing_detail.cash_charged_gross': '10000', 'billing_detail.txn_count_total': '1' },
        ],
      });
    });

    const bundle = await readOutcomes(ctx, ['j1'], [], '2026-06-01T00:00:00Z', 7);
    const treat = bundle.arms.find((a) => a.arm === 'treatment')!;
    // 4 USD * 25000 + 10000 VND = 110000 VND for the single user.
    expect(treat.grossVnd).toBe(110000);
    expect(treat.payers).toBe(1);
    expect(bundle.currencies).toEqual(['USD', 'VND']);
  });

  it('accumulates the daily series across arms', async () => {
    mockLoad.mockImplementation((q: CubeQuery) => {
      if (!q) return Promise.resolve({ data: [] });
      if (q.timeDimensions[0]?.granularity !== 'day') return Promise.resolve({ data: [] });
      const isTreatment = q.filters[0]?.values.includes('t1');
      return Promise.resolve({
        data: isTreatment
          ? [
              { 'billing_detail.order_date.day': '2026-06-01T00:00:00.000', 'billing_detail.currency': 'VND', 'billing_detail.cash_charged_gross': '100' },
              { 'billing_detail.order_date.day': '2026-06-02T00:00:00.000', 'billing_detail.currency': 'VND', 'billing_detail.cash_charged_gross': '50' },
            ]
          : [
              { 'billing_detail.order_date.day': '2026-06-01T00:00:00.000', 'billing_detail.currency': 'VND', 'billing_detail.cash_charged_gross': '20' },
            ],
      });
    });

    const bundle = await readOutcomes(ctx, ['t1'], ['c1'], '2026-06-01T00:00:00Z', 7);
    expect(bundle.series).toEqual([
      { date: '2026-06-01', treatmentGrossVnd: 100, controlGrossVnd: 20 },
      { date: '2026-06-02', treatmentGrossVnd: 150, controlGrossVnd: 20 },
    ]);
  });

  it('series last cumulative point reconciles with the arm gross total', async () => {
    // Same gross (150 VND for the single treatment user) seen by both the
    // per-arm query (one user-currency row) and the daily series (split 100+50).
    mockLoad.mockImplementation((q: CubeQuery) => {
      if (!q) return Promise.resolve({ data: [] });
      const isSeries = q.timeDimensions[0]?.granularity === 'day';
      const isTreatment = q.filters[0]?.values.includes('t1');
      if (!isTreatment) return Promise.resolve({ data: [] }); // empty control
      if (isSeries) {
        return Promise.resolve({
          data: [
            { 'billing_detail.order_date.day': '2026-06-01T00:00:00.000', 'billing_detail.currency': 'VND', 'billing_detail.cash_charged_gross': '100' },
            { 'billing_detail.order_date.day': '2026-06-02T00:00:00.000', 'billing_detail.currency': 'VND', 'billing_detail.cash_charged_gross': '50' },
          ],
        });
      }
      return Promise.resolve({
        data: [
          { 'billing_detail.user_id': 't1', 'billing_detail.currency': 'VND', 'billing_detail.cash_charged_gross': '150', 'billing_detail.txn_count_total': '2' },
        ],
      });
    });

    const bundle = await readOutcomes(ctx, ['t1'], ['c1'], '2026-06-01T00:00:00Z', 7);
    const treat = bundle.arms.find((a) => a.arm === 'treatment')!;
    const lastSeries = bundle.series[bundle.series.length - 1];
    expect(lastSeries.treatmentGrossVnd).toBe(treat.grossVnd);
  });

  it('empty arm short-circuits to zero without a cube call for that arm', async () => {
    mockLoad.mockResolvedValue({ data: [] });
    const bundle = await readOutcomes(ctx, [], [], '2026-06-01T00:00:00Z', 14);
    expect(bundle.arms.every((a) => a.assigned === 0 && a.grossVnd === 0)).toBe(true);
  });
});
