/**
 * Append-only activity telemetry store.
 *
 * Write path: `recordActivity` is fire-and-forget — emit points call it after
 * the real work succeeds and never await the result on the hot path. It runs
 * OUTSIDE the caller's own DB transaction (a single autocommit INSERT), so a
 * telemetry failure can never poison or roll back the request's real write.
 * Disk-exhaustion errors (SQLITE_FULL/IOERR/CORRUPT) log at WARN so a full
 * volume is visible in logs instead of silently dropping the spine.
 *
 * Read path: `queryActivity` filters by actor sub / event type / time window
 * for the Phase-4 aggregator.
 *
 * PII boundary: `detail_json` carries ONLY member NAMES via `projectQueryShape`
 * — never filter values, predicate literals, or player UID lists. The query
 * payload that drove a Cube `/load` is reduced to {cubes, measures, dimensions}
 * before it is ever persisted.
 */

import type Database from 'better-sqlite3';
import { getDb } from '../db/sqlite.js';
import { isActivityEventType, type ActivityEventType } from './activity-event-types.js';
import type { Principal } from '../auth/principal.js';

export interface RecordActivityInput {
  eventType: ActivityEventType;
  targetType?: string | null;
  targetId?: string | null;
  workspace?: string | null;
  game?: string | null;
  /** Arbitrary structured detail; serialised as-is. Callers MUST pre-project
   *  any query payload through `projectQueryShape` to strip values/UIDs. */
  detail?: unknown;
  /** Defaults to Date.now(); injectable for tests. */
  ts?: number;
}

export interface ActivityRow {
  id: number;
  actorSub: string;
  actorEmail: string | null;
  eventType: string;
  targetType: string | null;
  targetId: string | null;
  workspace: string | null;
  game: string | null;
  detailJson: string | null;
  ts: number;
}

interface RawRow {
  id: number;
  actor_sub: string;
  actor_email: string | null;
  event_type: string;
  target_type: string | null;
  target_id: string | null;
  workspace: string | null;
  game: string | null;
  detail_json: string | null;
  ts: number;
}

function rowFromRaw(r: RawRow): ActivityRow {
  return {
    id: r.id,
    actorSub: r.actor_sub,
    actorEmail: r.actor_email,
    eventType: r.event_type,
    targetType: r.target_type,
    targetId: r.target_id,
    workspace: r.workspace,
    game: r.game,
    detailJson: r.detail_json,
    ts: r.ts,
  };
}

/**
 * Reduce a Cube query payload to member NAMES only. This is the PII gate: the
 * raw query carries `filters[].values` (e.g. a specific player segment), time
 * `dateRange` bounds, and may carry a `uid_list` — none of which may be
 * persisted. We keep only the structural shape: which cubes/measures/dimensions
 * were touched, by name.
 */
export function projectQueryShape(
  query: unknown,
): { cubes: string[]; measures: string[]; dimensions: string[] } {
  const q = (query ?? {}) as Record<string, unknown>;
  const asNames = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((m): m is string => typeof m === 'string') : [];

  const measures = asNames(q.measures);
  const dims = asNames(q.dimensions);
  // timeDimensions contribute the dimension NAME only — the dateRange/granularity
  // (which can be a value) is deliberately dropped.
  const timeDims = Array.isArray(q.timeDimensions)
    ? q.timeDimensions
        .map((t) => (t && typeof t === 'object' ? (t as Record<string, unknown>).dimension : null))
        .filter((d): d is string => typeof d === 'string')
    : [];

  const dimensions = Array.from(new Set([...dims, ...timeDims]));

  // Cube = the part before the first dot of every member reference. Filters
  // and their values are intentionally never inspected.
  const cubeOf = (member: string): string | null => {
    const i = member.indexOf('.');
    return i > 0 ? member.slice(0, i) : null;
  };
  const cubes = Array.from(
    new Set(
      [...measures, ...dimensions]
        .map(cubeOf)
        .filter((c): c is string => c !== null),
    ),
  );

  return { cubes, measures, dimensions };
}

/**
 * Inverse of `projectQueryShape` for the read path: parse a persisted
 * `detail_json` back into the structural shape. Tolerates a malformed/corrupt
 * row by returning null rather than throwing — a single bad row must never 500
 * an admin observability route. (Unreachable in practice: the only writer is
 * the projector above, but cheap insurance against a hand-edited row.)
 */
export function parseQueryShape(
  detailJson: string | null,
): { cubes: string[]; measures: string[]; dimensions: string[] } | null {
  if (!detailJson) return null;
  try {
    return JSON.parse(detailJson) as { cubes: string[]; measures: string[]; dimensions: string[] };
  } catch {
    return null;
  }
}

/**
 * Synchronous insert. Throws on failure — used by `recordActivity` (which
 * swallows) and directly by tests that assert on the persisted row.
 */
export function insertActivity(db: Database.Database, principal: Principal, input: RecordActivityInput): ActivityRow {
  if (!principal?.sub) {
    throw new Error('insertActivity: principal.sub is required');
  }
  if (!isActivityEventType(input.eventType)) {
    throw new Error(`insertActivity: unknown event_type "${input.eventType}"`);
  }
  const ts = input.ts ?? Date.now();
  const detailJson = input.detail !== undefined && input.detail !== null ? JSON.stringify(input.detail) : null;

  const info = db
    .prepare(
      `INSERT INTO activity_events
         (actor_sub, actor_email, event_type, target_type, target_id, workspace, game, detail_json, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      principal.sub,
      principal.email ?? null,
      input.eventType,
      input.targetType ?? null,
      input.targetId ?? null,
      input.workspace ?? null,
      input.game ?? null,
      detailJson,
      ts,
    );

  return {
    id: Number(info.lastInsertRowid),
    actorSub: principal.sub,
    actorEmail: principal.email ?? null,
    eventType: input.eventType,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    workspace: input.workspace ?? null,
    game: input.game ?? null,
    detailJson,
    ts,
  };
}

const DISK_ERROR_CODES = new Set(['SQLITE_FULL', 'SQLITE_IOERR', 'SQLITE_CORRUPT']);

/**
 * Fire-and-forget emit. NEVER throws — a telemetry failure must not break the
 * request that triggered it. Disk-exhaustion classes log at WARN (a full
 * volume is operationally serious and must be visible); everything else logs
 * at debug. Runs outside the caller's transaction by using the shared
 * autocommit connection directly.
 */
export function recordActivity(principal: Principal, input: RecordActivityInput): void {
  try {
    insertActivity(getDb(), principal, input);
  } catch (err) {
    const code = (err as { code?: string })?.code ?? '';
    const msg = err instanceof Error ? err.message : String(err);
    if (DISK_ERROR_CODES.has(code)) {
      // eslint-disable-next-line no-console
      console.warn(`[activity-store] disk error on emit (${code}): ${msg}`);
    } else {
      // eslint-disable-next-line no-console
      console.debug(`[activity-store] emit failed (swallowed): ${msg}`);
    }
  }
}

export interface QueryActivityOpts {
  actorSub?: string;
  /** Match any of several actor subs (actor_sub IN (...)). Used where one
   *  person's events can be keyed under more than one owner-sub — e.g. the KC
   *  UUID in real-auth and the email in dev mode. Combined with `actorSub` via
   *  AND if both are given (callers normally set one or the other). */
  actorSubs?: string[];
  eventType?: ActivityEventType;
  /** Event types to exclude (event_type NOT IN (...)). Used to keep
   *  infrastructure-health telemetry (`cube_outage`) out of the user-activity
   *  session timeline so it neither pollutes the events shown nor consumes the
   *  `limit` scan budget ahead of real activity. */
  excludeEventTypes?: ActivityEventType[];
  since?: number;
  until?: number;
  limit?: number;
}

export function queryActivity(db: Database.Database, opts: QueryActivityOpts = {}): ActivityRow[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.actorSub) {
    clauses.push('actor_sub = ?');
    params.push(opts.actorSub);
  }
  if (opts.actorSubs && opts.actorSubs.length > 0) {
    clauses.push(`actor_sub IN (${opts.actorSubs.map(() => '?').join(', ')})`);
    params.push(...opts.actorSubs);
  }
  if (opts.eventType) {
    clauses.push('event_type = ?');
    params.push(opts.eventType);
  }
  if (opts.excludeEventTypes && opts.excludeEventTypes.length > 0) {
    clauses.push(`event_type NOT IN (${opts.excludeEventTypes.map(() => '?').join(', ')})`);
    params.push(...opts.excludeEventTypes);
  }
  if (opts.since !== undefined) {
    clauses.push('ts >= ?');
    params.push(opts.since);
  }
  if (opts.until !== undefined) {
    clauses.push('ts <= ?');
    params.push(opts.until);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);

  const rows = db
    .prepare(
      `SELECT id, actor_sub, actor_email, event_type, target_type, target_id,
              workspace, game, detail_json, ts
         FROM activity_events
         ${where}
        ORDER BY ts DESC, id DESC
        LIMIT ?`,
    )
    .all(...params, limit) as RawRow[];

  return rows.map(rowFromRaw);
}

export interface ActivityTimestampsOpts {
  actorSubs: string[];
  since: number;
  until: number;
  /** Event types to exclude (e.g. `cube_outage` health flaps). */
  excludeEventTypes?: ActivityEventType[];
}

/**
 * Ascending event timestamps for an actor within a window — one narrow column,
 * no row cap. The session aggregator uses this to derive the TRUE 30-day
 * session count + daily sparkline, which must reflect the whole window and so
 * can't ride the row-capped `queryActivity` detail scan (a busy user's older
 * days would fall outside the cap and read as zero activity). Bounded naturally
 * by the window + the (actor_sub, ts) index; this is an admin-only surface.
 */
export function activityTimestamps(db: Database.Database, opts: ActivityTimestampsOpts): number[] {
  if (opts.actorSubs.length === 0) return [];
  const params: unknown[] = [...opts.actorSubs];
  let where = `actor_sub IN (${opts.actorSubs.map(() => '?').join(', ')}) AND ts >= ? AND ts <= ?`;
  params.push(opts.since, opts.until);
  if (opts.excludeEventTypes && opts.excludeEventTypes.length > 0) {
    where += ` AND event_type NOT IN (${opts.excludeEventTypes.map(() => '?').join(', ')})`;
    params.push(...opts.excludeEventTypes);
  }
  return (
    db
      .prepare(`SELECT ts FROM activity_events WHERE ${where} ORDER BY ts ASC`)
      .all(...params) as Array<{ ts: number }>
  ).map((r) => r.ts);
}

/** Distinct actor subs that produced any event at or after `since`. */
export function distinctActorsSince(db: Database.Database, since: number): string[] {
  return (
    db
      .prepare('SELECT DISTINCT actor_sub FROM activity_events WHERE ts >= ?')
      .all(since) as Array<{ actor_sub: string }>
  ).map((r) => r.actor_sub);
}

/** Top `target_id`s for an event type since `since`, by frequency desc. */
export function topEventTargets(
  db: Database.Database,
  eventType: ActivityEventType,
  since: number,
  limit = 5,
): Array<{ targetId: string; count: number }> {
  const capped = Math.min(Math.max(limit, 1), 50);
  return (
    db
      .prepare(
        `SELECT target_id AS targetId, COUNT(*) AS count
           FROM activity_events
          WHERE event_type = ? AND ts >= ? AND target_id IS NOT NULL
          GROUP BY target_id
          ORDER BY count DESC, target_id ASC
          LIMIT ?`,
      )
      .all(eventType, since, capped) as Array<{ targetId: string; count: number }>
  );
}

/** Delete events older than `cutoff` (epoch ms). Returns rows removed. */
export function pruneActivityBefore(db: Database.Database, cutoff: number): number {
  const info = db.prepare('DELETE FROM activity_events WHERE ts < ?').run(cutoff);
  return info.changes;
}
