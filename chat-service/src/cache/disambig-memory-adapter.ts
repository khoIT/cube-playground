/**
 * Session-scoped disambiguation memory.
 *
 * Wraps kv-cache-store with kind='disambig_resolution', one row per session.
 * The row's value_json holds whichever slot resolutions the user has accepted
 * during this session (metric, dimension, filters, timeRange). When the
 * disambig tool runs and a slot is already memorised, it skips clarify for
 * that slot and routes auto with the prior value.
 *
 * Each slot is wrapped in SlotMemory<T> so we can store the user's natural-
 * language phrase ("this week", "revenue") alongside the resolved value.
 * The phrase is what lets a future read (a) re-resolve time on read against
 * the current clock and (b) show readable labels in the Settings UI.
 *
 * Scope: per-session, 24h TTL. Cross-session preference learning lives in
 * the `user_disambig_prefs` table — read by this module's caller, not here.
 */

import type Database from 'better-sqlite3';
import { config } from '../config.js';
import { kvGet, kvPut } from './kv-cache-store.js';

const KIND = 'disambig_resolution';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** Slot value plus the user's original phrasing that produced it. */
export interface SlotMemory<T> {
  value: T;
  phrase?: string;
}

/** Resolved time-range stored verbatim; phrase enables re-resolution on read. */
export interface TimeRangeValue {
  dateRange: string | [string, string];
  granularity?: 'day' | 'week' | 'month' | 'quarter' | 'year';
}

/** The four user-intent shapes the engine recognises today. */
export type QueryIntentSlot = 'aggregate' | 'leaderboard' | 'trend' | 'comparison';

/** Concept-tier entity (cube + primary-key) carried across turns. */
export interface EntityValue {
  cube: string;
  pk: string;
}

/** Mutable bag of resolved slots a user has accepted in this session. */
export interface DisambigResolutions {
  metric?: SlotMemory<string>;
  dimension?: SlotMemory<string>;
  timeRange?: SlotMemory<TimeRangeValue>;
  /** Filters keyed by cube member ref. Each value is a SlotMemory<string>. */
  filters?: Record<string, SlotMemory<string>>;
  /**
   * Phase 02a sub-deliverable D — slot-level continuity for the disambig
   * pipeline. Persisted EVEN WHEN the overall turn ended in clarify so the
   * next turn's reply ("Revenue") can re-derive the prior intent+concept
   * without re-asking. Read confidence: 0.95 from session tier (here), 0.7
   * from cross-session prefs.
   */
  intent?: SlotMemory<QueryIntentSlot>;
  concept?: SlotMemory<string>;
  entity?: SlotMemory<EntityValue>;
  /**
   * Last executed Cube query (JSON-serialised CubeQuery), written by
   * emit_query_artifact and the starter pass-through. Machine context for
   * additive follow-ups ("add in user count") — the merge target. NOT
   * prompt-rendered (token bloat); `phrase` carries the artifact title.
   */
  lastQuery?: SlotMemory<string>;
  /**
   * Cube the assistant referenced via {{field:cube.member}} in a reply it never
   * charted. Lets the NEXT turn anchor an otherwise-unresolvable follow-up
   * ("show inflow vs outflow") to that cube instead of a canned clarify menu.
   * `phrase` holds the full suggested member ref for provenance.
   */
  suggestedCube?: SlotMemory<string>;
  updatedAt?: number;
}

function sessionKey(sessionId: string): string {
  return `session:${sessionId}`;
}

/**
 * Read the resolution bag for a session, or empty object on miss / when
 * the cache service is disabled. Tolerates legacy rows written before the
 * SlotMemory shape: bare strings become `{ value: string }`.
 */
export function getResolutions(
  db: Database.Database,
  sessionId: string,
): DisambigResolutions {
  if (!config.cacheServiceEnabled) return {};
  const row = kvGet(db, KIND, sessionKey(sessionId));
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.valueJson) as unknown;
    return normalise(parsed);
  } catch {
    return {};
  }
}

/**
 * Merge a partial resolution into the session's bag. Subsequent calls for
 * other slots accumulate (read-modify-write under SQLite's single-writer
 * semantics; no race risk in single-process mode). No-op when cache disabled.
 */
export function mergeResolution(
  db: Database.Database,
  sessionId: string,
  ownerId: string,
  partial: DisambigResolutions,
): void {
  if (!config.cacheServiceEnabled) return;
  const current = getResolutions(db, sessionId);
  const next: DisambigResolutions = {
    ...current,
    ...partial,
    filters: { ...(current.filters ?? {}), ...(partial.filters ?? {}) },
    updatedAt: Date.now(),
  };
  if (next.filters && Object.keys(next.filters).length === 0) delete next.filters;
  // intent/concept/entity propagate through the spread above; nothing else
  // to merge — they are scalar slots, not maps.

  kvPut(db, {
    kind: KIND,
    key: sessionKey(sessionId),
    valueJson: JSON.stringify(next),
    ownerId,
    expiresAt: Date.now() + DEFAULT_TTL_MS,
  });
}

// ---------------------------------------------------------------------------
// Legacy-row tolerance: rows written before SlotMemory shape used bare strings.
// ---------------------------------------------------------------------------

function wrap<T>(v: unknown): SlotMemory<T> | undefined {
  if (v == null) return undefined;
  if (typeof v === 'object' && v !== null && 'value' in (v as Record<string, unknown>)) {
    return v as SlotMemory<T>;
  }
  return { value: v as T };
}

function normalise(raw: unknown): DisambigResolutions {
  if (typeof raw !== 'object' || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const out: DisambigResolutions = {};
  if (r.metric != null) out.metric = wrap<string>(r.metric);
  if (r.dimension != null) out.dimension = wrap<string>(r.dimension);
  if (r.timeRange != null) out.timeRange = wrap<TimeRangeValue>(r.timeRange);
  if (r.filters && typeof r.filters === 'object') {
    const wrapped: Record<string, SlotMemory<string>> = {};
    for (const [k, v] of Object.entries(r.filters as Record<string, unknown>)) {
      const w = wrap<string>(v);
      if (w) wrapped[k] = w;
    }
    if (Object.keys(wrapped).length > 0) out.filters = wrapped;
  }
  if (r.intent != null) {
    const wrapped = wrap<string>(r.intent);
    if (wrapped && isQueryIntent(wrapped.value)) {
      out.intent = wrapped as SlotMemory<QueryIntentSlot>;
    }
  }
  if (r.concept != null) out.concept = wrap<string>(r.concept);
  if (r.lastQuery != null) out.lastQuery = wrap<string>(r.lastQuery);
  if (r.suggestedCube != null) out.suggestedCube = wrap<string>(r.suggestedCube);
  if (r.entity != null) {
    const wrapped = wrap<EntityValue>(r.entity);
    if (wrapped && isEntityValue(wrapped.value)) out.entity = wrapped;
  }
  if (typeof r.updatedAt === 'number') out.updatedAt = r.updatedAt;
  return out;
}

function isQueryIntent(v: unknown): v is QueryIntentSlot {
  return v === 'aggregate' || v === 'leaderboard' || v === 'trend' || v === 'comparison';
}

function isEntityValue(v: unknown): v is EntityValue {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as EntityValue).cube === 'string' &&
    typeof (v as EntityValue).pk === 'string'
  );
}
