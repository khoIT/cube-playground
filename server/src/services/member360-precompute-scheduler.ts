/**
 * Nightly scheduling for the member-360 precompute. The cron tick (every 60s)
 * calls maybeRunMember360Precompute(); it no-ops unless the current time falls
 * inside the configured nightly window (default 02:00–06:00 GMT+7, env
 * MEMBER360_PRECOMPUTE_WINDOW="HH:MM-HH:MM"), then drains due segments ONE AT
 * A TIME — globally serial so the whole feature presents as a single slow
 * client to Cube. A module-level flag prevents overlapping passes across ticks.
 *
 * Manual trigger (dev/testing + "compute now") bypasses the window but is
 * rate-limited to one accepted trigger per segment per 10 minutes.
 */

import { getDb } from '../db/sqlite.js';
import { precomputeSegmentMembers360 } from './member360-runner.js';

/** GMT+7 (Asia/Saigon) — the ops timezone all windows are expressed in. */
const TZ_OFFSET_MS = 7 * 3600_000;
const DEFAULT_WINDOW = '02:00-06:00';
const TRIGGER_COOLDOWN_MS = 10 * 60_000;

/** A nightly precompute window as minutes-of-day in GMT+7. Exported because the
 *  Care scheduler defaults a parameter to this type across module boundaries —
 *  an unexported type can't be named in the emitted declarations (TS4076). */
export interface PrecomputeWindow {
  startMin: number; // minutes-of-day GMT+7
  endMin: number;
}

/** Parse "HH:MM-HH:MM"; falls back to the default window on malformed input. */
export function parsePrecomputeWindow(raw: string | undefined): PrecomputeWindow {
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec((raw ?? '').trim());
  const src = m ?? /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(DEFAULT_WINDOW)!;
  const startMin = Number(src[1]) * 60 + Number(src[2]);
  const endMin = Number(src[3]) * 60 + Number(src[4]);
  return { startMin, endMin };
}

function minutesOfDayGmt7(nowMs: number): number {
  const d = new Date(nowMs + TZ_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** True when `nowMs` is inside the window (handles midnight wrap). */
export function isInsideWindow(nowMs: number, w: PrecomputeWindow): boolean {
  const m = minutesOfDayGmt7(nowMs);
  return w.startMin <= w.endMin
    ? m >= w.startMin && m < w.endMin
    : m >= w.startMin || m < w.endMin;
}

/** UTC epoch ms of the CURRENT window's start (assumes nowMs is inside it).
 *  For wrapped windows past midnight, the start was yesterday GMT+7. */
export function currentWindowStartMs(nowMs: number, w: PrecomputeWindow): number {
  const local = new Date(nowMs + TZ_OFFSET_MS);
  let dayStartUtc = Date.UTC(
    local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(),
  ) - TZ_OFFSET_MS;
  const m = minutesOfDayGmt7(nowMs);
  if (w.startMin > w.endMin && m < w.endMin) dayStartUtc -= 86_400_000; // wrapped past midnight
  return dayStartUtc + w.startMin * 60_000;
}

/** Segments due this window: tiers present AND last run predates window start.
 *  Game-registry eligibility is re-checked inside the runner (JS-side map). */
export function listDueMember360Segments(nowMs: number, w: PrecomputeWindow): string[] {
  const windowStartIso = new Date(currentWindowStartMs(nowMs, w)).toISOString();
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT id FROM segments
       WHERE member_tiers_json IS NOT NULL
         AND (member360_last_run_at IS NULL OR member360_last_run_at < ?)
    `)
    .all(windowStartIso) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

let running = false;

/** Cron hook: drain due segments serially when inside the nightly window. */
export async function maybeRunMember360Precompute(nowMs: number = Date.now()): Promise<void> {
  if (running) return;
  const window = parsePrecomputeWindow(process.env.MEMBER360_PRECOMPUTE_WINDOW);
  if (!isInsideWindow(nowMs, window)) return;
  const ids = listDueMember360Segments(nowMs, window);
  if (ids.length === 0) return;

  running = true;
  try {
    for (const id of ids) {
      try {
        const result = await precomputeSegmentMembers360(id);
        if (result) {
          // eslint-disable-next-line no-console
          console.log(
            `[member360-precompute] ${id}: uids=${result.uids} panels=${result.panels} ` +
              `ok=${result.ok} error=${result.error} budgetSkipped=${result.budgetSkipped} ` +
              `elapsedMs=${result.elapsedMs}`,
          );
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[member360-precompute] ${id} failed:`, (err as Error).message);
      }
    }
  } finally {
    running = false;
  }
}

const lastTriggerAt = new Map<string, number>();

export interface TriggerResult {
  accepted: boolean;
  retryAfterMs?: number;
}

/** Manual "compute now": bypasses the window, keeps the 10-min/segment lid.
 *  The run itself is fire-and-forget; callers respond 202 immediately. */
export function triggerMember360Precompute(segmentId: string, nowMs: number = Date.now()): TriggerResult {
  const last = lastTriggerAt.get(segmentId);
  if (last != null && nowMs - last < TRIGGER_COOLDOWN_MS) {
    return { accepted: false, retryAfterMs: TRIGGER_COOLDOWN_MS - (nowMs - last) };
  }
  lastTriggerAt.set(segmentId, nowMs);
  void precomputeSegmentMembers360(segmentId).then(
    (result) => {
      if (result) {
        // eslint-disable-next-line no-console
        console.log(
          `[member360-precompute] manual ${segmentId}: ok=${result.ok} error=${result.error} ` +
            `budgetSkipped=${result.budgetSkipped} elapsedMs=${result.elapsedMs}`,
        );
      }
    },
    (err) => {
      // eslint-disable-next-line no-console
      console.warn(`[member360-precompute] manual ${segmentId} failed:`, (err as Error).message);
    },
  );
  return { accepted: true };
}

/** Test hook — clears the manual-trigger cooldown ledger. */
export function resetMember360TriggerState(): void {
  lastTriggerAt.clear();
}
