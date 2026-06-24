/**
 * Session derivation — turns the append-only `activity_events` spine into a
 * per-user session timeline for the admin observability surface.
 *
 * Sessions are NOT a stored entity. They are derived on read by gap-based
 * sessionization: events for one actor are ordered by time, and an idle gap
 * longer than `GAP_MIN` minutes starts a new session. Duration is last−first
 * event timestamp within the window. "What they did" = the events inside the
 * window (feature opens + privacy-safe query shapes). This adds ONE read query
 * — no schema change, no new logging, no keystroke/content capture.
 *
 * Identity: events key on Keycloak `sub`; the admin UI keys on email. We
 * resolve email→sub via `user_access.kc_sub`. A user with no sub (invited,
 * never logged in) or no events yields an empty timeline — never a throw.
 */

import type { ActivityEventType } from './activity-event-types.js';
import { getDb } from '../db/sqlite.js';
import { getAccess, normalizeEmail } from '../auth/access-store.js';
import { ownerSubsForEmail } from '../auth/principal.js';
import { queryActivity, activityTimestamps, parseQueryShape } from './activity-store.js';

/** Idle gap (minutes) that ends one session and starts the next. */
const GAP_MIN = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Sessionization window: only events from the last N days are considered. */
const WINDOW_DAYS = 30;
/** Hard cap on events scanned for the per-session event DETAIL, to bound cost on
 *  a very busy actor. The headline session count + sparkline are derived from a
 *  separate full-window timestamp scan so they reflect the true 30-day window,
 *  not just the newest `SCAN_LIMIT` events. */
const SCAN_LIMIT = 1000;
/** Event types kept OUT of the session timeline. `cube_outage` is backend
 *  reachability telemetry, not a user action — a browser tab left open emits a
 *  flap beacon every time the gateway/Cube blips, which would otherwise fabricate
 *  phantom 0-minute "sessions" and bury real activity. Outage stats live on the
 *  org observability surface instead. */
const TIMELINE_EXCLUDE: ActivityEventType[] = ['cube_outage'];

export interface SessionEvent {
  ts: number;
  type: string;
  /** feature_open: the feature id. query_run: null. */
  target: string | null;
  /** query_run: privacy-safe member-name shape. feature_open: null. */
  shape: { cubes: string[]; measures: string[]; dimensions: string[] } | null;
}

export interface UserSession {
  start: number;
  end: number;
  durationMs: number;
  events: SessionEvent[];
}

export interface UserSessions {
  /** Most-recent sessions first, capped at `limit`. */
  sessions: UserSession[];
  /** Total sessions derived across the whole 30-day window. */
  sessions30: number;
  /** Mean session duration across the 30-day window (0 if no sessions). */
  avgDurationMs: number;
  /** Daily event counts, length `WINDOW_DAYS`, oldest→newest (last = today). */
  sparkline: number[];
}

export interface SessionsOpts {
  /** Max sessions returned (newest first). Default 5. */
  limit?: number;
  /** Idle-gap threshold in minutes. Default GAP_MIN (60). */
  gapMin?: number;
  /** Injectable clock (tests). Defaults to Date.now(). */
  now?: number;
}

function emptyResult(): UserSessions {
  return { sessions: [], sessions30: 0, avgDurationMs: 0, sparkline: new Array(WINDOW_DAYS).fill(0) };
}

/**
 * Build the gap-derived session timeline for one user. Returns an empty result
 * (never null/throw) for an unknown user, a user without a resolved sub, or a
 * user with no events in the window.
 */
export function buildUserSessions(emailRaw: string, opts: SessionsOpts = {}): UserSessions {
  const now = opts.now ?? Date.now();
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 50);
  const gapMs = Math.max(opts.gapMin ?? GAP_MIN, 0) * 60_000;
  const email = normalizeEmail(emailRaw);

  const rec = getAccess(email);
  if (!rec) return emptyResult();
  // Read across BOTH identity keys: real-auth telemetry is keyed by the KC sub,
  // dev-mode telemetry by the email. A UUID-only read misses every dev event.
  const subs = ownerSubsForEmail(email, rec.kcSub);
  if (subs.length === 0) return emptyResult();

  const since = now - WINDOW_DAYS * DAY_MS;

  // True 30-day signal: every activity timestamp in the window (outage flaps
  // excluded), ascending. One narrow column, no row cap — so the headline count
  // + sparkline reflect the whole window, not just the newest SCAN_LIMIT events.
  const allTs = activityTimestamps(getDb(), {
    actorSubs: subs,
    since,
    until: now,
    excludeEventTypes: TIMELINE_EXCLUDE,
  });
  if (allTs.length === 0) return emptyResult();

  // Daily event-count sparkline: index 0 = oldest day, last = today.
  const sparkline = new Array(WINDOW_DAYS).fill(0);
  for (const ts of allTs) {
    const dayAgo = Math.floor((now - ts) / DAY_MS);
    const idx = WINDOW_DAYS - 1 - dayAgo;
    if (idx >= 0 && idx < WINDOW_DAYS) sparkline[idx] += 1;
  }

  // Headline count + mean duration: gap-sessionize the full-window timestamps.
  const { count: sessions30, totalDurationMs } = sessionizeTimestamps(allTs, gapMs);
  const avgDurationMs = sessions30 === 0 ? 0 : Math.round(totalDurationMs / sessions30);

  // Per-session event DETAIL for the newest `limit` sessions: capped full-row
  // scan (newest-first → chronological). The recent end is identical to the
  // full-window pass, so the newest sessions shown line up with the headline.
  const rows = queryActivity(getDb(), {
    actorSubs: subs,
    since,
    until: now,
    excludeEventTypes: TIMELINE_EXCLUDE,
    limit: SCAN_LIMIT,
  })
    .slice()
    .sort((a, b) => a.ts - b.ts);

  // Sessionize: a gap strictly greater than gapMs starts a new session.
  const sessions: UserSession[] = [];
  let current: SessionEvent[] = [];
  let prevTs = 0;
  const flush = () => {
    if (current.length === 0) return;
    const start = current[0].ts;
    const end = current[current.length - 1].ts;
    sessions.push({ start, end, durationMs: end - start, events: current });
    current = [];
  };
  for (const r of rows) {
    if (current.length > 0 && r.ts - prevTs > gapMs) flush();
    current.push({
      ts: r.ts,
      type: r.eventType,
      target: r.eventType === 'query_run' ? null : r.targetId,
      shape: r.eventType === 'query_run' ? parseQueryShape(r.detailJson) : null,
    });
    prevTs = r.ts;
  }
  flush();

  // Newest first, capped.
  sessions.reverse();
  return { sessions: sessions.slice(0, limit), sessions30, avgDurationMs, sparkline };
}

/**
 * Gap-sessionize an ascending timestamp list: returns the session count and the
 * summed duration (last−first ts per session). Same idle-gap rule as the
 * detailed pass, but over timestamps only — used for the true 30-day headline.
 */
function sessionizeTimestamps(tsAsc: number[], gapMs: number): { count: number; totalDurationMs: number } {
  if (tsAsc.length === 0) return { count: 0, totalDurationMs: 0 };
  let count = 1;
  let totalDurationMs = 0;
  let start = tsAsc[0];
  let prev = tsAsc[0];
  for (let i = 1; i < tsAsc.length; i += 1) {
    const ts = tsAsc[i];
    if (ts - prev > gapMs) {
      totalDurationMs += prev - start;
      count += 1;
      start = ts;
    }
    prev = ts;
  }
  totalDurationMs += prev - start;
  return { count, totalDurationMs };
}
