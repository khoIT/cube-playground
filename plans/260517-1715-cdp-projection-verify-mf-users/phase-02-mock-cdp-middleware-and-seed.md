---
phase: 2
title: "Mock CDP middleware and seed"
status: complete
priority: P1
effort: "0.5d"
dependencies: [1]
---

# Phase 2: Mock CDP middleware and seed

## Overview

Stand up `/cdp/v1/*` entirely inside the vite dev server. Implements POST create, GET list, GET one, GET total â€” all backed by an in-memory `Map<(game_id, metric_name), Metric>` seeded from a JSON fixture. Responses follow the MM-01 envelope (`{ status, error?, data?, pagination? }`). TDD: handler-level tests with synthetic req/res objects precede middleware code.

## Requirements

### Functional

- Vite plugin exporting a connect-style middleware mounted at `/cdp/v1`.
- Routes:

  | Method | Path | Behavior |
  |---|---|---|
  | `POST` | `/cdp/v1/metrics` | Create metric. 200 on success; 409 `METRIC_EXISTED` if `(game_id, metric_name)` already present; 400 `INVALID_REQUEST` if required field missing. |
  | `GET` | `/cdp/v1/metrics/{game_id}` | List metrics for game. 404 `GAME_NOT_FOUND` if no game seeded. Supports `?page`, `?page_size`, `?metrics=name1,name2`. |
  | `GET` | `/cdp/v1/metrics/{game_id}/{metric_name}` | Get one. 200 / 404 `METRIC_NOT_FOUND` or `GAME_NOT_FOUND`. |
  | `GET` | `/cdp/v1/metrics/{game_id}/total` | Count. 200 / 404. |

- All responses use MM-01 envelope:
  - Success: `{ status: 'SUCCESS', error: null, data?, pagination? }`
  - Error: `{ status: 'ERROR', error: { code, message } }`
- Seed fixture loaded from `vite-plugins/cdp-mock-seed.json` at plugin init. In-memory map regenerated from seed on every dev-server start.
- Seed fixture contains **5+ records covering each Cube agg type** + 1 deliberate mismatch (locked per Validation Session 1):
  - 1Ã— `count` measure â†’ seed matches projection â‡’ verify `Available` (example name: `user_count`)
  - 1Ã— `sum` measure â†’ seed matches projection â‡’ `Available` (example name: any non-mismatch `sum` measure on `mf_users`)
  - 1Ã— `count_distinct` measure â†’ seed matches projection â‡’ `Available`
  - 1Ã— `count_distinct_approx` measure â†’ seed matches projection â‡’ `Available`
  - 1Ã— filtered variant (any agg + `filters:`) â†’ seed matches projection â‡’ `Available` (example name: `paying_user_count`)
  - 1Ã— **deliberate mismatch entry** â€” a separate measure whose seed record has `expression` deliberately wrong vs what `projectMeasure` outputs for it â‡’ verify hits `Mismatch`. Pinned name: `lifetime_recharge_amount_vnd` w/ seed `expression: 'SUM(amount_usd)'` while projection emits `SUM(lifetime_recharge_amount_vnd)`. (Distinct record from the matching `sum` measure above.)
  - Note: exact measure names sourced from live `mf_users` cube at P2 implementation start (see plan Open Q1). If a given agg type isn't present on the cube, scope-down: skip that record. The mismatch entry uses whatever `sum` measure exists on `mf_users`; if `lifetime_recharge_amount_vnd` is absent, substitute another `sum` measure (and the matching `sum` row uses yet another distinct one).
  - Any other `mf_users` measure â†’ not seeded â‡’ `Missing` on verify.
- **No JWT validation. No `Authorization` header check. No 401 path.** Mock ignores auth entirely (locked per Validation Session 1).

### Non-functional

- File length â‰¤ 200 lines; split handlers vs router if needed.
- Zero throws into vite â€” wrap handler logic in try/catch returning 500 `INTERNAL_ERROR`.
- Idempotent seeding: tests can reset state.

## Architecture

```
vite-plugins/
  cdp-mock-middleware.ts      â—„â”€â”€ new (plugin + handlers)
  cdp-mock-seed.json          â—„â”€â”€ new (fixture)
  __tests__/
    cdp-mock-middleware.test.ts â—„â”€â”€ new (FIRST)
vite.config.ts                 â—„â”€â”€ modify (register plugin)
```

### Plugin shape

```ts
// vite-plugins/cdp-mock-middleware.ts
import type { Plugin, Connect } from 'vite';
import seed from './cdp-mock-seed.json';

type StoreKey = `${string}:${string}`; // `${game_id}:${metric_name}`
const store = new Map<StoreKey, MetricRecord>();

export function cdpMockMiddleware(): Plugin {
  return {
    name: 'cdp-mock-middleware',
    configureServer(server) {
      hydrateFromSeed(store);
      server.middlewares.use('/cdp/v1', router(store));
    },
  };
}

// router(store): Connect.NextHandleFunction â€” exported for tests
```

### State + seed

- Store reset on plugin init.
- `MetricRecord` = full MM-01 `Metric` shape including `created_at` / `updated_at` (ISO with +07:00 offset).
- `created_at` / `updated_at` stamped on POST; seed has fixed timestamps for determinism.

## Related Code Files

- **Create:**
  - `vite-plugins/cdp-mock-middleware.ts`
  - `vite-plugins/cdp-mock-seed.json`
  - `vite-plugins/__tests__/cdp-mock-middleware.test.ts`
- **Modify:**
  - `vite.config.ts` â€” register `cdpMockMiddleware()` in `plugins` array
- **Read (context):**
  - `vite-plugins/schema-write-middleware.ts` â€” reference pattern (req body parsing, error envelope)
  - `C:\Users\CPU12830-local\Downloads\MM-01-CRUD.openapi.yaml` â€” envelope + error codes
- **Delete:** none

## Implementation Steps (TDD)

0. **Probe live cube** â€” hit `/cubejs-api/v1/meta?extended=true`, list `mf_users` measures + their agg types. Pick one per agg type for the seed (per Requirements above).
1. **Test first** â€” write `cdp-mock-middleware.test.ts` calling exported `router(store)` directly w/ mocked `req` / `res`:
   - `POST /metrics` w/ valid body â†’ 200 + `SUCCESS` envelope; subsequent GET returns it
   - `POST /metrics` duplicate `(game_id, metric_name)` â†’ 409 + `METRIC_EXISTED`
   - `POST /metrics` missing `metric_name` â†’ 400 + `INVALID_REQUEST`
   - `GET /metrics/bal_vn` â†’ list w/ pagination (5+ entries)
   - `GET /metrics/bal_vn?metrics=user_count,paying_user_count` â†’ filtered list (2 entries)
   - `GET /metrics/unknown` â†’ 404 + `GAME_NOT_FOUND`
   - `GET /metrics/bal_vn/<count_measure>` â†’ 200 + matching seed record
   - `GET /metrics/bal_vn/<sum_measure>` â†’ 200 + matching seed record (one per agg type)
   - `GET /metrics/bal_vn/<count_distinct_measure>` â†’ 200
   - `GET /metrics/bal_vn/<count_distinct_approx_measure>` â†’ 200
   - `GET /metrics/bal_vn/<filtered_variant>` â†’ 200
   - `GET /metrics/bal_vn/<mismatch_measure>` â†’ 200 w/ deliberately different `expression`
   - `GET /metrics/bal_vn/nope` â†’ 404 + `METRIC_NOT_FOUND`
   - `GET /metrics/bal_vn/total` â†’ 200 + count (â‰¥ 5)
   - Internal exception (handler throws) â†’ 500 + `INTERNAL_ERROR`
   - **No** 401 path â€” request without `Authorization` header still succeeds.
2. Run â†’ all red.
3. Write `cdp-mock-seed.json` w/ the 5+ fixtures.
4. Write `cdp-mock-middleware.ts` step-by-step until tests green.
5. Register plugin in `vite.config.ts`.
6. Manual smoke: `npm run dev` â†’ `curl http://localhost:3000/cdp/v1/metrics/bal_vn/total` â†’ returns `{ status: SUCCESS, data: { game_id: bal_vn, total_metrics: <Nâ‰¥5> } }`.

## Success Criteria

- [ ] â‰¥ 14 handler test cases, all green (one per agg type + the standard routes)
- [ ] Seed has â‰¥ 5 records, one per Cube agg type + 1 deliberate mismatch
- [ ] Plugin registered in `vite.config.ts`
- [ ] Curl smoke against running dev server returns expected envelope for each route
- [ ] All response shapes validated against MM-01 `*Response` schemas (snapshot or schema-validator test)
- [ ] No leak of in-memory state across test runs (`router` accepts injected `store` so tests use fresh map)
- [ ] No 401 in middleware code or tests (auth ignored per Validation Session 1)
- [ ] All new files â‰¤ 200 lines
- [ ] `npm run build` succeeds (plugin shape valid for vite)

<!-- Updated: Validation Session 1 â€” seed grew 3 â†’ 5+ records; 401 path dropped -->


## Risk Assessment

| Risk | Mitigation |
|---|---|
| Vite plugin lifecycle differs from `schema-write-middleware` (which is a custom plugin already in repo) | Copy the existing plugin's shape exactly; reuse the `configureServer` hook |
| Seed JSON drift from `projectMeasure` output | Single source of truth: a unit test in P2 round-trips `projectMeasure(mf_users, user_count)` and asserts deep-equal against seed entry |
| `req.body` parsing for POST â€” vite's connect doesn't auto-parse JSON | Use a tiny `readJsonBody(req)` helper; covered by tests |
| Path parsing brittle (regex on URL) | Use `URL` constructor + `pathname.split('/').filter(Boolean)`; tested w/ trailing slash + query string cases |
| Test isolation â€” global `store` leaks | Export `router(store)` factory; tests inject fresh `new Map()` |
| Pagination default mismatch w/ spec (page=1, page_size=50) | Matched to spec; tested explicitly |
