/**
 * Canonical metric set for segment snapshots — the single source of truth for:
 *
 *   (a) CANONICAL_USER_STATE_COLUMNS — the per-uid state-table schema. Every row
 *       in segment_member_state_daily carries these columns; the DDL (schema) and
 *       the state writer (INSERT) both iterate the SAME ordered array so the
 *       table and the writer can never positionally drift.
 *   (b) segmentKpiSpecsForPreset — the segment-level KPI list persisted as a
 *       time-series in segment_kpi_daily, sourced from the in-memory preset
 *       registry (headline + per-tab scalar KPIs), so the persisted numbers match
 *       what the Insights tab renders with zero duplication of the YAML.
 *
 * Why every state column is a DIMENSION: mf_users is a per-user dimensional
 * table (1 row per user). Per-user values — ltv_vnd, total_active_days,
 * lifecycle_stage — are exposed as Cube dimensions, not measures (the aggregate
 * measures like ltv_total_vnd power the KPIs instead). So a predicate-free
 * projection of these columns is dimensions:[identity, ...cols], measures:[] —
 * one GROUP BY, exactly the membership writer's shape but wider.
 *
 * Per-game pruning: a column whose physical member is absent from a game's /meta
 * is dropped to NULL (never a hard failure) — e.g. engagement_segment exists in
 * cfm_vn but not jus_vn. Reuses the same /meta existence check the Members tab
 * uses (cube-member-resolver.physicalMember + MetaMemberSets).
 */

import type { MetaMemberSets } from '../services/cube-meta-members.js';
import { physicalMember } from '../services/cube-member-resolver.js';
import type { KpiSpec } from '../presets/mf-users-hub.js';
import { presetRegistry } from '../presets/registry.js';

export type UserStateColumnKind = 'dimension' | 'measure';
export type UserStateSqlType = 'VARCHAR' | 'DOUBLE' | 'BIGINT' | 'DATE';

export interface UserStateColumn {
  /** Lakehouse column name + the canonical key the writer aliases the Cube
   *  member to (positionally stable). */
  key: string;
  /** Logical Cube member (cube.field). null for `uid`, whose member is the
   *  segment's identity dimension, resolved per cube at write time. */
  member: string | null;
  kind: UserStateColumnKind;
  sqlType: UserStateSqlType;
}

/**
 * The canonical per-user state columns, in the fixed positional order the DDL
 * and the INSERT both follow. `uid` leads (its member is the per-cube identity
 * dim); the rest are mf_users per-user dimensions. Members re-verified present
 * in cfm_vn + jus_vn mf_users models (engagement_segment is cfm-only → pruned
 * to NULL for jus). A missing member is pruned, never an error.
 */
export const CANONICAL_USER_STATE_COLUMNS: readonly UserStateColumn[] = [
  { key: 'uid', member: null, kind: 'dimension', sqlType: 'VARCHAR' },
  { key: 'ingame_name', member: 'mf_users.ingame_name', kind: 'dimension', sqlType: 'VARCHAR' },
  { key: 'ltv_vnd', member: 'mf_users.ltv_vnd', kind: 'dimension', sqlType: 'DOUBLE' },
  { key: 'ltv_30d_vnd', member: 'mf_users.ltv_30d_vnd', kind: 'dimension', sqlType: 'DOUBLE' },
  { key: 'is_paying_user', member: 'mf_users.is_paying_user', kind: 'dimension', sqlType: 'VARCHAR' },
  { key: 'is_paying_30d', member: 'mf_users.is_paying_30d', kind: 'dimension', sqlType: 'VARCHAR' },
  { key: 'total_active_days', member: 'mf_users.total_active_days', kind: 'dimension', sqlType: 'BIGINT' },
  { key: 'days_since_last_active', member: 'mf_users.days_since_last_active', kind: 'dimension', sqlType: 'BIGINT' },
  { key: 'days_since_last_recharge', member: 'mf_users.days_since_last_recharge', kind: 'dimension', sqlType: 'BIGINT' },
  { key: 'max_role_level', member: 'mf_users.max_role_level', kind: 'dimension', sqlType: 'BIGINT' },
  { key: 'lifecycle_stage', member: 'mf_users.lifecycle_stage', kind: 'dimension', sqlType: 'VARCHAR' },
  { key: 'churn_risk', member: 'mf_users.churn_risk', kind: 'dimension', sqlType: 'VARCHAR' },
  { key: 'engagement_segment', member: 'mf_users.engagement_segment', kind: 'dimension', sqlType: 'VARCHAR' },
  { key: 'payer_tier', member: 'mf_users.payer_tier', kind: 'dimension', sqlType: 'VARCHAR' },
  { key: 'country', member: 'mf_users.country', kind: 'dimension', sqlType: 'VARCHAR' },
  { key: 'os_platform', member: 'mf_users.os_platform', kind: 'dimension', sqlType: 'VARCHAR' },
  { key: 'last_active_date', member: 'mf_users.last_active_date', kind: 'dimension', sqlType: 'DATE' },
  { key: 'install_date', member: 'mf_users.install_date', kind: 'dimension', sqlType: 'DATE' },
];

/** uid is keyed/typed separately by every consumer (it leads the DDL alongside
 *  snapshot_date/_ts/game/segment). These are the value columns the DDL and the
 *  writer iterate after uid, in stable order. */
export const STATE_VALUE_COLUMNS: readonly UserStateColumn[] =
  CANONICAL_USER_STATE_COLUMNS.filter((c) => c.key !== 'uid');

/** The Trino column type for a state column (indirection point if a column ever
 *  needs a CAST wrapper). */
export function sqlTypeFor(col: UserStateColumn): UserStateSqlType {
  return col.sqlType;
}

/**
 * Drop state columns whose physical member is absent from the game's /meta
 * (mirrors member-profile-runner's column check). `uid` is always kept — its
 * member is the resolved identity dim, not an mf_users field. metaSets null
 * (catalog unavailable) keeps all columns (legacy posture).
 */
export function pruneColumnsForGame(
  columns: readonly UserStateColumn[],
  metaSets: MetaMemberSets | null,
  prefix: string | null,
): UserStateColumn[] {
  if (!metaSets) return [...columns];
  return columns.filter((c) => {
    if (c.member == null) return true; // uid / identity — always present
    const known = c.kind === 'dimension' ? metaSets.dimensions : metaSets.measures;
    return known.has(physicalMember(c.member, prefix));
  });
}

/**
 * The segment-level KPIs to persist as a time-series for a preset: the union of
 * its headline KPIs and every tab's scalar KPIs, deduped by measure ref (first
 * spec wins so the headline label/format is preferred). Card breakdowns
 * (line/bar/composition) are NOT persisted in v1 — distribution trends derive
 * from per-user state. Sourced from the loaded registry, never the raw YAML.
 */
export function segmentKpiSpecsForPreset(presetId: string): KpiSpec[] {
  const preset = presetRegistry[presetId];
  if (!preset) return [];
  const all: KpiSpec[] = [
    ...preset.headlineKpis,
    ...preset.tabs.flatMap((t) => t.kpis),
  ];
  const seen = new Set<string>();
  const out: KpiSpec[] = [];
  for (const spec of all) {
    if (seen.has(spec.measure)) continue;
    seen.add(spec.measure);
    out.push(spec);
  }
  return out;
}
