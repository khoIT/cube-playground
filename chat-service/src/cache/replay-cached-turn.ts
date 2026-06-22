/**
 * Replay a cached turn through the SSE stream.
 *
 * Event sequence (matches live-turn wire shape):
 *   loading
 *   token         — one chunk per ~80 chars of cached text
 *   query_artifact — one per cached artifact (FE re-fetches rows on render)
 *   chart         — one per cached chart (data may be refreshed by refresh hook)
 *   result        — tokens=0, cost=0; carries cache_hit + cache_freshness
 *
 * The result event's cache flags let the FE render the indicator immediately
 * without waiting for a turn-row refetch.
 */

import { writeSseEvent } from '../core/sse-stream.js';
import type { SseEvent, QueryArtifact, ChartArtifact, VerdictData } from '../types.js';
import { chunkText } from './response-cache-key.js';
import type { CachedResponse, CachedValue } from '../db/response-cache-store.js';
import type { Writable } from 'node:stream';

/** Outcome of a replay — caller persists `freshness` on the new turn row. */
export interface ReplayOutcome {
  artifacts: QueryArtifact[];
  charts: ChartArtifact[];
  freshness: 'refreshed' | 'stale';
  /** Lead takeaway from the cached value — static (not refreshed); persisted on
   *  the replayed row so reload matches the live replay. Undefined when none. */
  verdict?: VerdictData;
}

/**
 * Optional hook to re-execute cached charts against live Cube on hit.
 * Returns the (possibly mutated) lists plus an overall freshness flag.
 */
export type RefreshHook = (
  artifacts: QueryArtifact[],
  charts: ChartArtifact[],
) => Promise<ReplayOutcome>;

/**
 * Replay a cached turn onto the given stream.
 *
 * @param cached    Row from response_cache table.
 * @param stream    Node Writable (the SSE reply.raw stream).
 * @param emitFn    Optional override for emitting events (used in tests).
 * @param refresh   Optional refresh hook; absent = freshness='stale'.
 */
export async function replayCachedTurn(
  cached: CachedResponse,
  stream: Writable,
  emitFn?: (event: SseEvent) => void,
  refresh?: RefreshHook,
): Promise<ReplayOutcome> {
  const emit = emitFn ?? ((event: SseEvent) => writeSseEvent(stream, event));

  let value: CachedValue;
  try {
    value = JSON.parse(cached.value_json) as CachedValue;
  } catch {
    throw new Error(`response_cache: corrupt value_json for key ${cached.key}`);
  }

  const text = value.text ?? '';
  const cachedArtifacts = value.artifacts ?? [];
  const cachedCharts = value.charts ?? [];
  const cachedVerdict = value.verdict;

  // Best-effort refresh — failures fall through to the stale fallback.
  let outcome: ReplayOutcome = {
    artifacts: cachedArtifacts,
    charts: cachedCharts,
    freshness: 'stale',
  };
  if (refresh && (cachedArtifacts.length > 0 || cachedCharts.length > 0)) {
    try {
      outcome = await refresh(cachedArtifacts, cachedCharts);
    } catch {
      // swallow; stale fallback already prepared
    }
  }
  // Verdict is static text — never refreshed — so re-attach it regardless of
  // whether the refresh hook ran (it returns a fresh outcome without verdict).
  outcome.verdict = cachedVerdict;

  emit({ type: 'loading', data: {} });

  // Verdict leads, before the body tokens — mirrors a fresh turn where the
  // model emits emit_verdict first.
  if (cachedVerdict) {
    emit({ type: 'verdict', data: cachedVerdict });
  }

  for (const chunk of chunkText(text, 80)) {
    emit({ type: 'token', data: { delta: chunk } });
  }

  for (const artifact of outcome.artifacts) {
    emit({ type: 'query_artifact', data: artifact });
  }
  for (const chart of outcome.charts) {
    emit({ type: 'chart', data: chart });
  }

  emit({
    type: 'result',
    data: {
      text,
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
      cache_hit: true,
      cache_freshness: outcome.freshness,
    },
  });

  return outcome;
}
