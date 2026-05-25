# Phase 04 — Cache effectiveness data layer

## Context Links
- Design: `design/hifi-mockup.html` (Cache tab section — feeds metric cards + top-N table)
- Cache schema: `chat-service/src/db/response-cache-migrate.ts` (no `cube_meta_hash` col — see Deviation)
- Cache key derivation: `chat-service/src/cache/response-cache-key.ts:45-70`
- Cache write site: `chat-service/src/cache/response-cache-write.ts`
- Current meta-version helper: `chat-service/src/core/cube-meta-cache.ts:76` (`getMetaVersion(gameId, cubeToken)`)
- Migration boot path: `chat-service/src/db/migrate.ts:29-58`
- Plugin registration: `chat-service/src/index.ts:29-73`
- Existing cache-clear plugin (style reference): `chat-service/src/api/debug-cache-clear.ts`
- Existing turn fields: `chat-service/src/db/migrate.ts:42-51` (cache_hit, cache_creation/read_tokens, started_at, ended_at, cost_usd, input/output_tokens, skill, model)

## Overview
- **Priority:** P1 (blocks phase 05 UI; parallelizable with 01/02/03)
- **Status:** pending
- **Description:** Build the server-side data layer for the 6 cache-effectiveness metrics. New store + new Fastify plugin + proxy route. Owner-scoped; game + days filterable.

## Key Insights — verified against codebase
- `response_cache` table has the columns we need EXCEPT `cube_meta_hash`. The current implementation mixes `cubeMetaHash` into the sha256 `key` (irreversible). To compute stale-cache pressure per spec, we MUST surface the hash as a queryable column. **Deviation**: add a `cube_meta_hash TEXT` column via idempotent ALTER. Legacy rows NULL → excluded from staleness denominator with caveat in UI.
- `getMetaVersion(gameId, cubeToken)` returns the current hash. It needs `cubeToken` — not available from the endpoint context. **Solution**: read the latest stored hash for that game from the most recent cache entries instead. Newest row's `cube_meta_hash` = current "as-of-last-write" hash. This avoids a network call from the dashboard endpoint and matches the actual definition users care about (drift between live cache).
- All metrics are owner-scoped: `chat_turns` ↔ `chat_sessions` (owner_id) join is the gateway. `response_cache` has NO owner_id; we join via `original_turn_id` → `chat_turns.session_id` → `chat_sessions.owner_id`.
- Time window: default 30 days, clamped [1, 90]. Bucket by day for sparkline.
- Top-N default = 20; clamp [1, 100].

## Deviation Notice (requires user confirmation per review-audit-self-decision rule)
**Spec said**: "Use `cube-meta-cache.ts:getMetaVersion()` for current hash. NO new table needed — compute on demand."
**Reality**: `response_cache` does NOT persist the per-row hash (only mixed into key). On-demand computation is impossible without it.
**Proposed**: idempotent `ALTER TABLE response_cache ADD COLUMN cube_meta_hash TEXT;` + write-site update in `response-cache-write.ts` to populate it. Legacy rows: NULL.
**Spec intent preserved**: NO new table. One additive column on existing table.
**Backwards compat**: NULL handling — staleness denominator counts only non-NULL rows; UI shows "X% stale of Y typed rows · Z legacy rows excluded".
**Alternative considered**: Drop stale-cache metric entirely. Rejected — spec lists it as one of the 6.

## Requirements
**Functional**
- `GET /debug/cache-effectiveness?game=<id>&days=<n>&topN=<n>&q=<str>` returns:
  ```ts
  {
    summary: {
      hitRate: number;           // 0..1, over `assistant` turns in window
      dollarsSaved: number;      // Σ over response_cache: cost_usd × (hit_count - 1)
      tokensSaved: number;       // Σ (input_tokens + output_tokens) × (hit_count - 1)
      latencyWinMs: { avgMissMs: number; avgHitMs: number; speedupX: number };
    };
    sparkline: Array<{ day: string; hits: number; misses: number }>;  // YYYY-MM-DD, oldest → newest
    topQueries: Array<{
      queryKey: string;
      snippet: string;           // first 80 chars of user_text from joined chat_turns
      skill: string;
      model: string;
      hitCount: number;
      lastHitAt: number | null;
      dollarsSaved: number;      // cost_usd × (hit_count - 1)
      originalTurnId: string;
      originalSessionId: string;
    }>;
    staleRatio: {
      stale: number;             // count where cube_meta_hash != currentHash AND cube_meta_hash IS NOT NULL
      typed: number;             // count where cube_meta_hash IS NOT NULL
      legacy: number;            // count where cube_meta_hash IS NULL
    };
    currentMetaHash: string | null;  // null if no rows in cache yet
    computedAt: string;          // ISO
  }
  ```
- Optional `q` param filters `topQueries` by `user_text_normalized LIKE '%q%'` (used by phase 02 cached-mode search).
- Game param optional → "all games for this owner".
- Days clamp [1,90]; topN clamp [1,100].

**Non-functional**
- `cache-effectiveness-store.ts` < 200 LOC.
- `debug-cache-effectiveness.ts` < 100 LOC.
- All queries owner-scoped via join (see Architecture).
- No N+1: 5 SQL statements total (one per chunk: summary metrics, hit-rate, sparkline buckets, top-N, stale ratio).

## Architecture

```
GET /api/chat/debug/cache-effectiveness?game=&days=&topN=&q=  [server/src/routes/chat.ts proxy]
                       │
                       ▼ X-Owner-Id forwarded
GET /debug/cache-effectiveness?...     [chat-service plugin]
                       │
                       ▼ ownerId, gameId?, days, topN, q?
computeCacheEffectiveness(db, opts):    [cache-effectiveness-store.ts]
  ├── hitRateAndLatency()  — SELECT FROM chat_turns JOIN chat_sessions WHERE owner_id=? AND role='assistant' AND started_at >= ?
  ├── savingsAndStale()    — SELECT FROM response_cache rc JOIN chat_turns t ON rc.original_turn_id=t.id JOIN chat_sessions s ON t.session_id=s.id WHERE s.owner_id=?
  ├── hitsMissesByDay()    — same join as #1 + GROUP BY date(started_at/1000,'unixepoch')
  ├── topQueries()         — SELECT FROM response_cache rc JOIN chat_turns t ON rc.original_turn_id=t.id JOIN chat_sessions s ON t.session_id=s.id WHERE s.owner_id=? ORDER BY hit_count DESC LIMIT ?
  └── resolveCurrentHash() — SELECT cube_meta_hash FROM response_cache rc JOIN ... WHERE owner_id=? AND game_id=? ORDER BY created_at DESC LIMIT 1
```

**Defense-in-depth (mirroring `debug-cache-clear.ts`):** when `game` is passed, verify owner has ≥ 1 session in that game before any query runs.

**Indexes assessment:** existing `idx_response_cache_game_last_hit` is on `(game_id, last_hit_at)`. The owner-scoped path joins via `original_turn_id` — chat_turns has primary key index on `id`. Cost is bounded by N(response_cache_for_game). Acceptable < 10ms at 10k rows.

## Related Code Files
**Modify**
- `chat-service/src/db/response-cache-migrate.ts` — add idempotent `ALTER TABLE response_cache ADD COLUMN cube_meta_hash TEXT;` inside the function (use `addColumnIfMissing` pattern from `migrate.ts:19` — promote helper to a shared utility OR inline a try/catch). Keep `CREATE TABLE` block also listing the column for fresh DBs.
- `chat-service/src/cache/response-cache-write.ts` — populate `cube_meta_hash` on every INSERT. Hash is already available (used to derive key). Pass through.
- `chat-service/src/db/response-cache-store.ts` — extend `InsertCacheParams` with `cubeMetaHash: string`; add it to INSERT statement.
- `chat-service/src/index.ts` — register `debugCacheEffectivenessRoutes` (1 line + 1 import).
- `server/src/routes/chat.ts` — add `GET /api/chat/debug/cache-effectiveness` proxy route (~25 LOC, mirrors leaderboard proxy at line 450).

**Create**
- `chat-service/src/db/cache-effectiveness-store.ts` (~170 LOC) — 5 pure functions + 1 aggregator + types.
- `chat-service/src/api/debug-cache-effectiveness.ts` (~80 LOC) — Fastify plugin: zod validate, owner-guard, defense-in-depth game-membership check, call aggregator, return.

**Delete:** none.

## Implementation Steps
1. **Migration**: edit `response-cache-migrate.ts`. Update the `CREATE TABLE IF NOT EXISTS` SQL to include `cube_meta_hash TEXT` column. Then add an inline ALTER fallback using a try/catch identical to `migrate.ts:19-27`:
   ```ts
   try { db.exec('ALTER TABLE response_cache ADD COLUMN cube_meta_hash TEXT;'); }
   catch (err) { if (!/duplicate column/.test(String(err))) throw err; }
   ```
2. **Write site**: in `response-cache-write.ts`, locate where `insertCacheEntry` is called; pass through the `cubeMetaHash` already available (the key was derived from it).
3. **Store update**: in `response-cache-store.ts`, extend `InsertCacheParams` + `CachedResponse` types + INSERT SQL.
4. **New store**: write `cache-effectiveness-store.ts`:
   - `computeCacheEffectiveness(db, { ownerId, gameId?, days, topN, q? })` aggregates 5 sub-queries.
   - All sub-queries use parameterized SQL. NEVER inline `q` — bind via `?`.
   - Hit-rate denominator = COUNT(role='assistant') in window for owner+game.
   - Latency: AVG(ended_at - started_at) per cache_hit flag.
   - Speedup = `avgMissMs / max(avgHitMs, 1)`. Round to 1 decimal.
5. **Plugin**: write `debug-cache-effectiveness.ts`:
   - zod parse `{ game?, days=30, topN=20, q? }`.
   - extractOwnerId → 401.
   - If `game` present: defense-in-depth (`SELECT 1 FROM chat_sessions WHERE owner_id=? AND game_id=? LIMIT 1`).
   - call store, return.
6. **Register plugin**: `chat-service/src/index.ts` — add `await fastify.register(debugCacheEffectivenessRoutes, { db });` alongside other debug plugins.
7. **Proxy**: in `server/src/routes/chat.ts`, near line 450, add a sibling block:
   ```ts
   app.get('/api/chat/debug/cache-effectiveness', async (request, reply) => {
     const owner = resolveOwner(request);
     if (!owner) return reply.status(401).send({ code: 'no_owner' });
     const params = new URLSearchParams();
     for (const [k, v] of Object.entries(request.query as Record<string, string|undefined>)) {
       if (typeof v === 'string' && v.length > 0) params.set(k, v);
     }
     const url = `${chatServiceUrl()}/debug/cache-effectiveness?${params.toString()}`;
     try {
       const { status, payload } = await proxyJson(url, 'GET', owner);
       return reply.status(status).send(payload);
     } catch (err) {
       return reply.status(502).send({ code: 'upstream_unreachable', message: (err as Error).message });
     }
   });
   ```
8. **Tests**: a smoke unit test for `computeCacheEffectiveness` against a seeded in-memory DB. Path: `chat-service/src/__tests__/cache-effectiveness-store.test.ts`. Cover: empty DB → zero/NaN guards; happy path → exact $ math; legacy NULL → counted in `staleRatio.legacy`.
9. **Compile**: `cd chat-service && npm run build` + `cd server && npm run build` (or whatever tsconfigs use).

## Todo List
- [ ] Add `cube_meta_hash` column (CREATE + idempotent ALTER)
- [ ] Update `InsertCacheParams` + INSERT SQL in `response-cache-store.ts`
- [ ] Plumb `cubeMetaHash` through `response-cache-write.ts`
- [ ] Write `cache-effectiveness-store.ts` (5 sub-queries + aggregator)
- [ ] Write `debug-cache-effectiveness.ts` Fastify plugin
- [ ] Register plugin in `chat-service/src/index.ts`
- [ ] Add proxy route in `server/src/routes/chat.ts`
- [ ] Smoke unit test in `chat-service/src/__tests__/`
- [ ] Compile both services
- [ ] Verify NULL row handling end-to-end (legacy rows pre-migration)

## Success Criteria
- Endpoint returns 200 + shape above for happy path.
- 401 missing owner; 400 invalid days; 403 game-not-owned by owner.
- $ saved = exact mathematical Σ (deterministic with seeded data).
- Stale ratio: post-migration writes populate `cube_meta_hash`; legacy rows show in `legacy` bucket, NOT `stale`.
- Same query 2× → same response (modulo `computedAt`).
- 30 days × 1000 rows benchmark: < 50ms p99 (smoke).

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| `$ saved` formula assumes hit cost ≈ miss cost | High | Low (semantic) | Caveat in UI tooltip (phase 05); document in store JSDoc |
| `currentMetaHash` from newest row is approximate (real "current" requires cube_token) | Med | Low | Document: "latest observed hash"; user understands |
| ALTER TABLE on production DB races a running write | Low | Low | better-sqlite3 is single-threaded per process; migrate runs on boot before listener accepts |
| NULL legacy rows skew hit-rate sparkline | None | None | Sparkline uses `chat_turns`, not `response_cache`. Unaffected. |
| Owner-scoping bug — `response_cache` has no owner_id, easy to forget join | Med | **HIGH** (privacy) | Single store function gates all queries via mandatory `chat_sessions s ON s.id=t.session_id WHERE s.owner_id=?` join. Unit-test it. |
| `q` LIKE injection | Low | Med | Parameterized binding (no string concat); test with `'; DROP --` payload |

## Security Considerations
- **Owner-scoping is the core privacy guarantee.** Every SELECT in this store joins `chat_sessions` and WHERE-clauses `owner_id = ?`. There must be NO query path that returns cross-owner data — assert with a unit test where two owners write rows and one reads.
- Defense-in-depth: when `game` param present, refuse if owner has no sessions in that game (mirrors `debug-cache-clear.ts:42-56`).
- No new auth surface; reuse `extractOwnerId`.

## Next Steps
- Phase 05 consumes this endpoint.
- Phase 02 cached-mode search consumes it via `?q=`.
