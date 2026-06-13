/**
 * cubestore-introspect pure logic: logical-base suffix strip + the JS
 * aggregation that folds system.tables/indexes/partitions into per-schema
 * pre-agg materialisation. No live MySQL — the DB call is the thin wrapper;
 * aggregation is the part with edge cases (suffix strip, index→table join,
 * boolean coercion, schema filter, byte/active sums).
 */

import { describe, it, expect } from 'vitest';
import {
  logicalPreaggBase,
  aggregateCubestoreStorage,
  type TableRow,
  type IndexRow,
  type PartRow,
} from '../src/services/cubestore-introspect.js';

describe('logicalPreaggBase', () => {
  it('strips the version tail and a glued partition-range date', () => {
    expect(logicalPreaggBase('active_daily_dau_by_country_payer_daily_batch20260601_pgstsc44_dslie4mx_1l2maeu'))
      .toBe('active_daily_dau_by_country_payer_daily_batch');
  });
  it('strips a 3-token version tail with no date stamp', () => {
    expect(logicalPreaggBase('ordered_funnel_canonical_canonical_daily_b1x4f2jr_vjvzkro0_1l2maep'))
      .toBe('ordered_funnel_canonical_canonical_daily');
  });
  it('leaves a short name untouched', () => {
    expect(logicalPreaggBase('foo_bar')).toBe('foo_bar');
  });

  // The checker hinges on this symmetry: the stored base (derived from the
  // PHYSICAL CubeStore name via logicalPreaggBase) must equal the BARE name the
  // Cube /sql dry-run reports (already suffix-free). If they ever diverge, every
  // verdict silently degrades to not-built. The dry-run name must NOT be
  // re-stripped — findPreaggByTableName matches it directly.
  it('stored base (from physical) equals the dry-run bare table name', () => {
    const physical = 'active_daily_dau_by_country_payer_daily_batch20260601_pgstsc44_dslie4mx_1l2maeu';
    const dryRunBare = 'active_daily_dau_by_country_payer_daily_batch'; // as Cube /sql reports it
    expect(logicalPreaggBase(physical)).toBe(dryRunBare);
    // And the dry-run name is stable under a second strip only if it has >3
    // tokens — which is why findPreaggByTableName must compare it directly, not
    // re-run logicalPreaggBase (that would yield 'active_daily_dau_by_country').
    expect(logicalPreaggBase(dryRunBare)).not.toBe(dryRunBare);
  });
});

describe('aggregateCubestoreStorage', () => {
  // Two physical tables of ONE logical pre-agg in preagg_cfm, plus a noise
  // schema that must be filtered out. Index ids == table ids (the default
  // index), partitions reference index_id.
  const tables: TableRow[] = [
    { id: 1, table_schema: 'preagg_cfm', table_name: 'active_daily_dau_batch20260101_aa_bb_cc', has_data: true, is_ready: true, sealed: false, build_range_end: '2026-01-31T00:00:00Z', seal_at: null },
    { id: 2, table_schema: 'preagg_cfm', table_name: 'active_daily_dau_batch20260201_aa_bb_dd', has_data: true, is_ready: true, sealed: true, build_range_end: '2026-02-28T00:00:00Z', seal_at: '2026-02-28T01:00:00Z' },
    { id: 3, table_schema: 'analytics', table_name: 'some_raw_table', has_data: true, is_ready: true, sealed: false, build_range_end: null, seal_at: null },
  ];
  const indexes: IndexRow[] = [
    { id: 1, table_id: 1 },
    { id: 2, table_id: 2 },
    { id: 3, table_id: 3 },
  ];
  const parts: PartRow[] = [
    { index_id: 1, active: true, main_table_row_count: 100, file_size: 1000 },
    { index_id: 2, active: false, main_table_row_count: 50, file_size: 500 },
    { index_id: 2, active: 1, main_table_row_count: 25, file_size: 250 }, // boolean as 1
    { index_id: 3, active: true, main_table_row_count: 9, file_size: 9 },  // noise schema
  ];

  it('groups physical tables by logical base, filters non-preagg schemas', () => {
    const out = aggregateCubestoreStorage(tables, indexes, parts);
    // analytics schema filtered out → only preagg_cfm.
    expect(out).toHaveLength(1);
    expect(out[0].schema).toBe('preagg_cfm');
    expect(out[0].preaggs).toHaveLength(1);
    expect(out[0].preaggs[0].base).toBe('active_daily_dau_batch');
  });

  it('folds partition stats and table flags across the group', () => {
    const [{ preaggs: [p] }] = aggregateCubestoreStorage(tables, indexes, parts);
    expect(p.tableCount).toBe(2);
    expect(p.sealedCount).toBe(1);   // table 2 sealed
    expect(p.readyCount).toBe(2);
    expect(p.partitions).toBe(3);    // 1 + 2
    expect(p.activePartitions).toBe(2); // index1(true) + index2(1 truthy)
    expect(p.rows).toBe(175);        // 100 + 50 + 25
    expect(p.bytes).toBe(1750);      // 1000 + 500 + 250
    expect(p.buildRangeEnd).toBe('2026-02-28T00:00:00Z'); // max
    expect(p.sealAt).toBe('2026-02-28T01:00:00Z');
  });

  it('tolerates null file_size / row_count', () => {
    const out = aggregateCubestoreStorage(
      [{ id: 9, table_schema: 'preagg_x', table_name: 'a_b_c_d_e_f', has_data: true, is_ready: false, sealed: false, build_range_end: null, seal_at: null }],
      [{ id: 9, table_id: 9 }],
      [{ index_id: 9, active: false, main_table_row_count: null, file_size: null }],
    );
    expect(out[0].preaggs[0].bytes).toBe(0);
    expect(out[0].preaggs[0].rows).toBe(0);
    expect(out[0].preaggs[0].activePartitions).toBe(0);
  });
});
