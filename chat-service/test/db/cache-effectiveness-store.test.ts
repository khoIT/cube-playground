/**
 * Unit tests for cache-effectiveness-store.ts
 *
 * Covers:
 *   - empty DB → zero results, no throws
 *   - hit rate with a realistic mix of hits and misses
 *   - $ saved formula: cost × (hit_count - 1); original miss NOT double-counted
 *   - tokens saved same formula
 *   - latency win partitioned by cache_hit
 *   - sparkline: correct day buckets, correct length, hit/miss counts
 *   - top-N ordering and q filter
 *   - stale ratio: old-hash rows → stale; same-hash rows → not stale; null rows → legacy
 *   - owner isolation: owner B cannot see owner A's cache rows (PRIVACY invariant)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrate.js';
import { computeCacheEffectiveness } from '../../src/db/cache-effectiveness-store.js';
import * as chatStore from '../../src/db/chat-store.js';
import { kvPut } from '../../src/cache/kv-cache-store.js';

vi.mock('../../src/config.js', () => ({
  config: {
    port: 3005, logLevel: 'silent', anthropicApiKey: 'test',
    anthropicBaseUrl: 'https://test', chatModel: 'claude-test',
    chatMaxOutputTokens: 4096, serverBaseUrl: 'http://localhost:3004',
    cubeApiUrl: 'http://localhost:4000', chatDbPath: ':memory:',
    chatMaxTurnsPerSession: 40, chatMaxTokensPerTurn: 8000,
    skillLoaderTtlMs: 5000, contextBudgetTokens: 180000,
    titleModel: 'claude-haiku', rateLimitPerOwnerPerMin: 30,
    costPer1kInputUsd: 0.003, costPer1kOutputUsd: 0.015,
    mcpEnabled: false, starterRankMinSessions: 3,
    disambigAutoThreshold: 0.75, mainServerServiceToken: '',
    streamRegistryRingSize: 100, streamRegistryMaxTurns: 10,
    streamRegistryTtlMs: 60000, streamRegistrySweepIntervalMs: 60000,
    langfusePublicKey: '', langfuseSecretKey: '',
    langfuseBaseUrl: 'https://cloud.langfuse.com',
    responseCacheEnabled: false,
  },
}));

vi.mock('../../src/db/snapshot-store.js', () => ({
  writeChatSnapshot: vi.fn(),
  hydrateChatFromSnapshot: vi.fn(() => ({ hydrated: false, counts: {} })),
  getChatSyncStatus: vi.fn(() => null),
  CHAT_SNAPSHOT_PATH: '/tmp/test-snapshot.json',
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

let _turnSeq = 0;
function uid(prefix = 't') { return `${prefix}-${++_turnSeq}-${Math.random().toString(36).slice(2, 6)}`; }

/** Insert a session and return its id. */
function seedSession(db: Database.Database, ownerId: string, gameId: string): string {
  const s = chatStore.createSession(db, { ownerId, gameId, title: 'test' });
  return s.id;
}

/** Mark a session soft-deleted by setting deleted_at to now. */
function markSessionDeleted(db: Database.Database, sessionId: string): void {
  db.prepare(`UPDATE chat_sessions SET deleted_at = ? WHERE id = ?`).run(Date.now(), sessionId);
}

interface TurnOpts {
  sessionId: string;
  cacheHit?: 0 | 1;
  startedAt?: number;
  endedAt?: number | null;
  costUsd?: number;
  skill?: string;
  model?: string;
}

/** Insert an assistant turn directly (bypasses the full turn route). */
function seedTurn(db: Database.Database, opts: TurnOpts): string {
  const turnId = uid('turn');
  const now = Date.now();
  db.prepare(
    `INSERT INTO chat_turns
       (id, session_id, turn_index, role, skill, model, started_at, ended_at,
        cost_usd, cache_hit, stop_reason)
     VALUES (?, ?, 0, 'assistant', ?, ?, ?, ?, ?, ?, 'end_turn')`,
  ).run(
    turnId,
    opts.sessionId,
    opts.skill ?? 'analytics',
    opts.model ?? 'claude-test',
    opts.startedAt ?? now,
    opts.endedAt !== undefined ? opts.endedAt : now + 100,
    opts.costUsd ?? 0.005,
    opts.cacheHit ?? 0,
  );
  return turnId;
}

interface CacheRowOpts {
  key?: string;
  gameId: string;
  originalTurnId: string;
  originalSessionId: string;
  hitCount?: number;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  cubeMetaHash?: string | null;
  createdAt?: number;
}

/** Insert a response_cache row directly. */
function seedCacheRow(db: Database.Database, opts: CacheRowOpts): void {
  db.prepare(
    `INSERT OR IGNORE INTO response_cache
       (key, game_id, skill, model, user_text_normalized, value_json,
        input_tokens, output_tokens, cost_usd, hit_count, created_at,
        original_turn_id, original_session_id, cube_meta_hash)
     VALUES (?, ?, 'analytics', 'claude-test', 'show revenue', '{"text":"ok","toolCalls":[]}',
             ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.key ?? uid('key'),
    opts.gameId,
    opts.inputTokens ?? 1000,
    opts.outputTokens ?? 400,
    opts.costUsd ?? 0.005,
    opts.hitCount ?? 0,
    opts.createdAt ?? Date.now(),
    opts.originalTurnId,
    opts.originalSessionId,
    opts.cubeMetaHash ?? null,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeCacheEffectiveness', () => {
  let db: Database.Database;

  beforeEach(() => { db = makeDb(); _turnSeq = 0; });

  // -------------------------------------------------------------------------
  // Empty DB
  // -------------------------------------------------------------------------

  it('returns zeros on empty DB without throwing', () => {
    const r = computeCacheEffectiveness(db, { ownerId: 'owner-a', days: 30, topN: 20 });
    expect(r.summary.hitRate).toBe(0);
    expect(r.summary.dollarsSaved).toBe(0);
    expect(r.summary.tokensSaved).toBe(0);
    expect(r.summary.latencyWinMs.avgHitMs).toBe(0);
    expect(r.summary.latencyWinMs.avgMissMs).toBe(0);
    expect(r.topQueries).toHaveLength(0);
    expect(r.sparkline).toHaveLength(30);
    expect(r.staleRatio).toBe(0);
    expect(r.legacyRatio).toBe(0);
    expect(r.currentMetaHash).toBeNull();
    expect(r.computedAt).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Hit rate
  // -------------------------------------------------------------------------

  it('computes hitRate correctly with 1 hit and 2 misses', () => {
    const sessId = seedSession(db, 'owner-a', 'game-1');
    seedTurn(db, { sessionId: sessId, cacheHit: 1 });
    seedTurn(db, { sessionId: sessId, cacheHit: 0 });
    seedTurn(db, { sessionId: sessId, cacheHit: 0 });

    const r = computeCacheEffectiveness(db, { ownerId: 'owner-a', days: 30, topN: 20 });
    expect(r.summary.hitRate).toBeCloseTo(1 / 3);
  });

  // -------------------------------------------------------------------------
  // Dollars saved formula
  // -------------------------------------------------------------------------

  it('$ saved = cost × (hit_count - 1); does NOT include original miss cost', () => {
    const sessId = seedSession(db, 'owner-a', 'game-1');
    const turnId = seedTurn(db, { sessionId: sessId, cacheHit: 0 });

    // hit_count=3 means 3 replays after the original miss → 3 saves
    seedCacheRow(db, {
      gameId: 'game-1',
      originalTurnId: turnId,
      originalSessionId: sessId,
      costUsd: 0.01,
      hitCount: 3,
    });

    const r = computeCacheEffectiveness(db, { ownerId: 'owner-a', days: 30, topN: 20 });
    // Σ cost × (hit_count - 1) = 0.01 × (3 - 1) = 0.02
    expect(r.summary.dollarsSaved).toBeCloseTo(0.02);
  });

  it('$ saved = 0 when hit_count=0 (never replayed)', () => {
    const sessId = seedSession(db, 'owner-a', 'game-1');
    const turnId = seedTurn(db, { sessionId: sessId, cacheHit: 0 });
    seedCacheRow(db, { gameId: 'game-1', originalTurnId: turnId, originalSessionId: sessId, hitCount: 0 });

    const r = computeCacheEffectiveness(db, { ownerId: 'owner-a', days: 30, topN: 20 });
    expect(r.summary.dollarsSaved).toBe(0);
  });

  it('sums across multiple cache rows', () => {
    const sessId = seedSession(db, 'owner-a', 'game-1');
    const t1 = seedTurn(db, { sessionId: sessId });
    const t2 = seedTurn(db, { sessionId: sessId });
    seedCacheRow(db, { key: 'k1', gameId: 'game-1', originalTurnId: t1, originalSessionId: sessId, costUsd: 0.01, hitCount: 2 });
    seedCacheRow(db, { key: 'k2', gameId: 'game-1', originalTurnId: t2, originalSessionId: sessId, costUsd: 0.02, hitCount: 4 });

    const r = computeCacheEffectiveness(db, { ownerId: 'owner-a', days: 30, topN: 20 });
    // 0.01*(2-1) + 0.02*(4-1) = 0.01 + 0.06 = 0.07
    expect(r.summary.dollarsSaved).toBeCloseTo(0.07);
  });

  // -------------------------------------------------------------------------
  // Tokens saved
  // -------------------------------------------------------------------------

  it('tokensSaved = Σ (input+output) × (hit_count - 1)', () => {
    const sessId = seedSession(db, 'owner-a', 'game-1');
    const turnId = seedTurn(db, { sessionId: sessId });
    seedCacheRow(db, {
      gameId: 'game-1', originalTurnId: turnId, originalSessionId: sessId,
      inputTokens: 1000, outputTokens: 500, hitCount: 3,
    });

    const r = computeCacheEffectiveness(db, { ownerId: 'owner-a', days: 30, topN: 20 });
    // (1000+500) × (3-1) = 1500 × 2 = 3000
    expect(r.summary.tokensSaved).toBe(3000);
  });

  // -------------------------------------------------------------------------
  // Latency win
  // -------------------------------------------------------------------------

  it('latencyWin avgHitMs and avgMissMs are partitioned by cache_hit', () => {
    const sessId = seedSession(db, 'owner-a', 'game-1');
    const now = Date.now();
    seedTurn(db, { sessionId: sessId, cacheHit: 1, startedAt: now, endedAt: now + 50 });
    seedTurn(db, { sessionId: sessId, cacheHit: 1, startedAt: now, endedAt: now + 150 });
    seedTurn(db, { sessionId: sessId, cacheHit: 0, startedAt: now, endedAt: now + 2000 });
    seedTurn(db, { sessionId: sessId, cacheHit: 0, startedAt: now, endedAt: now + 4000 });

    const r = computeCacheEffectiveness(db, { ownerId: 'owner-a', days: 30, topN: 20 });
    expect(r.summary.latencyWinMs.avgHitMs).toBeCloseTo(100);  // (50+150)/2
    expect(r.summary.latencyWinMs.avgMissMs).toBeCloseTo(3000); // (2000+4000)/2
    expect(r.summary.latencyWinMs.speedupX).toBeCloseTo(30);    // 3000/100
  });

  // -------------------------------------------------------------------------
  // Sparkline
  // -------------------------------------------------------------------------

  it('sparkline has correct length = days param', () => {
    const r = computeCacheEffectiveness(db, { ownerId: 'owner-a', days: 7, topN: 20 });
    expect(r.sparkline).toHaveLength(7);
  });

  it('sparkline last bucket (today) captures turns seeded now', () => {
    const sessId = seedSession(db, 'owner-a', 'game-1');
    seedTurn(db, { sessionId: sessId, cacheHit: 1 });
    seedTurn(db, { sessionId: sessId, cacheHit: 0 });

    const r = computeCacheEffectiveness(db, { ownerId: 'owner-a', days: 7, topN: 20 });
    const today = r.sparkline[r.sparkline.length - 1];
    expect(today.hits).toBe(1);
    expect(today.misses).toBe(1);
  });

  it('sparkline earlier buckets are zero when no turns in those days', () => {
    const sessId = seedSession(db, 'owner-a', 'game-1');
    seedTurn(db, { sessionId: sessId });

    const r = computeCacheEffectiveness(db, { ownerId: 'owner-a', days: 5, topN: 20 });
    // All but the last bucket should be 0
    for (const b of r.sparkline.slice(0, -1)) {
      expect(b.hits + b.misses).toBe(0);
    }
  });

  // -------------------------------------------------------------------------
  // Top queries
  // -------------------------------------------------------------------------

  it('topQueries ordered by hit_count desc', () => {
    const sessId = seedSession(db, 'owner-a', 'game-1');
    const t1 = seedTurn(db, { sessionId: sessId });
    const t2 = seedTurn(db, { sessionId: sessId });
    const t3 = seedTurn(db, { sessionId: sessId });
    seedCacheRow(db, { key: 'k-low',  gameId: 'game-1', originalTurnId: t1, originalSessionId: sessId, hitCount: 1 });
    seedCacheRow(db, { key: 'k-high', gameId: 'game-1', originalTurnId: t2, originalSessionId: sessId, hitCount: 10 });
    seedCacheRow(db, { key: 'k-mid',  gameId: 'game-1', originalTurnId: t3, originalSessionId: sessId, hitCount: 5 });

    const r = computeCacheEffectiveness(db, { ownerId: 'owner-a', days: 30, topN: 20 });
    expect(r.topQueries[0].queryKey).toBe('k-high');
    expect(r.topQueries[1].queryKey).toBe('k-mid');
    expect(r.topQueries[2].queryKey).toBe('k-low');
  });

  it('topN limits results', () => {
    const sessId = seedSession(db, 'owner-a', 'game-1');
    for (let i = 0; i < 5; i++) {
      const t = seedTurn(db, { sessionId: sessId });
      seedCacheRow(db, { key: `k-${i}`, gameId: 'game-1', originalTurnId: t, originalSessionId: sessId, hitCount: i + 1 });
    }
    const r = computeCacheEffectiveness(db, { ownerId: 'owner-a', days: 30, topN: 3 });
    expect(r.topQueries).toHaveLength(3);
  });

  it('snippet is capped at 80 chars', () => {
    const sessId = seedSession(db, 'owner-a', 'game-1');
    const t = seedTurn(db, { sessionId: sessId });
    const longText = 'a'.repeat(200);
    db.prepare(
      `INSERT OR IGNORE INTO response_cache
         (key, game_id, skill, model, user_text_normalized, value_json,
          input_tokens, output_tokens, cost_usd, hit_count, created_at,
          original_turn_id, original_session_id)
       VALUES (?, ?, 'analytics', 'claude-test', ?, '{}', 100, 50, 0.001, 1, ?, ?, ?)`,
    ).run('k-long', 'game-1', longText, Date.now(), t, sessId);

    const r = computeCacheEffectiveness(db, { ownerId: 'owner-a', days: 30, topN: 20 });
    expect(r.topQueries[0].snippet.length).toBe(80);
  });

  // -------------------------------------------------------------------------
  // Stale ratio
  // -------------------------------------------------------------------------

  it('staleRatio: old-hash rows counted as stale, same-hash rows not, null rows as legacy', () => {
    const sessId = seedSession(db, 'owner-a', 'game-1');
    const t1 = seedTurn(db, { sessionId: sessId });
    const t2 = seedTurn(db, { sessionId: sessId });
    const t3 = seedTurn(db, { sessionId: sessId });

    const now = Date.now();
    // Newest row sets "current hash" for game-1
    seedCacheRow(db, { key: 'k-current', gameId: 'game-1', originalTurnId: t1, originalSessionId: sessId, cubeMetaHash: 'hash-new', createdAt: now });
    // Older row with different hash → stale
    seedCacheRow(db, { key: 'k-stale',   gameId: 'game-1', originalTurnId: t2, originalSessionId: sessId, cubeMetaHash: 'hash-old', createdAt: now - 10000 });
    // Legacy row → null → legacy bucket
    seedCacheRow(db, { key: 'k-legacy',  gameId: 'game-1', originalTurnId: t3, originalSessionId: sessId, cubeMetaHash: null });

    const r = computeCacheEffectiveness(db, { ownerId: 'owner-a', gameId: 'game-1', days: 30, topN: 20 });
    // stale=1, typed=2, legacy=1 → denom=3 → staleRatio=1/3, legacyRatio=1/3
    expect(r.staleRatio).toBeCloseTo(1 / 3);
    expect(r.legacyRatio).toBeCloseTo(1 / 3);
    expect(r.currentMetaHash).toBe('hash-new');
  });

  it('currentMetaHash is null when no typed rows exist', () => {
    const sessId = seedSession(db, 'owner-a', 'game-1');
    const t = seedTurn(db, { sessionId: sessId });
    seedCacheRow(db, { gameId: 'game-1', originalTurnId: t, originalSessionId: sessId, cubeMetaHash: null });

    const r = computeCacheEffectiveness(db, { ownerId: 'owner-a', gameId: 'game-1', days: 30, topN: 20 });
    expect(r.currentMetaHash).toBeNull();
    // legacy=1, typed=0 → denom=1 → legacyRatio=1, staleRatio=0
    expect(r.legacyRatio).toBeCloseTo(1);
    expect(r.staleRatio).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Owner isolation — PRIVACY INVARIANT
  // -------------------------------------------------------------------------

  it('owner B cannot see owner A cache rows even if they share the same game_id', () => {
    // Owner A has sessions in game-1 and generated cache rows
    const sessA = seedSession(db, 'owner-a', 'game-1');
    const turnA = seedTurn(db, { sessionId: sessA, cacheHit: 0, costUsd: 0.1 });
    seedCacheRow(db, {
      key: 'owner-a-key', gameId: 'game-1',
      originalTurnId: turnA, originalSessionId: sessA,
      costUsd: 0.1, hitCount: 5,
    });

    // Owner B has NO sessions in game-1 — queries as if they do
    const r = computeCacheEffectiveness(db, { ownerId: 'owner-b', days: 30, topN: 20 });

    expect(r.summary.dollarsSaved).toBe(0);
    expect(r.summary.hitRate).toBe(0);
    expect(r.topQueries).toHaveLength(0);
    expect(r.staleRatio).toBe(0);
    expect(r.legacyRatio).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Soft-delete exclusion
  // -------------------------------------------------------------------------

  it('soft-deleted sessions are excluded from hitRate, dollarsSaved, and topQueries', () => {
    // Live session — should be counted
    const liveSess = seedSession(db, 'owner-a', 'game-1');
    const liveTurn = seedTurn(db, { sessionId: liveSess, cacheHit: 1, costUsd: 0.01 });
    seedCacheRow(db, {
      key: 'k-live', gameId: 'game-1',
      originalTurnId: liveTurn, originalSessionId: liveSess,
      costUsd: 0.01, hitCount: 2,
    });

    // Deleted session — should NOT be counted
    const deletedSess = seedSession(db, 'owner-a', 'game-1');
    const deletedTurn = seedTurn(db, { sessionId: deletedSess, cacheHit: 1, costUsd: 0.5 });
    seedCacheRow(db, {
      key: 'k-deleted', gameId: 'game-1',
      originalTurnId: deletedTurn, originalSessionId: deletedSess,
      costUsd: 0.5, hitCount: 10,
    });
    markSessionDeleted(db, deletedSess);

    const r = computeCacheEffectiveness(db, { ownerId: 'owner-a', days: 30, topN: 20 });
    // Only the live row contributes: 0.01 × (2-1) = 0.01
    expect(r.summary.dollarsSaved).toBeCloseTo(0.01);
    // Only the live turn counts toward hitRate
    expect(r.topQueries).toHaveLength(1);
    expect(r.topQueries[0].queryKey).toBe('k-live');
  });

  it('soft-deleted sessions excluded from staleRatio and currentMetaHash', () => {
    const liveSess = seedSession(db, 'owner-a', 'game-1');
    const liveTurn = seedTurn(db, { sessionId: liveSess });
    seedCacheRow(db, {
      key: 'k-live', gameId: 'game-1',
      originalTurnId: liveTurn, originalSessionId: liveSess,
      cubeMetaHash: 'hash-live',
    });

    const deletedSess = seedSession(db, 'owner-a', 'game-1');
    const deletedTurn = seedTurn(db, { sessionId: deletedSess });
    seedCacheRow(db, {
      key: 'k-deleted', gameId: 'game-1',
      originalTurnId: deletedTurn, originalSessionId: deletedSess,
      cubeMetaHash: 'hash-old', createdAt: Date.now() - 10000,
    });
    markSessionDeleted(db, deletedSess);

    const r = computeCacheEffectiveness(db, { ownerId: 'owner-a', gameId: 'game-1', days: 30, topN: 20 });
    // Live row is the only typed row → stale=0, legacy=0
    expect(r.staleRatio).toBe(0);
    expect(r.legacyRatio).toBe(0);
    expect(r.currentMetaHash).toBe('hash-live');
  });

  // -------------------------------------------------------------------------
  // currentMetaHash at all-games scope
  // -------------------------------------------------------------------------

  it('currentMetaHash is null at all-games scope (cross-game pick is meaningless)', () => {
    // Two games, different schema hashes — cross-game "current" is undefined
    const s1 = seedSession(db, 'owner-a', 'game-1');
    const t1 = seedTurn(db, { sessionId: s1 });
    seedCacheRow(db, {
      key: 'k1', gameId: 'game-1', originalTurnId: t1, originalSessionId: s1,
      cubeMetaHash: 'hash-game1',
    });

    const s2 = seedSession(db, 'owner-a', 'game-2');
    const t2 = seedTurn(db, { sessionId: s2 });
    seedCacheRow(db, {
      key: 'k2', gameId: 'game-2', originalTurnId: t2, originalSessionId: s2,
      cubeMetaHash: 'hash-game2',
    });

    // No gameId filter → currentMetaHash must be null
    const rAll = computeCacheEffectiveness(db, { ownerId: 'owner-a', days: 30, topN: 20 });
    expect(rAll.currentMetaHash).toBeNull();

    // With gameId filter → currentMetaHash resolves to that game's hash
    const rG1 = computeCacheEffectiveness(db, { ownerId: 'owner-a', gameId: 'game-1', days: 30, topN: 20 });
    expect(rG1.currentMetaHash).toBe('hash-game1');
  });

  // -------------------------------------------------------------------------
  // kv_cache byKind breakdown
  // -------------------------------------------------------------------------

  it('byKind is empty when kv_cache has no rows', () => {
    const r = computeCacheEffectiveness(db, { ownerId: 'owner-a', days: 30, topN: 20 });
    expect(r.byKind).toEqual([]);
  });

  it('byKind groups kv_cache rows by kind with entries + totalHits', () => {
    kvPut(db, { kind: 'load', key: 'k1', valueJson: '{}', now: 1000 });
    kvPut(db, { kind: 'load', key: 'k2', valueJson: '{}', now: 1100 });
    kvPut(db, { kind: 'turn_detail', key: 'tA', valueJson: '{}', now: 1200 });

    // Simulate hits on load/k1 by manually bumping (no kvGet API exposes
    // bypass; use raw UPDATE to keep test pure-table-level).
    db.prepare(`UPDATE kv_cache SET hit_count = 5, last_hit_at = 2000 WHERE kind = 'load' AND key = 'k1'`).run();
    db.prepare(`UPDATE kv_cache SET hit_count = 2, last_hit_at = 1900 WHERE kind = 'turn_detail' AND key = 'tA'`).run();

    const r = computeCacheEffectiveness(db, { ownerId: 'owner-a', days: 30, topN: 20 });
    expect(r.byKind).toHaveLength(2);

    const load = r.byKind.find((k) => k.kind === 'load')!;
    expect(load.entries).toBe(2);
    expect(load.totalHits).toBe(5);
    expect(load.lastHitAt).toBe(2000);

    const turnDetail = r.byKind.find((k) => k.kind === 'turn_detail')!;
    expect(turnDetail.entries).toBe(1);
    expect(turnDetail.totalHits).toBe(2);
    expect(turnDetail.lastHitAt).toBe(1900);
  });

  it('byKind is sorted by kind ascending', () => {
    kvPut(db, { kind: 'zzz', key: 'k', valueJson: '{}' });
    kvPut(db, { kind: 'aaa', key: 'k', valueJson: '{}' });
    kvPut(db, { kind: 'mmm', key: 'k', valueJson: '{}' });

    const r = computeCacheEffectiveness(db, { ownerId: 'owner-a', days: 30, topN: 20 });
    expect(r.byKind.map((k) => k.kind)).toEqual(['aaa', 'mmm', 'zzz']);
  });

  it('owner B with different game sees only their own data', () => {
    // Owner A — game-1
    const sessA = seedSession(db, 'owner-a', 'game-1');
    const tA = seedTurn(db, { sessionId: sessA, costUsd: 0.5 });
    seedCacheRow(db, { key: 'kA', gameId: 'game-1', originalTurnId: tA, originalSessionId: sessA, costUsd: 0.5, hitCount: 10 });

    // Owner B — game-2
    const sessB = seedSession(db, 'owner-b', 'game-2');
    const tB = seedTurn(db, { sessionId: sessB, costUsd: 0.02 });
    seedCacheRow(db, { key: 'kB', gameId: 'game-2', originalTurnId: tB, originalSessionId: sessB, costUsd: 0.02, hitCount: 2 });

    const rA = computeCacheEffectiveness(db, { ownerId: 'owner-a', days: 30, topN: 20 });
    const rB = computeCacheEffectiveness(db, { ownerId: 'owner-b', days: 30, topN: 20 });

    // Owner A: 0.5 × (10-1) = 4.5
    expect(rA.summary.dollarsSaved).toBeCloseTo(4.5);
    expect(rA.topQueries[0].queryKey).toBe('kA');

    // Owner B: 0.02 × (2-1) = 0.02
    expect(rB.summary.dollarsSaved).toBeCloseTo(0.02);
    expect(rB.topQueries[0].queryKey).toBe('kB');
  });
});
