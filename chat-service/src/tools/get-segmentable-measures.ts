/**
 * Tool: get_segmentable_measures
 *
 * Fetches the catalog of measures that can be used as segment predicates for a
 * given game. Each entry carries the logical cube member (`dimension`), a
 * human-readable label, and — for spend-like distributions — a pre-scoped
 * population spec (`over`) for percentile resolution.
 *
 * The `over` spec is opaque to the LLM: it must be passed verbatim to
 * `propose_segment` without any modification. The field names reference
 * physical table/column paths that are server-controlled; fabricating them
 * would produce silent wrong segments.
 *
 * Maps to: GET /api/segments/segmentable-measures?game=<id>
 */

import { z } from 'zod';
import { getJson, ServerClientError } from '../services/server-client.js';
import type { ToolContext } from '../types.js';

export const name = 'get_segmentable_measures';
export const description =
  'Fetch the catalog of measures that can be used in segment predicates for a game. ' +
  'Each entry has a `concept` id, `label`, `dimension` (the logical Cube member to use as ' +
  'the predicate member), and optionally `over` (population scoping spec for percentiles). ' +
  'Always call this before propose_segment — never fabricate member or population values.';

export const inputSchema = {
  game: z.string().min(1).describe('Game id, e.g. "cfm_vn"'),
};

export interface SegmentableMeasure {
  /** Stable concept identifier, e.g. "ltv_vnd". */
  concept: string;
  /** Human-readable label for the measure. */
  label: string;
  /**
   * Logical Cube member to use as the predicate's `member` field.
   * Example: "mf_users.ltv_vnd". Use this verbatim in the predicate leaf.
   */
  dimension: string;
  /** Granularity window, e.g. "lifetime" or "30d". Used for window-matching. */
  window?: string;
  /** ISO 4217 currency code when the measure is monetary. */
  currency?: string;
  /**
   * Population scoping spec for percentile/top-N resolution.
   * Present for spend-like measures where an unscoped percentile collapses to
   * zero (the median free user spent nothing). Pass verbatim to propose_segment
   * — never modify table/column fields.
   */
  over?: PopulationOver;
}

export interface PopulationOver {
  table: string;
  column: string;
  filter?: unknown;
  identityMerge?: unknown;
}

interface CatalogResponse {
  measures: SegmentableMeasure[];
}

type OkResult = { ok: true; measures: SegmentableMeasure[] };
type ErrResult = { ok: false; error: 'server_error' | 'not_found'; detail: unknown };

export async function handler(
  args: { game: string },
  ctx: ToolContext,
): Promise<OkResult | ErrResult> {
  const path = `/api/segments/segmentable-measures?game=${encodeURIComponent(args.game)}`;
  try {
    const data = await getJson<CatalogResponse>(path, ctx);
    return { ok: true, measures: data.measures ?? [] };
  } catch (err) {
    if (err instanceof ServerClientError) {
      if (err.status === 404) {
        return { ok: false, error: 'not_found', detail: { game: args.game } };
      }
      return { ok: false, error: 'server_error', detail: { status: err.status, body: err.body } };
    }
    return { ok: false, error: 'server_error', detail: { message: String(err) } };
  }
}
