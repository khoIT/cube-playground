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
import type { TimeRangeValue, EntityValue, QueryIntentSlot } from '../cache/disambig-memory-adapter.js';

const WRITE_CONFIDENCE_FLOOR = 0.7;
/**
 * Phase 02a sub-deliverable D — cross-session reads of intent/concept/entity
 * are downgraded to 0.7 confidence (vs 0.92 for metric/dimension/timeRange).
 * The disambig tool flags these as `source: 'cross-session'` on the
 * assumption payload so the skill body renders an always-disclose footer.
 */
const CROSS_SESSION_INTENT_CONFIDENCE = 0.7;

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

  // Phase 02a sub-deliverable D — cross-session intent/concept/entity slots.
  // Downgraded confidence (0.7) + always-disclose source marker so the
  // disambig tool surfaces an explicit-history footer rather than silent
  // auto-routing. The marker is encoded as a structured warning the tool
  // parses on its way out.
  //
  // Intent override semantics mirror the L2 session-tier fill: the engine
  // always emits something (defaults to 'aggregate' at 0.6), so the slot is
  // never "empty". We override iff the pref carries a more-specific intent
  // AND the per-turn value is the low-confidence aggregate default.
  const intent = prefs.get('intent');
  const prefHasSpecificIntent = intent && intent.value !== 'aggregate';
  const engineDefaultedAggregate =
    result.slots.intent.value === 'aggregate' && result.slots.intent.confidence <= 0.6;
  if (intent && prefHasSpecificIntent && (!result.slots.intent.value || engineDefaultedAggregate)) {
    result.slots.intent = {
      value: intent.value as QueryIntentSlot,
      confidence: CROSS_SESSION_INTENT_CONFIDENCE,
      alias: intent.phrase,
    };
    result.warnings.push(`[cross_session_pref] intent:${intent.value}`);
    touchUserPref(ctx.db, ctx.ownerId, ctx.gameId, 'intent', ctx.now);
  }
  const concept = prefs.get('concept');
  if (!result.slots.concept?.value && concept) {
    result.slots.concept = {
      value: concept.value as string,
      confidence: CROSS_SESSION_INTENT_CONFIDENCE,
      alias: concept.phrase,
    };
    result.warnings.push(`[cross_session_pref] concept:${concept.value}`);
    touchUserPref(ctx.db, ctx.ownerId, ctx.gameId, 'concept', ctx.now);
  }
  const entity = prefs.get('entity');
  if (!result.slots.entity?.value && entity) {
    result.slots.entity = {
      value: entity.value as EntityValue,
      confidence: CROSS_SESSION_INTENT_CONFIDENCE,
      alias: entity.phrase,
    };
    result.warnings.push(`[cross_session_pref] entity:${(entity.value as EntityValue).cube}`);
    touchUserPref(ctx.db, ctx.ownerId, ctx.gameId, 'entity', ctx.now);
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

  // Phase 02a sub-deliverable D — mirror L2 writes for intent/concept/entity
  // so the cross-session tier captures the "user habitually asks leaderboards
  // about spenders in game X" pattern. Writes ignore action: a confident
  // slot inside an overall-clarify turn still lands here.
  const intent = result.slots.intent;
  if (intent?.value && intent.confidence >= WRITE_CONFIDENCE_FLOOR) {
    upsertUserPref(ctx.db, {
      ownerId: ctx.ownerId, gameId: ctx.gameId, slot: 'intent',
      value: intent.value, phrase: intent.alias, now: ctx.now,
    });
  }
  const concept = result.slots.concept;
  if (concept?.value && concept.confidence >= WRITE_CONFIDENCE_FLOOR) {
    upsertUserPref(ctx.db, {
      ownerId: ctx.ownerId, gameId: ctx.gameId, slot: 'concept',
      value: concept.value, phrase: concept.alias, now: ctx.now,
    });
  }
  const entity = result.slots.entity;
  if (entity?.value && entity.confidence >= WRITE_CONFIDENCE_FLOOR) {
    upsertUserPref(ctx.db, {
      ownerId: ctx.ownerId, gameId: ctx.gameId, slot: 'entity',
      value: entity.value, phrase: entity.alias, now: ctx.now,
    });
  }
}

function typedGranularity(g: unknown): TimeRangeValue['granularity'] {
  return g === 'day' || g === 'week' || g === 'month' || g === 'quarter' || g === 'year' ? g : undefined;
}

function formatRange(r: string | [string, string]): string {
  return typeof r === 'string' ? r : `${r[0]}..${r[1]}`;
}
