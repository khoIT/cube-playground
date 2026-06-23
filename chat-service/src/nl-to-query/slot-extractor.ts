/**
 * Combines the lexical resolvers (synonym, number, date) into a typed slot
 * representation the orchestrator can hand to the query composer and the
 * clarification builder. Metrics are anchored to a single primary hit;
 * everything else hangs off the same scan so confidences stay correlated.
 */

import type {
  DisambiguationSlots,
  MetricResolution,
  OfficialTerm,
  ScoredSlot,
  SlotFilter,
} from './types.js';
import { resolveTerms, unresolvedSpans, matchDimensionSynonym, type AliasHit } from './synonym-resolver.js';
import { resolveCubeRelativeDimension } from './member-resolution.js';
import { resolveMetric } from './metric-resolver.js';
import { classifyTerm } from './term-classifier.js';
import { parseNumbers, type ParsedNumber } from './number-normaliser.js';
import { resolveDateRanges, type ResolvedDate } from './date-resolver.js';
import { classifyIntent } from './intent-classifier.js';
import { cubeNameOf } from '../core/cube-meta-capability.js';
import { resolveDefaultMetric } from '../core/smart-defaults.js';

export interface ExtractInput {
  message: string;
  isVietnameseContext: boolean;
  now: number;
  glossary: OfficialTerm[];
  knownMembers?: Set<string>;
}

export interface ExtractResult {
  slots: DisambiguationSlots;
  unresolved: string[];
  warnings: string[];
  dates: ResolvedDate[];
  numbers: ParsedNumber[];
  hits: AliasHit[];
  /** The unified resolver's verdict — threaded out for the disclosure footer. */
  resolution?: MetricResolution;
}

/**
 * Map the unified resolver's verdict onto the metric (and, for ratios, the
 * ratio) slot. For ratio terms `metric.value` stays undefined — the ratio
 * slot is the metric — but `metric.confidence` carries the score so the
 * clarification builder and overall-confidence treat it like any metric.
 */
function buildMetricSlots(
  resolution: MetricResolution | null,
): { metric: ScoredSlot<string>; ratio?: DisambiguationSlots['ratio'] } {
  if (!resolution) return { metric: { value: undefined, confidence: 0 } };

  if (resolution.refKind === 'ratio' && resolution.ratioRef) {
    return {
      metric: {
        value: undefined,
        alias: resolution.alias,
        span: resolution.span,
        confidence: resolution.confidence,
      },
      ratio: resolution.ratioRef,
    };
  }

  return {
    metric: {
      value: resolution.ref ?? undefined,
      alias: resolution.alias,
      span: resolution.span,
      // Expression/unknown refs carry no member — keep confidence low so the
      // metric clarification surfaces the resolver's reason.
      confidence: resolution.ref ? resolution.confidence : Math.min(resolution.confidence, 0.3),
    },
  };
}

interface DimensionContext {
  message: string;
  /** Cube the metric resolved to — scopes a cube-relative breakdown member. */
  metricCube: string | null;
  knownMembers?: Set<string>;
}

function pickDimension(
  hits: AliasHit[],
  glossary: OfficialTerm[],
  ctx: DimensionContext,
): ScoredSlot<string> | undefined {
  const termById = new Map(glossary.map((t) => [t.id, t]));
  const dimHits = hits.filter((h) => {
    const term = termById.get(h.termId);
    return term ? classifyTerm(term) === 'dimension' : false;
  });
  const glossaryDim = dimHits[0];

  // Cube-relative override: a breakdown phrase whose physical member name
  // varies by cube (platform → os_platform | platform) must bind on the
  // metric's resolved cube. The glossary's static ref for these names a member
  // that often doesn't exist on this game's cube (the dead `mf_users.platform`),
  // which trips the /meta gate into a clarify. Prefer the live cube member.
  const synonym = matchDimensionSynonym(ctx.message);
  if (synonym && ctx.metricCube) {
    const member = resolveCubeRelativeDimension(ctx.metricCube, synonym, ctx.knownMembers);
    if (member) {
      return {
        value: member,
        alias: glossaryDim?.alias ?? synonym.family,
        span: glossaryDim?.span,
        confidence: 0.9,
      };
    }
  }

  if (!glossaryDim) return undefined;
  return {
    value: glossaryDim.cubeRef ?? undefined,
    alias: glossaryDim.alias,
    span: glossaryDim.span,
    confidence: glossaryDim.cubeRef ? 0.9 : 0.4,
  };
}

/** Map a glossary ConceptFilter op to the Cube filter operator vocabulary. */
const CONCEPT_OP_TO_CUBE: Record<string, string> = {
  '=': 'equals',
  '!=': 'notEquals',
  '>': 'gt',
  '>=': 'gte',
  '<': 'lt',
  '<=': 'lte',
  IN: 'equals',
  'NOT IN': 'notEquals',
};

function buildFilters(hits: AliasHit[], glossary: OfficialTerm[], numbers: ParsedNumber[]): SlotFilter[] | undefined {
  const termById = new Map(glossary.map((t) => [t.id, t]));
  const filterHits = hits.filter((h) => {
    const term = termById.get(h.termId);
    return term ? classifyTerm(term) === 'filter' : false;
  });
  if (filterHits.length === 0) return undefined;

  const filters: SlotFilter[] = [];
  for (const hit of filterHits) {
    const term = termById.get(hit.termId);
    // Bound segment/concept value (e.g. whale → mf_users.payer_tier = 'whale').
    // The term carries the exact member + op + value, so emit it verbatim —
    // this is the cube-member binding the /meta gate validates against.
    const df = term?.defaultFilter;
    if (df?.member) {
      const values = Array.isArray(df.value) ? df.value.map(String) : [String(df.value)];
      filters.push({
        member: df.member,
        operator: CONCEPT_OP_TO_CUBE[df.op] ?? 'equals',
        values,
        confidence: 0.8,
        alias: hit.alias,
      });
      continue;
    }
    if (!hit.cubeRef) continue;
    // Threshold filter: nearest number after the alias span anchors the cutoff.
    const closestNumber = numbers.find((n) => n.span[0] >= hit.span[1] && n.span[0] - hit.span[1] < 32);
    if (closestNumber) {
      filters.push({
        member: hit.cubeRef,
        operator: 'gt',
        values: [String(closestNumber.value)],
        confidence: 0.85,
        alias: hit.alias,
      });
    } else {
      filters.push({
        member: hit.cubeRef,
        operator: 'set',
        values: [],
        confidence: 0.7,
        alias: hit.alias,
      });
    }
  }
  return filters.length ? mergeEqualsByMember(filters) : undefined;
}

/**
 * Collapse multiple `equals` filters on the SAME member into one — Cube reads
 * an `equals` with several values as IN. "whale / dolphin / minnow" thus
 * becomes `payer_tier IN [whale,dolphin,minnow]` (a tier breakdown) instead of
 * three contradictory `= x` clauses that AND to an empty result. Other
 * operators (gt, set, …) are never merged.
 */
function mergeEqualsByMember(filters: SlotFilter[]): SlotFilter[] {
  const out: SlotFilter[] = [];
  const equalsByMember = new Map<string, SlotFilter>();
  for (const f of filters) {
    if (f.operator !== 'equals') {
      out.push(f);
      continue;
    }
    const existing = equalsByMember.get(f.member);
    if (existing) {
      for (const v of f.values) if (!existing.values.includes(v)) existing.values.push(v);
    } else {
      const copy = { ...f, values: [...f.values] };
      equalsByMember.set(f.member, copy);
      out.push(copy);
    }
  }
  return out;
}

export function extractSlots(input: ExtractInput): ExtractResult {
  const hits = resolveTerms(input.message, input.glossary);
  const numbers = parseNumbers(input.message, { isVietnameseContext: input.isVietnameseContext });
  const dates = resolveDateRanges(input.message, input.now);

  const resolution = resolveMetric(input.message, input.glossary, input.knownMembers);
  const { metric, ratio } = buildMetricSlots(resolution);
  const filters = buildFilters(hits, input.glossary, numbers);

  // Cube the metric resolved to — measure ref, else the ratio's numerator.
  // Scopes the cube-relative breakdown member (platform → os_platform|platform).
  const metricRef = resolution?.ref ?? resolution?.ratioRef?.numerator ?? ratio?.numerator ?? null;
  const metricCube = metricRef ? cubeNameOf(metricRef) : null;
  const dimension = pickDimension(hits, input.glossary, {
    message: input.message,
    metricCube,
    knownMembers: input.knownMembers,
  });

  const primaryDate = dates[0];
  const timeRange = primaryDate
    ? {
        value: primaryDate.dateRange,
        alias: primaryDate.alias,
        span: primaryDate.span,
        confidence: primaryDate.confidence,
        granularity: primaryDate.granularity,
      }
    : undefined;

  const warnings: string[] = [];
  for (const n of numbers) warnings.push(...n.warnings);
  if (resolution?.reason) warnings.push(resolution.reason);

  // Deterministic default metric: a segment/time question that names no metric
  // ("show Minnow last 7 days", "Whale this month") binds the segment filter
  // but leaves the metric slot empty, so the composer can't emit a measure and
  // the turn clarifies → no chart. Fill it: money cue → the game's Revenue
  // measure, else the active-user count. Gated to a question that already
  // anchors intent (a filter and/or an explicit time) so a contentless message
  // still clarifies. Resolved from the glossary, never a hardcoded ref.
  let metricSlot = metric;
  if (!metricSlot.value && !ratio && (filters?.length || timeRange?.value)) {
    const def = resolveDefaultMetric(input.glossary, input.message);
    // Require the /meta member set, like the cube-relative dimension path: a
    // meta-down turn must surface the honest "data model unavailable" clarify
    // rather than auto-route an unvalidated default member.
    if (def && input.knownMembers?.has(def.ref)) {
      metricSlot = { value: def.ref, alias: def.label, confidence: 0.8 };
      warnings.push(
        `No metric named — defaulted to ${def.label} (${def.ref}); change it if you meant another measure.`,
      );
    }
  }

  const intentResult = classifyIntent(input.message);
  const slots: DisambiguationSlots = {
    metric: metricSlot,
    dimension,
    timeRange,
    filters,
    intent: intentResult.slot,
    limit: intentResult.limit,
  };
  if (ratio) slots.ratio = ratio;

  // Concept-tier metadata: when the resolved metric term carries an entity
  // (e.g. "spender" → players.user_id), pin concept + entity slots so the
  // leaderboard builder can rank by that entity without re-resolving.
  if (resolution?.termId) {
    const term = input.glossary.find((t) => t.id === resolution.termId);
    if (term && (term.entityCube || term.ranking)) {
      slots.concept = {
        value: term.id,
        alias: resolution.alias,
        confidence: resolution.confidence,
      };
      if (term.entityCube && term.entityPk) {
        slots.entity = {
          value: { cube: term.entityCube, pk: term.entityPk },
          alias: resolution.alias,
          confidence: resolution.confidence,
        };
      }
    }
  }

  return {
    slots,
    unresolved: unresolvedSpans(input.message, hits),
    warnings,
    dates,
    numbers,
    hits,
    ...(resolution ? { resolution } : {}),
  };
}
