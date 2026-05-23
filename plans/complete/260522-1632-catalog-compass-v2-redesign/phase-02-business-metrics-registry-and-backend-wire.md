---
phase: 2
title: "Business metrics registry and backend wire"
status: done
priority: P1
effort: "2-3d"
dependencies: [1]
---

# Phase 2: Business metrics registry and backend wire

## Overview

Add `business-metrics/*.yml` registry to **cube-playground's existing Fastify sidecar server** (`server/src/`). Expose `GET /api/business-metrics` (list) + `POST /api/business-metrics` (write, used by P6 composition wizard). Seed ~20 GDS-1.8 metrics. Frontend hook `useBusinessMetrics()` mirrors the existing `useCatalogMeta` mutex pattern.

**Architecture revision 2026-05-22 18:52:** registry lives in cube-playground, not cube-dev. cube-dev stays as the sealed `cubejs/cube:latest` docker container. We own the YAML + endpoints inside our own server — no cross-repo coordination required (R1 resolved).

## Requirements

**Functional:**
- New directory `server/src/presets/business-metrics/` with one YAML per metric
- Loader service `business-metrics-loader.ts` reads + Zod-validates + caches all YAMLs at startup; re-loads on file change (dev mode via `tsx watch`)
- Route `GET /api/business-metrics` returns JSON array
- Route `POST /api/business-metrics` accepts body matching Zod schema → writes `<id>.yml` atomically → reloads cache → returns 201
- Frontend hook `useBusinessMetrics()` consumes endpoint with mutex caching
- ~20 seed YAMLs from `_GDS__-_1_8_Metrics_Definition.md` committed alongside

**Non-functional:**
- Endpoint latency < 100ms for full registry (in-memory cache hit)
- Malformed YAML logged with file path; rest of registry still loads
- POST is atomic (write to temp + rename); no partial files on disk
- File-watch reload triggers within 500ms in dev mode

## Architecture

**Registry location:** `server/src/presets/business-metrics/`

**YAML schema** (per file, filename = `<id>.yml`, id matches `^[a-z][a-z0-9_]*$`):

```yaml
id: arpdau
label: ARPDAU
description: Average revenue per daily active user.
synonyms: [arpu_daily, avg_rev_per_dau]
tier: 1                              # 1-6
domain: revenue                      # 7-value enum
owner: data-platform@vng
trust: certified                     # 5-value enum
formula:
  type: ratio
  numerator: user_recharge_daily.revenue_vnd   # cube names are STABLE across games (repositoryFactory swaps per JWT)
  denominator: active_daily.dau
game_compatibility:                  # NEW 2026-05-22 19:11 — which games have the required upstreams
  required_cubes: [user_recharge_daily, active_daily]
  # → frontend computes per-game availability from active /meta: if all required cubes
  #   present, metric is enabled; else disabled with "Not available for <game>" tooltip.
parameter:                           # optional
  name: cohort_window
  options: [d1, d7, d30]
related_concepts:                    # optional
  - users.country
  - users.platform
```

**`game_compatibility` semantics:** The loader does NOT filter by game (it doesn't know the active game). The list/POST endpoints return ALL metrics. The **frontend** intersects `metric.game_compatibility.required_cubes` against the cube names in the active-game `/meta` payload (already JWT-scoped) and renders incompatible metrics as disabled. This keeps backend stateless and lets the picker show "20 metrics: 14 available for cfm · 6 disabled".

**Server layout (new files):**

```
server/src/
├── presets/
│   └── business-metrics/                  # NEW dir
│       ├── arpdau.yml                     # ~20 seeds total
│       ├── dau.yml
│       ├── paying_users.yml
│       └── ...
├── services/
│   └── business-metrics-loader.ts         # NEW — Zod-validated load + watch + cache
├── routes/
│   └── business-metrics.ts                # NEW — GET + POST handlers
└── types/
    └── business-metric.ts                 # NEW — Zod schema + inferred TS type
```

**Loader pattern:**

```ts
// services/business-metrics-loader.ts
const cache: Map<string, BusinessMetric> = new Map();

export async function loadAll(): Promise<void> {
  for (const file of await readdir(REGISTRY_DIR)) {
    if (!file.endsWith('.yml')) continue;
    try {
      const parsed = BusinessMetricSchema.parse(yaml.load(await readFile(...)));
      cache.set(parsed.id, parsed);
    } catch (e) {
      logger.warn(`Skipping ${file}:`, e.message);
    }
  }
}

export function getAll(): BusinessMetric[] { return [...cache.values()]; }
export function writeMetric(metric: BusinessMetric): Promise<void> { /* atomic */ }
```

**Frontend layout:**

```
src/pages/Catalog/metrics-tab/
├── use-business-metrics.ts                # NEW — mutex hook
├── business-metric-types.ts               # NEW — re-export TS type from server contract
└── __tests__/use-business-metrics.test.ts
```

**Shared types contract:** server defines the Zod schema; both sides import the inferred TS type to keep contract in sync.

## Related Code Files

**Create (server):**
- `server/src/types/business-metric.ts` — Zod schema
- `server/src/services/business-metrics-loader.ts` — loader + cache + watch
- `server/src/routes/business-metrics.ts` — GET + POST routes
- `server/src/presets/business-metrics/<id>.yml` × ~20

**Create (frontend):**
- `src/pages/Catalog/metrics-tab/use-business-metrics.ts`
- `src/pages/Catalog/metrics-tab/business-metric-types.ts`
- `src/pages/Catalog/metrics-tab/__tests__/use-business-metrics.test.ts`

**Modify:**
- `server/src/index.ts` — register new routes; call loader on startup
- `server/package.json` — add `js-yaml` + `@types/js-yaml` if not present

## Implementation Steps

1. **Add `js-yaml` dep** to `server/package.json`. Run `npm install` in `server/`.
2. **Define Zod schema** in `server/src/types/business-metric.ts`:
   - `tier`: `z.number().int().min(1).max(6)`
   - `domain`: `z.enum(['revenue', 'engagement', 'acquisition', 'retention', 'payments', 'concurrency', 'marketing'])`
   - `trust`: `z.enum(['certified', 'beta', 'draft', 'deprecated', 'orphaned'])`
   - `formula`: discriminated union on `type`
   - `game_compatibility`: `z.object({ required_cubes: z.array(z.string()) }).optional()` — optional for metrics that work on every game
   - Export both the schema (`BusinessMetricSchema`) and the inferred TS type
3. **Build loader service:** `loadAll()` at startup, `getAll()` for routes, `writeMetric(m)` for POST, `chokidar` watcher (or fs.watch) for dev reload. Already have similar patterns in `server/src/services/` to mirror.
4. **Build routes** in `server/src/routes/business-metrics.ts`:
   - `GET /api/business-metrics` → `reply.send(getAll())`
   - `POST /api/business-metrics` → validate body with schema → `writeMetric` → 201 + body
   - Register via `app.register(businessMetricsRoutes)` in `server/src/index.ts`
5. **Author seed YAMLs.** Read `plans/reports/_GDS__-_1_8_Metrics_Definition.md` (canonical metric definitions) AND `cube-dev/plans/reports/introspection-260522-1747-game-integration-schema-diff.md` (current per-game schema coverage). For each metric:
   - `<id>.yml` with `trust: certified`
   - Formula refs use cube names that exist in `cube-dev/cube/model/cubes/ballistar/` (canonical) — they auto-translate to other games via `repositoryFactory`
   - Set `game_compatibility.required_cubes` based on which tables the formula needs. Examples:
     - DAU / ARPDAU / retention metrics → `required_cubes: [active_daily, user_recharge_daily, mf_users]` (NOT available for PTG/MUAW)
     - Pure recharge counts/totals → `required_cubes: [recharge]` (available for ALL 6 games)
   - Missing refs → placeholder in `description` like `"[TODO: refund column not yet in cube model]"`
6. **Build frontend hook** `useBusinessMetrics()` mirroring `useCatalogMeta` mutex pattern. Endpoint = same origin (Fastify served behind vite proxy).
7. **Wire vite dev proxy** if not already — `vite.config.ts` should forward `/api/business-metrics` to `http://localhost:3001` (or whatever server port). Existing routes (segments, CDP) likely already proxied.
8. **Test loader** with fixture YAMLs in `server/test/`: success, malformed YAML skipped + logged, atomic write doesn't leave partial files on simulated crash.
9. **Test hook** with mocked fetch: success, dedupe via mutex, error path.
10. **Smoke test:** start server (`cd server && npm run dev`) + frontend (`npm run dev`), hit endpoint via curl, confirm hook returns seed data.

## Success Criteria

- [ ] `server/src/presets/business-metrics/` contains ~20 seed YAMLs
- [ ] `server/src/services/business-metrics-loader.ts` loads all without error
- [ ] Malformed YAML logged with file path; rest of registry still loads
- [ ] `GET /api/business-metrics` returns valid JSON array via curl
- [ ] `POST /api/business-metrics` writes a new YAML, returns 201, file visible on disk
- [ ] Adding a new YAML file in dev mode triggers reload within 500ms
- [ ] Atomic write: kill process mid-write; no partial `.yml` file left
- [ ] `useBusinessMetrics()` returns seed data in frontend dev mode
- [ ] Second call deduped via mutex (existing `useCatalogMeta` pattern)
- [ ] All server tests pass; bundle size delta < 2% frontend, server unchanged

## Risk Assessment

- **~~R1: backend wire across repos~~** — RESOLVED by hosting registry in cube-playground server. No more cube-dev coordination.
- **Missing formula refs:** seed YAMLs may reference building blocks not yet in cube-dev model. **Mitigation:** allow placeholder; P3 detail page handles "ref not found" gracefully.
- **YAML schema drift:** v1 schema may need extension. **Mitigation:** Zod schema in one place; both sides re-import.
- **Trust seeding noise** (R5). **Mitigation:** seed = `certified`; POST default = `beta` (wizard sets explicitly).
- **File-watch reliability** in dev mode (especially across Docker volumes if dev'd in container). **Mitigation:** add `npm run reload` script as manual fallback if chokidar misses events.
- **vite proxy config** may need touching if not already pointing at server port. **Mitigation:** verify existing routes (segments, CDP) use same pattern; copy.
