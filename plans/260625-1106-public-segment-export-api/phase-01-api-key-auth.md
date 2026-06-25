# Phase 01 — API-key auth + store

## Context
- Existing auth: `server/src/middleware/authenticate.ts` (app-JWT) + `workspace-header.ts`.
- Access store pattern: `server/src/auth/access-store.ts` (DB-authoritative, cached).
- Migrations: `server/src/db/migrations/` — next number **074**.

## Overview
- Priority: P0 (gates the whole surface).
- Service-to-service API keys, hashed at rest, workspace-scoped, optional
  segment/game allowlist, revocable, with `last_used_at` + audit.

## Requirements
- Mint format `sk_live_<base32(random 20 bytes)>`; show plaintext ONCE at creation.
- Store only `sha256(key)` (hex) + a short non-secret prefix (`sk_live_abcd…`) for display.
- Scope fields: `workspace` (required), `segment_ids` (NULL = all in workspace),
  `game_ids` (NULL = all), `role` fixed `export-reader` (read-only).
- Verify path: constant-time hash compare; reject revoked/expired; bump `last_used_at`
  (throttled write, e.g. ≤1/min) to avoid write amplification on every page.

## Architecture
- New `server/src/db/migrations/074-public-api-keys.sql`:
  `api_keys(id, key_prefix, key_sha256 UNIQUE, label, workspace, segment_ids_json,
  game_ids_json, created_by, created_at, revoked_at, expires_at, last_used_at)`.
- New `server/src/auth/api-key-store.ts` (<200 LoC): `createKey`, `verifyKey`,
  `listKeys`, `revokeKey`, `touchLastUsed`. Mirror `access-store.ts` caching.
- New `server/src/middleware/api-key-auth.ts`: a Fastify preHandler (NOT global
  onRequest) applied only to `/api/public/v1/*`. Resolves `req.apiKey` →
  `{ id, workspace, segmentIds, gameIds }` or 401. Decorates `req.apiKeyScope`.
- Scope check helper `canKeyAccessSegment(scope, segmentRow)`: workspace match +
  (segmentIds null or includes id) + (gameIds null or includes game).

## Related code files
- Create: migration 074, `api-key-store.ts`, `api-key-auth.ts`, `api-key-scope.ts`.
- Read: `access-store.ts`, `authenticate.ts`, `db/sqlite.ts` (migration runner).

## Implementation steps
1. Write migration 074 (idempotent CREATE TABLE IF NOT EXISTS + indexes on
   `key_sha256`, `workspace`).
2. `api-key-store.ts`: crypto.randomBytes → base32; sha256 hex; CRUD + cache.
3. `api-key-auth.ts`: read `Authorization: Bearer sk_live_…` or `X-API-Key`;
   verify; 401 JSON `{error:{code:'UNAUTHORIZED'}}`; attach scope; throttled touch.
4. `api-key-scope.ts`: `canKeyAccessSegment`.
5. Unit tests: hash round-trip, revoked/expired reject, scope allow/deny.

## Todo
- [ ] migration 074
- [ ] api-key-store.ts + cache
- [ ] api-key-auth.ts preHandler
- [ ] api-key-scope.ts
- [ ] tests (store + scope)

## Success criteria
- Valid key → scope resolved; revoked/expired/unknown → 401; cross-workspace
  segment → 403 via scope check. Plaintext key never persisted or logged.

## Risks
- Write amplification on `last_used_at` per streamed page → throttle to ≤1/min/key.
- Key leakage in logs → never log full key; log prefix only.

## Security
- Constant-time compare; sha256 at rest; read-only role; per-key scope is the
  authorization boundary (fail-closed on workspace mismatch).
