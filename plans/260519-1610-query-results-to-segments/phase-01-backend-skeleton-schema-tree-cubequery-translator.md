---
phase: 1
title: "Backend skeleton + schema + tree↔CubeQuery translator"
status: pending
priority: P1
effort: "1.5w"
dependencies: []
---

# Phase 1: Backend skeleton + schema + tree↔CubeQuery translator

## Overview

Stand up `/server` — a Fastify + better-sqlite3 process colocated in the repo. Ship the segment / analysis / identity-map schema, CRUD endpoints, owner-header middleware, and the bidirectional translator between the canonical AND/OR predicate tree and Cube `Query.filters`. This unblocks every other phase.

## Requirements

**Functional**
- Fastify server listens on `:3001` (configurable via env). Vite dev proxy forwards `/api/* → :3001`.
- SQLite database persists across restarts (file `./server/data/segments.db`).
- CRUD endpoints implemented for `segments`, `segment_analyses`, `cube_identity_map`, `presets`.
- `tree ↔ Cube Query.filters` translator handles AND/OR groups, nested groups, leaf operators per type (string / number / time / boolean), and the operator set defined in the brainstorm (`=`, `!=`, `>`, `<`, `>=`, `<=`, `IN`, `NOT IN`, `contains`, `set`, `notSet`, `inDateRange`, `beforeDate`, `afterDate`).
- Owner header middleware: reads `X-Owner` from each request (defaults to `anonymous`), stamps on writes, filters list queries unless `?owner=*`.
- `/api/meta/version` returns SHA-256 of last-seen Cube `/meta` payload (cached in-memory; refreshed on demand).
- `/api/presets` returns the registry's preset definitions (v1 has only `mf_users-hub`).

**Non-functional**
- Process boot ≤ 1s on cold start; schema migrations run idempotently.
- All endpoints return JSON; errors follow `{ error: { code, message, details? } }`.
- Translator is pure (no I/O) and 100% covered by unit tests.

## Architecture

```
/server
  package.json
  src/
    index.ts                 (Fastify bootstrap + plugin wiring)
    db/
      sqlite.ts              (better-sqlite3 singleton + migrations)
      migrations/
        001-init.sql
    routes/
      segments.ts            (CRUD + append + refresh stubs)
      analyses.ts
      identity-map.ts
      presets.ts
      meta-version.ts
    services/
      cube-client.ts         (HTTP wrapper around Cube /meta /load /sql)
      meta-cache.ts          (hash + cache + invalidation)
      translator.ts          (tree ↔ Cube Query.filters)
    middleware/
      owner-header.ts
    types/
      segment.ts
      predicate-tree.ts
      preset.ts
  test/
    translator.test.ts
    owner-header.test.ts
    routes.crud.test.ts
```

Vite config (`vite.config.ts`) gains a dev proxy entry: `'/api': 'http://localhost:3001'`. Prod single-binary serve handled in P8.

## Related Code Files

**Create**
- `server/package.json`, `server/tsconfig.json`
- `server/src/index.ts`
- `server/src/db/sqlite.ts`
- `server/src/db/migrations/001-init.sql`
- `server/src/routes/{segments,analyses,identity-map,presets,meta-version}.ts`
- `server/src/services/{cube-client,meta-cache,translator}.ts`
- `server/src/middleware/owner-header.ts`
- `server/src/types/{segment,predicate-tree,preset}.ts`
- `server/test/{translator,owner-header,routes.crud}.test.ts`
- `src/types/segment-api.ts` (shared FE type — typed against server)

**Modify**
- `vite.config.ts` — add `/api → :3001` proxy
- `package.json` — add `server:dev`, `server:build`, `server:test` scripts + concurrently for combined dev
- `.gitignore` — `server/data/`

## Implementation Steps

1. Scaffold `/server` with `pnpm` / `npm` workspace (single `package.json`). Add Fastify, `@fastify/cors`, `better-sqlite3`, `zod`, `tsx`, `vitest`.
2. Wire `vitest` + add `npm run server:test`.
3. Write `001-init.sql` matching the brainstorm schema (segments, segment_tags, segment_analyses, cube_identity_map). Skip `segment_size_history` (v1.5).
4. Implement `db/sqlite.ts` — opens DB, runs migrations on boot, exposes prepared-statement helpers.
5. Implement `services/translator.ts`:
   - `treeToCubeFilters(tree: PredicateNode): CubeFilter[]`
   - `cubeFiltersToTree(filters: CubeFilter[]): PredicateNode`
   - Cover all type/operator combinations; throw `UnsupportedOperator` on mismatch.
6. Implement `services/cube-client.ts` — fetch wrapper for `/cubejs-api/v1/{meta,load,sql}` reading Cube URL + JWT from env.
7. Implement `services/meta-cache.ts` — in-memory `{hash, fetchedAt, ttl=60s}`. `GET /api/meta/version` reads through cache.
8. Implement `middleware/owner-header.ts` — sets `request.owner = req.headers['x-owner'] || 'anonymous'`.
9. Implement `routes/segments.ts`:
   - `GET /api/segments?owner=&type=&q=&sort=`
   - `POST /api/segments` (validates with zod; runs translator if `predicate_tree_json` provided)
   - `GET /api/segments/:id`
   - `PATCH /api/segments/:id`
   - `DELETE /api/segments/:id`
   - `POST /api/segments/:id/append` (de-dupe uid merge)
   - `POST /api/segments/:id/refresh` — stub returns 202 + `status='refreshing'`; cron in P6 picks up the work.
10. Implement `routes/analyses.ts` — CRUD scoped to `:segmentId`.
11. Implement `routes/identity-map.ts` — GET merges saved + auto-suggested; PUT-per-cube persists.
12. Implement `routes/presets.ts` — returns a static list; preset bodies live FE-side in P4.
13. Add owner-header middleware to all routes; reject writes where target row's owner ≠ caller (return 403).
14. Add unit tests:
    - `translator.test.ts` — every operator round-trips; nested AND/OR; unsupported operator throws.
    - `routes.crud.test.ts` — happy path + 404 + 403.
    - `owner-header.test.ts` — fallback to `anonymous`, header passes through.
15. Wire `npm run server:dev` (tsx watch) + `npm run dev:all` (concurrently runs Vite + server).
16. Document endpoints in `server/README.md` + add OpenAPI export script (optional — phase out if heavy).
17. Publish FE types from `src/types/segment-api.ts` — keep in lockstep with server zod schemas.

## Success Criteria

- [x] `npm run server:dev` boots Fastify on :3001 with migrations applied. *(boots in ~20ms; verified locally)*
- [x] `npm run dev:all` runs Vite (:3000) + server (:3001) concurrently. *(concurrently script wired)*
- [x] `POST /api/segments` creates a row; `GET /api/segments/:id` returns it. *(covered by routes-crud.test.ts)*
- [x] PATCH respects owner ownership; mismatched owner returns 403.
- [x] Translator round-trips a 3-level nested AND/OR predicate to Cube filters and back without loss. *(11 translator tests including 3-level nesting)*
- [x] `/api/meta/version` returns a stable hash; changes when Cube schema changes.
- [x] `/api/presets` returns at least `{ id: 'mf_users-hub' }` (preset body is FE-only).
- [x] All unit tests pass (`npm run server:test`). *(23/23 passing)*
- [x] FE type file (`src/types/segment-api.ts`) compiles against server zod schemas.

### Session 2026-05-19 delivery notes
- Built with Node 24 + `better-sqlite3` from source (no prebuild for Node 24). Risk row already documented; pin Node 20 LTS in CI if prebuild required.
- `vitest.config.ts` added under `server/` to isolate from root config.
- Bonus: dev-only `POST /api/__fixtures__/segments` route added (gated by `NODE_ENV !== 'production'`) to support P0 visual regression fixtures.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Translator misses edge cases for `inDateRange` (relative vs absolute) | Test both forms; document supported strings; reject malformed values at the zod boundary. |
| `better-sqlite3` native build fails on CI / Apple Silicon | Pin Node 20 LTS in `engines`; ship build instructions; consider `node-sqlite3` fallback only if blocked. |
| Owner-header pretend-auth gives false sense of access control | Document explicitly in `server/README.md`; mark v1.5 follow-up for real auth. |
| `meta-cache` TTL too long → stale drift detection | Default 60s; expose `?force=1` for cache busting in dev. |
| Endpoint contract drift between FE/server | Export zod schemas; FE imports types from `src/types/segment-api.ts`; CI typecheck catches mismatches. |
