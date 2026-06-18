/**
 * Tool: get_time_coverage
 * Finds the latest date with data for a cube's time dimension by walking
 * 31-day windows backwards from today — one bounded probe per window, first
 * non-empty window returns its max date. Replaces the agent's blind
 * trial-and-error preview probing when "this month" turns out to be ahead of
 * the data pipeline (e.g. asking for June when the cube stops at April).
 * Window size respects behavior-cube guards that require a ≤31-day bound.
 *
 * Each probe attaches a cheap additive measure + day granularity so it can be
 * served by the cube's measure rollup. A bare dimension-only probe never
 * matches a measure rollup and falls through to a cold source scan — on heavy
 * derived cubes (e.g. retention's two-pass self-join) that is ~60s per window,
 * which used to exhaust the whole turn budget across 6 windows. Probes are also
 * bounded by an AbortController timeout so a cold backend can't hang the tool.
 */

import { z } from 'zod';
import { config } from '../config.js';
import * as cubeMetaCache from '../core/cube-meta-cache.js';
import { resolveMemberMeta } from '../core/cube-meta-capability.js';
import type { ToolContext } from '../types.js';

export const name = 'get_time_coverage';
export const description =
  'Find the latest date that actually has data for a cube time dimension, e.g. ' +
  'get_time_coverage({member:"etl_money_flow.log_date"}) → {found:true, latestDate:"2026-04-30"}. ' +
  'Call this ONCE when a preview on a recent date range returns 0 rows — the data pipeline may lag ' +
  'weeks behind today. Re-anchor your dateRange to latestDate and disclose the staleness to the user. ' +
  'Do NOT hunt for data by re-running preview_cube_query with shifted ranges.';

/** Window length per probe — matches the ≤31-day bound guard on behavior cubes. */
const WINDOW_DAYS = 31;
const DEFAULT_MAX_WINDOWS = 6;
/** Total wall-clock budget for the whole window walk. The core invariant: this
 * tool must never approach the turn budget (the incident: 6 unguarded cold
 * probes ≈ 300s killed the turn). A rollup-served walk finishes in well under a
 * second; only cold rollup-less cubes (~5-12s/window) ever approach this. */
const TOTAL_BUDGET_MS = 30_000;
/** Per-probe ceiling so one wedged request can't eat the whole budget alone;
 * the effective timeout is min(this, budget remaining). */
const PROBE_TIMEOUT_MS = 18_000;
/** Cube aggregation types that roll up additively, so attaching one routes the
 * probe to a measure rollup instead of a cold source scan. countDistinct
 * (exact) is excluded — it can't merge across rollup partitions. */
const ADDITIVE_AGG_TYPES = new Set(['count', 'sum', 'countDistinctApprox']);

export const inputSchema = {
  /** Time dimension ref, e.g. "etl_money_flow.log_date". */
  member: z.string().min(1),
  /** How many 31-day windows to walk back (default 6 ≈ 6 months). */
  maxWindows: z.number().int().min(1).max(24).optional(),
};

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(from: Date, days: number): Date {
  return new Date(from.getTime() - days * 86_400_000);
}

/**
 * Pick a cheap additive measure on the same cube as `member` so the probe can
 * hit that cube's measure rollup. Prefers count/sum (cheapest to roll up).
 * Returns null when the cube exposes no additive measure — caller then probes
 * dimension-only (correct, just slower) under the same timeout guard.
 */
function pickAdditiveMeasure(meta: any, member: string): string | null {
  const cubeName = member.includes('.') ? member.slice(0, member.indexOf('.')) : member;
  const cube = (meta?.cubes as Array<any> | undefined)?.find((c) => c?.name === cubeName);
  const measures: Array<{ name: string; type?: string; aggType?: string }> = cube?.measures ?? [];
  // Cube /meta reports result type ('number') in `type` and the aggregation in
  // `aggType`; fall back to `type` for callers/mocks that fold them together.
  const aggOf = (m: { type?: string; aggType?: string }) => m.aggType ?? m.type;
  const additive = measures.filter((m) => {
    const agg = aggOf(m);
    return agg !== undefined && ADDITIVE_AGG_TYPES.has(agg);
  });
  // Prefer count, then sum, then any additive — count rollups are smallest.
  return (
    additive.find((m) => aggOf(m) === 'count')?.name ??
    additive.find((m) => aggOf(m) === 'sum')?.name ??
    additive[0]?.name ??
    null
  );
}

export async function handler(
  args: { member: string; maxWindows?: number },
  ctx: ToolContext,
): Promise<unknown> {
  const maxWindows = args.maxWindows ?? DEFAULT_MAX_WINDOWS;
  const meta = await cubeMetaCache.getMeta(ctx.gameId, ctx.workspace);
  const resolved = resolveMemberMeta(meta, args.member);

  // Coverage only makes sense over a time axis. Reject measures and plain
  // dimensions with an actionable message instead of sending a query Cube
  // would reject (or that would order nonsensically).
  if (resolved.kind !== 'timeDimension') {
    return {
      member: args.member,
      found: false,
      probedWindows: 0,
      error:
        `${args.member} is a ${resolved.kind}, not a time dimension — pass the cube's date/time ` +
        'column (resolve_query_terms shows dataType "time").',
    };
  }

  const today = new Date();
  const url = `${config.serverBaseUrl}/cube-api/v1/load`;
  // Attaching an additive measure + day granularity lets the probe route to a
  // measure rollup; without one it falls through to a (possibly cold) source
  // scan. Either way the AbortController below bounds the wall-clock.
  const probeMeasure = pickAdditiveMeasure(meta, args.member);
  const deadline = Date.now() + TOTAL_BUDGET_MS;

  for (let i = 0; i < maxWindows; i++) {
    // Stop before a probe that can't finish inside the remaining budget rather
    // than risk overshooting it; report what we covered so the agent proceeds.
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return {
        member: args.member,
        found: false,
        probedWindows: i,
        timedOut: true,
        note:
          `Coverage probing hit its ${TOTAL_BUDGET_MS / 1000}s budget after ${i} window(s) on a ` +
          'cold/slow backend. Proceed with the user\'s requested range and disclose that data ' +
          'freshness could not be confirmed; do not re-probe.',
      };
    }
    // Window i: [today - (i+1)*31 + 1 day, today - i*31] — contiguous,
    // non-overlapping, each exactly 31 days so per-window bound guards pass.
    const end = daysAgo(today, i * WINDOW_DAYS);
    const start = daysAgo(end, WINDOW_DAYS - 1);
    const dateRange: [string, string] = [fmtDate(start), fmtDate(end)];

    // Order desc + limit 1 → the single returned row carries the max date
    // within the window. With a rollup-eligible measure we add day granularity
    // (rollups are keyed by their granularity); the time dim is still returned
    // under its bare ref so row[args.member] resolves either way.
    const query = probeMeasure
      ? {
          measures: [probeMeasure],
          timeDimensions: [{ dimension: args.member, granularity: 'day', dateRange }],
          order: { [args.member]: 'desc' },
          limit: 1,
        }
      : {
          dimensions: [args.member],
          timeDimensions: [{ dimension: args.member, dateRange }],
          order: { [args.member]: 'desc' },
          limit: 1,
        };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(PROBE_TIMEOUT_MS, remaining));
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Cube-Workspace': ctx.workspace,
          'X-Cube-Game': ctx.gameId,
        },
        body: JSON.stringify({ query }),
        signal: ctrl.signal,
      });
    } catch (err) {
      // Timed-out (aborted) probe on a cold backend. Probing further windows
      // would hit the same cold path, so bail with an actionable result rather
      // than chaining 6 slow scans into the turn budget.
      if (err instanceof Error && err.name === 'AbortError') {
        return {
          member: args.member,
          found: false,
          probedWindows: i + 1,
          timedOut: true,
          note:
            `Coverage probe timed out on a cold/slow backend (window ${dateRange[0]}..${dateRange[1]}). ` +
            "Proceed with the user's requested range and disclose that data freshness could not be " +
            'confirmed; do not re-probe.',
        };
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Cube /load failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as { data?: Record<string, string | number>[] };
    const row = data?.data?.[0];
    const raw = row?.[args.member];
    if (raw !== null && raw !== undefined) {
      return {
        member: args.member,
        found: true,
        // Cube returns time values as ISO timestamps — trim to the date part.
        latestDate: String(raw).slice(0, 10),
        probedWindows: i + 1,
        searchedBack: dateRange[0],
      };
    }
  }

  const oldestStart = fmtDate(daysAgo(today, maxWindows * WINDOW_DAYS - 1));
  return {
    member: args.member,
    found: false,
    probedWindows: maxWindows,
    searchedBack: oldestStart,
    note:
      `No data between ${oldestStart} and today. The cube may be empty for this game, ` +
      'or the data is older — retry with a larger maxWindows if the user asked about an older period.',
  };
}
