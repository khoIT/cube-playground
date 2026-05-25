/**
 * Low-level SQL helpers for cache-effectiveness-store.ts.
 *
 * Each function executes exactly one parameterized SQL statement.
 * Owner-scoping invariant: every SELECT joins through
 *   chat_turns t → chat_sessions s WHERE s.owner_id = ?
 * so no response_cache row is readable without the originating session's owner match.
 */

import type Database from 'better-sqlite3';
import type { LatencyWin, SparklineDay, TopQuery, StaleRatio } from './cache-effectiveness-store.js';

// ---------------------------------------------------------------------------
// Hit rate + latency
// ---------------------------------------------------------------------------

/** Compute hit rate and avg latency partitioned by cache_hit flag. */
export function queryHitRateAndLatency(
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
  return { hitRate: hits / rows.length, latencyWin: { avgHitMs, avgMissMs, speedupX } };
}

// ---------------------------------------------------------------------------
// Savings totals
// ---------------------------------------------------------------------------

/** Σ cost × (hit_count - 1) and Σ tokens × (hit_count - 1) for owner scope. */
export function querySavingsTotals(
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

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

/** Today-anchored sparkline — one bucket per day for the last `days` days. */
export function querySparklineByDay(
  db: Database.Database,
  { ownerId, gameId, sinceMs, days }: { ownerId: string; gameId?: string; sinceMs: number; days: number },
): SparklineDay[] {
  const gameFilter = gameId ? 'AND cs.game_id = ?' : '';
  const bindings: unknown[] = [ownerId, sinceMs, ...(gameId ? [gameId] : [])];

  type Row = { day: string; cache_hit: number; cnt: number };
  const rows = db.prepare(
    `SELECT date(ct.started_at / 1000, 'unixepoch') AS day,
            ct.cache_hit, COUNT(*) AS cnt
     FROM chat_turns ct
     JOIN chat_sessions cs ON cs.id = ct.session_id
     WHERE cs.owner_id = ? AND ct.role = 'assistant' AND ct.started_at >= ? ${gameFilter}
     GROUP BY day, ct.cache_hit`,
  ).all(...bindings) as Row[];

  // Build YYYY-MM-DD labels anchored to today (last index = today)
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
    const b = map.get(r.day);
    if (b) { if (r.cache_hit === 1) b.hits += r.cnt; else b.misses += r.cnt; }
  }
  return labels.map((day) => ({ day, ...map.get(day)! }));
}

// ---------------------------------------------------------------------------
// Top queries
// ---------------------------------------------------------------------------

/** Top-N cache entries by hit_count for this owner, with optional text filter. */
export function queryTopQueriesByHit(
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
    key: string; skill: string; model: string; user_text_normalized: string;
    hit_count: number; cost_usd: number; last_hit_at: number | null;
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

// ---------------------------------------------------------------------------
// Stale ratio
// ---------------------------------------------------------------------------

/**
 * Compute stale/typed/legacy counts.
 * "current hash" per game = cube_meta_hash of the newest non-null row in that game
 * (proxy for getMetaVersion() which requires cubeToken not available here).
 */
export function queryStaleRatio(
  db: Database.Database,
  { ownerId, gameId }: { ownerId: string; gameId?: string },
): { staleRatio: StaleRatio; currentMetaHash: string | null } {
  const gameFilter = gameId ? 'AND rc.game_id = ?' : '';
  const bindings: unknown[] = [ownerId, ...(gameId ? [gameId] : [])];

  // Newest non-null hash per game (proxy for "current" version)
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
  const currentMetaHash = gameId
    ? (currentHashByGame.get(gameId) ?? null)
    : (hashRows[0]?.cube_meta_hash ?? null);

  // Per-game, per-hash group counts
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
