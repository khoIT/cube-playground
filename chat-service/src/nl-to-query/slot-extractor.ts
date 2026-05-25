/**
 * Combines the lexical resolvers (synonym, number, date) into a typed slot
 * representation the orchestrator can hand to the query composer and the
 * clarification builder. Metrics are anchored to a single primary hit;
 * everything else hangs off the same scan so confidences stay correlated.
 */

import type {
  DisambiguationSlots,
  OfficialTerm,
  ScoredSlot,
  SlotFilter,
} from './types.js';
import { resolveTerms, unresolvedSpans, type AliasHit } from './synonym-resolver.js';
import { parseNumbers, type ParsedNumber } from './number-normaliser.js';
import { resolveDateRanges, type ResolvedDate } from './date-resolver.js';

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
}

function classify(term: OfficialTerm): 'metric' | 'dimension' | 'filter' | 'comparison' {
  const cat = (term.category ?? '').toLowerCase();
  if (cat === 'segment' || cat === 'user') return 'filter';
  if (cat === 'comparison') return 'comparison';
  if (cat === 'dimension' || cat === 'attribute') return 'dimension';
  return 'metric';
}

function refKnown(ref: string | null, members?: Set<string>): boolean {
  if (!ref) return false;
  if (!members) return true;
  return members.has(ref);
}

function pickMetric(hits: AliasHit[], glossary: OfficialTerm[], members?: Set<string>): ScoredSlot<string> | undefined {
  const termById = new Map(glossary.map((t) => [t.id, t]));
  const metricHits = hits.filter((h) => {
    const term = termById.get(h.termId);
    return term ? classify(term) === 'metric' : false;
  });
  if (metricHits.length === 0) return undefined;
  // Pick the longest alias as the canonical metric — same heuristic used by
  // the synonym resolver to dedupe overlaps.
  const best = metricHits.reduce((a, b) => (a.alias.length >= b.alias.length ? a : b));
  const known = refKnown(best.cubeRef, members);
  return {
    value: best.cubeRef ?? undefined,
    alias: best.alias,
    span: best.span,
    confidence: best.cubeRef ? (known ? 1 : 0.5) : 0.3,
  };
}

function pickDimension(hits: AliasHit[], glossary: OfficialTerm[]): ScoredSlot<string> | undefined {
  const termById = new Map(glossary.map((t) => [t.id, t]));
  const dimHits = hits.filter((h) => {
    const term = termById.get(h.termId);
    return term ? classify(term) === 'dimension' : false;
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
    return term ? classify(term) === 'filter' : false;
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

  const metric = pickMetric(hits, input.glossary, input.knownMembers) ?? {
    value: undefined,
    confidence: 0,
  };
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

  const slots: DisambiguationSlots = { metric, dimension, timeRange, filters };

  return {
    slots,
    unresolved: unresolvedSpans(input.message, hits),
    warnings,
    dates,
    numbers,
    hits,
  };
}
