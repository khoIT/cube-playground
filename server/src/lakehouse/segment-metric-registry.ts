/**
 * Per-game metric→mart bindings for segment metric-movement reads
 * (membership@day ⨝ fact@day). Entries exist ONLY for (game, mart) pairs whose
 * live join probe PASSED (membership uid ⨝ mart user_id matched on real data) —
 * eligibility is gated by evidence, not by the mart merely existing. ballistar
 * also probe-passed and can be added as two rows when wanted (short history:
 * marts start 2026-05-07); muaw/pubgm await membership snapshots; ptg marts
 * are stale (frozen 2023-08-31).
 *
 * Scope v1: mart-backed metrics only. Cube-model-internal derived metrics
 * (measure SQL living in YAML) are NOT representable here — they'd need the
 * Cube /sql compile path, out of scope for the registry.
 *
 * Identity note: membership uid namespace = the segment's resolved identity
 * dim, and the probes proved it matches `user_id` in these std marts directly
 * for both games (jus uids carry the @vng_vie… suffix on BOTH sides). A future
 * jus segment snapshotting BARE uids (mf_users-defined) would zero-join — the
 * reader emits a runtime warning when memberCount ≫ joined rows.
 */

export type MetricAgg = 'sum' | 'count_members';

export interface MetricBinding {
  metricKey: string;
  label: string;
  /** Bare mart table name, resolved under the game's Trino schema. */
  mart: string;
  uidCol: string;
  dateCol: string;
  /** Column summed when agg='sum'; ignored for count_members. */
  valueCol: string | null;
  agg: MetricAgg;
  unit: string;
}

const STD_ACTIVE = 'std_ingame_user_active_daily';
const STD_RECHARGE = 'std_ingame_user_recharge_daily';

function gameBindings(): MetricBinding[] {
  return [
    {
      metricKey: 'revenue',
      label: 'Revenue (VND)',
      mart: STD_RECHARGE,
      uidCol: 'user_id',
      dateCol: 'log_date',
      valueCol: 'ingame_total_recharge_value_vnd',
      agg: 'sum',
      unit: 'VND',
    },
    {
      metricKey: 'active_members',
      label: 'Active members',
      mart: STD_ACTIVE,
      uidCol: 'user_id',
      dateCol: 'log_date',
      valueCol: null,
      agg: 'count_members',
      unit: 'members',
    },
  ];
}

/** Keyed by canonical game id (the value stored on segments.game_id). */
export const SEGMENT_METRIC_REGISTRY: Record<string, MetricBinding[]> = {
  cfm_vn: gameBindings(),
  jus_vn: gameBindings(),
};

export function listEligibleMetrics(gameId: string): MetricBinding[] {
  return SEGMENT_METRIC_REGISTRY[gameId] ?? [];
}

export function resolveMetricBinding(gameId: string, metricKey: string): MetricBinding | null {
  return listEligibleMetrics(gameId).find((b) => b.metricKey === metricKey) ?? null;
}
