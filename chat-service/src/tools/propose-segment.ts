/**
 * Tool: propose_segment
 *
 * Validates a segment specification, resolves percentile cutoffs when needed,
 * assembles human-readable disclosures, and emits a `segment_proposal` SSE
 * event. This tool NEVER writes a segment — the frontend writes on user confirm.
 *
 * Accepts three predicate shapes:
 *
 *   threshold   — measure >= fixed value (e.g. "spend > 1000").
 *                 Builds a plain `gte` leaf; no cutoff call needed.
 *
 *   percentile  — measure in top P% (e.g. "top 25% spenders").
 *                 Converts to percentileGte; calls /resolve-cutoff to preview
 *                 the cutoff value and estimated cohort size.
 *
 *   top_n       — absolute count (e.g. "top 100 spenders").
 *                 Resolves population size via /resolve-cutoff, converts N to a
 *                 percentile, then continues as the percentile path.
 *
 * Guardrails (all return ok:false so the LLM can explain, never emit wrong data):
 *   - concept not in catalog → ask; don't guess a member name.
 *   - percentile/top_n with no `over` on the catalog entry → ask for population;
 *     an unscoped percentile of a spend column is 0 for the median free user,
 *     which selects the entire population — silently wrong.
 *   - `over.table` / `over.column` must come from the catalog, not fabricated
 *     by the LLM (re-validated here before the server call).
 */

import { z } from 'zod';
import type { ToolContext } from '../types.js';
import type { SegmentableMeasure } from './get-segmentable-measures.js';
import type { PredicateNode } from '../types/predicate-tree.js';
import type { CubeInputFilter } from '../utils/cube-query-to-predicate-tree.js';
import {
  handleThreshold,
  handleQuery,
  type OkResult,
  type ErrResult,
} from './propose-segment-handlers.js';
import {
  handlePercentile,
  handleTopN,
} from './propose-segment-cutoff-handlers.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const PopulationOverSchema = z.object({
  table: z.string(),
  column: z.string(),
  filter: z.unknown().optional(),
  identityMerge: z.unknown().optional(),
});

const SegmentableMeasureSchema = z.object({
  concept: z.string(),
  label: z.string(),
  dimension: z.string(),
  window: z.string().optional(),
  currency: z.string().optional(),
  over: PopulationOverSchema.optional(),
});

export const name = 'propose_segment';
export const description =
  'Validate a segment specification and emit a segment_proposal SSE event. ' +
  'Accepts four shapes: (1) threshold — fixed measure threshold (spend > 1000), ' +
  '(2) percentile — top P% of a population, (3) top_n — absolute top-N converted ' +
  'to a percentile, (4) query — plain dimension filters from a Cube query the user ' +
  'already explored ("save that as a segment"). ' +
  'For threshold/percentile/top_n: always call get_segmentable_measures first to ' +
  'get valid measure catalog entries — never fabricate member or population values. ' +
  'For query: pass the filters array from the last emit_query_artifact call ' +
  '(same shape as CubeQuery.filters) and the logical cube name (member prefix). ' +
  'This tool emits a proposal; it never creates or modifies a segment.';

// Recursive filter schema for kind='query'. Mirrors CubeInputFilter: supports
// leaf filters (member + operator + values) and logical AND/OR groups.
type CubeFilterInput = {
  member?: string;
  dimension?: string;
  operator?: string;
  values?: string[];
  and?: CubeFilterInput[];
  or?: CubeFilterInput[];
};
const CubeFilterInputSchema: z.ZodType<CubeFilterInput> = z.lazy(() =>
  z.object({
    member: z.string().optional(),
    dimension: z.string().optional(),
    operator: z.string().optional(),
    values: z.array(z.string()).optional(),
    and: z.array(CubeFilterInputSchema).optional(),
    or: z.array(CubeFilterInputSchema).optional(),
  }),
);

export const inputSchema = {
  game_id: z.string().min(1).describe('Game id, e.g. "cfm_vn"'),
  name: z.string().min(1).describe('Suggested segment name'),
  kind: z
    .enum(['threshold', 'percentile', 'top_n', 'query'])
    .describe(
      'threshold = fixed value predicate; percentile = top P% of population; ' +
        'top_n = absolute count converted to percentile; ' +
        'query = plain dimension filters from an already-explored Cube query ' +
        '(use when user says "save that as a segment" after emit_query_artifact)',
    ),
  measure: SegmentableMeasureSchema.optional().describe(
    'Required for threshold/percentile/top_n. ' +
      'Catalog entry from get_segmentable_measures. ' +
      'Pass the entry verbatim — do not modify dimension or over fields. ' +
      'Omit for kind=query.',
  ),
  /** threshold only */
  threshold_value: z
    .number()
    .optional()
    .describe('Required when kind=threshold. The bound value (inclusive). Direction set by threshold_op.'),
  /** threshold only: bound direction (ignored when threshold_value_max is set — that is a range) */
  threshold_op: z
    .enum(['gte', 'lte'])
    .default('gte')
    .describe(
      'Direction of the threshold bound for a SINGLE bound. gte (default) = "at least / ' +
        'more than" — measure >= value (e.g. "spent > 1000"). lte = "at most / under / ' +
        'fewer than" — measure <= value (e.g. "fewer than 3 active days"). Pick lte for any ' +
        '"under/below/at most/no more than" phrasing. Ignored when threshold_value_max is ' +
        'set (that makes it a range).',
    ),
  /** threshold only: upper bound of a range */
  threshold_value_max: z
    .number()
    .optional()
    .describe(
      'Optional upper bound for a RANGE threshold (e.g. "spent between 500 and 1000"). ' +
        'When set, the predicate is measure >= threshold_value AND measure <= ' +
        'threshold_value_max (both inclusive); threshold_op is ignored. Must be ≥ ' +
        'threshold_value. Omit for a single-bound threshold.',
    ),
  /** percentile only: top P% means p = 100 - P */
  percentile_top_pct: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe(
      'Required when kind=percentile. The top-X% you want, e.g. 25 for top 25%. ' +
        'The tool converts to the corresponding percentile rank automatically.',
    ),
  /** top_n only */
  top_n: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Required when kind=top_n. The absolute count, e.g. 100 for top 100.'),
  /** query only */
  filters: z
    .array(CubeFilterInputSchema)
    .optional()
    .describe(
      'Required when kind=query. The filters array from the Cube query the user ' +
        'just explored (same shape as CubeQuery.filters from emit_query_artifact). ' +
        'Supports leaf filters (member/operator/values) and logical AND/OR groups.',
    ),
  /** threshold/percentile/top_n: extra conditions AND-ed onto the main leaf */
  additional_filters: z
    .array(
      z.object({
        member: z
          .string()
          .describe('Fully-qualified member on the SAME cube, e.g. "mf_users.ltv_vnd".'),
        operator: z.enum(['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'set', 'notSet']),
        values: z.array(z.union([z.string(), z.number()])).optional(),
      }),
    )
    .optional()
    .describe(
      'Extra conditions AND-ed onto a threshold/percentile/top_n proposal so it ' +
        'expresses a COMPOUND predicate in one call — e.g. "top 25% by active days ' +
        'who never paid" = kind=percentile on active_days + additional_filters ' +
        '[{member:"mf_users.ltv_vnd", operator:"equals", values:[0]}]. All members ' +
        'must be on the same cube. Use this instead of probing for a cutoff and ' +
        'asking the user for a manual floor.',
    ),
  /** query only: logical cube name (member prefix, e.g. "mf_users") */
  cube: z
    .string()
    .optional()
    .describe(
      'Required when kind=query. The logical cube the query targeted, e.g. "mf_users". ' +
        'Use the prefix of the measure/dimension member names in the query.',
    ),
  suggested_visibility: z
    .enum(['personal', 'shared', 'org'])
    .default('personal')
    .describe('Suggested sharing level for the proposed segment.'),
  /** query only: lineage of the explored query this segment is crystallized from */
  source_query: z
    .object({
      artifact_id: z.string().optional(),
      question: z.string().optional(),
      cube_query: z.unknown().optional(),
    })
    .optional()
    .describe(
      'Lineage for kind=query. The explored query this segment came from — the ' +
        'artifact id and/or the user question. Carried to the segment\'s born_from ' +
        'so the cohort records its origin. Omit for threshold/percentile/top_n.',
    ),
  language: z
    .enum(['en', 'vi', 'mixed'])
    .default('en')
    .describe('Turn language — disclosures include Vietnamese lines when vi/mixed.'),
};

// ---------------------------------------------------------------------------
// Segment proposal SSE payload — matches the FE-facing contract exactly
// ---------------------------------------------------------------------------

export interface SegmentProposal {
  type: 'segment_proposal';
  name: string;
  game_id: string;
  /** Logical cube, e.g. "mf_users" (the prefix of measure.dimension). */
  cube: string;
  predicate_tree: PredicateNode;
  resolved: {
    cutoff?: number;
    estCount: number;
    populationCount?: number;
    population: string;
  };
  disclosures: string[];
  suggestedVisibility: 'personal' | 'shared' | 'org';
  /**
   * Lineage — the exploration this proposal came from ("save that as a segment"
   * after emit_query_artifact, or the FE "Build segment from this" bridge).
   * Threaded to the segment's `born_from` on create. Set only on kind=query.
   */
  source_query?: {
    artifact_id?: string;
    question?: string;
    cube_query?: unknown;
  };
  /**
   * Present only for edit proposals (propose_segment_edit). When set, the FE
   * confirms by PATCHing /api/segments/:id with `predicate_tree` instead of
   * POSTing a new segment. `previous_predicate_tree` powers the old→new diff.
   */
  edit?: {
    segment_id: string;
    previous_predicate_tree: PredicateNode;
  };
}

// ---------------------------------------------------------------------------
// Handler — validates shared preconditions then dispatches to per-kind handlers
// ---------------------------------------------------------------------------

export async function handler(
  args: {
    game_id: string;
    name: string;
    kind: 'threshold' | 'percentile' | 'top_n' | 'query';
    measure?: SegmentableMeasure;
    threshold_value?: number;
    threshold_op?: 'gte' | 'lte';
    threshold_value_max?: number;
    percentile_top_pct?: number;
    top_n?: number;
    filters?: CubeInputFilter[];
    additional_filters?: import('./propose-segment-handlers.js').AdditionalFilter[];
    cube?: string;
    suggested_visibility?: 'personal' | 'shared' | 'org';
    language?: 'en' | 'vi' | 'mixed';
    source_query?: { artifact_id?: string; question?: string; cube_query?: unknown };
  },
  ctx: ToolContext,
): Promise<OkResult | ErrResult> {
  const { kind, suggested_visibility = 'personal', language = 'en' } = args;
  const isVi = language === 'vi' || language === 'mixed';

  // kind='query' has its own validation path — skip measure checks.
  if (kind === 'query') {
    return handleQuery({ args, isVi, ctx, suggested_visibility });
  }

  // For threshold/percentile/top_n: measure is required.
  if (!args.measure) {
    return {
      ok: false,
      error: 'missing_measure',
      detail: 'measure is required for kind=threshold, kind=percentile, and kind=top_n.',
    };
  }
  const measure = args.measure;

  // Re-validate the `over` field came from a real catalog entry (not LLM-
  // fabricated): we check that if `over` is present, it has table + column as
  // non-empty strings. The server endpoint does the authoritative check; this
  // is a defence-in-depth guard that catches obvious hallucinations early.
  if (measure.over) {
    const { table, column } = measure.over;
    if (!table || !column || typeof table !== 'string' || typeof column !== 'string') {
      return {
        ok: false,
        error: 'invalid_over',
        detail:
          'The `over` population spec has empty table or column fields. ' +
          'Use the entry exactly as returned by get_segmentable_measures.',
      };
    }
  }

  // Derive the logical cube from the dimension member prefix (e.g. "mf_users.ltv_vnd" → "mf_users").
  const cube = measure.dimension.split('.')[0] ?? measure.dimension;

  switch (kind) {
    case 'threshold':
      return handleThreshold({ args: { ...args, measure }, cube, isVi, ctx, suggested_visibility });
    case 'percentile':
      return handlePercentile({ args: { ...args, measure }, cube, isVi, ctx, suggested_visibility });
    case 'top_n':
      return handleTopN({ args: { ...args, measure }, cube, isVi, ctx, suggested_visibility });
    default: {
      // Exhaustive check: kind narrowed to never here if all cases handled.
      const _exhaustive: never = kind;
      return { ok: false, error: 'unknown', detail: `Unknown kind: ${String(_exhaustive)}` };
    }
  }
}
