/**
 * Cutoff-based handlers for the propose_segment tool: percentile and top_n.
 *
 * Both paths call /api/segments/resolve-cutoff to translate a percentage or
 * absolute count into a concrete measure cutoff and estimated cohort size.
 * Kept separate from the non-cutoff handlers (threshold + query) so each
 * file stays comfortably under ~250 LOC.
 */

import { randomUUID } from 'node:crypto';
import type { ToolContext } from '../types.js';
import type { LeafNode, GroupNode } from '../types/predicate-tree.js';
import {
  resolveCutoff,
  type OkResult,
  type ErrResult,
  type MeasureHandlerArgs,
} from './propose-segment-handlers.js';
import {
  buildDisclosures,
  populationLabelFor,
} from './propose-segment-disclosures.js';
import type { SegmentProposal } from './propose-segment.js';

// ---------------------------------------------------------------------------
// Percentile path
// ---------------------------------------------------------------------------

export async function handlePercentile(opts: {
  args: MeasureHandlerArgs;
  cube: string;
  isVi: boolean;
  ctx: ToolContext;
  suggested_visibility: 'personal' | 'shared' | 'org';
}): Promise<OkResult | ErrResult> {
  const { args, cube, isVi, ctx, suggested_visibility } = opts;
  const { measure, game_id } = args;

  if (args.percentile_top_pct == null) {
    return {
      ok: false,
      error: 'missing_percentile',
      detail: 'percentile_top_pct is required for kind=percentile.',
    };
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
// Top-N path (converts absolute count to percentile, then resolves cutoff)
// ---------------------------------------------------------------------------

export async function handleTopN(opts: {
  args: MeasureHandlerArgs;
  cube: string;
  isVi: boolean;
  ctx: ToolContext;
  suggested_visibility: 'personal' | 'shared' | 'org';
}): Promise<OkResult | ErrResult> {
  const { args, cube, isVi, ctx, suggested_visibility } = opts;
  const { measure, game_id } = args;

  if (args.top_n == null || args.top_n < 1) {
    return {
      ok: false,
      error: 'missing_top_n',
      detail: 'top_n is required and must be ≥ 1 for kind=top_n.',
    };
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
