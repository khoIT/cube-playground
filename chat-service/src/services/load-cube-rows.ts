/**
 * load-cube-rows — execute a Cube /load query and return rows, with the same
 * cache + normalization behavior preview_cube_query has always used.
 *
 * Extracted from preview-cube-query so other callers (the emit_query_artifact
 * deterministic-chart fallback) can share this load path. preview_cube_query
 * now delegates here; behavior is unchanged. Note the cache key includes the
 * row limit, so preview (≤50) and the fallback (MAX_ROWS=100) don't necessarily
 * share a cached entry — each caller still benefits from repeat-call caching.
 *
 * Coverage-aware variant: when a query with a RELATIVE date range returns zero
 * rows, `loadCubeRowsCovered` probes the cube's real data coverage and re-runs
 * against a same-width window ending on the latest date that has data — so a
 * chart renders instead of an empty card. An EXPLICIT [from,to] range the user
 * pinned is never silently moved; it returns empty plus the coverage date so the
 * caller can disclose "no data in that range; latest is <date>".
 */

import { config } from '../config.js';
import * as cubeMetaCache from '../core/cube-meta-cache.js';
import { getCachedLoad, putCachedLoad } from '../cache/load-cache-adapter.js';
import { normalizeCubeDateRanges, clampAnalysisWindows } from '../tools/normalize-cube-date-range.js';
import {
  isRelativeRange,
  rangeWidthDays,
  resolveCoverageLatest,
  snapWindow,
  type DateRange,
} from './resolve-coverage-range.js';
import type { CubeQuerySchema } from '../tools/preview-cube-query.js';
import type { z } from 'zod';
import type { ToolContext } from '../types.js';

type CubeQuery = z.infer<typeof CubeQuerySchema>;
type CubeRow = Record<string, string | number>;

/** Describes any coverage-driven rewrite applied to an empty query. */
export interface CoverageSnap {
  /** Time dimension the coverage was probed on, e.g. "active_daily.log_date". */
  member: string;
  /** Latest date with data, or null if the probe found nothing / timed out. */
  latestDate: string | null;
  /** True when the range was rewritten and the query re-run against real data. */
  applied: boolean;
  /** Whether the original range was relative (auto-snappable) or explicit. */
  kind: 'relative' | 'explicit';
  /** The (normalized) range originally requested. */
  requestedRange?: DateRange;
  /** The window actually queried after snapping (present when applied). */
  snappedRange?: [string, string];
}

export interface LoadCubeResult {
  rows: CubeRow[];
  /** The query actually executed — equals the input unless a snap was applied. */
  query: CubeQuery;
  snap?: CoverageSnap;
}

/**
 * Execute one already-normalized Cube /load (with `limit`) and return rows.
 * Handles the load cache (read + write of non-empty results) and the abort
 * safety net. No coverage logic — that lives in loadCubeRowsCovered.
 */
async function fetchRows(query: CubeQuery, ctx: ToolContext, maxRows: number): Promise<CubeRow[]> {
  // Cache key includes cube_meta_hash so schema changes invalidate entries.
  // Skip silently when there's no db handle on ctx (unit tests).
  const metaHash = await cubeMetaCache.getMetaVersion(ctx.gameId, ctx.workspace).catch(() => null);
  if (ctx.db) {
    const cached = getCachedLoad(ctx.db, { query, gameId: ctx.gameId, metaHash });
    if (cached) return cached.slice(0, maxRows);
  }

  // Route through the workspace-aware Fastify proxy — it resolves auth + base
  // URL from the X-Cube-Workspace header server-side. The proxy polls Cube's
  // continue-wait windows up to its own budget; this abort is a safety net for
  // a wedged connection, set just above the proxy budget so the proxy's own
  // bounded response wins under normal warming.
  const url = `${config.serverBaseUrl}/cube-api/v1/load`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), config.cubeLoadTimeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Cube-Workspace': ctx.workspace,
        'X-Cube-Game': ctx.gameId,
        // Tag query telemetry with the originating chat conversation.
        'X-Cube-Source': ctx.sessionId ? `chat:${ctx.sessionId}` : 'chat',
      },
      body: JSON.stringify({ query }),
      signal: ctl.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(
        `Cube /load timed out after ${Math.round(config.cubeLoadTimeoutMs / 1000)}s`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Cube /load failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { data?: CubeRow[] };
  const rows = data?.data ?? [];

  // Real results cache; empty results don't (almost always transient — caching
  // would freeze a "no data" state for the cache TTL).
  if (ctx.db && rows.length > 0) {
    putCachedLoad(ctx.db, { query, gameId: ctx.gameId, metaHash, rows });
  }

  return rows.slice(0, maxRows);
}

/**
 * Find the single time dimension carrying a dateRange — the only case we can
 * unambiguously snap. Returns null when there are zero or multiple such dims.
 * `kind` is read from the RAW (pre-normalize) range so a relative phrase that
 * normalization rewrote to a tuple is still treated as relative.
 */
function eligibleTimeDim(
  rawQuery: CubeQuery,
  normalized: CubeQuery,
): { member: string; kind: 'relative' | 'explicit'; requestedRange?: DateRange } | null {
  const withRange = (rawQuery.timeDimensions ?? []).filter((td) => td.dateRange !== undefined);
  if (withRange.length !== 1) return null;
  const member = withRange[0].dimension;
  const kind = isRelativeRange(withRange[0].dateRange as DateRange | undefined)
    ? 'relative'
    : 'explicit';
  const normTd = (normalized.timeDimensions ?? []).find((td) => td.dimension === member);
  return { member, kind, requestedRange: normTd?.dateRange as DateRange | undefined };
}

function withSnappedRange(query: CubeQuery, member: string, range: [string, string]): CubeQuery {
  return {
    ...query,
    timeDimensions: (query.timeDimensions ?? []).map((td) =>
      td.dimension === member ? { ...td, dateRange: range } : td,
    ),
  };
}

/**
 * Run a Cube /load and, on an empty RELATIVE-range result, snap to the latest
 * window that has data and re-run once. Returns the rows, the query actually
 * executed, and (when coverage was consulted) a `snap` describing what happened
 * so the caller can keep its deeplink in sync and disclose the shift.
 *
 * `snapOnEmpty: false` disables the coverage step (the plain executor).
 */
export async function loadCubeRowsCovered(
  rawQuery: CubeQuery,
  ctx: ToolContext,
  opts: { maxRows: number; snapOnEmpty?: boolean },
): Promise<LoadCubeResult> {
  const snapOnEmpty = opts.snapOnEmpty ?? true;
  const normalizedTds = normalizeCubeDateRanges(rawQuery.timeDimensions);
  // Cap the scan window before the /load so a long-range query can't trigger a
  // multi-month cold scan on the heavy event cubes. Disclosure to the user lives
  // in the caller (emit_query_artifact); here it only bounds the read.
  const clamped = clampAnalysisWindows(normalizedTds, config.analysisMaxWindowDays);
  const query = { ...rawQuery, timeDimensions: clamped.timeDimensions, limit: opts.maxRows };

  const rows = await fetchRows(query, ctx, opts.maxRows);
  if (rows.length > 0 || !snapOnEmpty) return { rows, query };

  const eligible = eligibleTimeDim(rawQuery, query);
  if (!eligible) return { rows, query };

  const { member, kind, requestedRange } = eligible;
  const latestDate = await resolveCoverageLatest(member, ctx);

  // Relative + a known latest date → snap to a same-width window and re-run.
  if (latestDate && kind === 'relative') {
    const width = rangeWidthDays(requestedRange);
    const snappedRange = snapWindow(latestDate, width);
    const snappedQuery = withSnappedRange(query, member, snappedRange);
    const retryRows = await fetchRows(snappedQuery, ctx, opts.maxRows);
    return {
      rows: retryRows,
      query: snappedQuery,
      snap: { member, latestDate, applied: true, kind, requestedRange, snappedRange },
    };
  }

  // Explicit range (never moved) or no coverage found → leave empty, disclose.
  return { rows, query, snap: { member, latestDate, applied: false, kind, requestedRange } };
}

/**
 * Back-compat thin wrapper: run a query and return rows only (with the same
 * coverage snap-on-empty behavior). Callers that need the snap metadata or the
 * effective query should use loadCubeRowsCovered.
 */
export async function loadCubeRows(
  rawQuery: CubeQuery,
  ctx: ToolContext,
  opts: { maxRows: number; snapOnEmpty?: boolean },
): Promise<CubeRow[]> {
  return (await loadCubeRowsCovered(rawQuery, ctx, opts)).rows;
}
