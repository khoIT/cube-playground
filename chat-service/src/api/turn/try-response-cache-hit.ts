/**
 * Exact-match response-cache lookup for a turn. Computes the cache key (cube
 * meta hash + system-prompt hash + skill/game/model/text); on a hit, replays
 * the cached turn through the SSE stream, persists a cache_hit assistant row,
 * and fully closes out the turn (done event, registry finish, mutex release,
 * stream end).
 *
 * Extracted from the turn handler as a self-contained early-exit. Returns a
 * discriminated result: `{ hit: true }` means the handler must return
 * immediately; `{ hit: false, ... }` carries the computed key + meta hash so
 * the live-LLM path can write the cache after the turn completes.
 */

import type Database from 'better-sqlite3';
import type { Writable } from 'node:stream';
import * as chatStore from '../../db/chat-store.js';
import type { SseEvent } from '../../types.js';
import { getMetaVersion } from '../../core/cube-meta-cache.js';
import { computeCacheKey, hashSystemPrompt } from '../../cache/response-cache-key.js';
import { getByKey, incrementHit } from '../../db/response-cache-store.js';
import { replayCachedTurn } from '../../cache/replay-cached-turn.js';
import { buildRefreshHook } from '../../cache/refresh-cached-artifacts.js';
import { getStreamRegistry } from '../../core/stream-registry-instance.js';
import type { TurnTimer } from '../../observability/turn-timing.js';

type StreamRegistry = ReturnType<typeof getStreamRegistry>;

export type CacheHitResult =
  | { hit: true }
  | { hit: false; cacheKey: string | null; resolvedCubeMetaHash: string | null };

interface Args {
  db: Database.Database;
  enabled: boolean;
  bypassCache: boolean;
  gameId: string;
  workspace: string;
  userText: string;
  skill: string;
  systemPrompt: string;
  resolvedModel: string;
  turnId: string;
  sessionId: string;
  userTurnIndex: number;
  startedAt: number;
  emit: (event: SseEvent) => void;
  stream: Writable;
  timer: TurnTimer;
  registry: StreamRegistry;
  release: (() => void) | null;
  logger: { warn: (obj: unknown, msg?: string) => void; info: (obj: unknown, msg?: string) => void };
}

const MISS_DISABLED: CacheHitResult = { hit: false, cacheKey: null, resolvedCubeMetaHash: null };

export async function tryResponseCacheHit(args: Args): Promise<CacheHitResult> {
  const {
    db, enabled, bypassCache, gameId, workspace, userText, skill, systemPrompt,
    resolvedModel, turnId, sessionId, userTurnIndex, startedAt,
    emit, stream, timer, registry, release, logger,
  } = args;

  if (!enabled || bypassCache) return MISS_DISABLED;

  try {
    const cubeMetaHash = await getMetaVersion(gameId, workspace);
    timer.mark('meta-hash');
    const systemPromptHash = hashSystemPrompt(systemPrompt);
    const cacheKey = computeCacheKey({
      skill,
      gameId,
      userText,
      cubeMetaHash,
      model: resolvedModel,
      systemPromptHash,
    });
    const cached = getByKey(db, cacheKey);
    if (!cached) {
      return { hit: false, cacheKey, resolvedCubeMetaHash: cubeMetaHash };
    }

    // Cache hit — replay through the registry ring buffer (so a refresh mid-
    // replay can resume) and re-execute chart queries against live Cube via the
    // refresh hook. Query artifacts carry no rows; the FE re-fetches on render.
    const refresh = buildRefreshHook({ workspace, db, gameId, metaHash: cubeMetaHash });
    const outcome = await replayCachedTurn(cached, stream, emit, refresh);
    timer.mark('cache-replay');
    incrementHit(db, cacheKey);

    const hitAt = Date.now();
    const cachedValue = JSON.parse(cached.value_json);
    chatStore.appendTurn(db, {
      id: turnId,
      sessionId,
      turnIndex: userTurnIndex + 1,
      role: 'assistant',
      assistantText: cachedValue.text ?? '',
      // Persist the (possibly refreshed) payload so hydrate/reload matches the
      // SSE stream's artifacts/charts.
      artifacts: outcome.artifacts.length > 0 ? outcome.artifacts : undefined,
      charts: outcome.charts.length > 0 ? outcome.charts : undefined,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      cacheHit: 1,
      originalTurnId: cached.original_turn_id,
      cacheFreshness: outcome.freshness,
      // Persist the replayed verdict so reloading the cache-hit turn renders the
      // same lead block the live replay just streamed.
      verdictJson: outcome.verdict ? JSON.stringify(outcome.verdict) : undefined,
      skill,
      model: resolvedModel,
      // Cache hits are gated at write time on stop_reason='end_turn', so a
      // replayed turn represents a successful end_turn. Set explicitly because
      // the observability stack is skipped here — without it stop_reason stays
      // NULL and the leaderboard inflates legacyCount.
      stopReason: 'end_turn',
      startedAt,
      endedAt: hitAt,
    });
    chatStore.incrementTurnCount(db, sessionId, 0, 0);

    emit({ type: 'done', data: {} });
    timer.flush(logger, 'cache_hit');
    registry.finish(turnId, 'done');
    if (release) release();
    stream.end();
    return { hit: true };
  } catch (cacheErr) {
    // Cache lookup failure is non-fatal — fall through to the live LLM call.
    logger.warn({ err: cacheErr }, '[turn] cache lookup failed, falling through to LLM');
    return { hit: false, cacheKey: null, resolvedCubeMetaHash: null };
  }
}
