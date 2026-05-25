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

/** Phase 1 — fill empty slots from L2+L3 memory; no writes here. */
export function fillResultFromMemory(
  result: DisambiguationResult,
  params: MergeMemoryParams,
): DisambiguationResult {
  const { db, sessionId, ownerId, gameId, now } = params;
  const mem = getResolutions(db, sessionId);
  const userPrefsCtx = { db, ownerId, gameId, now };
  fillGapsFromMemory(result, mem, now);
  fillGapsFromUserPrefs(result, userPrefsCtx);
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
): void {
  if (!result.slots.metric.value && mem.metric) {
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
  return !!(p.metric || p.dimension || p.timeRange || p.filters);
}

function typedGranularity(g: unknown): TimeRangeValue['granularity'] {
  return g === 'day' || g === 'week' || g === 'month' || g === 'quarter' || g === 'year' ? g : undefined;
}

function formatRange(r: string | [string, string]): string {
  return typeof r === 'string' ? r : `${r[0]}..${r[1]}`;
}
