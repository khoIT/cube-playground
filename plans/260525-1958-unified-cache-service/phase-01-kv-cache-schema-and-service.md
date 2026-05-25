# Phase 01 — kv_cache Schema, Base Service, Flag Rename

## Context Links

- Existing schema: `chat-service/src/db/response-cache-migrate.ts`
- Existing service: `chat-service/src/cache/response-cache-write.ts`, `cache/replay-cached-turn.ts`
- Config: `chat-service/src/config.ts:97–99,138`
- Migration host: `chat-service/src/db/migrate.ts`
- Research: `research/researcher-01-anthropic-prompt-cache.md` (gating note)

## Overview

- **Priority:** P1 (blocks 02–06)
- **Status:** pending
- **Description:** Introduce a single `kv_cache` table that all future cache adapters write to, behind a unified `CACHE_SERVICE_ENABLED` flag. Existing `response_cache` table stays untouched this phase (data migration deferred to a follow-up after dashboard reads from both).

## Key Insights

- `response_cache` PRIMARY KEY is `key`; new table uses `(kind, key)` composite so per-kind keyspaces never collide (a `load` row with the same hash as a `title` row coexist).
- `meta_hash` column generalises `cube_meta_hash` so other adapters (e.g. compaction tied to a turn window hash) can use the same drift-detection scaffolding.
- `owner_id` becomes a first-class column (was a JOIN-derived attribute on response_cache) — title/compaction caches need owner-scoped lookup as a direct WHERE.

## Requirements

### Functional
- New table `kv_cache` created idempotently on boot.
- New service module `kv-cache-service.ts` exposing `get/set/incrementHit/purgeExpired/clearForKind`.
- New config flag `CACHE_SERVICE_ENABLED` (default `false`). When unset, fall back to `RESPONSE_CACHE_ENABLED` for one release window (deprecation warning logged at boot if used).
- Per-kind disable list `CACHE_KINDS_DISABLED` (comma-separated). Adapters consult it.
- `ANTHROPIC_PROMPT_CACHE_ENABLED` (default `true`) — separate flag, not gated by `CACHE_SERVICE_ENABLED`.

### Non-Functional
- All writes synchronous via better-sqlite3 (same pattern as response_cache).
- Reads must complete <2ms p99 — same primary-key lookup characteristic.
- No new dependencies.

## Architecture

```
adapter (load|title|compaction|turn_detail) ─► kv-cache-service ─► kv-cache-store ─► kv_cache table
                                                       │
                                                       └─► config gate (CACHE_SERVICE_ENABLED + per-kind)
```

`kv-cache-service.ts` is intentionally thin — it owns:
- Gating (`isEnabledForKind(kind)`)
- Key namespacing (composes `(kind, key)`)
- TTL math (`expires_at = createdAt + ttlMs` if `ttlMs > 0`, else `NULL` = no expiry)
- Hit counting on read

Adapters own:
- Key derivation (each surface has its own hash strategy)
- Value shape (JSON schema per kind)
- TTL choice per kind

## Related Code Files

### Create
- `chat-service/src/db/kv-cache-migrate.ts` — CREATE TABLE + indexes; idempotent.
- `chat-service/src/db/kv-cache-store.ts` — SQL accessors (`getByKindKey`, `upsert`, `incrementHit`, `purgeExpired`, `clearForKind`, `aggregateByKind`).
- `chat-service/src/cache/kv-cache-service.ts` — gating + thin wrapper over store.
- `chat-service/test/cache/kv-cache-service.test.ts` — round-trip + TTL expiry + gate tests.

### Modify
- `chat-service/src/db/migrate.ts` — wire `migrateKvCache(db)` after `migrateResponseCache`.
- `chat-service/src/config.ts` — add `cacheServiceEnabled`, `cacheKindsDisabled[]`, `anthropicPromptCacheEnabled`. Keep `responseCacheEnabled` as the legacy alias (parsed but emits a deprecation log when read alone).

### Delete
- None.

## Schema (DDL)

```sql
CREATE TABLE IF NOT EXISTS kv_cache (
  kind          TEXT NOT NULL,
  key           TEXT NOT NULL,
  value_json    TEXT NOT NULL,
  owner_id      TEXT,
  game_id       TEXT,
  meta_hash     TEXT,
  model         TEXT,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd      REAL    NOT NULL DEFAULT 0,
  hit_count     INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_hit_at   INTEGER,
  expires_at    INTEGER,
  PRIMARY KEY (kind, key)
);

CREATE INDEX IF NOT EXISTS idx_kv_cache_kind_expires      ON kv_cache(kind, expires_at);
CREATE INDEX IF NOT EXISTS idx_kv_cache_owner_kind        ON kv_cache(owner_id, kind);
CREATE INDEX IF NOT EXISTS idx_kv_cache_game_kind         ON kv_cache(game_id, kind);
```

**Down SQL** (for reversibility):
```sql
DROP INDEX IF EXISTS idx_kv_cache_game_kind;
DROP INDEX IF EXISTS idx_kv_cache_owner_kind;
DROP INDEX IF EXISTS idx_kv_cache_kind_expires;
DROP TABLE IF EXISTS kv_cache;
```

## Implementation Steps

1. Create `kv-cache-migrate.ts` with the DDL above; idempotent (`CREATE TABLE IF NOT EXISTS`).
2. Wire it from `migrate.ts` after `migrateResponseCache(db)`.
3. Create `kv-cache-store.ts` with five exported functions:
   - `getByKindKey(db, kind, key)` — returns row or null; does NOT increment hit (caller does after using the value).
   - `upsertEntry(db, params)` — `INSERT ... ON CONFLICT(kind, key) DO UPDATE SET value_json=excluded.value_json, created_at=excluded.created_at, expires_at=excluded.expires_at, hit_count=0, last_hit_at=NULL`. (Refresh-on-write semantics — title and load benefit from rewriting.)
   - `incrementHit(db, kind, key)` — same pattern as `response-cache-store.incrementHit`.
   - `purgeExpired(db, nowMs)` — `DELETE FROM kv_cache WHERE expires_at IS NOT NULL AND expires_at < ?` (LIMIT 500).
   - `clearForKind(db, kind, filters?)` — `DELETE FROM kv_cache WHERE kind = ? [AND owner_id = ?] [AND game_id = ?]`.
   - `aggregateByKind(db, sinceMs, ownerId)` — used by phase 06 for the dashboard breakdown.
4. Create `kv-cache-service.ts` with:
   - `isEnabledForKind(kind)` → returns `false` if `!config.cacheServiceEnabled` OR `kind ∈ config.cacheKindsDisabled`.
   - `get(kind, key)` → reads, returns row + parsed JSON, or null. Checks `expires_at` and treats expired as miss.
   - `set(kind, key, params)` → no-op if disabled; else `upsertEntry`.
   - `markHit(kind, key)` → increments hit.
5. Update `config.ts`:
   - Add `cacheServiceEnabled: boolean`.
   - Add `cacheKindsDisabled: string[]` (parsed from `CACHE_KINDS_DISABLED=title,compaction`).
   - Add `anthropicPromptCacheEnabled: boolean` (default `true`).
   - Legacy alias: when `CACHE_SERVICE_ENABLED` is unset but `RESPONSE_CACHE_ENABLED=true`, set `cacheServiceEnabled = true` and `console.warn` at boot. Remove after one release.
6. Write three round-trip tests in `chat-service/test/cache/kv-cache-service.test.ts`:
   - `set → get` returns identical value; `hit_count` stays 0 until `markHit`.
   - `expires_at` in past → `get` returns null.
   - `isEnabledForKind('load')` flips correctly with env mutation.

## Todo List

- [ ] Create `kv-cache-migrate.ts`
- [ ] Wire from `migrate.ts`
- [ ] Create `kv-cache-store.ts` (5 functions)
- [ ] Create `kv-cache-service.ts` (4 entry points)
- [ ] Extend `config.ts` (3 new keys + legacy alias)
- [ ] Write 3 round-trip tests
- [ ] Run `npm run build` in chat-service — verify TS compiles
- [ ] Run `npm test -- kv-cache-service` — green

## Success Criteria

- Boot with empty DB → `kv_cache` table exists.
- Boot with existing DB → no duplicate-column / duplicate-table errors.
- `CACHE_SERVICE_ENABLED=false` → service rejects `set` (no-op) and returns `null` on `get`.
- `RESPONSE_CACHE_ENABLED=true CACHE_SERVICE_ENABLED unset` → boot log warns deprecation and behaves as enabled.
- Tests green.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| `kv_cache` table conflicts with future column add | Low | Low | Use `addColumnIfMissing` helper (already in `migrate.ts:18`) for future fields. |
| Boot performance regression (extra DDL) | Low | Negligible | Idempotent CREATE; <1ms cost. |
| Flag rename breaks running envs | Medium | Medium | Legacy `RESPONSE_CACHE_ENABLED` alias for one release; log deprecation. |

## Security Considerations

- `owner_id` column added but NOT used as a write gate in this phase — adapters in 03–05 own owner-scoping. Phase 04 (PII-sensitive) will add a defense-in-depth check at the service layer (`get` cross-checks `owner_id` against the param when kind is in a privacy-sensitive set).
- No PII enters `kv_cache` in this phase (only the table exists).

## Next Steps

- Phase 02 (independent) — Anthropic prompt cache wiring.
- Phases 03–05 — adapter implementations, each in their own file.
- Phase 06 — dashboard reads from `kv_cache` aggregate AND legacy `response_cache` until data migration.
