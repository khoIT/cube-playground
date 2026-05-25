/**
 * Layer 3 (cross-session) integration for the disambig tool. Reads
 * `user_disambig_prefs` to fill slots that Layer 2 left empty, and writes
 * back every confidently-resolved slot alongside Layer 2 writes.
 *
 * Phrase storage on the row lets timeRange re-resolve against the current
 * clock — so a "this month" preference set in May surfaces June's range
 * when the next session opens, instead of stale May 1–31.
 */

import type Database from 'better-sqlite3';
import {
  getUserPrefs,
  upsertUserPref,
  touchUserPref,
  type UserPrefRow,
  type PrefSlot,
} from '../cache/user-prefs-adapter.js';
import { resolveTimePhrase } from '../nl-to-query/phrase-resolver.js';
import type { DisambiguationResult } from '../nl-to-query/index.js';
import type { TimeRangeValue } from '../cache/disambig-memory-adapter.js';

const WRITE_CONFIDENCE_FLOOR = 0.7;

export interface UserPrefsCtx {
  db: Database.Database;
  ownerId: string;
  gameId: string;
  now: number;
}

/** Index prefs by slot for O(1) lookup. */
function indexBySlot(rows: UserPrefRow[]): Map<PrefSlot, UserPrefRow> {
  const m = new Map<PrefSlot, UserPrefRow>();
  for (const r of rows) m.set(r.slot, r);
  return m;
}

export function fillGapsFromUserPrefs(
  result: DisambiguationResult,
  ctx: UserPrefsCtx,
): void {
  const prefs = indexBySlot(getUserPrefs(ctx.db, ctx.ownerId, ctx.gameId));
  if (prefs.size === 0) return;

  const metric = prefs.get('metric');
  if (!result.slots.metric.value && metric) {
    result.slots.metric = {
      value: metric.value as string,
      confidence: 0.92,
      alias: metric.phrase,
    };
    result.warnings.push(`metric resolved from your saved defaults: ${metric.value}`);
    touchUserPref(ctx.db, ctx.ownerId, ctx.gameId, 'metric', ctx.now);
  }

  const dim = prefs.get('dimension');
  if (!result.slots.dimension?.value && dim) {
    result.slots.dimension = {
      value: dim.value as string,
      confidence: 0.92,
      alias: dim.phrase,
    };
    result.warnings.push(`dimension resolved from your saved defaults: ${dim.value}`);
    touchUserPref(ctx.db, ctx.ownerId, ctx.gameId, 'dimension', ctx.now);
  }

  const tr = prefs.get('timeRange');
  if (!result.slots.timeRange?.value && tr) {
    const stored = tr.value as TimeRangeValue;
    const fresh = resolveTimePhrase(tr.phrase, ctx.now);
    const value = fresh ? fresh.dateRange : stored.dateRange;
    const granularity = fresh?.granularity ?? stored.granularity;
    result.slots.timeRange = {
      value,
      confidence: 0.92,
      alias: tr.phrase,
      granularity,
    };
    const label = tr.phrase ?? formatRange(value);
    result.warnings.push(`timeRange resolved from your saved defaults: ${label}`);
    touchUserPref(ctx.db, ctx.ownerId, ctx.gameId, 'timeRange', ctx.now);
  }
}

/** Write every confidently-resolved slot to user prefs. Mirrors the L2 write trigger. */
export function writeConfidentSlotsToUserPrefs(
  result: DisambiguationResult,
  ctx: UserPrefsCtx,
): void {
  const m = result.slots.metric;
  if (m.value && m.confidence >= WRITE_CONFIDENCE_FLOOR) {
    upsertUserPref(ctx.db, {
      ownerId: ctx.ownerId, gameId: ctx.gameId, slot: 'metric',
      value: m.value, phrase: m.alias, now: ctx.now,
    });
  }
  const d = result.slots.dimension;
  if (d?.value && d.confidence >= WRITE_CONFIDENCE_FLOOR) {
    upsertUserPref(ctx.db, {
      ownerId: ctx.ownerId, gameId: ctx.gameId, slot: 'dimension',
      value: d.value, phrase: d.alias, now: ctx.now,
    });
  }
  const t = result.slots.timeRange;
  if (t?.value && t.confidence >= WRITE_CONFIDENCE_FLOOR) {
    const tv: TimeRangeValue = { dateRange: t.value, granularity: typedGranularity(t.granularity) };
    upsertUserPref(ctx.db, {
      ownerId: ctx.ownerId, gameId: ctx.gameId, slot: 'timeRange',
      value: tv, phrase: t.alias, now: ctx.now,
    });
  }
  for (const f of result.slots.filters ?? []) {
    if (f.confidence < WRITE_CONFIDENCE_FLOOR) continue;
    upsertUserPref(ctx.db, {
      ownerId: ctx.ownerId, gameId: ctx.gameId, slot: `filter:${f.member}`,
      value: f.values.join(','), phrase: f.alias, now: ctx.now,
    });
  }
}

function typedGranularity(g: unknown): TimeRangeValue['granularity'] {
  return g === 'day' || g === 'week' || g === 'month' || g === 'quarter' || g === 'year' ? g : undefined;
}

function formatRange(r: string | [string, string]): string {
  return typeof r === 'string' ? r : `${r[0]}..${r[1]}`;
}
