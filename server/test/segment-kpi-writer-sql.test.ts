/**
 * Pure-logic tests for the KPI writer SQL builder.
 * No Trino, no DB, no Cube calls.
 *
 * Invariants:
 *  - One VALUES tuple per metric spec.
 *  - NULL value renders as SQL NULL literal (not 0, not empty string).
 *  - DELETE and INSERT are keyed on the same (game, segment, snapshot_ts) slice.
 *  - member_count is written verbatim.
 *  - toSqlLiteral escapes string values in labels/metric_ids.
 */

import { describe, it, expect } from 'vitest';
import { buildKpiInsertSql } from '../src/lakehouse/segment-kpi-writer.js';

const TS = '2026-06-18 10:00:00';
const DATE = '2026-06-18';
const GAME = 'cfm_vn';
const SEG = 'seg-kpi-test';
const MEMBER_COUNT = 4200;

const SPECS = [
  { metricId: 'mf_users.user_count', metricLabel: 'Active Users', value: 1234 },
  { metricId: 'mf_users.paying_rate_30d', metricLabel: 'Paying Rate 30d', value: 0.1234 },
  { metricId: 'mf_users.arppu_vnd', metricLabel: 'ARPPU (VND)', value: null },
];

describe('buildKpiInsertSql — tuple count', () => {
  it('produces one VALUES tuple per spec', () => {
    const { insertSql } = buildKpiInsertSql({
      specs: SPECS,
      memberCount: MEMBER_COUNT,
      snapshotDate: DATE,
      snapshotTs: TS,
      gameId: GAME,
      segmentId: SEG,
    });
    // Count opening parentheses of VALUES tuples: each tuple is "(DATE..."
    const tupleMatches = insertSql.match(/\(DATE '/g);
    expect(tupleMatches?.length).toBe(SPECS.length);
  });

  it('empty specs array produces an INSERT with no tuple data (caller must guard against calling with 0 specs)', () => {
    // buildKpiInsertSql is a pure SQL builder; the guard (skip when 0 specs)
    // lives in writeSegmentKpiSnapshot, not here. When called with empty specs
    // the builder produces a syntactically correct INSERT with no VALUES rows.
    const { insertSql } = buildKpiInsertSql({
      specs: [],
      memberCount: 0,
      snapshotDate: DATE,
      snapshotTs: TS,
      gameId: GAME,
      segmentId: SEG,
    });
    expect(insertSql).toContain('INSERT INTO');
    // No tuple date literals emitted — the VALUES list is empty.
    expect(insertSql).not.toContain(`DATE '${DATE}'`);
  });
});

describe('buildKpiInsertSql — NULL safety', () => {
  it('renders null value as SQL NULL (not 0 or empty string)', () => {
    const { insertSql } = buildKpiInsertSql({
      specs: [{ metricId: 'mf_users.arppu_vnd', metricLabel: 'ARPPU', value: null }],
      memberCount: 0,
      snapshotDate: DATE,
      snapshotTs: TS,
      gameId: GAME,
      segmentId: SEG,
    });
    // The value position in the tuple should be NULL not '0' or "''"
    expect(insertSql).toContain(', NULL,');
  });

  it('renders a non-null numeric value as a raw number (no quotes)', () => {
    const { insertSql } = buildKpiInsertSql({
      specs: [{ metricId: 'mf_users.user_count', metricLabel: 'Count', value: 99.5 }],
      memberCount: 100,
      snapshotDate: DATE,
      snapshotTs: TS,
      gameId: GAME,
      segmentId: SEG,
    });
    expect(insertSql).toContain('99.5');
    // Must NOT be quoted as a string
    expect(insertSql).not.toContain("'99.5'");
  });

  it('renders zero as 0, not NULL', () => {
    const { insertSql } = buildKpiInsertSql({
      specs: [{ metricId: 'mf_users.user_count', metricLabel: 'Count', value: 0 }],
      memberCount: 0,
      snapshotDate: DATE,
      snapshotTs: TS,
      gameId: GAME,
      segmentId: SEG,
    });
    expect(insertSql).toContain(', 0,');
    // Should not treat 0 as null
    const nullCount = (insertSql.match(/\bNULL\b/g) ?? []).length;
    expect(nullCount).toBe(0);
  });
});

describe('buildKpiInsertSql — slice idempotence', () => {
  const { insertSql, deleteSql } = buildKpiInsertSql({
    specs: SPECS,
    memberCount: MEMBER_COUNT,
    snapshotDate: DATE,
    snapshotTs: TS,
    gameId: GAME,
    segmentId: SEG,
  });

  it('DELETE is keyed on (game_id, segment_id, snapshot_ts)', () => {
    expect(deleteSql).toContain(`'${GAME}'`);
    expect(deleteSql).toContain(`'${SEG}'`);
    expect(deleteSql).toContain(`TIMESTAMP '${TS}'`);
  });

  it('INSERT references the same snapshot_ts and snapshot_date', () => {
    expect(insertSql).toContain(`TIMESTAMP '${TS}'`);
    expect(insertSql).toContain(`DATE '${DATE}'`);
    expect(insertSql).toContain(`'${GAME}'`);
    expect(insertSql).toContain(`'${SEG}'`);
  });

  it('INSERT col list includes member_count', () => {
    expect(insertSql).toContain('member_count');
  });

  it('member_count value appears in each tuple', () => {
    const count = (insertSql.match(new RegExp(String(MEMBER_COUNT), 'g')) ?? []).length;
    expect(count).toBe(SPECS.length);
  });
});

describe('buildKpiInsertSql — string escaping', () => {
  it('escapes single quotes in metric labels', () => {
    const { insertSql } = buildKpiInsertSql({
      specs: [{ metricId: 'mf_users.x', metricLabel: "O'Brien Metric", value: 1 }],
      memberCount: 0,
      snapshotDate: DATE,
      snapshotTs: TS,
      gameId: GAME,
      segmentId: SEG,
    });
    expect(insertSql).toContain("'O''Brien Metric'");
  });
});

describe('buildKpiInsertSql — INSERT column order', () => {
  it('includes all required columns', () => {
    const { insertSql } = buildKpiInsertSql({
      specs: SPECS,
      memberCount: MEMBER_COUNT,
      snapshotDate: DATE,
      snapshotTs: TS,
      gameId: GAME,
      segmentId: SEG,
    });
    const colListMatch = insertSql.match(/INSERT INTO \S+ \(([^)]+)\)/);
    expect(colListMatch).not.toBeNull();
    const cols = colListMatch![1].split(',').map((c) => c.trim());
    expect(cols).toContain('snapshot_date');
    expect(cols).toContain('snapshot_ts');
    expect(cols).toContain('game_id');
    expect(cols).toContain('segment_id');
    expect(cols).toContain('metric_id');
    expect(cols).toContain('metric_label');
    expect(cols).toContain('value');
    expect(cols).toContain('member_count');
  });
});
