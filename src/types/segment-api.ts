/**
 * Shared frontend types for the segments API.
 * These mirror the server-side zod schemas in server/src/types/.
 * Keep in sync manually when the server schema changes.
 */

export type SegmentType = 'manual' | 'predicate';
export type SegmentStatus = 'fresh' | 'refreshing' | 'broken' | 'stale';
/** Unified visibility ladder. `personal` (default) = owner-private; `shared` =
 *  workspace-visible; `org` = org-wide (admin-only to set). */
export type SegmentVisibility = 'personal' | 'shared' | 'org';

export type LeafOperator =
  | 'equals'
  | 'notEquals'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'in'
  | 'notIn'
  | 'contains'
  | 'set'
  | 'notSet'
  | 'inDateRange'
  | 'beforeDate'
  | 'afterDate'
  // Derived relative-date (tenure / recency, resolved against an as-of anchor):
  | 'dateWithinLast'
  | 'dateBeforeLast'
  // Statistical / percentile (two-pass cutoff over a reference population):
  | 'percentileGte'
  | 'percentileLte';

export type LeafValueType = 'string' | 'number' | 'time' | 'boolean';

/** Value carried by `dateWithinLast` / `dateBeforeLast`. */
export interface RelativeDateValue {
  n: number;
  unit: 'day' | 'week' | 'month';
}

/** Reference population a percentile cutoff is computed over (not the cohort). */
export interface PopulationRef {
  table?: string;
  column?: string;
}

/** Value carried by `percentileGte` / `percentileLte`. */
export interface PercentileValue {
  p: number;
  over?: PopulationRef;
}

export interface LeafNode {
  kind: 'leaf';
  id: string;
  member: string;
  type: LeafValueType;
  op: LeafOperator;
  values: unknown[];
}

export interface GroupNode {
  kind: 'group';
  id: string;
  op: 'AND' | 'OR';
  children: PredicateNode[];
}

export type PredicateNode = GroupNode | LeafNode;

/** One member of an LTV tier. `ltv` null = measure cell missing → render "—".
 *  `name` = refresh-time in-game name (when the game models one), stored with
 *  the uid so the Members tab shows the friendly identity without a view-time
 *  live query. Absent on games with no name dim, or on tiers computed before
 *  this field existed (those fall back to the live dim query, then the uid). */
export interface TierMember {
  uid: string;
  ltv: number | null;
  name?: string | null;
}

/** `all` replaces the trio for degenerate cohorts (≤150 members). */
export type TierName = 'top' | 'middle' | 'bottom' | 'all';

/** LTV-ranked member subgroups computed server-side at refresh time. */
export interface MemberTiers {
  computed_at: string;
  /** Logical name of the ranking measure (e.g. mf_users.ltv_total_vnd). */
  ltv_measure: string;
  tiers: Partial<Record<TierName, TierMember[]>>;
}

export interface CardCacheEntry {
  rows: Array<Record<string, unknown>>;
  fetched_at: string;
  /** Outcome of the last precompute for this card. Absent on legacy cache rows
   *  written before status tracking — treat missing as 'ok'. */
  status?: 'ok' | 'error';
  /** Failure reason when status='error' (Cube error or "refresh budget exceeded"). */
  error?: string;
}

/** Lakehouse snapshot capture cadence — how often the snapshot job materializes
 *  this segment. Distinct from refresh_cadence_min (cohort recompute). */
export type SnapshotCadence = '15m' | '30m' | '1h' | '3h' | '6h' | '12h' | 'daily';

/** Unified "Track every" cadence — the single operator knob that drives both
 *  the live recompute and the lakehouse capture. `Off` = on-demand only. */
export type TrackCadence = 'Off' | SnapshotCadence;

export interface Segment {
  id: string;
  name: string;
  type: SegmentType;
  owner: string;
  status: SegmentStatus;
  cube: string | null;
  predicate_tree: PredicateNode | null;
  cube_query_json: string | null;
  sql_preview: string | null;
  uid_count: number;
  uid_list: string[];
  tags: string[];
  refresh_cadence_min: number | null;
  /** Capture cadence for the lakehouse snapshot job. NOT NULL in storage
   *  (defaults 'daily'); optional here so test fixtures/builders predating it
   *  still satisfy the type — read it as `snapshot_cadence ?? 'daily'`. */
  snapshot_cadence?: SnapshotCadence;
  /** Unified track cadence — single source of truth the operator sets; the
   *  backend derives refresh_cadence_min + snapshot_cadence from it. Optional
   *  here so fixtures predating it still type-check (read as `?? 'daily'`). */
  track_cadence?: TrackCadence;
  last_refreshed_at: string | null;
  broken_reason: string | null;
  created_at: string;
  updated_at: string;
  game_id: string;
  /** Activation registry for CDP / future destinations. Server hydrates from
   * `activations_json` column; always present (possibly empty) on responses. */
  activations: Activation[];
  /** Pre-rendered preset card rows, keyed by `kpi:<id>` / `card:<tabId>:<id>`. Present on segment-by-id GET only. */
  card_cache?: Record<string, CardCacheEntry>;
  /** Serialised FunnelDefinition. Non-null when segment was created via the funnel builder. */
  funnel_json: string | null;
  /** Visibility ladder. NULL on legacy rows maps to 'personal' server-side. */
  visibility: SegmentVisibility;
  /** Human-readable "shared by …" label stamped at create time. Null on
   *  legacy rows — render `owner` instead. */
  owner_label: string | null;
  /** When the segment was last published via share. Null = never/unshared. */
  shared_at: string | null;
  /** True when the caller is the segment's owner. LITERAL ownership only —
   *  the "shared with you" rail keys off it. Use can_administer to gate
   *  controls. */
  is_owner: boolean;
  /** True when the caller may run owner-level controls (owner OR admin) —
   *  gates edit/delete/share. Mirrors the server's canAdministerSegment. */
  can_administer: boolean;
  /** LTV tiers (detail GET only). Null/absent → fall back to random sample. */
  member_tiers?: MemberTiers | null;
  /** Serving lifecycle: draft (exploration scratch), served (published downstream
   *  contract), deprecated (force-demoted, kept readable but not pullable). Absent
   *  on fixtures predating it → read as 'draft'. */
  lifecycle?: SegmentLifecycle;
  served_at?: string | null;
  served_by?: string | null;
  /** Serving contract — present for served/deprecated rows (null for draft on the
   *  list; always present on detail). */
  serving?: ServingContract | null;
}

export type SegmentLifecycle = 'draft' | 'served' | 'deprecated';

/** A key entitled to pull a served segment (grouped by key; a rotated key is a
 *  new id). */
export interface EntitledKey {
  id: string;
  label: string;
  appliesVia: 'segment' | 'all-segments';
  lastUsedAt: string | null;
}

/** Computed serving contract surfaced on the segment detail + served list rows. */
export interface ServingContract {
  lifecycle: SegmentLifecycle;
  servedAt: string | null;
  servedBy: string | null;
  cadence: TrackCadence;
  lastSnapshotAt: string | null;
  /** UTC ISO of the next snapshot ready to pull (clamped to the GMT+7 window);
   *  null when cadence is 'Off'. */
  nextReadyAt: string | null;
  snapshotEnabled: boolean;
  /** Keys entitled by scope (NOT the actual-consumer count, which is audit-derived
   *  and lives on the consumption endpoint). */
  entitledCount: number;
  entitled: EntitledKey[];
}

// ── Consumption observability (admin-only) ──────────────────────────────────

export interface ConsumptionSummary {
  pulls: number;
  /** Distinct keys that ACTUALLY pulled (audit-derived), not entitled scope. */
  consumingKeys: number;
  rowsLastPull: number;
  /** Over instrumented pulls only; null when there are none → UI shows "—". */
  successRate: number | null;
  p95LatencyMs: number | null;
  avgFreshnessMs: number | null;
  windowStart: string;
}

export interface ConsumptionByKey {
  keyId: string;
  label: string;
  pulls: number;
  lastPullAt: string | null;
  rowsLast: number;
  lastHttpStatus: number | null;
}

export interface ConsumptionDailyPoint {
  date: string;
  keyId: string;
  pulls: number;
}

export interface ConsumptionStatusBreakdown {
  ok: number;
  no_snapshot: number;
  rate_limited: number;
}

export interface RecentPull {
  id: number;
  keyId: string;
  label: string;
  startedAt: string;
  httpStatus: number | null;
  errorCode: string | null;
  format: string | null;
  pageIndex: number | null;
  rows: number;
  snapshotTs: string | null;
  latencyMs: number | null;
}

export interface SegmentConsumption {
  summary: ConsumptionSummary;
  byKey: ConsumptionByKey[];
  dailyByKey: ConsumptionDailyPoint[];
  statusBreakdown: ConsumptionStatusBreakdown;
  recentPulls: RecentPull[];
  recentCursor: number | null;
}

export interface SegmentPullLogPage {
  items: RecentPull[];
  nextCursor: number | null;
}

export interface SegmentTokenInfo {
  id: string;
  label: string;
  appliesVia: 'segment' | 'all-segments';
  lastUsedAt: string | null;
  everPulled: boolean;
}

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

export interface ActivationInput {
  env: ActivationEnv;
  metric_name: string;
  game_id?: string;
  destination?: ActivationDestination;
  status?: ActivationStatus;
}

export interface RefreshLogRow {
  id: number;
  segment_id: string;
  ts: string;
  uid_count: number;
  status: string;
  // What triggered the refresh: 'cron' | 'manual' | 'create' | 'edit'. Rows
  // written before the source column existed report 'unknown'.
  source?: string;
}

export interface GameDef {
  id: string;
  name: string;
  mark?: string;
  color?: string;
}

export interface GamesConfig {
  defaultGameId: string;
  games: GameDef[];
}

export interface SegmentInput {
  name: string;
  type: SegmentType;
  cube?: string | null;
  tags?: string[];
  predicate_tree?: PredicateNode | null;
  uid_list?: string[];
  refresh_cadence_min?: number | null;
  game_id?: string;
  /** Serialised FunnelDefinition when creating via the funnel builder. */
  funnel_json?: string | null;
  /**
   * Cube-level segments from the originating query (e.g. mf_users.whales).
   * Not representable in the predicate tree — the server stores them as a
   * `segments` sidecar in cube_query_json so Live refreshes keep the scope.
   */
  cube_segments?: string[] | null;
  /** Defaults to 'personal' server-side; 'org' requires admin. */
  visibility?: SegmentVisibility;
  /**
   * Lineage — the exploration this cohort was crystallized from (the "Build
   * segment from this" bridge / "save that as a segment" chat turn). Persisted
   * as the segment's `born_from` so the cohort remembers its origin.
   */
  born_from?: {
    artifact_id?: string;
    question?: string;
    cube_query?: unknown;
  };
}

export interface SegmentPatch {
  name?: string;
  /** Changing type to 'predicate' converts a manual segment to live — requires
   *  a predicate_tree in the same request. The server auto-enqueues a refresh. */
  type?: SegmentType;
  cube?: string | null;
  tags?: string[];
  predicate_tree?: PredicateNode | null;
  uid_list?: string[];
  refresh_cadence_min?: number | null;
  /** Set the lakehouse snapshot capture cadence (15m–daily). */
  snapshot_cadence?: SnapshotCadence;
  /** Set the unified "Track every" cadence — the single knob. The server
   *  dual-writes refresh_cadence_min + snapshot_cadence from it. Prefer this
   *  over setting the two legacy fields directly. */
  track_cadence?: TrackCadence;
  /** Owner may set personal/shared; 'org' requires admin. */
  visibility?: SegmentVisibility;
  /**
   * Cube-level named segments (SQL snippets from the data model) to attach as
   * scope sidecar. Owner/admin only. Omitting preserves the existing sidecar.
   */
  cube_segments?: string[] | null;
}

export interface SegmentAnalysis {
  id: string;
  segment_id: string;
  title: string;
  owner: string;
  query_json: string | null;
  layout_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface CubeIdentityMapping {
  cube: string;
  identity_field: string | null;
  source: 'manual' | 'auto' | 'auto-suggest';
  confidence: number | null;
  updated_at: string | null;
  is_suggested?: boolean;
  matched_pattern?: string | null;
}

export interface PresetTab {
  id: string;
  label: string;
}

export interface Preset {
  id: string;
  label: string;
  description?: string;
  tabs: PresetTab[];
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
