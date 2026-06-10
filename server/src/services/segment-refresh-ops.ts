/**
 * Read-side derivation + watchdog for the segment-refresh cron monitor.
 *
 * The segment cron (cron-runner.ts) recomputes predicate-segment cohorts + KPI
 * cards on a cadence. Nothing today surfaces whether that background job is
 * healthy, wedged, or quietly serving stale/erroring data. This module derives
 * that picture from existing tables (no new persistence) and provides the wedge
 * watchdog that self-heals rows stuck in 'refreshing'.
 *
 * Two signals that exist nowhere else and motivate the whole monitor:
 *   - `wedged`   — a row stuck in 'refreshing' past a sane threshold. The queue
 *                  is in-memory, so a refreshing row at rest is an orphan; the
 *                  cron's listDueSegments() skips it, so without recovery it
 *                  rots until the next process boot.
 *   - `degraded` — cohort refreshed fine, but K of N KPI cards are erroring
 *                  (cold-query timeout / unbuilt rollup). Cards keep serving
 *                  last-good (card-cache-store preserves it), so the segment
 *                  looks green while individual cards are silently frozen.
 *
 * Wedge threshold = max(cadence, WEDGE_FLOOR_MIN) so a legitimately long refresh
 * (e.g. a multi-million-uid cohort) is never falsely flagged or auto-killed.
 */

import { getDb } from '../db/sqlite.js';
import { reconcileSegmentRefreshing } from './segment-status.js';
import { currentlyProcessing } from '../jobs/refresh-queue.js';

const MIN = 60_000;

/** Floor for the wedge threshold, in minutes. Env-overridable. */
export const WEDGE_FLOOR_MIN = Number(process.env.SEGMENT_REFRESH_WEDGE_FLOOR_MIN) || 10;

/**
 * Whether the cron-tick watchdog auto-reconciles wedged rows. Default on. Set
 * SEGMENT_REFRESH_WATCHDOG_ENABLED=false to make wedges display-only (the UI
 * still flags them; an operator unsticks manually) without a redeploy.
 */
export const WATCHDOG_ENABLED =
  (process.env.SEGMENT_REFRESH_WATCHDOG_ENABLED ?? 'true').toLowerCase() !== 'false';

/** A refreshing row older than this (since it flipped to 'refreshing') is wedged. */
export function wedgeThresholdMs(cadenceMin: number | null): number {
  const cadence = cadenceMin && cadenceMin > 0 ? cadenceMin : WEDGE_FLOOR_MIN;
  return Math.max(cadence, WEDGE_FLOOR_MIN) * MIN;
}

export type DerivedRefreshState =
  | 'healthy'
  | 'due'
  | 'in_flight'
  | 'wedged'
  | 'serving_stale'
  | 'broken'
  | 'degraded';

export interface DeriveInput {
  status: string; // fresh | refreshing | broken | stale
  lastRefreshedAt: string | null;
  /** When the row last changed state — while 'refreshing' this is when it started. */
  updatedAt: string | null;
  cadenceMin: number | null;
  errorCards: number;
  now: number;
}

/**
 * Map raw segment state → derived monitor state. Precedence (highest first):
 * broken → refreshing(wedged|in_flight) → degraded → serving_stale → due → healthy.
 * Pure: no DB access, fully unit-testable.
 */
export function deriveRefreshState(input: DeriveInput): DerivedRefreshState {
  const { status, lastRefreshedAt, updatedAt, cadenceMin, errorCards, now } = input;

  if (status === 'broken') return 'broken';

  if (status === 'refreshing') {
    const startedMs = updatedAt ? Date.parse(updatedAt) : NaN;
    const refreshingAge = Number.isNaN(startedMs) ? 0 : now - startedMs;
    return refreshingAge >= wedgeThresholdMs(cadenceMin) ? 'wedged' : 'in_flight';
  }

  // Serving states (fresh / stale): cohort is up, but cards may be cold-failing.
  if (errorCards > 0) return 'degraded';

  if (status === 'stale') return 'serving_stale';

  // fresh: overdue past cadence (or never refreshed) → due, else healthy.
  if (isOverdue(lastRefreshedAt, cadenceMin, now)) return 'due';
  return 'healthy';
}

function isOverdue(lastRefreshedAt: string | null, cadenceMin: number | null, now: number): boolean {
  if (!lastRefreshedAt) return true; // never refreshed
  if (!cadenceMin || cadenceMin <= 0) return false;
  const lastMs = Date.parse(lastRefreshedAt);
  if (Number.isNaN(lastMs)) return true;
  return now - lastMs >= cadenceMin * MIN;
}

export interface ErroringCard {
  cardId: string;
  error: string | null;
}

export interface SegmentRefreshOpsRow {
  id: string;
  name: string;
  gameId: string;
  workspace: string;
  status: string;
  derivedState: DerivedRefreshState;
  lastRefreshedAt: string | null;
  cadenceMin: number | null;
  /** Age of last successful refresh (ms); null if never refreshed. */
  ageMs: number | null;
  /** How far past cadence (ms); 0 when on time / not applicable. */
  overdueByMs: number;
  uidCount: number;
  brokenReason: string | null;
  cards: { ok: number; error: number; total: number };
  erroringCards: ErroringCard[];
}

export interface CronHeartbeat {
  lastTickAt: string | null;
  tickIntervalMs: number;
  /** ms since last tick; null if cron never ticked. */
  sinceLastTickMs: number | null;
}

export interface SegmentRefreshOpsPayload {
  generatedAt: string;
  cron: CronHeartbeat;
  queue: { processing: boolean; size: number };
  watchdog: { enabled: boolean; wedgeFloorMin: number };
  summary: {
    total: number;
    wedged: number;
    degraded: number;
    servingStale: number;
    broken: number;
    inFlight: number;
    due: number;
    healthy: number;
  };
  segments: SegmentRefreshOpsRow[];
}

interface RawSegmentRow {
  id: string;
  name: string;
  game_id: string;
  workspace: string;
  status: string;
  last_refreshed_at: string | null;
  updated_at: string | null;
  refresh_cadence_min: number | null;
  uid_count: number;
  broken_reason: string | null;
}

interface CardTally {
  ok: number;
  error: number;
  total: number;
}

/** Tally ok/error/total cards per segment in one grouped query. */
function loadCardTallies(): Map<string, CardTally> {
  const rows = getDb()
    .prepare(
      `SELECT segment_id,
              SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS err,
              COUNT(*) AS total
         FROM segment_card_cache
        GROUP BY segment_id`,
    )
    .all() as Array<{ segment_id: string; err: number; total: number }>;
  const map = new Map<string, CardTally>();
  for (const r of rows) {
    const error = Number(r.err) || 0;
    const total = Number(r.total) || 0;
    map.set(r.segment_id, { ok: total - error, error, total });
  }
  return map;
}

/** Load only the erroring cards (id + message) for the given segments. */
function loadErroringCards(segmentIds: string[]): Map<string, ErroringCard[]> {
  const map = new Map<string, ErroringCard[]>();
  if (segmentIds.length === 0) return map;
  const placeholders = segmentIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT segment_id, card_id, error
         FROM segment_card_cache
        WHERE status = 'error' AND segment_id IN (${placeholders})`,
    )
    .all(...segmentIds) as Array<{ segment_id: string; card_id: string; error: string | null }>;
  for (const r of rows) {
    const list = map.get(r.segment_id) ?? [];
    list.push({ cardId: r.card_id, error: r.error });
    map.set(r.segment_id, list);
  }
  return map;
}

/**
 * Assemble the full ops payload. The route supplies the cron heartbeat (lives in
 * cron-runner to avoid an import cycle) + queue introspection. Read-only over
 * segments + segment_card_cache.
 */
export function collectSegmentRefreshOps(opts: {
  now?: number;
  lastTickAt: string | null;
  tickIntervalMs: number;
  queueProcessing: boolean;
  queueSize: number;
}): SegmentRefreshOpsPayload {
  const now = opts.now ?? Date.now();
  const db = getDb();

  const raw = db
    .prepare(
      `SELECT id, name, game_id, workspace, status, last_refreshed_at, updated_at,
              refresh_cadence_min, uid_count, broken_reason
         FROM segments
        WHERE type = 'predicate'
        ORDER BY name COLLATE NOCASE`,
    )
    .all() as RawSegmentRow[];

  const tallies = loadCardTallies();
  const errorSegmentIds = raw
    .filter((r) => (tallies.get(r.id)?.error ?? 0) > 0)
    .map((r) => r.id);
  const erroringBySegment = loadErroringCards(errorSegmentIds);

  const summary = {
    total: raw.length,
    wedged: 0,
    degraded: 0,
    servingStale: 0,
    broken: 0,
    inFlight: 0,
    due: 0,
    healthy: 0,
  };

  const segments: SegmentRefreshOpsRow[] = raw.map((r) => {
    const cards = tallies.get(r.id) ?? { ok: 0, error: 0, total: 0 };
    const derivedState = deriveRefreshState({
      status: r.status,
      lastRefreshedAt: r.last_refreshed_at,
      updatedAt: r.updated_at,
      cadenceMin: r.refresh_cadence_min,
      errorCards: cards.error,
      now,
    });

    const lastMs = r.last_refreshed_at ? Date.parse(r.last_refreshed_at) : NaN;
    const ageMs = Number.isNaN(lastMs) ? null : now - lastMs;
    const cadenceMs = r.refresh_cadence_min && r.refresh_cadence_min > 0
      ? r.refresh_cadence_min * MIN
      : 0;
    const overdueByMs = ageMs != null && cadenceMs > 0 ? Math.max(0, ageMs - cadenceMs) : 0;

    bumpSummary(summary, derivedState);

    return {
      id: r.id,
      name: r.name,
      gameId: r.game_id,
      workspace: r.workspace,
      status: r.status,
      derivedState,
      lastRefreshedAt: r.last_refreshed_at,
      cadenceMin: r.refresh_cadence_min,
      ageMs,
      overdueByMs,
      uidCount: r.uid_count,
      brokenReason: r.broken_reason,
      cards,
      erroringCards: erroringBySegment.get(r.id) ?? [],
    };
  });

  const sinceLastTickMs = opts.lastTickAt ? now - Date.parse(opts.lastTickAt) : null;

  return {
    generatedAt: new Date(now).toISOString(),
    cron: {
      lastTickAt: opts.lastTickAt,
      tickIntervalMs: opts.tickIntervalMs,
      sinceLastTickMs: Number.isNaN(sinceLastTickMs as number) ? null : sinceLastTickMs,
    },
    queue: { processing: opts.queueProcessing, size: opts.queueSize },
    watchdog: { enabled: WATCHDOG_ENABLED, wedgeFloorMin: WEDGE_FLOOR_MIN },
    summary,
    segments,
  };
}

function bumpSummary(s: SegmentRefreshOpsPayload['summary'], state: DerivedRefreshState): void {
  switch (state) {
    case 'wedged': s.wedged++; break;
    case 'degraded': s.degraded++; break;
    case 'serving_stale': s.servingStale++; break;
    case 'broken': s.broken++; break;
    case 'in_flight': s.inFlight++; break;
    case 'due': s.due++; break;
    case 'healthy': s.healthy++; break;
  }
}

/**
 * Wedge watchdog: reconcile every 'refreshing' row older than its wedge
 * threshold back to 'stale', so the next cron tick re-enqueues it. Same op as
 * the boot-time reconcile, but it runs every tick — closing the gap a long-lived
 * gateway leaves when it wedges a row without restarting. No-op when disabled.
 * Returns the ids it reset.
 */
export function runWedgeWatchdog(now: number = Date.now()): string[] {
  if (!WATCHDOG_ENABLED) return [];
  const rows = getDb()
    .prepare(
      `SELECT id, updated_at, refresh_cadence_min
         FROM segments
        WHERE status = 'refreshing'`,
    )
    .all() as Array<{ id: string; updated_at: string | null; refresh_cadence_min: number | null }>;

  // The id the drain loop is actively refreshing right now is NOT an orphan,
  // even if its age crossed the threshold (a slow multi-million-uid refresh can
  // legitimately outrun it). Reaping it would re-enqueue a redundant refresh of
  // the exact cohort still running. Only true at-rest 'refreshing' rows are wedged.
  const active = currentlyProcessing();

  const reset: string[] = [];
  for (const r of rows) {
    if (r.id === active) continue;
    const startedMs = r.updated_at ? Date.parse(r.updated_at) : NaN;
    const age = Number.isNaN(startedMs) ? Infinity : now - startedMs;
    if (age >= wedgeThresholdMs(r.refresh_cadence_min)) {
      if (reconcileSegmentRefreshing(r.id)) reset.push(r.id);
    }
  }
  return reset;
}
