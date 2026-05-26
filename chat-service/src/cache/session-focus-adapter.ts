/**
 * Session-focus store — phase 02, context layer B.
 *
 * Per-session snapshot of "what we were just talking about". Written at the
 * end of each assistant turn; read at the start of the next turn's
 * `compose()` so the model sees the prior context even when SDK session
 * resume (phase 01, layer A) is unavailable or has been compacted away.
 *
 * Backed by the unified kv_cache table with `kind='session_focus'`, same TTL
 * + scoping discipline as disambig_resolution.
 *
 * Source-of-truth note: for overlapping slots (metric/dimension/timeRange/
 * filters/concept), the canonical store is `disambig_resolution`. This
 * adapter's role is to *copy* a snapshot for prompt injection and to add
 * the non-disambig fields (skill, artifactRef, segment).
 */

import type Database from 'better-sqlite3';
import { config } from '../config.js';
import { kvGet, kvPut, kvEvict } from './kv-cache-store.js';
import type {
  SlotMemory,
  TimeRangeValue,
  EntityValue,
  QueryIntentSlot,
} from './disambig-memory-adapter.js';

const KIND = 'session_focus';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Bag of slots the model should see at the start of the next turn. Each
 * value wraps in `SlotMemory<T>` so the phase-03 Settings UI can render
 * `(95% — from "doanh thu")` provenance.
 */
export interface SessionFocus {
  skill?: SlotMemory<string>;
  concept?: SlotMemory<string>;
  artifactRef?: SlotMemory<string>;
  metric?: SlotMemory<string>;
  dimension?: SlotMemory<string>;
  timeRange?: SlotMemory<TimeRangeValue>;
  segment?: SlotMemory<string>;
  filters?: Record<string, SlotMemory<string>>;
  intent?: SlotMemory<QueryIntentSlot>;
  entity?: SlotMemory<EntityValue>;
  updatedAt?: number;
}

function sessionKey(sessionId: string): string {
  return `session:${sessionId}`;
}

/**
 * Read the focus bag for a session. Returns `{}` on miss, when the cache
 * service is flag-off, or when the focus-store flag itself is off. Legacy/
 * malformed rows are tolerated as empty (same pattern as disambig adapter).
 */
export function getFocus(
  db: Database.Database,
  sessionId: string,
): SessionFocus {
  if (!config.cacheServiceEnabled) return {};
  if (!config.chatContextFocusStoreEnabled) return {};
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
 * Merge a partial focus into the session's bag. No-op when either the
 * cache service or the focus-store flag is off.
 *
 * Topic-pivot semantics: a key present in `partial` overwrites the
 * matching key in `current` — see phase 02 R1 (stale focus). Use
 * `clearFocus` for "reset" semantics, not by passing nulls.
 */
export function mergeFocus(
  db: Database.Database,
  sessionId: string,
  ownerId: string,
  partial: Partial<SessionFocus>,
): void {
  if (!config.cacheServiceEnabled) return;
  if (!config.chatContextFocusStoreEnabled) return;
  const current = getFocus(db, sessionId);
  const next: SessionFocus = {
    ...current,
    ...partial,
    filters: { ...(current.filters ?? {}), ...(partial.filters ?? {}) },
    updatedAt: Date.now(),
  };
  if (next.filters && Object.keys(next.filters).length === 0) delete next.filters;

  kvPut(db, {
    kind: KIND,
    key: sessionKey(sessionId),
    valueJson: JSON.stringify(next),
    ownerId,
    expiresAt: Date.now() + DEFAULT_TTL_MS,
  });
}

/**
 * Drop the focus row entirely. Used by phase 03's "reset session focus"
 * action and by `compactSession()` after porting forward.
 */
export function clearFocus(db: Database.Database, sessionId: string): void {
  if (!config.cacheServiceEnabled) return;
  kvEvict(db, KIND, sessionKey(sessionId));
}

/**
 * Format a focus bag as the `## Conversation focus` block injected into
 * the next turn's system prompt. Returns an empty string when the bag has
 * no usable slots so `compose()` can skip the block.
 *
 * Output is bounded: 1 metric, 1 dim, 1 timeRange, 1 segment, up to 5
 * filters, 1 artifact ref. Phase 02 R2 (token bloat).
 */
export function renderFocusPreamble(focus: SessionFocus): string {
  const lines: string[] = [];
  if (focus.metric?.value) {
    lines.push(`- Last metric: {{field:${focus.metric.value}}}` +
      (focus.metric.phrase ? ` (from "${focus.metric.phrase}")` : ''));
  }
  if (focus.dimension?.value) {
    lines.push(`- Last dimension: {{field:${focus.dimension.value}}}`);
  }
  if (focus.timeRange?.value) {
    const r = focus.timeRange.value.dateRange;
    const range = typeof r === 'string' ? r : `${r[0]}..${r[1]}`;
    lines.push(`- Time range: ${focus.timeRange.phrase ?? range}` +
      (focus.timeRange.phrase ? ` (${range})` : ''));
  }
  if (focus.concept?.value) {
    lines.push(`- Concept: ${focus.concept.value}` +
      (focus.concept.phrase ? ` (from "${focus.concept.phrase}")` : ''));
  }
  if (focus.segment?.value) {
    lines.push(`- Segment: ${focus.segment.value}`);
  }
  if (focus.filters) {
    const entries = Object.entries(focus.filters).slice(0, 5);
    for (const [member, slot] of entries) {
      lines.push(`- Filter: ${member} = ${slot.value}`);
    }
  }
  if (focus.artifactRef?.value) {
    lines.push(`- Last artifact: ${focus.artifactRef.value}`);
  }
  if (focus.skill?.value) {
    lines.push(`- Last skill: ${focus.skill.value}`);
  }
  if (lines.length === 0) return '';

  return [
    '## Conversation focus',
    '',
    'You were just talking about the following. When the user uses anaphora ("it",',
    '"that", "now break it down by …"), assume they mean this context.',
    '',
    ...lines,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Normaliser — tolerate legacy/missing fields
// ---------------------------------------------------------------------------

function wrap<T>(v: unknown): SlotMemory<T> | undefined {
  if (v == null) return undefined;
  if (typeof v === 'object' && v !== null && 'value' in (v as Record<string, unknown>)) {
    return v as SlotMemory<T>;
  }
  return { value: v as T };
}

function normalise(raw: unknown): SessionFocus {
  if (typeof raw !== 'object' || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const out: SessionFocus = {};
  if (r.skill != null) out.skill = wrap<string>(r.skill);
  if (r.concept != null) out.concept = wrap<string>(r.concept);
  if (r.artifactRef != null) out.artifactRef = wrap<string>(r.artifactRef);
  if (r.metric != null) out.metric = wrap<string>(r.metric);
  if (r.dimension != null) out.dimension = wrap<string>(r.dimension);
  if (r.timeRange != null) out.timeRange = wrap<TimeRangeValue>(r.timeRange);
  if (r.segment != null) out.segment = wrap<string>(r.segment);
  if (r.intent != null) out.intent = wrap<QueryIntentSlot>(r.intent);
  if (r.entity != null) out.entity = wrap<EntityValue>(r.entity);
  if (r.filters && typeof r.filters === 'object') {
    const wrapped: Record<string, SlotMemory<string>> = {};
    for (const [k, v] of Object.entries(r.filters as Record<string, unknown>)) {
      const w = wrap<string>(v);
      if (w) wrapped[k] = w;
    }
    if (Object.keys(wrapped).length > 0) out.filters = wrapped;
  }
  if (typeof r.updatedAt === 'number') out.updatedAt = r.updatedAt;
  return out;
}
