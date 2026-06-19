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
import { randomUUID } from 'node:crypto';
import { postJson, ServerClientError } from '../services/server-client.js';
import type { ToolContext } from '../types.js';
import type { SegmentableMeasure, PopulationOver } from './get-segmentable-measures.js';
import type {
  PredicateNode,
  LeafNode,
  GroupNode,
} from '../types/predicate-tree.js';
import {
  cubeQueryToPredicateTree,
  type CubeInputFilter,
} from '../utils/cube-query-to-predicate-tree.js';

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
    .describe('Required when kind=threshold. The minimum value (inclusive).'),
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
  language: z
    .enum(['en', 'vi', 'mixed'])
    .default('en')
    .describe('Turn language — disclosures include Vietnamese lines when vi/mixed.'),
};

// ---------------------------------------------------------------------------
// Cutoff resolution response shape from the server
// ---------------------------------------------------------------------------

interface CutoffResponse {
  cutoff: number;
  populationCount: number;
  estCount: number;
}

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
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

type OkResult = { ok: true; proposal_emitted: true; name: string; estCount: number };
type ErrResult = {
  ok: false;
  error:
    | 'missing_threshold_value'
    | 'missing_percentile'
    | 'missing_top_n'
    | 'missing_population'
    | 'cutoff_failed'
    | 'invalid_over'
    | 'missing_filters'
    | 'missing_cube'
    | 'invalid_filters'
    | 'missing_measure'
    | 'unknown';
  detail: string;
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(
  args: {
    game_id: string;
    name: string;
    kind: 'threshold' | 'percentile' | 'top_n' | 'query';
    measure?: SegmentableMeasure;
    threshold_value?: number;
    percentile_top_pct?: number;
    top_n?: number;
    filters?: CubeInputFilter[];
    cube?: string;
    suggested_visibility?: 'personal' | 'shared' | 'org';
    language?: 'en' | 'vi' | 'mixed';
  },
  ctx: ToolContext,
): Promise<OkResult | ErrResult> {
  const { game_id, kind, suggested_visibility = 'personal', language = 'en' } = args;
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

// ---------------------------------------------------------------------------
// Per-kind handler arg shapes
// ---------------------------------------------------------------------------

/** Args shape for threshold/percentile/top_n handlers where measure is guaranteed present. */
type MeasureHandlerArgs = Omit<Parameters<typeof handler>[0], 'measure'> & {
  measure: SegmentableMeasure;
};

// ---------------------------------------------------------------------------
// Threshold path
// ---------------------------------------------------------------------------

async function handleThreshold(opts: {
  args: MeasureHandlerArgs;
  cube: string;
  isVi: boolean;
  ctx: ToolContext;
  suggested_visibility: 'personal' | 'shared' | 'org';
}): Promise<OkResult | ErrResult> {
  const { args, cube, isVi, ctx, suggested_visibility } = opts;
  const { measure } = args;

  if (args.threshold_value == null) {
    return { ok: false, error: 'missing_threshold_value', detail: 'threshold_value is required for kind=threshold.' };
  }

  const leaf: LeafNode = {
    kind: 'leaf',
    id: randomUUID(),
    member: measure.dimension,
    type: 'number',
    op: 'gte',
    values: [args.threshold_value],
  };
  const predicate: GroupNode = { kind: 'group', id: randomUUID(), op: 'AND', children: [leaf] };

  const windowLabel = measure.window ?? 'lifetime';
  const currencyNote = measure.currency ? ` (${measure.currency})` : '';
  const disclosures = buildDisclosures({
    kind: 'threshold',
    label: measure.label,
    value: args.threshold_value,
    currency: measure.currency,
    window: measure.window,
    isVi,
  });

  const proposal: SegmentProposal = {
    type: 'segment_proposal',
    name: args.name,
    game_id: args.game_id,
    cube,
    predicate_tree: predicate,
    resolved: {
      // estCount unknown without a server call for a plain threshold; disclose this.
      estCount: 0,
      population: `${measure.label} ≥ ${args.threshold_value}${currencyNote} (${windowLabel})`,
    },
    disclosures: [
      ...disclosures,
      isVi
        ? 'Số lượng thành viên ước tính chưa được tính. Nhấn Xác nhận để lưu và làm mới.'
        : 'Estimated count not pre-computed for fixed thresholds. Confirm to save and refresh.',
    ],
    suggestedVisibility: suggested_visibility,
  };

  ctx.sseEmitter.emit('segment_proposal', proposal);

  return { ok: true, proposal_emitted: true, name: args.name, estCount: 0 };
}

// ---------------------------------------------------------------------------
// Percentile path
// ---------------------------------------------------------------------------

async function handlePercentile(opts: {
  args: MeasureHandlerArgs;
  cube: string;
  isVi: boolean;
  ctx: ToolContext;
  suggested_visibility: 'personal' | 'shared' | 'org';
}): Promise<OkResult | ErrResult> {
  const { args, cube, isVi, ctx, suggested_visibility } = opts;
  const { measure, game_id } = args;

  if (args.percentile_top_pct == null) {
    return { ok: false, error: 'missing_percentile', detail: 'percentile_top_pct is required for kind=percentile.' };
  }

  // top X% → at or above the (100-X)th percentile
  const p = 100 - args.percentile_top_pct;

  // Percentile without a scoped population is silently wrong for spend-like
  // measures: the median free user spent 0, so the p50 cutoff selects everyone.
  if (!measure.over) {
    return {
      ok: false,
      error: 'missing_population',
      detail:
        `${measure.label} has no population scope in the catalog. ` +
        'Ask the user to specify the population (e.g. "among payers only").',
    };
  }

  const cutoffResult = await resolveCutoff(
    { game_id, p, gte: true, over: measure.over },
    ctx,
  );
  if (!cutoffResult.ok) return cutoffResult;

  const { cutoff, estCount, populationCount } = cutoffResult.data;

  const leaf: LeafNode = {
    kind: 'leaf',
    id: randomUUID(),
    member: measure.dimension,
    type: 'number',
    op: 'percentileGte',
    values: [{ p, over: measure.over }],
  };
  const predicate: GroupNode = { kind: 'group', id: randomUUID(), op: 'AND', children: [leaf] };

  const populationLabel = populationLabelFor(measure);
  const disclosures = buildDisclosures({
    kind: 'percentile',
    label: measure.label,
    topPct: args.percentile_top_pct,
    p,
    cutoff,
    currency: measure.currency,
    window: measure.window,
    populationLabel,
    isVi,
  });

  const proposal: SegmentProposal = {
    type: 'segment_proposal',
    name: args.name,
    game_id,
    cube,
    predicate_tree: predicate,
    resolved: {
      cutoff,
      estCount,
      populationCount,
      population: populationLabel,
    },
    disclosures,
    suggestedVisibility: suggested_visibility,
  };

  ctx.sseEmitter.emit('segment_proposal', proposal);

  return { ok: true, proposal_emitted: true, name: args.name, estCount };
}

// ---------------------------------------------------------------------------
// Top-N path (converts to percentile)
// ---------------------------------------------------------------------------

async function handleTopN(opts: {
  args: MeasureHandlerArgs;
  cube: string;
  isVi: boolean;
  ctx: ToolContext;
  suggested_visibility: 'personal' | 'shared' | 'org';
}): Promise<OkResult | ErrResult> {
  const { args, cube, isVi, ctx, suggested_visibility } = opts;
  const { measure, game_id } = args;

  if (args.top_n == null || args.top_n < 1) {
    return { ok: false, error: 'missing_top_n', detail: 'top_n is required and must be ≥ 1 for kind=top_n.' };
  }

  if (!measure.over) {
    return {
      ok: false,
      error: 'missing_population',
      detail:
        `${measure.label} has no population scope in the catalog. ` +
        'Ask the user to specify the population (e.g. "among payers only").',
    };
  }

  // Step 1: get population count via a probe cutoff call at p=50.
  // Any valid p works here — we only need populationCount from the response.
  const probeResult = await resolveCutoff(
    { game_id, p: 50, gte: true, over: measure.over },
    ctx,
  );
  if (!probeResult.ok) return probeResult;

  const { populationCount } = probeResult.data;

  // Step 2: derive the percentile from top-N.
  // Clamp to (0, 100) — if N >= population treat as 0.1% (nearly everyone).
  const rawP = 100 * (1 - args.top_n / populationCount);
  const p = Math.max(0.1, Math.min(99.9, rawP));

  // Step 3: resolve actual cutoff at the derived percentile.
  const cutoffResult = await resolveCutoff(
    { game_id, p, gte: true, over: measure.over },
    ctx,
  );
  if (!cutoffResult.ok) return cutoffResult;

  const { cutoff, estCount } = cutoffResult.data;

  const leaf: LeafNode = {
    kind: 'leaf',
    id: randomUUID(),
    member: measure.dimension,
    type: 'number',
    op: 'percentileGte',
    values: [{ p, over: measure.over }],
  };
  const predicate: GroupNode = { kind: 'group', id: randomUUID(), op: 'AND', children: [leaf] };

  const populationLabel = populationLabelFor(measure);
  const disclosures = buildDisclosures({
    kind: 'top_n',
    label: measure.label,
    topN: args.top_n,
    p,
    cutoff,
    currency: measure.currency,
    window: measure.window,
    populationLabel,
    populationCount,
    isVi,
  });

  const proposal: SegmentProposal = {
    type: 'segment_proposal',
    name: args.name,
    game_id,
    cube,
    predicate_tree: predicate,
    resolved: {
      cutoff,
      estCount,
      populationCount,
      population: populationLabel,
    },
    disclosures,
    suggestedVisibility: suggested_visibility,
  };

  ctx.sseEmitter.emit('segment_proposal', proposal);

  return { ok: true, proposal_emitted: true, name: args.name, estCount };
}

// ---------------------------------------------------------------------------
// Query path — plain dimension filters from an already-explored Cube query
// ---------------------------------------------------------------------------

async function handleQuery(opts: {
  args: Parameters<typeof handler>[0];
  isVi: boolean;
  ctx: ToolContext;
  suggested_visibility: 'personal' | 'shared' | 'org';
}): Promise<OkResult | ErrResult> {
  const { args, isVi, ctx, suggested_visibility } = opts;

  if (!args.filters || args.filters.length === 0) {
    return {
      ok: false,
      error: 'missing_filters',
      detail:
        'filters is required for kind=query. Pass the filters array from the ' +
        'Cube query the user just explored.',
    };
  }

  if (!args.cube || !args.cube.trim()) {
    return {
      ok: false,
      error: 'missing_cube',
      detail:
        'cube is required for kind=query. Pass the logical cube name ' +
        '(member prefix, e.g. "mf_users").',
    };
  }

  // Translate the Cube filters array to a PredicateNode. cubeQueryToPredicateTree
  // enforces all segment-legality guardrails (no measure filters, no time-in-OR,
  // no order+limit without a ranked measure).
  const translateResult = cubeQueryToPredicateTree({ filters: args.filters });
  if (!translateResult.ok) {
    return {
      ok: false,
      error: 'invalid_filters',
      detail: `${translateResult.reason}: ${translateResult.hint}`,
    };
  }

  const cube = args.cube.trim();
  const disclosures = buildQueryDisclosures({ name: args.name, cube, isVi });

  const proposal: SegmentProposal = {
    type: 'segment_proposal',
    name: args.name,
    game_id: args.game_id,
    cube,
    predicate_tree: translateResult.predicate,
    resolved: {
      // No cutoff for plain predicate segments. estCount is computed on confirm-refresh.
      estCount: 0,
      population: `matching the explored query filters on ${cube}`,
    },
    disclosures,
    suggestedVisibility: suggested_visibility,
  };

  ctx.sseEmitter.emit('segment_proposal', proposal);

  return { ok: true, proposal_emitted: true, name: args.name, estCount: 0 };
}

// ---------------------------------------------------------------------------
// Cutoff resolution
// ---------------------------------------------------------------------------

async function resolveCutoff(
  payload: { game_id: string; p: number; gte: boolean; over: PopulationOver },
  ctx: ToolContext,
): Promise<{ ok: true; data: CutoffResponse } | ErrResult> {
  try {
    const data = await postJson<CutoffResponse>(
      '/api/segments/resolve-cutoff',
      payload,
      ctx,
    );
    return { ok: true, data };
  } catch (err) {
    const detail =
      err instanceof ServerClientError
        ? `HTTP ${err.status}: ${JSON.stringify(err.body)}`
        : String(err);
    return { ok: false, error: 'cutoff_failed', detail };
  }
}

// ---------------------------------------------------------------------------
// Disclosure builder
// ---------------------------------------------------------------------------

type DisclosureParams =
  | {
      kind: 'threshold';
      label: string;
      value: number;
      currency?: string;
      window?: string;
      isVi: boolean;
    }
  | {
      kind: 'percentile';
      label: string;
      topPct: number;
      p: number;
      cutoff: number;
      currency?: string;
      window?: string;
      populationLabel: string;
      isVi: boolean;
    }
  | {
      kind: 'top_n';
      label: string;
      topN: number;
      p: number;
      cutoff: number;
      currency?: string;
      window?: string;
      populationLabel: string;
      populationCount: number;
      isVi: boolean;
    };

function buildDisclosures(params: DisclosureParams): string[] {
  const lines: string[] = [];
  const { isVi } = params;

  if (params.kind === 'threshold') {
    const win = params.window ?? 'lifetime';
    const cur = params.currency ? ` ${params.currency}` : '';
    lines.push(`Segment: ${params.label} ≥ ${params.value}${cur} (${win} window).`);
    if (isVi) {
      lines.push(`Phân khúc: ${params.label} ≥ ${params.value}${cur} (cửa sổ ${win}).`);
    }
    lines.push(
      'This is a fixed threshold — the count updates each time the segment is refreshed ' +
        'as users cross or drop below the threshold.',
    );
    if (isVi) {
      lines.push('Ngưỡng cố định — số lượng cập nhật mỗi lần làm mới phân khúc.');
    }
  }

  if (params.kind === 'percentile') {
    const cur = params.currency ? ` ${params.currency}` : '';
    const win = params.window ? ` (${params.window})` : '';
    const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    lines.push(
      `Top ${params.topPct}% of ${params.populationLabel} by ${params.label}${win}.`,
    );
    lines.push(
      `Resolved cutoff: ≥ ${fmt(params.cutoff)}${cur} at the ${params.p.toFixed(1)}th percentile.`,
    );
    lines.push(
      'Rolling percentile: the cutoff is re-resolved each time the segment refreshes, ' +
        'so membership changes as the population distribution shifts.',
    );
    if (isVi) {
      lines.push(`Top ${params.topPct}% ${params.populationLabel} theo ${params.label}${win}.`);
      lines.push(`Ngưỡng giải quyết: ≥ ${fmt(params.cutoff)}${cur} ở phân vị thứ ${params.p.toFixed(1)}.`);
      lines.push(
        'Phân vị động: ngưỡng được tính lại mỗi lần làm mới, thành viên thay đổi theo phân phối dân số.',
      );
    }
  }

  if (params.kind === 'top_n') {
    const cur = params.currency ? ` ${params.currency}` : '';
    const win = params.window ? ` (${params.window})` : '';
    const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    const pctDisplay = (100 - params.p).toFixed(1);
    lines.push(
      `Requested top ${fmt(params.topN)} out of ${fmt(params.populationCount)} ${params.populationLabel}.`,
    );
    lines.push(
      `Converted to top ≈${pctDisplay}% by ${params.label}${win} (percentile ≥${params.p.toFixed(1)}).`,
    );
    lines.push(`Resolved cutoff: ≥ ${fmt(params.cutoff)}${cur}.`);
    lines.push(
      'Rolling approximation: stored as a percentile, so the count drifts as the population changes. ' +
        'The absolute count may not equal exactly ' + fmt(params.topN) + ' after each refresh.',
    );
    if (isVi) {
      lines.push(
        `Yêu cầu top ${fmt(params.topN)} trong ${fmt(params.populationCount)} ${params.populationLabel}.`,
      );
      lines.push(
        `Chuyển thành top ≈${pctDisplay}% theo ${params.label}${win} (phân vị ≥${params.p.toFixed(1)}).`,
      );
      lines.push(
        'Xấp xỉ động: lưu dưới dạng phân vị, số lượng thực tế có thể thay đổi sau mỗi lần làm mới.',
      );
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function populationLabelFor(measure: SegmentableMeasure): string {
  // Derive a readable population label from the measure concept.
  // Catalog entries for spend-like measures typically describe payers or active users.
  // Use the concept as the fallback.
  return measure.label ? `${measure.label} population` : measure.concept;
}

/**
 * Disclosures for the query kind — plain dimension predicate segment.
 * No cutoff to resolve; count is computed at confirm-refresh time.
 */
function buildQueryDisclosures(params: {
  name: string;
  cube: string;
  isVi: boolean;
}): string[] {
  const lines: string[] = [
    `Segment "${params.name}" will match users on cube ${params.cube} using the exact dimension filters from your explored query.`,
    'This is a rolling predicate segment — membership is re-evaluated each time the segment refreshes as dimension values change.',
    'Estimated count is not pre-computed. Confirm to save the segment and trigger a refresh.',
  ];
  if (params.isVi) {
    lines.push(
      `Phân khúc "${params.name}" sẽ lọc người dùng trên cube ${params.cube} theo các điều kiện lọc đã khám phá.`,
      'Đây là phân khúc điều kiện động — thành viên được đánh giá lại mỗi lần làm mới phân khúc.',
      'Số lượng ước tính chưa được tính. Nhấn Xác nhận để lưu và làm mới.',
    );
  }
  return lines;
}
