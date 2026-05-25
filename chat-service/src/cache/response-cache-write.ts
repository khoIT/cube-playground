/**
 * Write-gate for response cache — decides whether a completed turn is
 * eligible for caching and writes the entry if so.
 *
 * Skip conditions (any one is sufficient to skip):
 *   - RESPONSE_CACHE_ENABLED !== 'true'
 *   - stop_reason explicitly not 'end_turn' (null/undefined still allowed)
 *   - error flag set (turn ended with an error)
 *   - assistantText is empty
 *
 * Artifact + chart turns are now cached. Query artifacts only carry the Cube
 * query JSON — the FE re-fetches live rows when rendering. Chart artifacts
 * embed snapshot rows; refresh happens at replay time (see
 * refresh-cached-artifacts.ts). Semantic-layer drift is handled by the
 * cubeMetaHash component of the cache key — a schema change rotates the key
 * so stale entries are unreachable.
 */

import type Database from 'better-sqlite3';
import { insertCacheEntry } from '../db/response-cache-store.js';
import { normalize } from './response-cache-key.js';
import type { QueryArtifact, ChartArtifact } from '../types.js';

export interface MaybeWriteParams {
  db: Database.Database;
  enabled: boolean;
  key: string;
  gameId: string;
  skill: string;
  model: string;
  userText: string;
  assistantText: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  stopReason: string | undefined;
  collectedArtifacts: QueryArtifact[];
  collectedCharts: ChartArtifact[];
  hadError: boolean;
  turnId: string;
  sessionId: string;
  /** The cube meta version hash used when deriving the cache key; stored for stale-cache analysis. */
  cubeMetaHash?: string | null;
}

/**
 * Conditionally write a response-cache entry.
 * All skip checks live here so turn.ts stays readable.
 * Returns true if an entry was written, false otherwise.
 *
 * stop_reason gate: skip only when stop_reason is explicitly NOT 'end_turn'
 * (e.g. 'max_tokens', 'stop_sequence'). A null/undefined stop_reason means
 * the observability stack didn't capture it — we allow caching in that case
 * since errors are already covered by hadError.
 */
export function maybeWriteResponseCache(params: MaybeWriteParams): boolean {
  if (!params.enabled) return false;
  if (params.hadError) return false;
  // Explicit non-end_turn stop: don't cache. Null means not captured — allow.
  if (params.stopReason !== undefined && params.stopReason !== null && params.stopReason !== 'end_turn') return false;
  if (!params.assistantText) return false;

  insertCacheEntry(params.db, {
    key: params.key,
    gameId: params.gameId,
    skill: params.skill,
    model: params.model,
    userTextNormalized: normalize(params.userText),
    value: {
      text: params.assistantText,
      toolCalls: [],
      artifacts: params.collectedArtifacts.length > 0 ? params.collectedArtifacts : undefined,
      charts: params.collectedCharts.length > 0 ? params.collectedCharts : undefined,
    },
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    costUsd: params.costUsd,
    originalTurnId: params.turnId,
    originalSessionId: params.sessionId,
    cubeMetaHash: params.cubeMetaHash ?? null,
  });

  return true;
}
