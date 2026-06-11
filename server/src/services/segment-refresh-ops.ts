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
 *   - `degraded` — cohort refreshed fine, but K of N KPI cards FAILED their last
 *                  refresh (cold-query timeout / unbuilt rollup). The signal is
 *                  the card's persisted `error` breadcrumb, NOT its status: when
 *                  a card that previously succeeded starts failing, the cache's
 *                  last-good preservation flips it back to status='ok' (so it
 *                  still serves the stale value) and records the failure only in
 *                  `error`. Counting status='error' alone therefore misses the
 *                  most common decay — a card that froze hours ago while the
 *                  segment kept reading green. `error IS NOT NULL` catches both
 *                  the never-succeeded (status='error') and the serving-last-good
 *                  (status='ok' + breadcrumb) cases without false-flagging a
 *                  healthy-but-stable card (whose value simply hasn't changed).
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
  /**
   * Cards whose LAST refresh attempt failed (persisted `error IS NOT NULL`),
   * counting both status='error' (never succeeded) and status='ok'-with-error
   * (serving last-good while the refresh keeps failing). Drives `degraded`.
   */
  failingCards: number;
  now: number;
}

/**
 * Map raw segment state → derived monitor state. Precedence (highest first):
 * broken → refreshing(wedged|in_flight) → degraded → serving_stale → due → healthy.
 * Pure: no DB access, fully unit-testable.
 */
export function deriveRefreshState(input: DeriveInput): DerivedRefreshState {
  const { status, lastRefreshedAt, updatedAt, cadenceMin, failingCards, now } = input;

  if (status === 'broken') return 'broken';

  if (status === 'refreshing') {
    const startedMs = updatedAt ? Date.parse(updatedAt) : NaN;
    const refreshingAge = Number.isNaN(startedMs) ? 0 : now - startedMs;
    return refreshingAge >= wedgeThresholdMs(cadenceMin) ? 'wedged' : 'in_flight';
  }

  // Serving states (fresh / stale): cohort is up, but ≥1 KPI card's last refresh
  // failed — including cards that still serve a last-good value (status='ok' +
  // error breadcrumb), the decay a status='error'-only count would miss.
  if (failingCards > 0) return 'degraded';

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
  /** `error` = cards at status='error' (no last-good to show). */
  cards: { ok: number; error: number; total: number };
  /** Cards whose last refresh attempt failed (status='error' OR status='ok' with
   *  an error breadcrumb still serving last-good). ≥1 ⇒ derivedState 'degraded'. */
  failingCards: number;
  /** Age (ms) of the newest cached card; null when the segment has no cards.
   *  Display only (last time any card VALUE changed — not last verified). */
  newestCardAgeMs: number | null;
  /** True when ≥1 card is failing its refresh while still serving last-good — the
   *  silent decay that reads green via status alone. (= failingCards > cards.error) */
  cardsStale: boolean;
  /** Every card whose last refresh failed (id + latest error), incl. last-good. */
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
  queue: {
    processing: boolean;
    /** Segments WAITING behind the in-flight one — excludes the running id. */
    size: number;
    runningId: string | null;
    queuedIds: string[];
  };
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
  /** status='error' — no last-good value to render. */
  error: number;
  /** error IS NOT NULL — last refresh failed (incl. status='ok' serving last-good). */
  failing: number;
  total: number;
  /** ISO of the most recently computed card; null when the segment has none. */
  newestFetchedAt: string | null;
}

/** Tally per segment in one query: ok/error/total, failing (last attempt errored,
 *  by breadcrumb — catches cards serving last-good), and newest fetched_at. */
function loadCardTallies(): Map<string, CardTally> {
  const rows = getDb()
    .prepare(
      `SELECT segment_id,
              SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS err,
              SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS failing,
              COUNT(*) AS total,
              MAX(fetched_at) AS newest
         FROM segment_card_cache
        GROUP BY segment_id`,
    )
    .all() as Array<{ segment_id: string; err: number; failing: number; total: number; newest: string | null }>;
  const map = new Map<string, CardTally>();
  for (const r of rows) {
    const error = Number(r.err) || 0;
    const total = Number(r.total) || 0;
    map.set(r.segment_id, {
      ok: total - error,
      error,
      failing: Number(r.failing) || 0,
      total,
      newestFetchedAt: r.newest ?? null,
    });
  }
  return map;
}

/** Load every card whose last refresh failed (id + latest message) for the given
 *  segments — by `error IS NOT NULL`, so cards still serving a last-good value
 *  (status='ok' + breadcrumb) are surfaced alongside hard status='error' ones. */
function loadErroringCards(segmentIds: string[]): Map<string, ErroringCard[]> {
  const map = new Map<string, ErroringCard[]>();
  if (segmentIds.length === 0) return map;
  const placeholders = segmentIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT segment_id, card_id, error
         FROM segment_card_cache
        WHERE error IS NOT NULL AND segment_id IN (${placeholders})`,
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
  queueRunningId?: string | null;
  queueQueuedIds?: string[];
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
  const failingSegmentIds = raw
    .filter((r) => (tallies.get(r.id)?.failing ?? 0) > 0)
    .map((r) => r.id);
  const erroringBySegment = loadErroringCards(failingSegmentIds);

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
    const tally = tallies.get(r.id) ?? { ok: 0, error: 0, failing: 0, total: 0, newestFetchedAt: null };
    const newestMs = tally.newestFetchedAt ? Date.parse(tally.newestFetchedAt) : NaN;
    const newestCardAgeMs = Number.isNaN(newestMs) ? null : now - newestMs;

    const derivedState = deriveRefreshState({
      status: r.status,
      lastRefreshedAt: r.last_refreshed_at,
      updatedAt: r.updated_at,
      cadenceMin: r.refresh_cadence_min,
      failingCards: tally.failing,
      now,
    });
    // Silent decay: cards failing their refresh while still serving last-good
    // (status='ok' + breadcrumb) — green by status alone, the case worth a callout.
    const cardsStale = tally.failing > tally.error;

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
      cards: { ok: tally.ok, error: tally.error, total: tally.total },
      failingCards: tally.failing,
      newestCardAgeMs,
      cardsStale,
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
    queue: {
      processing: opts.queueProcessing,
      size: opts.queueSize,
      runningId: opts.queueRunningId ?? null,
      queuedIds: opts.queueQueuedIds ?? [],
    },
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
