/**
 * Cache effectiveness aggregator.
 *
 * All queries are owner-scoped via:
 *   response_cache rc
 *   JOIN chat_turns t ON rc.original_turn_id = t.id
 *   JOIN chat_sessions s ON t.session_id = s.id
 *   WHERE s.owner_id = ?
 *
 * PRIVACY INVARIANT: No query in this file may return response_cache rows
 * unless the owning session belongs to the requesting owner. Verified by
 * the "owner isolation" unit test in cache-effectiveness-store.test.ts.
 *
 * $ saved formula (LOCKED): Σ cost_usd × (hit_count - 1) per row where hit_count > 0.
 * The "1" is subtracted because the first serve of the row was the original miss cost.
 *
 * staleRatio uses newest-row-hash-per-game as the "current" hash proxy,
 * since getMetaVersion() requires a cubeToken unavailable in the debug context.
 */

import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LatencyWin {
  avgHitMs: number;
  avgMissMs: number;
  speedupX: number;
}

export interface SparklineDay {
  day: string;    // YYYY-MM-DD
  hits: number;
  misses: number;
}

export interface TopQuery {
  queryKey: string;
  snippet: string;            // first 80 chars of user_text_normalized
  skill: string;
  model: string;
  hitCount: number;
  lastHitAt: number | null;
  dollarsSaved: number;       // cost_usd × (hit_count - 1)
  originalTurnId: string;
  originalSessionId: string;
}

export interface StaleRatio {
  stale: number;   // cube_meta_hash IS NOT NULL AND != currentHash for that game
  typed: number;   // cube_meta_hash IS NOT NULL
  legacy: number;  // cube_meta_hash IS NULL
}

export interface CacheEffectivenessResult {
  summary: {
    hitRate: number;
    dollarsSaved: number;
    tokensSaved: number;
    latencyWinMs: LatencyWin;
  };
  sparkline: SparklineDay[];
  topQueries: TopQuery[];
  staleRatio: StaleRatio;
  currentMetaHash: string | null;
  computedAt: string;
}

export interface CacheEffectivenessParams {
  ownerId: string;
  gameId?: string;
  days: number;
  topN: number;
  q?: string;
}

// ---------------------------------------------------------------------------
// Sub-query helpers
// ---------------------------------------------------------------------------

/** Hit-rate and latency window from chat_turns (no response_cache join needed). */
function hitRateAndLatency(
  db: Database.Database,
  { ownerId, gameId, sinceMs }: { ownerId: string; gameId?: string; sinceMs: number },
): { hitRate: number; latencyWin: LatencyWin } {
  const gameFilter = gameId ? 'AND cs.game_id = ?' : '';
  const bindings: unknown[] = [ownerId, sinceMs, ...(gameId ? [gameId] : [])];

  type Row = { cache_hit: number; started_at: number; ended_at: number | null };
  const rows = db.prepare(
    `SELECT ct.cache_hit, ct.started_at, ct.ended_at
     FROM chat_turns ct
     JOIN chat_sessions cs ON cs.id = ct.session_id
     WHERE cs.owner_id = ? AND ct.role = 'assistant' AND ct.started_at >= ? ${gameFilter}`,
  ).all(...bindings) as Row[];

  if (rows.length === 0) {
    return { hitRate: 0, latencyWin: { avgHitMs: 0, avgMissMs: 0, speedupX: 1 } };
  }

  let hits = 0, hitMs = 0, hitN = 0, missMs = 0, missN = 0;
  for (const r of rows) {
    if (r.cache_hit === 1) {
      hits++;
      if (r.ended_at != null) { hitMs += r.ended_at - r.started_at; hitN++; }
    } else {
      if (r.ended_at != null) { missMs += r.ended_at - r.started_at; missN++; }
    }
  }

  const avgHitMs = hitN > 0 ? hitMs / hitN : 0;
  const avgMissMs = missN > 0 ? missMs / missN : 0;
  const speedupX = Math.round((avgMissMs / Math.max(avgHitMs, 1)) * 10) / 10;

  return { hitRate: rows.length > 0 ? hits / rows.length : 0, latencyWin: { avgHitMs, avgMissMs, speedupX } };
}

/** Aggregate savings from response_cache rows (owner-scoped). */
function savingsTotals(
  db: Database.Database,
  { ownerId, gameId }: { ownerId: string; gameId?: string },
): { dollarsSaved: number; tokensSaved: number } {
  const gameFilter = gameId ? 'AND rc.game_id = ?' : '';
  const bindings: unknown[] = [ownerId, ...(gameId ? [gameId] : [])];

  type Row = { cost_usd: number; input_tokens: number; output_tokens: number; hit_count: number };
  const rows = db.prepare(
    `SELECT rc.cost_usd, rc.input_tokens, rc.output_tokens, rc.hit_count
     FROM response_cache rc
     JOIN chat_turns t ON t.id = rc.original_turn_id
     JOIN chat_sessions s ON s.id = t.session_id
     WHERE s.owner_id = ? AND rc.hit_count > 0 ${gameFilter}`,
  ).all(...bindings) as Row[];

  let dollarsSaved = 0, tokensSaved = 0;
  for (const r of rows) {
    const saves = r.hit_count - 1;
    if (saves > 0) {
      dollarsSaved += r.cost_usd * saves;
      tokensSaved += (r.input_tokens + r.output_tokens) * saves;
    }
  }
  return { dollarsSaved, tokensSaved };
}

/** Today-anchored sparkline of cache hits vs misses by day. */
function sparklineByDay(
  db: Database.Database,
  { ownerId, gameId, sinceMs, days }: { ownerId: string; gameId?: string; sinceMs: number; days: number },
): SparklineDay[] {
  const gameFilter = gameId ? 'AND cs.game_id = ?' : '';
  const bindings: unknown[] = [ownerId, sinceMs, ...(gameId ? [gameId] : [])];

  type Row = { day: string; cache_hit: number; cnt: number };
  const rows = db.prepare(
    `SELECT date(ct.started_at / 1000, 'unixepoch') AS day,
            ct.cache_hit,
            COUNT(*) AS cnt
     FROM chat_turns ct
     JOIN chat_sessions cs ON cs.id = ct.session_id
     WHERE cs.owner_id = ? AND ct.role = 'assistant' AND ct.started_at >= ? ${gameFilter}
     GROUP BY day, ct.cache_hit`,
  ).all(...bindings) as Row[];

  // Build YYYY-MM-DD labels for the last `days` days (today last)
  const labels: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    labels.push(d.toISOString().slice(0, 10));
  }

  const map = new Map<string, { hits: number; misses: number }>();
  for (const lbl of labels) map.set(lbl, { hits: 0, misses: 0 });

  for (const r of rows) {
    const bucket = map.get(r.day);
    if (!bucket) continue;
    if (r.cache_hit === 1) bucket.hits += r.cnt;
    else bucket.misses += r.cnt;
  }

  return labels.map((day) => ({ day, ...map.get(day)! }));
}

/** Top-N cache entries by hit_count for this owner. */
function topQueriesByHit(
  db: Database.Database,
  { ownerId, gameId, topN, q }: { ownerId: string; gameId?: string; topN: number; q?: string },
): TopQuery[] {
  const conditions: string[] = ['s.owner_id = ?'];
  const bindings: unknown[] = [ownerId];

  if (gameId) { conditions.push('rc.game_id = ?'); bindings.push(gameId); }

  if (q && q.trim()) {
    const safe = q.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
    conditions.push(`rc.user_text_normalized LIKE ? ESCAPE '\\'`);
    bindings.push(`%${safe}%`);
  }
  bindings.push(topN);

  type Row = {
    key: string; skill: string; model: string;
    user_text_normalized: string; hit_count: number;
    cost_usd: number; last_hit_at: number | null;
    original_turn_id: string; original_session_id: string;
  };
  const rows = db.prepare(
    `SELECT rc.key, rc.skill, rc.model, rc.user_text_normalized,
            rc.hit_count, rc.cost_usd, rc.last_hit_at,
            rc.original_turn_id, rc.original_session_id
     FROM response_cache rc
     JOIN chat_turns t ON t.id = rc.original_turn_id
     JOIN chat_sessions s ON s.id = t.session_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY rc.hit_count DESC, rc.created_at DESC
     LIMIT ?`,
  ).all(...bindings) as Row[];

  return rows.map((r) => ({
    queryKey: r.key,
    snippet: r.user_text_normalized.slice(0, 80),
    skill: r.skill,
    model: r.model,
    hitCount: r.hit_count,
    lastHitAt: r.last_hit_at,
    dollarsSaved: r.cost_usd * Math.max(r.hit_count - 1, 0),
    originalTurnId: r.original_turn_id,
    originalSessionId: r.original_session_id,
  }));
}

/**
 * Compute stale ratio using "newest row's hash per game" as current-hash proxy.
 * Legacy rows (cube_meta_hash IS NULL) counted separately, NOT in stale denominator.
 */
function computeStaleRatio(
  db: Database.Database,
  { ownerId, gameId }: { ownerId: string; gameId?: string },
): { staleRatio: StaleRatio; currentMetaHash: string | null } {
  const gameFilter = gameId ? 'AND rc.game_id = ?' : '';
  const bindings: unknown[] = [ownerId, ...(gameId ? [gameId] : [])];

  // Resolve current hash per game = newest row's cube_meta_hash (non-null)
  type HashRow = { game_id: string; cube_meta_hash: string };
  const hashRows = db.prepare(
    `SELECT rc.game_id, rc.cube_meta_hash
     FROM response_cache rc
     JOIN chat_turns t ON t.id = rc.original_turn_id
     JOIN chat_sessions s ON s.id = t.session_id
     WHERE s.owner_id = ? AND rc.cube_meta_hash IS NOT NULL ${gameFilter}
     GROUP BY rc.game_id
     HAVING rc.created_at = MAX(rc.created_at)`,
  ).all(...bindings) as HashRow[];

  const currentHashByGame = new Map(hashRows.map((r) => [r.game_id, r.cube_meta_hash]));
  const currentMetaHash = gameId ? (currentHashByGame.get(gameId) ?? null) : (hashRows[0]?.cube_meta_hash ?? null);

  // Count all rows for owner+game
  type CountRow = { game_id: string; cube_meta_hash: string | null; cnt: number };
  const countRows = db.prepare(
    `SELECT rc.game_id, rc.cube_meta_hash, COUNT(*) AS cnt
     FROM response_cache rc
     JOIN chat_turns t ON t.id = rc.original_turn_id
     JOIN chat_sessions s ON s.id = t.session_id
     WHERE s.owner_id = ? ${gameFilter}
     GROUP BY rc.game_id, rc.cube_meta_hash`,
  ).all(...bindings) as CountRow[];

  let stale = 0, typed = 0, legacy = 0;
  for (const r of countRows) {
    if (r.cube_meta_hash === null) {
      legacy += r.cnt;
    } else {
      typed += r.cnt;
      const current = currentHashByGame.get(r.game_id);
      if (current && r.cube_meta_hash !== current) stale += r.cnt;
    }
  }

  return { staleRatio: { stale, typed, legacy }, currentMetaHash };
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

/**
 * Compute all cache-effectiveness metrics for the given owner+game scope.
 * days is clamped [1, 90] at the caller (plugin layer).
 */
export function computeCacheEffectiveness(
  db: Database.Database,
  params: CacheEffectivenessParams,
): CacheEffectivenessResult {
  const days = Math.max(1, Math.min(90, params.days));
  const topN = Math.max(1, Math.min(100, params.topN));
  const sinceMs = Date.now() - days * 24 * 3_600_000;

  const { hitRate, latencyWin } = hitRateAndLatency(db, { ownerId: params.ownerId, gameId: params.gameId, sinceMs });
  const { dollarsSaved, tokensSaved } = savingsTotals(db, { ownerId: params.ownerId, gameId: params.gameId });
  const sparkline = sparklineByDay(db, { ownerId: params.ownerId, gameId: params.gameId, sinceMs, days });
  const topQueries = topQueriesByHit(db, { ownerId: params.ownerId, gameId: params.gameId, topN, q: params.q });
  const { staleRatio, currentMetaHash } = computeStaleRatio(db, { ownerId: params.ownerId, gameId: params.gameId });

  return {
    summary: { hitRate, dollarsSaved, tokensSaved, latencyWinMs: latencyWin },
    sparkline,
    topQueries,
    staleRatio,
    currentMetaHash,
    computedAt: new Date().toISOString(),
  };
}
