/**
 * Live Cube query-performance telemetry store.
 *
 * Write path mirrors `activity-store.ts` exactly: `recordQueryPerf` is
 * fire-and-forget — the proxy calls it AFTER the response is queued and never
 * awaits it. A single autocommit INSERT runs outside any caller transaction, so
 * a telemetry failure can never poison the real request. Disk-exhaustion errors
 * log at WARN (a full volume must be visible); everything else logs at debug.
 *
 * PII boundary: `query_shape` is the names-only projection (`projectQueryShape`,
 * imported from activity-store — DRY, one gate) used by the classifier/summary.
 * `query_full` (migration 062) ADDITIONALLY stores the COMPLETE query verbatim —
 * filter values, dateRange, any UID list — a deliberate admin-only posture so an
 * operator can reproduce the exact slow/failed query; exposure is bounded by the
 * admin-only read routes + 30d prune. `error_excerpt` is a truncated upstream
 * error MESSAGE, not a query payload.
 *
 * Sampling: ALL non-200s are captured (the actionable failures); 200s are
 * sampled to bound write volume (see `shouldCapture`).
 */

import type Database from 'better-sqlite3';
import { getDb } from '../db/sqlite.js';
import { projectQueryShape, parseQueryShape } from './activity-store.js';

export type QueryShape = { cubes: string[]; measures: string[]; dimensions: string[] };

export interface QueryPerfInput {
  actorSub: string;
  actorEmail?: string | null;
  workspace?: string | null;
  game?: string | null;
  method: 'GET' | 'POST';
  status: number;
  latencyMs: number;
  /** Raw Cube query payload — projected to NAMES via projectQueryShape before persist. */
  query?: unknown;
  /** `usedPreAggregations` from a 200 /load body; stored raw (may be '[]' for lambda). */
  usedPreaggs?: unknown;
  /** Upstream error body for non-200; truncated + sanitised before persist. */
  errorBody?: unknown;
  /** Sanitized originating route (browser Referer path); null for API callers. */
  source?: string | null;
  /** Defaults to Date.now(); injectable for tests. */
  ts?: number;
}

export interface QueryPerfRow {
  id: number;
  ts: number;
  actorSub: string;
  actorEmail: string | null;
  workspace: string | null;
  game: string | null;
  method: string;
  status: number;
  latencyMs: number;
  usedPreaggs: string | null;
  preaggHit: number | null;
  shape: QueryShape | null;
  errorExcerpt: string | null;
  /** Complete query verbatim (parsed) — includes values/dateRange. Admin-only. */
  queryFull: unknown | null;
  /** Originating route (e.g. /dashboards/123), or null for API callers. */
  source: string | null;
}

interface RawRow {
  id: number;
  ts: number;
  actor_sub: string;
  actor_email: string | null;
  workspace: string | null;
  game: string | null;
  method: string;
  status: number;
  latency_ms: number;
  used_preaggs: string | null;
  preagg_hit: number | null;
  query_shape: string | null;
  error_excerpt: string | null;
  query_full: string | null;
  source: string | null;
}

function parseJson(json: string | null): unknown | null {
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

function rowFromRaw(r: RawRow): QueryPerfRow {
  return {
    id: r.id,
    ts: r.ts,
    actorSub: r.actor_sub,
    actorEmail: r.actor_email,
    workspace: r.workspace,
    game: r.game,
    method: r.method,
    status: r.status,
    latencyMs: r.latency_ms,
    usedPreaggs: r.used_preaggs,
    preaggHit: r.preagg_hit,
    shape: parseQueryShape(r.query_shape),
    errorExcerpt: r.error_excerpt,
    queryFull: parseJson(r.query_full),
    source: r.source,
  };
}

/** Bound the stored verbatim query so a pathological payload can't bloat a row. */
const QUERY_FULL_MAX = 16_000;

/** Default slow-200 threshold (ms): a 200 above this is always captured. */
export const SLOW_MS = Number(process.env.PERF_SLOW_MS) || 3000;
/** Keep 1-in-N fast 200s. Default 1/10. */
export const PERF_SAMPLE_RATE = Math.max(1, Number(process.env.PERF_SAMPLE_RATE) || 10);

/**
 * Pure sampling decision. ALL non-200s are kept (failures are the signal and
 * are never sampled). Slow 200s (>= SLOW_MS) are kept (near-misses worth
 * seeing). Fast 200s are sampled 1-in-PERF_SAMPLE_RATE keyed on a cheap counter
 * so a fast cache-hit storm doesn't bloat the time-series indexes.
 *
 * `seq` is a monotonic counter supplied by the caller (a process-local tick) so
 * the function stays pure and deterministically testable.
 */
export function shouldCapture(status: number, latencyMs: number, seq: number): boolean {
  if (status !== 200) return true;
  if (latencyMs >= SLOW_MS) return true;
  return seq % PERF_SAMPLE_RATE === 0;
}

/** Sanitise an upstream error body to a short message — never a query payload. */
export function errorExcerptOf(errorBody: unknown): string | null {
  if (errorBody == null) return null;
  let msg: string;
  if (typeof errorBody === 'string') {
    msg = errorBody;
  } else if (typeof errorBody === 'object') {
    const e = (errorBody as { error?: unknown }).error;
    msg = typeof e === 'string' ? e : '';
  } else {
    msg = String(errorBody);
  }
  msg = msg.trim();
  if (!msg) return null;
  return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
}

/**
 * Synchronous insert. Throws on failure — used by `recordQueryPerf` (which
 * swallows) and directly by tests that assert on the persisted row.
 */
export function insertQueryPerf(db: Database.Database, input: QueryPerfInput): QueryPerfRow {
  if (!input.actorSub) {
    throw new Error('insertQueryPerf: actorSub is required');
  }
  const ts = input.ts ?? Date.now();
  const shape = input.query != null ? projectQueryShape(input.query) : null;
  const shapeJson = shape ? JSON.stringify(shape) : null;
  const usedPreaggs =
    input.usedPreaggs != null ? JSON.stringify(input.usedPreaggs) : null;
  const errorExcerpt = input.status === 200 ? null : errorExcerptOf(input.errorBody);
  // Verbatim query (incl. values/dateRange/UIDs) — admin-only, bounded length.
  let queryFull: string | null = null;
  if (input.query != null) {
    const raw = JSON.stringify(input.query);
    queryFull = raw.length > QUERY_FULL_MAX ? raw.slice(0, QUERY_FULL_MAX) : raw;
  }
  const source = input.source ?? null;

  const info = db
    .prepare(
      `INSERT INTO query_perf
         (ts, actor_sub, actor_email, workspace, game, method, status, latency_ms,
          used_preaggs, preagg_hit, query_shape, error_excerpt, query_full, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    )
    .run(
      ts,
      input.actorSub,
      input.actorEmail ?? null,
      input.workspace ?? null,
      input.game ?? null,
      input.method,
      input.status,
      Math.round(input.latencyMs),
      usedPreaggs,
      shapeJson,
      errorExcerpt,
      queryFull,
      source,
    );

  return {
    id: Number(info.lastInsertRowid),
    ts,
    actorSub: input.actorSub,
    actorEmail: input.actorEmail ?? null,
    workspace: input.workspace ?? null,
    game: input.game ?? null,
    method: input.method,
    status: input.status,
    latencyMs: Math.round(input.latencyMs),
    usedPreaggs,
    preaggHit: null,
    shape,
    errorExcerpt,
    queryFull: parseJson(queryFull),
    source,
  };
}

const DISK_ERROR_CODES = new Set(['SQLITE_FULL', 'SQLITE_IOERR', 'SQLITE_CORRUPT']);

/**
 * Fire-and-forget emit. NEVER throws — a telemetry failure must not break the
 * proxied request. Disk-exhaustion classes log at WARN; everything else at debug.
 */
export function recordQueryPerf(input: QueryPerfInput): void {
  try {
    insertQueryPerf(getDb(), input);
  } catch (err) {
    const code = (err as { code?: string })?.code ?? '';
    const msg = err instanceof Error ? err.message : String(err);
    if (DISK_ERROR_CODES.has(code)) {
      // eslint-disable-next-line no-console
      console.warn(`[query-perf-store] disk error on emit (${code}): ${msg}`);
    } else {
      // eslint-disable-next-line no-console
      console.debug(`[query-perf-store] emit failed (swallowed): ${msg}`);
    }
  }
}

export interface QueryPerfOpts {
  since?: number;
  until?: number;
  /** Exact status filter. */
  status?: number;
  /** Coarse class filter: 'fail' (status >= 400) or 'success' (status 200). */
  statusClass?: 'fail' | 'success';
  workspace?: string;
  game?: string;
  limit?: number;
}

export function queryPerf(db: Database.Database, opts: QueryPerfOpts = {}): QueryPerfRow[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.since !== undefined) {
    clauses.push('ts >= ?');
    params.push(opts.since);
  }
  if (opts.until !== undefined) {
    clauses.push('ts <= ?');
    params.push(opts.until);
  }
  if (opts.status !== undefined) {
    clauses.push('status = ?');
    params.push(opts.status);
  }
  if (opts.statusClass === 'fail') {
    clauses.push('status >= 400');
  } else if (opts.statusClass === 'success') {
    clauses.push('status = 200');
  }
  if (opts.workspace) {
    clauses.push('workspace = ?');
    params.push(opts.workspace);
  }
  if (opts.game) {
    clauses.push('game = ?');
    params.push(opts.game);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);

  const rows = db
    .prepare(
      `SELECT id, ts, actor_sub, actor_email, workspace, game, method, status,
              latency_ms, used_preaggs, preagg_hit, query_shape, error_excerpt,
              query_full, source
         FROM query_perf
         ${where}
        ORDER BY ts DESC, id DESC
        LIMIT ?`,
    )
    .all(...params, limit) as RawRow[];

  return rows.map(rowFromRaw);
}

/** Load a single row by id (for the on-demand suggestion/scaffold routes). */
export function getQueryPerfById(db: Database.Database, id: number): QueryPerfRow | null {
  const r = db
    .prepare(
      `SELECT id, ts, actor_sub, actor_email, workspace, game, method, status,
              latency_ms, used_preaggs, preagg_hit, query_shape, error_excerpt,
              query_full, source
         FROM query_perf WHERE id = ?`,
    )
    .get(id) as RawRow | undefined;
  return r ? rowFromRaw(r) : null;
}

export interface QueryPerfSummary {
  total: number;
  failures: number;
  slow: number;
  fallthrough: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  /** Effective slow-200 threshold (ms) so the UI renders from server config, not a hardcoded constant. */
  slowMs: number;
}

/**
 * KPI rollup over a window. Percentiles are approximate (ordered offset) —
 * exact percentiles are not required for triage (KISS). `fallthrough` counts
 * 200s that used no pre-aggregation (raw Trino reads — the slow path).
 */
export function summarizeQueryPerf(db: Database.Database, since?: number): QueryPerfSummary {
  const where = since !== undefined ? 'WHERE ts >= ?' : '';
  const params = since !== undefined ? [since] : [];
  const agg = db
    .prepare(
      `SELECT
         COUNT(*)                                            AS total,
         SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END)      AS failures,
         SUM(CASE WHEN status = 200 AND latency_ms >= ? THEN 1 ELSE 0 END) AS slow,
         SUM(CASE WHEN status = 200 AND (used_preaggs IS NULL OR used_preaggs = '[]')
                  THEN 1 ELSE 0 END)                          AS fallthrough
       FROM query_perf ${where}`,
    )
    .get(SLOW_MS, ...params) as {
    total: number | null;
    failures: number | null;
    slow: number | null;
    fallthrough: number | null;
  };

  const total = agg.total ?? 0;
  return {
    total,
    failures: agg.failures ?? 0,
    slow: agg.slow ?? 0,
    fallthrough: agg.fallthrough ?? 0,
    p50LatencyMs: percentile(db, 0.5, since),
    p95LatencyMs: percentile(db, 0.95, since),
    slowMs: SLOW_MS,
  };
}

/** Approximate percentile of latency over the window via ordered offset. */
function percentile(db: Database.Database, p: number, since?: number): number {
  const where = since !== undefined ? 'WHERE ts >= ?' : '';
  const params = since !== undefined ? [since] : [];
  const countRow = db
    .prepare(`SELECT COUNT(*) AS n FROM query_perf ${where}`)
    .get(...params) as { n: number };
  const n = countRow.n ?? 0;
  if (n === 0) return 0;
  const offset = Math.min(n - 1, Math.floor(p * n));
  const row = db
    .prepare(
      `SELECT latency_ms FROM query_perf ${where}
        ORDER BY latency_ms ASC LIMIT 1 OFFSET ?`,
    )
    .get(...params, offset) as { latency_ms: number } | undefined;
  return row?.latency_ms ?? 0;
}

/** Delete rows older than `cutoff` (epoch ms). Returns rows removed. */
export function pruneQueryPerfBefore(db: Database.Database, cutoff: number): number {
  return db.prepare('DELETE FROM query_perf WHERE ts < ?').run(cutoff).changes;
}
