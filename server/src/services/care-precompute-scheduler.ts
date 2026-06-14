/**
 * Nightly scheduling for the segment Care-tab precompute. The cron tick (every
 * 60s) calls maybeRunCarePrecompute(); it no-ops unless the current time falls
 * inside the configured nightly window (default 03:00–06:00 GMT+7, env
 * CARE_PRECOMPUTE_WINDOW="HH:MM-HH:MM"), then drains due segments ONE AT A TIME.
 *
 * Both BACKGROUND paths — the cron drain AND the manual "run now" trigger — run
 * through a single serial chain, so background warming presents as ONE slow
 * client to Trino (a manual trigger never runs concurrently with a nightly
 * pass; the cross-catalog join is heavy and parallelism would hammer a cold
 * warehouse). The interactive route's cold-miss compute is deliberately NOT on
 * this chain: a user opening the tab must not queue behind a full nightly drain,
 * so it computes synchronously (it pays the cold cost once, then it's a warm
 * hit). The GMT+7 window math is reused from the member-360 scheduler.
 *
 * Manual trigger is rate-limited to one accepted trigger per segment per 10
 * minutes and is fire-and-forget (callers respond 202 immediately).
 */

import { getDb } from '../db/sqlite.js';
import { hasCsCoverage, csProductId } from '../lakehouse/cs-product-map.js';
import { buildCsCarePayload, type CareBuildRow } from './cs-care-builder.js';
import { writeCareCache, markCareAttempt } from '../db/segment-care-cache-store.js';
import { recordCareRun, type CareRunSource } from '../db/segment-care-run-store.js';
import {
  parsePrecomputeWindow,
  isInsideWindow,
  currentWindowStartMs,
} from './member360-precompute-scheduler.js';

const DEFAULT_CARE_WINDOW = '03:00-06:00';
const TRIGGER_COOLDOWN_MS = 10 * 60_000;
/** Statement-timeout budget for the BACKGROUND CS reads (env
 *  CARE_PRECOMPUTE_READ_TIMEOUT_MS). Larger than the interactive route's 30s so
 *  a cold warehouse can complete the heavy cross-catalog join once and warm the
 *  cache — after which interactive loads are warm hits. */
const READ_TIMEOUT_MS = Math.max(
  1000,
  parseInt(process.env.CARE_PRECOMPUTE_READ_TIMEOUT_MS ?? '', 10) || 120_000,
);

interface DueRow {
  id: string;
  game_id: string;
  last_refreshed_at: string | null;
  computed_at: string | null;
}

/**
 * Segments due this window: predicate, CS-covered, AND
 *   - never precomputed, OR
 *   - last successful compute predates this window's start, OR
 *   - membership refreshed since the last care compute (secondary trigger).
 */
export function listDueCareSegments(nowMs: number, window = parseCareWindow()): string[] {
  const windowStartIso = new Date(currentWindowStartMs(nowMs, window)).toISOString();
  const rows = getDb()
    .prepare(
      `SELECT s.id, s.game_id, s.last_refreshed_at, c.computed_at
         FROM segments s
         LEFT JOIN segment_care_cache c ON c.segment_id = s.id
        WHERE s.type = 'predicate'`,
    )
    .all() as DueRow[];

  const due: string[] = [];
  for (const r of rows) {
    if (!hasCsCoverage(r.game_id) || csProductId(r.game_id) == null) continue;
    const neverComputed = !r.computed_at;
    const predatesWindow = r.computed_at != null && r.computed_at < windowStartIso;
    const membershipNewer =
      r.last_refreshed_at != null && r.computed_at != null && r.last_refreshed_at > r.computed_at;
    if (neverComputed || predatesWindow || membershipNewer) due.push(r.id);
  }
  return due;
}

/** Parse the care window from env, defaulting to 03:00–06:00 GMT+7. */
export function parseCareWindow(): ReturnType<typeof parsePrecomputeWindow> {
  return parsePrecomputeWindow(process.env.CARE_PRECOMPUTE_WINDOW ?? DEFAULT_CARE_WINDOW);
}

function loadCareRow(segmentId: string): CareBuildRow | null {
  const row = getDb()
    .prepare(
      `SELECT id, game_id, cube, workspace, uid_list_json, member_profiles_json
         FROM segments WHERE id = ?`,
    )
    .get(segmentId) as CareBuildRow | undefined;
  return row ?? null;
}

// Single serial chain shared by cron + manual: one Care compute at a time.
let chain: Promise<void> = Promise.resolve();
let draining = false;

function runSerial(task: () => Promise<void>): Promise<void> {
  const next = chain.then(task, task);
  chain = next.catch(() => {});
  return next;
}

/** Build + persist one segment's payload, recording a run row either way. */
async function precomputeOneCareSegment(segmentId: string, source: CareRunSource): Promise<void> {
  const startedAt = new Date().toISOString();
  const row = loadCareRow(segmentId);
  if (!row) {
    // Segment vanished between trigger and execution — record a no-op error run
    // so the board isn't silent (operator clicked "Run now" and saw nothing).
    recordCareRun({
      segmentId,
      gameId: 'unknown',
      source,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: 'error',
      runError: 'segment not found',
    });
    return;
  }
  const gameId = String(row.game_id);
  const t0 = Date.now();
  try {
    const payload = await buildCsCarePayload(row, { readTimeoutMs: READ_TIMEOUT_MS });
    writeCareCache(segmentId, gameId, payload);
    recordCareRun({
      segmentId,
      gameId,
      source,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: 'ok',
      tickets: payload.pulse.tickets,
      contacted: payload.pulse.contacted,
      elapsedMs: Date.now() - t0,
    });
    // eslint-disable-next-line no-console
    console.log(
      `[care-precompute] ${source} ${segmentId}: tickets=${payload.pulse.tickets} ` +
        `contacted=${payload.pulse.contacted} elapsedMs=${Date.now() - t0}`,
    );
  } catch (err) {
    const message = (err as Error).message;
    markCareAttempt(segmentId, gameId, message);
    recordCareRun({
      segmentId,
      gameId,
      source,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: 'error',
      elapsedMs: Date.now() - t0,
      runError: message,
    });
    // eslint-disable-next-line no-console
    console.warn(`[care-precompute] ${source} ${segmentId} failed:`, message);
  }
}

/** Cron hook: drain due segments serially when inside the nightly window. */
export async function maybeRunCarePrecompute(nowMs: number = Date.now()): Promise<void> {
  if (draining) return;
  const window = parseCareWindow();
  if (!isInsideWindow(nowMs, window)) return;
  const ids = listDueCareSegments(nowMs, window);
  if (ids.length === 0) return;

  draining = true;
  try {
    for (const id of ids) {
      await runSerial(() => precomputeOneCareSegment(id, 'cron'));
    }
  } finally {
    draining = false;
  }
}

const lastTriggerAt = new Map<string, number>();

export interface TriggerResult {
  accepted: boolean;
  retryAfterMs?: number;
}

/** Manual "run now": bypasses the window, keeps the 10-min/segment lid, and
 *  runs on the shared serial chain so it never races a nightly pass. */
export function triggerCarePrecompute(segmentId: string, nowMs: number = Date.now()): TriggerResult {
  const last = lastTriggerAt.get(segmentId);
  if (last != null && nowMs - last < TRIGGER_COOLDOWN_MS) {
    return { accepted: false, retryAfterMs: TRIGGER_COOLDOWN_MS - (nowMs - last) };
  }
  lastTriggerAt.set(segmentId, nowMs);
  void runSerial(() => precomputeOneCareSegment(segmentId, 'manual'));
  return { accepted: true };
}

/** Test hook — clears the manual-trigger cooldown ledger + resets the chain. */
export function resetCareTriggerState(): void {
  lastTriggerAt.clear();
  chain = Promise.resolve();
  draining = false;
}
