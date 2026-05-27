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
import { resolveTerms, unresolvedSpans, type AliasHit } from './synonym-resolver.js';
import { resolveMetric } from './metric-resolver.js';
import { classifyTerm } from './term-classifier.js';
import { parseNumbers, type ParsedNumber } from './number-normaliser.js';
import { resolveDateRanges, type ResolvedDate } from './date-resolver.js';
import { classifyIntent } from './intent-classifier.js';

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

function pickDimension(hits: AliasHit[], glossary: OfficialTerm[]): ScoredSlot<string> | undefined {
  const termById = new Map(glossary.map((t) => [t.id, t]));
  const dimHits = hits.filter((h) => {
    const term = termById.get(h.termId);
    return term ? classifyTerm(term) === 'dimension' : false;
  });
  if (dimHits.length === 0) return undefined;
  const best = dimHits[0];
  return {
    value: best.cubeRef ?? undefined,
    alias: best.alias,
    span: best.span,
    confidence: best.cubeRef ? 0.9 : 0.4,
  };
}

function buildFilters(hits: AliasHit[], glossary: OfficialTerm[], numbers: ParsedNumber[]): SlotFilter[] | undefined {
  const termById = new Map(glossary.map((t) => [t.id, t]));
  const filterHits = hits.filter((h) => {
    const term = termById.get(h.termId);
    return term ? classifyTerm(term) === 'filter' : false;
  });
  if (filterHits.length === 0) return undefined;

  const filters: SlotFilter[] = [];
  for (const hit of filterHits) {
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
  return filters.length ? filters : undefined;
}

export function extractSlots(input: ExtractInput): ExtractResult {
  const hits = resolveTerms(input.message, input.glossary);
  const numbers = parseNumbers(input.message, { isVietnameseContext: input.isVietnameseContext });
  const dates = resolveDateRanges(input.message, input.now);

  const resolution = resolveMetric(input.message, input.glossary, input.knownMembers);
  const { metric, ratio } = buildMetricSlots(resolution);
  const dimension = pickDimension(hits, input.glossary);
  const filters = buildFilters(hits, input.glossary, numbers);

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

  const intentResult = classifyIntent(input.message);
  const slots: DisambiguationSlots = {
    metric,
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
