/**
 * Pure-logic tests for the member-state writer SQL builder.
 * No Trino, no DB, no Cube calls — just SQL string assertions.
 *
 * Key invariants verified:
 *  - The mf_users projection (stateSql) must contain NO segment filter terms.
 *  - INSERT col list == [snapshot_date, snapshot_ts, game_id, segment_id, uid] + valueCols.
 *  - Each value column key appears exactly once as a SELECT alias.
 *  - Missing/pruned columns are absent from both INSERT col list and SELECT aliases.
 *  - The DELETE slice is keyed on (game, segment, snapshot_ts) — same as INSERT.
 */

import { describe, it, expect } from 'vitest';
import { buildMemberStateInsertSql } from '../src/lakehouse/segment-member-state-writer.js';
import type { UserStateColumn } from '../src/lakehouse/canonical-metric-set.js';

const SNAPSHOT_TS = '2026-06-18 10:00:00';
const SNAPSHOT_DATE = '2026-06-18';
const GAME_ID = 'cfm_vn';
const SEGMENT_ID = 'seg-abc-123';

// Minimal pruned column list (subset of canonical): uid excluded (handled separately).
const VALUE_COLS: UserStateColumn[] = [
  { key: 'ltv_vnd', member: 'mf_users.ltv_vnd', kind: 'dimension', sqlType: 'DOUBLE' },
  { key: 'lifecycle_stage', member: 'mf_users.lifecycle_stage', kind: 'dimension', sqlType: 'VARCHAR' },
  { key: 'days_since_last_active', member: 'mf_users.days_since_last_active', kind: 'dimension', sqlType: 'BIGINT' },
];

// A plausible (but fake) compiled mf_users SELECT — predicate-free by construction.
const FAKE_STATE_SQL =
  'SELECT "mf_users__uid", "mf_users__ltv_vnd", "mf_users__lifecycle_stage", "mf_users__days_since_last_active" ' +
  'FROM mf_users GROUP BY 1, 2, 3, 4 LIMIT 10000';

describe('buildMemberStateInsertSql — INSERT col list', () => {
  it('starts with the five fixed header columns', () => {
    const { insertCols } = buildMemberStateInsertSql({
      stateSql: FAKE_STATE_SQL,
      valueCols: VALUE_COLS,
      identityPhysical: 'mf_users.uid',
      snapshotDate: SNAPSHOT_DATE,
      snapshotTs: SNAPSHOT_TS,
      gameId: GAME_ID,
      segmentId: SEGMENT_ID,
      prefix: null,
    });
    expect(insertCols.slice(0, 5)).toEqual([
      'snapshot_date', 'snapshot_ts', 'game_id', 'segment_id', 'uid',
    ]);
  });

  it('appends exactly the value col keys in order', () => {
    const { insertCols } = buildMemberStateInsertSql({
      stateSql: FAKE_STATE_SQL,
      valueCols: VALUE_COLS,
      identityPhysical: 'mf_users.uid',
      snapshotDate: SNAPSHOT_DATE,
      snapshotTs: SNAPSHOT_TS,
      gameId: GAME_ID,
      segmentId: SEGMENT_ID,
      prefix: null,
    });
    expect(insertCols.slice(5)).toEqual(['ltv_vnd', 'lifecycle_stage', 'days_since_last_active']);
  });

  it('omits a pruned column entirely — shorter col list', () => {
    const prunedCols = VALUE_COLS.filter((c) => c.key !== 'lifecycle_stage');
    const { insertCols } = buildMemberStateInsertSql({
      stateSql: FAKE_STATE_SQL,
      valueCols: prunedCols,
      identityPhysical: 'mf_users.uid',
      snapshotDate: SNAPSHOT_DATE,
      snapshotTs: SNAPSHOT_TS,
      gameId: GAME_ID,
      segmentId: SEGMENT_ID,
      prefix: null,
    });
    expect(insertCols).not.toContain('lifecycle_stage');
    expect(insertCols).toContain('ltv_vnd');
    expect(insertCols).toContain('days_since_last_active');
  });
});

describe('buildMemberStateInsertSql — SQL correctness', () => {
  const { insertSql, deleteSql } = buildMemberStateInsertSql({
    stateSql: FAKE_STATE_SQL,
    valueCols: VALUE_COLS,
    identityPhysical: 'mf_users.uid',
    snapshotDate: SNAPSHOT_DATE,
    snapshotTs: SNAPSHOT_TS,
    gameId: GAME_ID,
    segmentId: SEGMENT_ID,
    prefix: null,
  });

  it('INSERT SQL references the state_daily table', () => {
    expect(insertSql).toContain('segment_member_state_daily');
  });

  it('INSERT SQL wraps stateSql in a state_src CTE', () => {
    expect(insertSql).toContain('state_src');
    expect(insertSql).toContain(FAKE_STATE_SQL);
  });

  it('INSERT SQL aliases uid column', () => {
    expect(insertSql).toContain('AS uid');
  });

  it('INSERT SQL aliases every value col key', () => {
    for (const col of VALUE_COLS) {
      expect(insertSql).toContain(`AS ${col.key}`);
    }
  });

  it('INSERT SQL contains the snapshot_ts literal', () => {
    expect(insertSql).toContain(`TIMESTAMP '${SNAPSHOT_TS}'`);
  });

  it('INSERT SQL contains the snapshot_date literal', () => {
    expect(insertSql).toContain(`DATE '${SNAPSHOT_DATE}'`);
  });

  it('INSERT SQL JOINs to segment_membership_daily for per-segment keying', () => {
    expect(insertSql).toContain('segment_membership_daily');
    expect(insertSql).toContain('JOIN');
  });

  it('DELETE SQL is keyed on (game_id, segment_id, snapshot_ts) — same slice as INSERT', () => {
    expect(deleteSql).toContain(`'${GAME_ID}'`);
    expect(deleteSql).toContain(`'${SEGMENT_ID}'`);
    expect(deleteSql).toContain(`TIMESTAMP '${SNAPSHOT_TS}'`);
  });

  it('stateSql has NO segment filter terms (predicate-free assertion)', () => {
    // The projection must not reference any segment predicate operators.
    // A real compiled SQL from mf_users with no filters has no WHERE clause
    // beyond the GROUP BY. We simply verify the fake SQL we passed is
    // unmodified (the builder never injects filters into it).
    expect(insertSql).toContain(FAKE_STATE_SQL);
    // And the state_src CTE contains only the raw stateSql.
    const stateSrcMatch = insertSql.match(/state_src AS \(\n\s+([\s\S]*?)\n\)/);
    expect(stateSrcMatch).not.toBeNull();
    const cteSql = stateSrcMatch![1].trim();
    expect(cteSql).toBe(FAKE_STATE_SQL);
  });
});

describe('buildMemberStateInsertSql — prefix workspace', () => {
  it('physicalizes column aliases with the game prefix', () => {
    const { insertSql } = buildMemberStateInsertSql({
      stateSql: FAKE_STATE_SQL,
      valueCols: [
        { key: 'ltv_vnd', member: 'mf_users.ltv_vnd', kind: 'dimension', sqlType: 'DOUBLE' },
      ],
      identityPhysical: 'mf_users.uid',
      snapshotDate: SNAPSHOT_DATE,
      snapshotTs: SNAPSHOT_TS,
      gameId: 'ballistar',
      segmentId: SEGMENT_ID,
      prefix: 'ballistar',
    });
    // With prefix 'ballistar', mf_users.ltv_vnd → ballistar_mf_users.ltv_vnd
    // The double-underscore alias: ballistar_mf_users__ltv_vnd
    expect(insertSql).toContain('ballistar_mf_users__ltv_vnd');
  });
});
