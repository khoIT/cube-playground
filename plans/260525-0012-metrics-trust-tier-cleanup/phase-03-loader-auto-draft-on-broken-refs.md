---
phase: 3
title: "Loader auto-draft on broken refs"
status: completed
priority: P1
effort: "2-3h"
dependencies: [2]
---

# Phase 3: Loader auto-draft on broken refs

## Overview

Don't let `certified` metrics keep advertising green badges when their formula refs no longer exist in Cube. At API-response time, validate each metric's refs against a cached per-game `/meta` snapshot; if any ref is unresolved, override the metric's `trust` to `'draft'` in-memory. The YAML stays untouched (the team's intent is still preserved on disk).

## Requirements

- Functional:
  - New service `server/src/services/metric-trust-resolver.ts`:
    - `resolveTrustForGame(metrics: BusinessMetric[], gameId: string): Promise<BusinessMetric[]>`
    - Fetches the game's `/meta` via existing `getMeta()` from `cube-client.ts`, builds the `MetaSnapshot` set, runs `validateRefs` per metric, returns a new array with `trust` rewritten to `'draft'` when any ref is unresolved.
  - In-memory cache keyed by `(gameId, metaHash)` with TTL = 60s (matches `meta-cache.ts` TTL). Cache stores the resolved trust map: `Record<metricId, 'certified'|'draft'|'deprecated'>` — small, cheap to recompute when hash changes.
  - Server route(s) that return business-metrics call `resolveTrustForGame` before responding. Identify these via `rg -rln "loadAll|getAll" server/src/routes/`.
- Non-functional:
  - `loadAll` stays pure (file → memory). All resolution happens at request time.
  - Per-request overhead: O(metrics × avg-refs-per-metric) set lookups — fast (sub-ms at 57 × ~2 refs).
  - When `/meta` fetch fails (network, auth), log a warning and return metrics with declared trust unchanged (fail-open — better to show a possibly-stale green than to draft-everything when Cube is down).

## Architecture

```
HTTP GET /api/business-metrics?game=ballistar
        │
        ▼
route handler
   ├─ const metrics = loadAll()                       (file registry)
   ├─ const adjusted = await resolveTrustForGame(metrics, 'ballistar')
   └─ res.json(adjusted)

resolveTrustForGame(metrics, gameId):
   ├─ check cache[gameId] vs latest meta hash
   ├─ if stale:
   │    ├─ meta = await getMeta(gameId-token)          // cube-client
   │    ├─ snapshot = snapshotFromMeta(meta)
   │    └─ for each metric:
   │         unresolved = validateRefs(metric, snapshot)
   │         trustMap[metric.id] = unresolved.length > 0 ? 'draft' : metric.trust
   │    cache[gameId] = { hash, trustMap }
   └─ return metrics.map(m => trustMap[m.id] === 'draft' ? { ...m, trust: 'draft' } : m)
```

The resolver NEVER promotes — a `deprecated` metric stays `deprecated` even if its refs resolve. Only `certified → draft` downgrades happen.

## Related Code Files

- Create: `server/src/services/metric-trust-resolver.ts` (≤120 LOC).
- Modify: `server/src/services/business-metrics-loader.ts` — no change (kept pure). Add a comment pointing to the resolver as the canonical "what does the API return" entry point.
- Modify: route handlers that currently call `getAll()` to return metrics — wrap with `resolveTrustForGame`. Identify exact paths via `rg -rln "loadAll|getAll" server/src/routes/`.
- Read for context: `server/src/services/metric-ref-validator.ts` (already exports `validateRefs`, `snapshotFromMeta`).
- Read for context: `server/src/services/meta-cache.ts` (hash-only cache; we use its TTL value but build our own trust-map cache).
- Read for context: `server/src/services/cube-client.ts` for `getMeta(token?)`.

## Implementation Steps

1. Grep route handlers calling business-metrics: `rg -rln "loadAll|getAll" server/src/routes/`. Confirm the list (likely `business-metrics.ts`).
2. Implement `metric-trust-resolver.ts`:
   - Module-level `Map<gameId, { hash: string; trustMap: Record<metricId, Trust>; fetchedAt: number }>`.
   - `resolveTrustForGame(metrics, gameId)` → check cache; rebuild on hash mismatch or TTL expiry.
   - Use `snapshotFromMeta` + `validateRefs` (already exported by `metric-ref-validator.ts`).
   - Fail-open: on `getMeta` error, log via `console.warn`, return metrics unchanged.
3. Inject the call in the route handler(s). Keep it a one-line wrap: `const adjusted = await resolveTrustForGame(metrics, gameId);`.
4. Write unit tests (`server/test/metric-trust-resolver.test.ts`):
   - Given a metric with all refs resolved → declared trust kept.
   - Given a metric with an unresolved ref → trust overridden to `'draft'` regardless of declared value.
   - Given a `deprecated` metric with unresolved refs → stays `'deprecated'` (never promoted, never downgraded from deprecated).
   - Cache hit on second call (no re-validation) when hash unchanged.
   - Cache invalidation on hash change.
   - `getMeta` rejection → fail-open returns metrics unchanged + warning logged.
5. Smoke-test against live ballistar: hit the relevant route, confirm `npm`, `installs`, `wau` come back as `'draft'` and `paying_users` stays `'certified'`.

## Success Criteria

- [x] `metric-trust-resolver.ts` exists, ≤120 LOC, unit tests green.
- [x] At least 3 known-broken IDs return `trust: 'draft'` from the route, 1 known-good keeps its declared trust — verified manually.
- [x] `loadAll` itself is unchanged (still pure file-loader).
- [x] `check-metric-drift.ts` CLI output unchanged.
- [x] No new TypeScript errors.

## Risk Assessment

- Risk: route handlers are called outside the HTTP layer (e.g. cron jobs, anomaly-detector) and would also get auto-drafted. Mitigation: keep `getAll()` / `loadAll()` themselves untouched; only the HTTP handler wraps with the resolver. Cron jobs that need pure registry data keep using the raw loader.
- Risk: a wrong cube token for a game returns `/meta` for the wrong game → all metrics get drafted. Mitigation: token resolution is the existing `resolveCubeTokenForGame` — if it returns null, log + fail-open without making the call.
- Risk: meta-hash collision (extremely unlikely). Mitigation: SHA-256 collisions are not a real risk here.
- Risk: per-game cache holds stale trust map after a model deploy. Mitigation: 60s TTL matches `meta-cache.ts`; team can `POST /api/meta/refresh` (if exists) or wait one minute.

## Security Considerations

- Cube token is already scoped per game via `resolveCubeTokenForGame`; resolver inherits that scoping. No new auth surface.
