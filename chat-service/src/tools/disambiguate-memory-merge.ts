/**
 * Memory bridge for `disambiguate_query`. Two layers: session kv_cache (L2)
 * and cross-session user_disambig_prefs (L3, in sibling module). Per turn:
 * fill empty slots L2→L3, drop resolved clarifications, then write every
 * confident slot back. Resolution order: explicit → L2 → L3 → ask.
 * Splitting fill / validate / write across phases lets callers reject a
 * slot (e.g. snapshot measure × timeRange) before it lands in memory.
 */

import type Database from 'better-sqlite3';
import {
  getResolutions, mergeResolution,
  type DisambigResolutions, type SlotMemory, type TimeRangeValue,
} from '../cache/disambig-memory-adapter.js';
import { resolveTimePhrase } from '../nl-to-query/phrase-resolver.js';
import {
  fillGapsFromUserPrefs,
  writeConfidentSlotsToUserPrefs,
} from './disambiguate-user-prefs-fill.js';
import type { DisambiguationResult } from '../nl-to-query/index.js';

const WRITE_CONFIDENCE_FLOOR = 0.7;

export interface MergeMemoryParams {
  db: Database.Database;
  sessionId: string;
  ownerId: string;
  gameId: string;
  now: number;
}

/**
 * A new question carrying a substantial phrase the engine could not account
 * for (e.g. "currency outflow reasons") must NOT have its topic decided by a
 * saved default — gap-filling the metric there suppresses the metric
 * clarification and flips clarify→auto with last week's metric. Short slot
 * replies ("by country", "theo quốc gia", "last month") leave at most tiny
 * unresolved fragments, so the ≥3-word threshold keeps the legit
 * clarify→reply fill flow intact.
 */
function hasSubstantialUnresolvedText(result: DisambiguationResult): boolean {
  return result.unresolved.some((span) => span.trim().split(/\s+/).length >= 3);
}

/** Phase 1 — fill empty slots from L2+L3 memory; no writes here. */
export function fillResultFromMemory(
  result: DisambiguationResult,
  params: MergeMemoryParams,
): DisambiguationResult {
  const { db, sessionId, ownerId, gameId, now } = params;
  const mem = getResolutions(db, sessionId);
  const userPrefsCtx = { db, ownerId, gameId, now };
  // Topic-bearing slots (metric/intent/concept/entity) stay empty when the
  // message looks like a new question about something we couldn't resolve;
  // dimension/timeRange/filter fills are benign refinements and always apply.
  const blockTopicFill = hasSubstantialUnresolvedText(result);
  fillGapsFromMemory(result, mem, now, blockTopicFill);
  fillGapsFromUserPrefs(result, userPrefsCtx, blockTopicFill);
  dropResolvedClarifications(result);
  upgradeActionIfNoClarsRemain(result);
  return result;
}

/** Phase 2 — write every still-confident slot back to L2+L3. Call after validation. */
export function writeMemoryFromResult(
  result: DisambiguationResult,
  params: MergeMemoryParams,
): void {
  const { db, sessionId, ownerId, gameId, now } = params;
  const mem = getResolutions(db, sessionId);
  writeConfidentSlotsToMemory(result, mem, { db, sessionId, ownerId });
  writeConfidentSlotsToUserPrefs(result, { db, ownerId, gameId, now });
}

/** Legacy single-call entry — fill then write, no validation between them. */
export function mergeMemoryIntoResult(
  result: DisambiguationResult,
  params: MergeMemoryParams,
): DisambiguationResult {
  fillResultFromMemory(result, params);
  writeMemoryFromResult(result, params);
  return result;
}

function fillGapsFromMemory(
  result: DisambiguationResult,
  mem: DisambigResolutions,
  now: number,
  blockTopicFill = false,
): void {
  if (!blockTopicFill && !result.slots.metric.value && mem.metric) {
    result.slots.metric = {
      value: mem.metric.value,
      confidence: 0.95,
      alias: mem.metric.phrase,
    };
    result.warnings.push(`metric resolved from session memory: ${mem.metric.value}`);
  }

  if (!result.slots.dimension?.value && mem.dimension) {
    result.slots.dimension = {
      value: mem.dimension.value,
      confidence: 0.95,
      alias: mem.dimension.phrase,
    };
    result.warnings.push(`dimension resolved from session memory: ${mem.dimension.value}`);
  }

  if (!result.slots.timeRange?.value && mem.timeRange) {
    const fresh = resolveTimePhrase(mem.timeRange.phrase, now);
    const value = fresh ? fresh.dateRange : mem.timeRange.value.dateRange;
    const granularity = fresh?.granularity ?? mem.timeRange.value.granularity;
    result.slots.timeRange = {
      value,
      confidence: 0.95,
      alias: mem.timeRange.phrase,
      granularity,
    };
    const label = mem.timeRange.phrase ?? formatRange(value);
    result.warnings.push(`timeRange resolved from session memory: ${label}`);
  }

  // Phase 02a sub-deliverable D — intent/concept/entity slot continuity. Read
  // at 0.95 confidence (same tier as metric/dimension). The disambig-tool's
  // post-fill v2 retry uses these to re-fire the leaderboard path when the
  // current turn supplied only a measure ("Revenue") after a clarify.
  //
  // Intent is special: the engine always emits something (defaults to
  // 'aggregate' at conf 0.6 when no positive regex hits). So a missing-value
  // check would never restore from memory. We override the engine default
  // when (a) memory carries a more specific intent (anything other than
  // aggregate) and (b) the current-turn confidence is at-or-below the
  // engine's default-aggregate level — i.e. the user typed a reply, not a
  // new top-level question.
  const memHasSpecificIntent = !blockTopicFill && mem.intent && mem.intent.value !== 'aggregate';
  const engineDefaultedAggregate =
    result.slots.intent.value === 'aggregate' && result.slots.intent.confidence <= 0.6;
  if (memHasSpecificIntent && (!result.slots.intent.value || engineDefaultedAggregate)) {
    result.slots.intent = {
      value: mem.intent!.value,
      confidence: 0.95,
      alias: mem.intent!.phrase,
    };
    result.warnings.push(`intent resolved from session memory: ${mem.intent!.value}`);
  }
  if (!blockTopicFill && !result.slots.concept?.value && mem.concept) {
    result.slots.concept = {
      value: mem.concept.value,
      confidence: 0.95,
      alias: mem.concept.phrase,
    };
    result.warnings.push(`concept resolved from session memory: ${mem.concept.value}`);
  }
  if (!blockTopicFill && !result.slots.entity?.value && mem.entity) {
    result.slots.entity = {
      value: mem.entity.value,
      confidence: 0.95,
      alias: mem.entity.phrase,
    };
    result.warnings.push(`entity resolved from session memory: ${mem.entity.value.cube}`);
  }
}

function dropResolvedClarifications(result: DisambiguationResult): void {
  result.clarifications = result.clarifications.filter((c) => {
    if (c.slot === 'metric' && result.slots.metric.value) return false;
    if (c.slot === 'dimension' && result.slots.dimension?.value) return false;
    if (c.slot === 'timeRange' && result.slots.timeRange?.value) return false;
    return true;
  });
}

function upgradeActionIfNoClarsRemain(result: DisambiguationResult): void {
  if (
    result.action === 'clarify' &&
    result.clarifications.length === 0 &&
    result.slots.metric.value
  ) {
    result.action = 'auto';
  }
}

interface WriteCtx {
  db: Database.Database;
  sessionId: string;
  ownerId: string;
}

function writeConfidentSlotsToMemory(
  result: DisambiguationResult,
  mem: DisambigResolutions,
  ctx: WriteCtx,
): void {
  const partial: DisambigResolutions = {};

  const m = result.slots.metric;
  if (m.value && m.confidence >= WRITE_CONFIDENCE_FLOOR && !sameValue(mem.metric?.value, m.value)) {
    partial.metric = { value: m.value, phrase: m.alias };
  }

  const d = result.slots.dimension;
  if (d?.value && d.confidence >= WRITE_CONFIDENCE_FLOOR && !sameValue(mem.dimension?.value, d.value)) {
    partial.dimension = { value: d.value, phrase: d.alias };
  }

  const t = result.slots.timeRange;
  if (t?.value && t.confidence >= WRITE_CONFIDENCE_FLOOR) {
    const value: TimeRangeValue = {
      dateRange: t.value,
      granularity: typedGranularity(t.granularity),
    };
    if (!sameTimeRange(mem.timeRange?.value, value)) {
      partial.timeRange = { value, phrase: t.alias };
    }
  }

  const filters = result.slots.filters ?? [];
  if (filters.length > 0) {
    const filterBag: Record<string, SlotMemory<string>> = {};
    for (const f of filters) {
      if (f.confidence < WRITE_CONFIDENCE_FLOOR) continue;
      const flat = f.values.join(',');
      if (!sameValue(mem.filters?.[f.member]?.value, flat)) {
        filterBag[f.member] = { value: flat, phrase: f.alias };
      }
    }
    if (Object.keys(filterBag).length > 0) partial.filters = filterBag;
  }

  // Phase 02a sub-deliverable D — write intent/concept/entity when the slot
  // confidence crosses the floor. Critically, this fires EVEN WHEN the
  // overall action is clarify: that's the fix for the b93d68e4 bug where
  // turn 0's intent ("leaderboard") evaporated because the metric slot
  // wasn't yet pinned. The decision to write per-slot beats per-action lets
  // turn 2's reply ("Revenue") re-derive the leaderboard shape.
  const intent = result.slots.intent;
  if (intent?.value && intent.confidence >= WRITE_CONFIDENCE_FLOOR && !sameValue(mem.intent?.value, intent.value)) {
    partial.intent = { value: intent.value, phrase: intent.alias };
  }
  const concept = result.slots.concept;
  if (concept?.value && concept.confidence >= WRITE_CONFIDENCE_FLOOR && !sameValue(mem.concept?.value, concept.value)) {
    partial.concept = { value: concept.value, phrase: concept.alias };
  }
  const entity = result.slots.entity;
  if (entity?.value && entity.confidence >= WRITE_CONFIDENCE_FLOOR) {
    const memEntity = mem.entity?.value;
    if (!memEntity || memEntity.cube !== entity.value.cube || memEntity.pk !== entity.value.pk) {
      partial.entity = { value: entity.value, phrase: entity.alias };
    }
  }

  if (!hasAnyKey(partial)) return;
  mergeResolution(ctx.db, ctx.sessionId, ctx.ownerId, partial);
}

// Helpers ------------------------------------------------------------------

function sameValue<T>(a: T | undefined, b: T): boolean {
  return a !== undefined && a === b;
}

function sameTimeRange(a: TimeRangeValue | undefined, b: TimeRangeValue): boolean {
  if (!a || a.granularity !== b.granularity) return false;
  const ar = a.dateRange, br = b.dateRange;
  if (typeof ar === 'string' && typeof br === 'string') return ar === br;
  if (Array.isArray(ar) && Array.isArray(br)) return ar[0] === br[0] && ar[1] === br[1];
  return false;
}

function hasAnyKey(p: DisambigResolutions): boolean {
  return !!(p.metric || p.dimension || p.timeRange || p.filters || p.intent || p.concept || p.entity);
}

function typedGranularity(g: unknown): TimeRangeValue['granularity'] {
  return g === 'day' || g === 'week' || g === 'month' || g === 'quarter' || g === 'year' ? g : undefined;
}

function formatRange(r: string | [string, string]): string {
  return typeof r === 'string' ? r : `${r[0]}..${r[1]}`;
}
