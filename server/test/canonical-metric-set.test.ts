/**
 * Pure-logic tests for the canonical metric set: KPI spec derivation from the
 * preset registry (dedupe by measure), stable column ordering, and per-game
 * /meta pruning. No Trino / no DB — the registry loads from the YAML bundles.
 */

import { describe, it, expect } from 'vitest';
import {
  CANONICAL_USER_STATE_COLUMNS,
  STATE_VALUE_COLUMNS,
  sqlTypeFor,
  pruneColumnsForGame,
  segmentKpiSpecsForPreset,
} from '../src/lakehouse/canonical-metric-set.js';
import type { MetaMemberSets } from '../src/services/cube-meta-members.js';

describe('CANONICAL_USER_STATE_COLUMNS', () => {
  it('leads with uid (identity, no fixed member) and only dimensions', () => {
    expect(CANONICAL_USER_STATE_COLUMNS[0]).toMatchObject({
      key: 'uid',
      member: null,
      kind: 'dimension',
    });
    // mf_users is a per-user dimensional table — every state column is a dim.
    for (const c of CANONICAL_USER_STATE_COLUMNS) expect(c.kind).toBe('dimension');
  });

  it('STATE_VALUE_COLUMNS is the canonical set minus uid, order preserved', () => {
    expect(STATE_VALUE_COLUMNS.map((c) => c.key)).toEqual(
      CANONICAL_USER_STATE_COLUMNS.filter((c) => c.key !== 'uid').map((c) => c.key),
    );
    expect(STATE_VALUE_COLUMNS.find((c) => c.key === 'uid')).toBeUndefined();
  });

  it('has unique keys and known sqlTypes', () => {
    const keys = CANONICAL_USER_STATE_COLUMNS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of CANONICAL_USER_STATE_COLUMNS) {
      expect(['VARCHAR', 'DOUBLE', 'BIGINT', 'DATE']).toContain(sqlTypeFor(c));
    }
  });
});

describe('pruneColumnsForGame', () => {
  const prefix = null;
  const allMembers = CANONICAL_USER_STATE_COLUMNS.flatMap((c) =>
    c.member ? [c.member] : [],
  );

  it('keeps uid and every present member when /meta has them all', () => {
    const meta: MetaMemberSets = {
      dimensions: new Set(allMembers),
      measures: new Set<string>(),
    };
    const kept = pruneColumnsForGame(CANONICAL_USER_STATE_COLUMNS, meta, prefix);
    expect(kept.map((c) => c.key)).toEqual(CANONICAL_USER_STATE_COLUMNS.map((c) => c.key));
  });

  it('drops a column whose member is absent (jus-style engagement_segment), keeps uid', () => {
    const meta: MetaMemberSets = {
      dimensions: new Set(allMembers.filter((m) => m !== 'mf_users.engagement_segment')),
      measures: new Set<string>(),
    };
    const kept = pruneColumnsForGame(CANONICAL_USER_STATE_COLUMNS, meta, prefix);
    expect(kept.find((c) => c.key === 'engagement_segment')).toBeUndefined();
    expect(kept.find((c) => c.key === 'uid')).toBeDefined();
  });

  it('null metaSets keeps every column (legacy posture)', () => {
    const kept = pruneColumnsForGame(CANONICAL_USER_STATE_COLUMNS, null, prefix);
    expect(kept.length).toBe(CANONICAL_USER_STATE_COLUMNS.length);
  });
});

describe('segmentKpiSpecsForPreset', () => {
  it('returns headline + tab KPIs deduped by measure for mf_users-hub', () => {
    const specs = segmentKpiSpecsForPreset('mf_users-hub');
    const measures = specs.map((s) => s.measure);
    // No duplicate measure refs.
    expect(new Set(measures).size).toBe(measures.length);
    // Headline measures present.
    expect(measures).toContain('mf_users.user_count');
    expect(measures).toContain('mf_users.paying_users');
    expect(measures).toContain('mf_users.ltv_total_vnd');
    expect(measures).toContain('mf_users.arpu_vnd');
    // Tab-only KPIs present (deduped union, not just headline).
    expect(measures).toContain('mf_users.paying_users_30d');
    expect(measures).toContain('mf_users.paying_rate_30d');
    expect(measures).toContain('mf_users.whales_count');
    expect(measures).toContain('mf_users.ltv_30d_total_vnd');
    expect(measures).toContain('mf_users.arppu_vnd');
    expect(measures).toContain('mf_users.lapsed_this_month_count');
  });

  it('unknown preset → empty list (writer skips with reason)', () => {
    expect(segmentKpiSpecsForPreset('does-not-exist')).toEqual([]);
  });
});
