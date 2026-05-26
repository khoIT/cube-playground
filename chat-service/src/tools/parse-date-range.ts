/**
 * Tool: parse_date_range — phase 07 (reduced scope; the only nl-to-query
 * helper not subsumed by phase 02a).
 *
 * Use it when `disambiguate_query` returns a timeRange clarification or
 * when the model wants to confirm a date-phrase interpretation before
 * preview_cube_query. Input text length is bounded to prevent regex DOS.
 *
 * Returns `null` when no rule matches. The model should retry
 * disambiguate_query with the pinned `dateRange` rather than guessing.
 */

import { z } from 'zod';
import { resolveDateRanges, type ResolvedDate, type Granularity } from '../nl-to-query/date-resolver.js';
import type { ToolContext } from '../types.js';

export const name = 'parse_date_range';
export const description =
  'Resolve a Vietnamese / English date phrase (e.g. "last 7 days", "Q1 2026", ' +
  '"tuần trước") into a Cube-compatible dateRange tuple + granularity hint. ' +
  'Returns null when no rule matches. Call this when disambiguate_query asks ' +
  'a timeRange clarification, or when you want to confirm a phrase before ' +
  'building a query.';

const GRANULARITIES = ['day', 'week', 'month', 'quarter', 'year'] as const;

export const inputSchema = {
  text: z.string().min(1).max(200),
  granularity: z.enum(GRANULARITIES).optional(),
  referenceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/, 'must be ISO 8601 date')
    .optional(),
};

export interface ParseDateRangeResult {
  dateRange: string | [string, string];
  granularity?: Granularity;
  phrase: string;
}

export async function handler(
  args: { text: string; granularity?: Granularity; referenceDate?: string },
  _ctx: ToolContext,
): Promise<ParseDateRangeResult | null> {
  const now = args.referenceDate ? Date.parse(args.referenceDate) : Date.now();
  if (Number.isNaN(now)) return null;

  const hits = resolveDateRanges(args.text, now);
  if (hits.length === 0) return null;

  // Pick the longest-span (most-specific) hit; date-resolver already sorts by
  // span start position, so we re-sort by span length here.
  const best = pickLongest(hits);
  return {
    dateRange: best.dateRange,
    granularity: args.granularity ?? best.granularity,
    phrase: best.alias,
  };
}

function pickLongest(hits: ResolvedDate[]): ResolvedDate {
  let best = hits[0]!;
  let bestLen = best.span[1] - best.span[0];
  for (const h of hits) {
    const len = h.span[1] - h.span[0];
    if (len > bestLen) {
      best = h;
      bestLen = len;
    }
  }
  return best;
}
