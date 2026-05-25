# Phase 03 — /load Result Cache Adapter

## Context Links

- Existing /load callers: `chat-service/src/tools/preview-cube-query.ts:99–107`, `chat-service/src/cache/refresh-cached-artifacts.ts:24–37`
- Meta hash source: `chat-service/src/core/cube-meta-cache.ts:76–85` (`getMetaVersion()`)
- Service from phase 01: `chat-service/src/cache/kv-cache-service.ts`

## Overview

- **Priority:** P2
- **Status:** pending
- **Description:** Cache Cube `/load` results behind a thin adapter so two existing callers DRY into one path. Key by `(measures+dimensions+filters+timeDimensions+gameId+cubeMetaHash)`, TTL 5–10 min, invalidate on meta-hash drift.

## Key Insights

- Two callers issue identical `POST /load` payloads at different stages: live `preview_cube_query` tool, and `refresh-cached-artifacts.ts` for chart refresh on cache replay. Shared cache helps **both** — preview hits warm refresh, refresh hits warm next preview.
- Cube `/load` response shape is `{ data: Row[] }` — only `data` needs caching (not the surrounding meta).
- Cube tokens are per-owner — but the SAME `gameId + query` yields the same `data` regardless of owner (Cube's /load is owner-agnostic at the data layer). So this cache CAN be cross-owner safely IFF the row data itself doesn't include per-owner PII. **Verification step in implementation.**

## Requirements

### Functional
- New adapter `cache/adapters/load-cache.ts` with `lookup({query, gameId, cubeToken}) → rows | null` and `store({query, gameId, cubeMetaHash, rows})`.
- Both `preview-cube-query.ts` and `refresh-cached-artifacts.ts` call the adapter before fetch.
- TTL = 5 min default, configurable via `CACHE_LOAD_TTL_MS` (default 300_000).
- Cache miss → live fetch → store → return.
- Cache hit → return cached rows; do NOT re-hit Cube.
- `X-Bypass-Cache: 1` header (already used by response cache) bypasses load cache too.

### Non-Functional
- Lookup must add ≤2ms vs uncached path.
- Failed cache write must not break the call path.

## Architecture

```
preview-cube-query.handler ─┐
                            ├─► load-cache.lookup(key) ─► (hit) return rows
refresh-cached-artifacts ──┘
                            └─► (miss) Cube /load ─► load-cache.store ─► return rows
```

### Key Derivation

```
canonical = JSON.stringify({
  m: (query.measures ?? []).sort(),
  d: (query.dimensions ?? []).sort(),
  td: (query.timeDimensions ?? []).map(t => ({d: t.dimension, g: t.granularity, r: t.dateRange})).sort(byDim),
  f: normaliseFilters(query.filters ?? []).sort(byMember),
  s: (query.segments ?? []).sort(),
  o: query.order ?? null,
  l: query.limit ?? null,
  off: query.offset ?? null,
  game: gameId
})
key = sha256(canonical + ':' + cubeMetaHash).slice(0,32)
```

`meta_hash` column = `cubeMetaHash` for drift visibility. On lookup, we compare row's `meta_hash` against current `getMetaVersion(gameId, cubeToken)` — mismatch = treat as miss (drift safety).

## Related Code Files

### Create
- `chat-service/src/cache/adapters/load-cache.ts` — adapter (≤120 lines).
- `chat-service/src/cache/adapters/canonicalise-query.ts` — small helper for stable JSON (DRY: reusable by other surfaces in future).
- `chat-service/test/cache/load-cache.test.ts` — round-trip + meta-hash invalidation tests.
- `chat-service/test/cache/canonicalise-query.test.ts` — key stability for permuted inputs.

### Modify
- `chat-service/src/tools/preview-cube-query.ts` — wrap the `fetch(...)` block; lookup before, store after.
- `chat-service/src/cache/refresh-cached-artifacts.ts` — same pattern around `runCubeLoad`.
- `chat-service/src/config.ts` — add `cacheLoadTtlMs` (default 300_000).

### Delete
- None.

## Implementation Steps

1. **Verify owner-agnosticism of /load data** — read 5–10 Cube cube definitions in this repo (`chat-service/cube` or main-server/cube — locate via grep) to confirm no measure/dimension performs row-level filtering based on the requesting `cubeToken` claim. If any do, downgrade the cache to per-(owner_id, gameId) keying. **This MUST happen before code.**
2. Create `canonicalise-query.ts`:
   - `function canonicaliseQuery(query, gameId): string` — sorts arrays, normalises filter member order, returns stable JSON.
3. Create `load-cache.ts`:
   - `async lookup({db, query, gameId, cubeMetaHash, bypass})` — if `bypass || !kvCacheService.isEnabledForKind('load')`, return null. Else canonicalise, hash, `kvCacheService.get('load', key)`, check `meta_hash === cubeMetaHash` (else null), parse `value_json.rows`, `markHit`, return rows.
   - `async store({db, query, gameId, cubeMetaHash, rows})` — canonicalise, hash, `kvCacheService.set('load', key, { value: {rows}, game_id, meta_hash: cubeMetaHash, expires_at: now + cacheLoadTtlMs })`.
4. Wire into `preview-cube-query.ts`:
   - Compute `cubeMetaHash = await getMetaVersion(ctx.gameId, ctx.cubeToken)` once (already available via cube-meta-cache).
   - Pre-fetch: `const cached = await loadCache.lookup({ db, query, gameId: ctx.gameId, cubeMetaHash, bypass: ctx.bypassCache });` — return cached rows if hit.
   - Post-fetch (on miss): `await loadCache.store({ ... rows })`.
   - Note: `ToolContext` doesn't currently carry `bypassCache`. Add the field (set from `X-Bypass-Cache` header in turn.ts). Wire through.
5. Wire into `refresh-cached-artifacts.ts`:
   - `runCubeLoad(query, cubeToken, gameId, db, cubeMetaHash)` — pre-fetch lookup, post-fetch store. Same pattern.
   - Caller (`buildRefreshHook`) gains `db, gameId, cubeMetaHash` deps. `turn.ts:301` currently calls `buildRefreshHook({ cubeToken })` — extend to pass through.
6. Add tests:
   - Round-trip: store → lookup returns same rows.
   - Meta-hash mismatch: store with hash A → lookup with hash B returns null.
   - TTL expiry: store with `expires_at = now - 1` → lookup returns null.
   - Bypass: `bypass: true` → lookup returns null even on hit.
   - Key stability: permute measures/dimensions/filters order → same key.

## Todo List

- [ ] Confirm Cube /load owner-agnosticism (cube-defs grep)
- [ ] Create canonicalise-query.ts
- [ ] Create load-cache.ts adapter
- [ ] Add `bypassCache` to ToolContext + wire from turn.ts
- [ ] Wire into preview-cube-query.ts
- [ ] Wire into refresh-cached-artifacts.ts (and extend buildRefreshHook signature)
- [ ] Add `cacheLoadTtlMs` to config
- [ ] Write 5 tests
- [ ] Manual: two consecutive preview_cube_query calls with same args → second logs cache hit

## Success Criteria

- Identical preview_cube_query call within 5min → no second `POST /load` network call (verify via fetch mock or log inspection).
- Cube schema change (meta hash rotation) → next preview misses (correct invalidation).
- Tests green.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Cube /load is owner-scoped via cubeToken row filtering | Low | High (cross-owner data leak) | Step 1 verification; downgrade to per-owner key if found. |
| Cache becomes stale within TTL window (data updates in Cube source) | Medium | Low–Medium | TTL is short (5m); doc the staleness window; `X-Bypass-Cache` available. |
| ToolContext shape change ripples through tests | Low | Low | Add field as optional; default false. |

## Security Considerations

- **PII gating:** If owner-agnosticism check fails, key MUST include `owner_id`. Default position: cross-owner cache only if Cube schema review confirms no per-token row filtering.
- `value_json.rows` may contain user-segmented data — same redaction audit applies as response_cache.
- Adapter respects `CACHE_KINDS_DISABLED=load` for emergency disable.

## Next Steps

- Phase 06 dashboard will display "load cache" stats (hit-rate, rows saved) alongside the existing response cache breakdown.
- Future optimisation: warm-cache prefetch when /meta refreshes (out of scope here).
