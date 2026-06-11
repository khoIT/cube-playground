import type { PredicateNode } from './predicate-tree.js';

export type SegmentType = 'manual' | 'predicate';
export type SegmentStatus = 'fresh' | 'refreshing' | 'broken' | 'stale';

export type ActivationStatus = 'active' | 'failed' | 'pending';
export type ActivationEnv = 'dev' | 'stag' | 'prod';
export type ActivationDestination = 'cdp';

export interface Activation {
  id: string;
  destination: ActivationDestination;
  game_id: string;
  env: ActivationEnv;
  metric_name: string;
  registered_at: string;
  last_pushed_at: string | null;
  status: ActivationStatus;
  last_error?: string;
}

/** One member of an LTV tier. `ltv` is null when the measure cell was
 *  missing/unparseable — render "—", never NaN. */
export interface TierMember {
  uid: string;
  ltv: number | null;
}

/** `all` is used for degenerate cohorts (≤150 members) instead of the trio. */
export type TierName = 'top' | 'middle' | 'bottom' | 'all';

/** LTV-ranked member subgroups computed at refresh time (member_tiers_json). */
export interface MemberTiers {
  computed_at: string;
  /** Logical name of the measure the ranking used (e.g. mf_users.ltv_total_vnd). */
  ltv_measure: string;
  tiers: Partial<Record<TierName, TierMember[]>>;
}

/** One column of the ranked member-profile snapshot. `key` is the row-object
 *  key (snake_cased preset column id: `last-active` → `last_active`). */
export interface MemberProfileColumn {
  key: string;
  label: string;
  /** Cube member the column was loaded from, as stored in the preset. */
  field: string;
  format?: string;
}

/**
 * Ranked, enriched member snapshot (member_profiles_json): up to
 * MEMBER_PROFILE_LIMIT members ordered by `rank_measure` desc, each row keyed
 * `{ uid, <column.key>: value }`. Computed at refresh time so the pull API
 * serves it with zero per-request Cube cost.
 */
export interface MemberProfiles {
  computed_at: string;
  /** Measure the ranking used; null = unranked (identity order). */
  rank_measure: string | null;
  columns: MemberProfileColumn[];
  rows: Array<Record<string, unknown> & { uid: string }>;
}

export interface Segment {
  id: string;
  name: string;
  type: SegmentType;
  owner: string;
  /** Human-readable "shared by …" label stamped at create time. NULL on
   *  legacy rows — consumers fall back to `owner`. */
  owner_label: string | null;
  /** When the segment was last published via /share. NULL = never/unshared. */
  shared_at: string | null;
  status: SegmentStatus;
  cube: string | null;
  predicate_tree_json: string | null;
  cube_query_json: string | null;
  sql_preview: string | null;
  uid_count: number;
  uid_list_json: string;
  refresh_cadence_min: number | null;
  last_refreshed_at: string | null;
  broken_reason: string | null;
  created_at: string;
  updated_at: string;
  game_id: string;
  activations_json: string;
  // hydrated fields (not in DB columns directly)
  tags?: string[];
  predicate_tree?: PredicateNode | null;
  activations?: Activation[];
  /** Parsed member_tiers_json; detail route only. Null = no tiers computed. */
  member_tiers?: MemberTiers | null;
}

export interface SegmentInput {
  name: string;
  type: SegmentType;
  owner?: string;
  cube?: string | null;
  tags?: string[];
  predicate_tree?: PredicateNode | null;
  uid_list?: string[];
  refresh_cadence_min?: number | null;
  game_id?: string;
}

export interface SegmentPatch {
  name?: string;
  cube?: string | null;
  tags?: string[];
  predicate_tree?: PredicateNode | null;
  uid_list?: string[];
  refresh_cadence_min?: number | null;
  status?: SegmentStatus;
  broken_reason?: string | null;
  sql_preview?: string | null;
}
