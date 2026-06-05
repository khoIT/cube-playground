/**
 * Tool: get_time_coverage
 * Finds the latest date with data for a cube's time dimension by walking
 * 31-day windows backwards from today — one bounded probe per window, first
 * non-empty window returns its max date. Replaces the agent's blind
 * trial-and-error preview probing when "this month" turns out to be ahead of
 * the data pipeline (e.g. asking for June when the cube stops at April).
 * Window size respects behavior-cube guards that require a ≤31-day bound.
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

  for (let i = 0; i < maxWindows; i++) {
    // Window i: [today - (i+1)*31 + 1 day, today - i*31] — contiguous,
    // non-overlapping, each exactly 31 days so per-window bound guards pass.
    const end = daysAgo(today, i * WINDOW_DAYS);
    const start = daysAgo(end, WINDOW_DAYS - 1);
    const dateRange: [string, string] = [fmtDate(start), fmtDate(end)];

    // Order desc + limit 1 → the single returned row carries the max date
    // within the window; no aggregation scan needed.
    const query = {
      dimensions: [args.member],
      timeDimensions: [{ dimension: args.member, dateRange }],
      order: { [args.member]: 'desc' },
      limit: 1,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Cube-Workspace': ctx.workspace,
        'X-Cube-Game': ctx.gameId,
      },
      body: JSON.stringify({ query }),
    });

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
