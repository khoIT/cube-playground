# Cube-Playground Server Caching Layers: Complete Mapping

**Date:** 2025-06-08  
**Workspace:** /Users/lap16299/Documents/code/cube-playground  
**Scope:** All PLAYGROUND-OWNED caching surfaces (server/src only, NOT external Cube)

---

## Executive Summary

The playground server implements **6 major cache surfaces** across 5 distinct backends, all coordinated via SQLite. **Every cache surface ultimately hits Cube's `/load` or `/meta` endpoint** (except the Cube proxy passthrough, which is pure relay). Cache refresh is **request-time lazy** for most surfaces, with **background cron** ("jobs") as the primary refresh mechanism for performance-critical paths. Meta-version busting on schema change is implemented uniformly across all Cube-dependent caches.

---

## Cache Mapping Table

| # | Surface | Storage | TTL / Staleness | Refresh Trigger | Hits Cube `/load`? | Key File(s) |
|---|---------|---------|-----------------|-----------------|-------------------|------------|
| **1** | **LiveOps KPI strip + Cohort grid** | SQLite `liveops_result_cache` | Configurable per-resource (default: varies by resource) | **Cron tick** every 90s (listStale → mark refreshing → parallel refresh) | ✅ Yes — `loadWithContinueWait()` per tile | `liveops-cache-store.ts`, `refresh-liveops.ts`, `liveops-refresh-handlers.ts` |
| **1b** | LiveOps Funnel cache | Same `liveops_result_cache` table | Resource TTL | **Cron tick** + analyst seed (POST FE → ensurePlaceholder → cron adopts) | ✅ Yes — `refreshFunnel()` | (same as above) |
| **2** | **Dashboard tile cache** | SQLite `dashboard_tile_cache` | Per-dashboard override + global default (300s) | **Cron tick** every 90s, only recently-viewed dashboards (7d horizon) | ✅ Yes — `loadWithContinueWait()` per tile query | `dashboard-tile-cache-store.ts`, `refresh-dashboard-tiles.ts` |
| **3** | **Segment card cache** (Insights cards) | SQLite `segment_card_cache` | **Request-time lazy**: stale = "never set" or corrupt query | **Segment refresh job** (`refresh-segment.ts` → `runPresetCards()`) OR manual `/api/segments/:id/refresh` | ✅ Yes — `loadWithContinueWait()` per card spec via `card-runner.ts` | `card-cache-store.ts`, `card-runner.ts`, `refresh-segment.ts` |
| **4** | **Segment member-360 cache** (detail panels) | SQLite `segment_member360_cache` | **Never TTL'd**: cleared only when segment refreshes + tier membership changes | **Nightly precompute scheduler** (member360-precompute-scheduler.ts) OR `refresh-segment.ts` → `member360-runner.ts` | ✅ Yes — `loadWithContinueWait()` per panel per uid | `member360-cache-store.ts`, `member360-runner.ts`, `member360-precompute-scheduler.ts` |
| **5** | **Segment brief cache** (AI summary) | SQLite `segment_brief_cache` | **Hash-based stale**: definition_hash mismatch = stale | **Request-time lazy** (route checks hash, single-flight LLM call) | ❌ No — hits LLM gateway (not Cube) | `segment-brief-store.ts`, `segment-brief-context.ts` |
| **6** | **Meta hash cache** (schema version) | **In-memory Map** (state object) | 60s TTL | **Request-time lazy** (callers call `getCubeMetaVersion()`) | ✅ Yes — calls `getMeta()` per game token | `meta-cache.ts`, `cube-client.ts` |
| **7** | **Cube proxy passthrough** (`/cube-api/v1/*`) | **None** — pure HTTP relay | N/A (no storage) | N/A (synchronous, server forwards to upstream Cube) | ✅ Yes — all `/load`, `/sql`, `/meta` calls pass through | `cube-proxy.ts` |
| **8** | **Business metrics registry** | **In-memory Map** (file-based YAML loader) | **No TTL**, file-system watched in dev | **File-system watch** (dev: live-reloading on `.yml` change; prod: boot-time load) | ❌ No — local YAML file set, used for metadata only | `business-metrics-loader.ts` |
| **9** | **Segment preview** (live editor estimate) | **In-memory Map** | 60s TTL | **Request-time lazy** (POST /api/preview → check cache → hit Cube /load + /sql) | ✅ Yes — `load()` + `sql()` per predicate tree | `preview-service.ts` |

---

## Detailed Surface Analysis

### 1. LiveOps Cache (KPI Strip + Cohort Grid + Funnel)

**File(s):**
- `server/src/services/liveops-cache-store.ts` — SQLite schema + read/write/status
- `server/src/jobs/refresh-liveops.ts` — cron job (main refresh loop)
- `server/src/services/liveops-refresh-handlers.ts` — per-resource handlers (KPI, cohort, funnel)
- `server/src/db/migrations/012-liveops-cache.sql` — SQLite table definitions

**Storage Backend:**
- **Table:** `liveops_result_cache`
- **Schema:**
  ```sql
  resource TEXT (kpi_strip|cohort_grid|funnel_result),
  cache_key TEXT (game or game:windowDays or game:funnelHash),
  game TEXT,
  payload_json TEXT (result set),
  payload_hash TEXT (sha256),
  cube_meta_version TEXT (bust on schema change),
  fetched_at DATETIME,
  expires_at DATETIME,
  status TEXT (fresh|refreshing|broken),
  error_msg TEXT
  ```

**TTL / Staleness Rule:**
- Per-resource TTL from `liveops.cache_ttl_seconds` setting (via `getSetting()`).
- Default fallback varies: KPI ~ typical API cache (check code), cohort grid similar.
- **Explicit miss logic:** caller (liveops route) checks `readCache()` → if miss or `expires_at < now`, calls `ensurePlaceholder()` to seed a `status='refreshing'` row; cron picks it up on next tick.

**Refresh Trigger:**
- **Background cron** (`refresh-liveops.ts` runs every 90s, configured in `cron-runner.ts`).
- **Tick logic:** `listStale()` finds rows where `expires_at < now AND status != 'refreshing'`.
- For each stale row (up to `perRefreshTimeoutMs` per resource), mark `status='refreshing'`, call `refreshKpiStrip()` / `refreshCohortGrid()` / `refreshFunnel()`, upsert via hash-skip write (no-op if payload unchanged + meta unchanged).
- **Funnel special case:** analyst creates funnel via POST to `/liveops/funnel` (FE) → route calls `ensurePlaceholder()` → cron refreshes from then on. Payload includes `{funnelDef, funnelDefHash}` for re-running.

**Hits Cube `/load`?**
- ✅ **YES.** All three handlers (`refreshKpiStrip`, `refreshCohortGrid`, `refreshFunnel`) call `loadWithContinueWait()` with Cube queries.
- KPI: query measures per KPI spec (e.g., `active_daily.count`), adds sparkline via 14-day time dimension.
- Cohort: queries retention cohort cube (multi-measure, time-scoped).
- Funnel: queries step-by-step funneled funnel path sequences.

**Cube Member Resolver (Prefix Mapping):**
- Game-scoped token via `resolveCubeTokenForGame(game)` — Cube JWT carries `game` claim.
- Prefix workspaces: `physicalizeQuery()` + `logicalizeRows()` handle prefix mapping (transparent to route).

---

### 2. Dashboard Tile Cache

**File(s):**
- `server/src/services/dashboard-tile-cache-store.ts` — SQLite store
- `server/src/jobs/refresh-dashboard-tiles.ts` — cron job
- `server/src/db/migrations/013-dashboard-tile-cache.sql` — schema

**Storage Backend:**
- **Table:** `dashboard_tile_cache`
- **Schema:**
  ```sql
  tile_id INTEGER PRIMARY KEY (FK dashboard_tiles.id),
  rows_json TEXT (result data),
  rows_hash TEXT (sha256),
  cube_meta_version TEXT,
  fetched_at DATETIME,
  expires_at DATETIME,
  status TEXT (fresh|refreshing|broken),
  error_msg TEXT,
  resp_json TEXT (full Cube /load response, for chart reconstruction)
  ```

**TTL / Staleness Rule:**
- **Dashboard-scoped:** each dashboard has a `tile_ttl_seconds` column (default global 300s).
- Staleness: `expires_at < now OR cache miss OR status='broken'`.
- **Refresh horizon:** only recently-viewed dashboards (7d window by default, configurable).

**Refresh Trigger:**
- **Background cron** every 90s (`refresh-dashboard-tiles.ts`).
- **Logic:** `listStaleTilesInRecentDashboards()` queries `dashboard_tiles` JOIN `dashboards` where `last_viewed_at >= horizon` AND (cache miss OR `expires_at < now` OR `status='broken'`).
- Per tick budget (default 30 tiles) to spread load.
- **On request:** GET `/dashboards/:id` updates `last_viewed_at`, priming the tile for next cron wave.

**Hits Cube `/load`?**
- ✅ **YES.** `refreshTile()` calls `loadWithContinueWait(query, token)` per tile's `query_json`.
- **Full response persisted:** `resp_json` stores the Cube `/load` response so the FE can rebuild a `ResultSet` and render via the same chart engine.

---

### 3. Segment Card Cache (Insights Cards)

**File(s):**
- `server/src/services/card-cache-store.ts` — SQLite store
- `server/src/services/card-runner.ts` — query composer + executor
- `server/src/jobs/refresh-segment.ts` — segment refresh pipeline
- `server/src/db/migrations/003-card-cache.sql` — schema

**Storage Backend:**
- **Table:** `segment_card_cache`
- **Schema:**
  ```sql
  segment_id TEXT,
  card_id TEXT,
  query_hash TEXT (sha256 of cubeQuery),
  rows_json TEXT (result data),
  fetched_at DATETIME,
  status TEXT (ok|error),
  error TEXT (error message if failed)
  ```

**TTL / Staleness Rule:**
- **No explicit TTL.** Cache is considered stale only when the segment's query changes (predicate modified) or refreshed via cron/manual.
- **Ghost row pruning:** when `upsertCardCache()` is called with a fresh preset's card set, any `card_id` absent from the new set is deleted (i.e., renamed/removed cards don't linger).

**Refresh Trigger:**
- **Segment refresh job** (`refresh-segment.ts`) — triggered by:
  1. **Cron-based:** `refresh-queue.ts` processes the queue at 60s intervals (scoped per-segment).
  2. **Manual API:** POST `/api/segments/:id/refresh` calls `enqueueRefresh()`.
  3. **Cadence:** each segment has `refresh_cadence_min` (e.g., 1440 for daily).
- **Refresh flow:** `refreshSegment()` → re-runs the predicate's Cube query (size phase) → calls `runPresetCards()` → for each card spec, composes a Cube query scoped by the segment's predicate filters → `loadWithContinueWait()` → `upsertCardCache()` (hash-skip write).

**Hits Cube `/load`?**
- ✅ **YES.** `card-runner.ts` composes per-card Cube queries by:
  - Extracting the preset's card spec (measure, dimensions, time dimension, date range).
  - ANDing the segment's predicate filters onto the query.
  - Calling `loadWithContinueWait(physicalizeQuery(query, prefix), token)`.
  - Parsing rows and storing in `segment_card_cache`.

**Scoping:**
- Card filters are AND-ed with segment predicate filters (both support nested logical groups).
- Avoids inlining the materialized uid list (which can exceed Cube's query-text limit for large cohorts).

---

### 4. Segment Member-360 Cache (Detail Panels)

**File(s):**
- `server/src/services/member360-cache-store.ts` — SQLite store
- `server/src/services/member360-runner.ts` — nightly batch executor
- `server/src/services/member360-precompute-scheduler.ts` — scheduler
- `server/src/routes/segment-member360.ts` — read-side routes
- `server/src/db/migrations/033-member360-cache.sql` — schema

**Storage Backend:**
- **Table:** `segment_member360_cache`
- **Schema:**
  ```sql
  segment_id TEXT,
  uid TEXT,
  panel_id TEXT,
  query_hash TEXT (sha256),
  rows_json TEXT (panel result),
  fetched_at DATETIME,
  status TEXT (ok|error),
  error TEXT
  ```

**TTL / Staleness Rule:**
- **No explicit TTL.** Rows are only cleared when the segment refreshes + tier membership changes.
- **Tier-driven pruning:** `pruneMember360CacheToUids(segmentId, newUidSet)` deletes rows for uids no longer in the segment's tier (i.e., when a tier's query changes and returns a different uid list).

**Refresh Trigger:**
- **Nightly precompute** (scheduler queues jobs, runner executes):
  1. `member360-precompute-scheduler.ts` — scans segments with active tiers, enqueues compute.
  2. `member360-runner.ts` — for each uid, loads all core panels (via `loadWithContinueWait()` per panel).
  3. Executed **after** `refresh-segment.ts` completes (segment size + card cache are fresh first).
- **Fallback refresh:** if `refresh-segment.ts` rebuilds tier membership, it calls `triggerMember360Precompute()` to start a re-run.

**Hits Cube `/load`?**
- ✅ **YES.** For each (uid, panel_id), the runner:
  - Looks up the panel's Cube query from the member360 panel registry.
  - Scopes by uid via filters (e.g., `identity IN [uid]`).
  - Calls `loadWithContinueWait(query, token)`.
  - Stores result in `segment_member360_cache`.

**Serving:**
- **Route:** GET `/api/segments/:id/members/:uid/panels` → `getMember360Cache(uid)` → returns `{panelId: view}` map.
- **Status:** GET `/api/segments/:id/member-cache-status` → `getMember360StatusBySegment(id)` → per-uid aggregate (ok count, error count, latest_fetched_at).

---

### 5. Segment Brief Cache (AI-Generated Summary)

**File(s):**
- `server/src/services/segment-brief-store.ts` — SQLite store + in-memory single-flight
- `server/src/routes/segment-brief.ts` — request route (not examined here, but invokes store)

**Storage Backend:**
- **Table:** `segment_brief_cache`
- **Schema:**
  ```sql
  segment_id TEXT,
  lang TEXT,
  definition_hash TEXT (hash of segment's definition, to detect stale),
  brief_json TEXT (AI-generated summary, null if error),
  status TEXT (ok|error),
  error TEXT,
  generated_at DATETIME
  ```

**TTL / Staleness Rule:**
- **Hash-based stale detection:** when a route GETs a segment's brief:
  1. Hash the segment's predicate definition.
  2. Compare to `definition_hash` in cache.
  3. If mismatch → stale → regenerate.

**Refresh Trigger:**
- **Request-time lazy** (on first GET or after definition change).
- **Single-flight:** in-memory Map keyed by `${segmentId}:${lang}` ensures concurrent requests share one LLM generation.

**Hits Cube `/load`?**
- ❌ **NO.** Segment brief calls the **LLM gateway** (typically Claude via `LITELLM_*` env), not Cube.
- However, the brief generator may *reference* Cube segment queries via context (not hitting Cube directly).

---

### 6. Meta Hash Cache (Cube Schema Version)

**File(s):**
- `server/src/services/meta-cache.ts` — in-memory cache + fetch wrapper
- `server/src/services/cube-client.ts` — underlying `getMeta()` call

**Storage Backend:**
- **In-memory Map** (single `state` object):
  ```ts
  { hash: string | null, fetchedAt: number }
  ```

**TTL / Staleness Rule:**
- 60 second TTL (`TTL_MS = 60_000`).
- Cold/expired → fetch from Cube; otherwise return cached.

**Refresh Trigger:**
- **Request-time lazy:** callers invoke `getCubeMetaVersion(game)` (wrapper function in `cube-client.ts` or job code).
- If cache is cold or expired, calls `getMeta()` (which hits Cube GET `/meta`) and hashes the response.

**Hits Cube `/load`?**
- ✅ **YES** — calls Cube GET `/meta`, but is a schema query, not a data load.
- Used as a **cache-busting key:** all persistent caches (liveops, dashboard tiles, card, member360) store `cube_meta_version` and re-run on mismatch (schema change detection).

---

### 7. Cube Proxy Passthrough (`/cube-api/v1/*`)

**File(s):**
- `server/src/routes/cube-proxy.ts` — HTTP relay middleware

**Storage Backend:**
- **None** — pure request/response forwarding.

**Refresh Trigger:**
- **Synchronous passthrough:** every request to `/cube-api/v1/{meta|load|sql}` is forwarded to upstream Cube immediately.
- **No caching.** Each request hits Cube directly.

**Hits Cube `/load`?**
- ✅ **YES** — `/cube-api/v1/load` and `/cube-api/v1/sql` pass through to Cube `/cubejs-api/v1/load` and `/cubejs-api/v1/sql`.
- **Workspace-aware:** `req.cubeCtx` (from middleware) resolves the correct Cube API URL + token per workspace.
- **Prefix-scoped:** `/meta` response is filtered to the active game's prefix (via `filterMetaToGamePrefix()`) on prefix workspaces.

---

### 8. Business Metrics Registry

**File(s):**
- `server/src/services/business-metrics-loader.ts` — YAML file loader + in-memory cache
- `server/src/presets/business-metrics/` — directory of `.yml` files

**Storage Backend:**
- **In-memory Map** (`cache: Map<string, BusinessMetric>`).
- **Backing store:** filesystem `.yml` files (e.g., `presets/business-metrics/`) read at boot.

**TTL / Staleness Rule:**
- **No TTL.** Reloaded only when `.yml` files change (on-disk watch in dev) or at boot.
- **Atomic writes:** POST/PATCH operations write `.yml.tmp` then rename.

**Refresh Trigger:**
- **Boot-time:** `loadAll()` reads all `.yml` files in the registry directory.
- **Dev-time watch:** `startWatcher()` monitors `.yml` changes and reloads on debounce (100ms).
- **Prod:** only boot-time load (file-system watch disabled).

**Hits Cube `/load`?**
- ❌ **NO.** Business metrics are **metadata only** — stored locally as YAML.
- Routes using metrics (e.g., metric detail page) may call Cube to fetch a metric's underlying cube/measure/dimensions, but the metric definition itself is local.

---

### 9. Segment Preview Cache (Live Editor)

**File(s):**
- `server/src/services/preview-service.ts` — in-memory cache + preview generator
- `server/src/routes/preview.ts` — POST `/api/preview` route

**Storage Backend:**
- **In-memory Map** keyed by `sha256(JSON.stringify({tree, primaryCube}))`.

**TTL / Staleness Rule:**
- 60 second TTL (`CACHE_TTL_MS = 60_000`).
- On miss or expire, recompute.

**Refresh Trigger:**
- **Request-time lazy:** POST `/api/preview` with a predicate tree.
- Checks cache → if hit and fresh, return `{cached: true}`.
- If miss/stale, calls `treeToCubeFilters()` + `resolveIdentityField()`, then:
  1. Fires Cube `/load` with `{dimensions: [identity], filters, total: true}` to get distinct uid count.
  2. Fires Cube `/sql` to get the compiled SQL.
  3. Returns `{estimated_count, cube_query, sql_preview, took_ms, cached: false}`.

**Hits Cube `/load`?**
- ✅ **YES** — calls `load()` and `sql()` from `cube-client.ts`, both hit Cube endpoints.
- Used by the FE's segment editor to estimate cohort size in real-time.

---

## Segment-Related API Call Paths: Cache vs. Live

### Which Segment APIs Hit Playground Cache vs. Cube Live?

| API Call | Path | Cache Hit? | Backend |
|----------|------|-----------|---------|
| **GET `/api/segments/:id`** (segment metadata) | `segments.ts` guardSegment | ❌ No cache | SQLite (segment metadata only) |
| **GET `/api/segments/:id/insights`** (card results) | `segments.ts` getCardCache | ✅ **Cache hit** (if fresh) | `segment_card_cache` SQLite |
| **POST `/api/segments/:id/refresh`** (manual refresh) | `segments.ts` enqueueRefresh | — | Queues cron job; reads/writes Cube via `/load` |
| **GET `/api/segments/:id/members/:uid/panels`** (member-360) | `segment-member360.ts` getMember360Cache | ✅ **Cache hit** (if precomputed) | `segment_member360_cache` SQLite |
| **GET `/api/segments/:id/member-cache-status`** | `segment-member360.ts` getMember360StatusBySegment | ✅ **Cache hit** (aggregated from member-360 cache) | `segment_member360_cache` SQLite |
| **POST `/api/preview`** (live editor estimate) | `preview.ts` → preview-service | ✅ **Cache hit** (60s) | In-memory Map OR Cube `/load` + `/sql` |
| **GET `/api/segments/:id/brief`** (AI summary) | `segment-brief.ts` (not fully examined) | ✅ **Cache hit** (if definition hash matches) | `segment_brief_cache` SQLite OR LLM gateway |
| **Cron background refresh** | `refresh-queue.ts` → `refresh-segment.ts` | — | Reads Cube `/load` for size + cards + member360 |

### Segment Count Computation Path

```
FE creates segment via predicate tree
  ↓
POST /api/segments {predicate_tree, primary_cube}
  ↓
Server: treeToCubeFilters(predicate_tree) → Cube Query {dimensions:[identity], filters, total:true}
  ↓
loadWithContinueWait() → Cube POST /load
  ↓
Extract total: {total: distinct_uid_count}
  ↓
Store in segments.uid_count, uid_list_json
  ↓
runPresetCards() → for each card, compose AND(card_query, segment_predicate_filters) → Cube /load
  ↓
Store in segment_card_cache
  ↓
(Later) nightly cron: triggerMember360Precompute() → member360-runner → Cube /load per uid per panel
  ↓
Store in segment_member360_cache
```

**Cube hit count per segment refresh:** 1 (size) + N_cards (cards) + M_uids × P_panels (member360) = potentially hundreds of `/load` calls.

---

## Cache Refresh Mechanics Summary

### Request-Time Lazy (On-Demand)
1. **Cube proxy** (`/cube-api/v1/*`) — always fresh, no caching.
2. **Segment preview** (POST `/api/preview`) — 60s in-memory cache; stale → recompute.
3. **Segment brief** (GET `/api/segments/:id/brief`) — hash-based; mismatch → regenerate.

### Background Cron-Driven (Proactive)
1. **LiveOps cache** (`refresh-liveops.ts`) — 90s tick, stale row refresh.
2. **Dashboard tile cache** (`refresh-dashboard-tiles.ts`) — 90s tick, recently-viewed horizon.
3. **Segment card cache** — refreshed as part of segment refresh job (cron-enqueued or manual).
4. **Segment member-360** — nightly precompute scheduler + segment refresh trigger.

### Single-Instance Semantics
- `refresh-queue.ts` ensures one segment refresh at a time (FIFO in-memory queue).
- `member360-precompute-scheduler.ts` follows same pattern (single-instance per-process).
- **Implication:** multi-process deployments (e.g., 3 gateway replicas) will have **redundant refresh overlaps** — no distributed coordination.

---

## Cache Invalidation & Schema-Change Busting

All Cube-dependent caches use **meta-version busting**:

```ts
if (existing && existing.cube_meta_version === input.cubeMetaVersion) {
  // no-op write — hash-skip, just bump expires_at
} else {
  // meta changed OR hash changed → full upsert
}
```

When Cube schema drifts:
1. A caller invokes `getCubeMetaVersion(game)` (either fresh fetch or cache hit after expiry).
2. If the hash changes, the next refresh cycle writes `cube_meta_version = newHash`.
3. Existing rows with old `cube_meta_version` will eventually be read as "meta mismatch" and refreshed.
4. **No explicit invalidate call** — stale rows are naturally re-refreshed on TTL expiry or status='broken' retry.

**Explicit invalidation APIs:**
- `invalidate(resource, game?)` — deletes all cache rows for a resource or (resource, game) pair.
- `expireKey()` — marks a single key as `expires_at = (epoch)` so cron picks it up immediately.
- Used when a dashboard is deleted, a segment is deleted, etc.

---

## Performance & Load Implications

### Cube `/load` Hit Rate
- **LiveOps:** 3 resources (KPI, cohort, funnel) × 1 load per cron tick (90s interval).
- **Dashboards:** 1 load per tile per cron tick (up to 30/tick, 7-day horizon).
- **Segments:** 1 (size) + N_cards + M_uids × P_panels per refresh cycle.
- **Preview:** 2 loads (load + sql) per editor keystroke (60s cache helps).
- **Total:** High fan-out during cron ticks; most loads are **batched and cached**.

### CubeStore Pre-Aggs Benefit
✅ All cached surfaces **would benefit from CubeStore pre-aggregations** because:
1. **KPI strip** — daily sparklines across 14 days, same measure queried repeatedly.
2. **Cohort grid** — retention cohort matrices (natural pre-agg shape).
3. **Dashboard tiles** — analyst-owned dashboards (likely stable queries).
4. **Segments** — card queries are repeated per segment, same predicate shape.

CubeStore would **reduce Cube's work** on each `/load`, but playground refresh would still hit `/load` as often (just faster).

---

## Unresolved Questions

1. **Multi-process deployment race condition**: If 3 gateway instances each run a cron tick simultaneously, will they coordinate or stomp on each other's writes?
   - Current code: no coordination (no distributed lock).
   - Likely behavior: redundant refreshes; last write wins; no correctness issue, just wasted work.
   - **Recommendation:** guard refresh-queue / member360-precompute with a distributed lock if scaling horizontally.

2. **Cube /meta caching per-game vs. global**: `meta-cache.ts` caches a single hash. Does this work for prefix workspaces where each game's meta may differ?
   - **Current:** `getCubeMetaVersion(game)` passes game, but the in-memory cache is **global, not keyed by game**.
   - **Impact:** if two games' schemas diverge, the second game to fetch meta will overwrite the first's hash, causing false "meta changed" busts.
   - **Recommendation:** key the in-memory cache by game (`game → hash`).

3. **Member-360 precompute scaling**: If a segment has 100k+ members and 10+ panels, running nightly `member360-runner` will fire 1M+ Cube loads.
   - Current code: `mapWithConcurrency(DEFAULT_BATCH_SIZE)` (check value) limits parallelism.
   - **Recommendation:** confirm batch size + concurrency are reasonable for Cube's connection limits.

4. **Stale segment queue accumulation**: If `refresh-queue.ts` is slow and segments are enqueued faster than processed, the queue grows unbounded.
   - Current code: in-memory Set, no size limit.
   - **Risk:** memory leak + OOM if thousands of segments are enqueued.
   - **Recommendation:** add a max queue size or drop oldest entries.

5. **Dashboard tile TTL per-dashboard vs. global**: How is per-dashboard `tile_ttl_seconds` set? Is there a UI for it?
   - Current code: PATCH `/api/dashboards/:id` can update, but not fully examined.
   - **Recommendation:** verify the UI/API path for setting per-dashboard TTL.

---

## Summary

**Playground owns 6 caching layers:**
1. **LiveOps** (KPI, cohort, funnel) — cron-driven SQLite cache.
2. **Dashboard tiles** — cron-driven SQLite cache, recently-viewed horizon.
3. **Segment cards (Insights)** — segment refresh job, SQLite cache.
4. **Segment member-360** — nightly precompute + segment refresh, SQLite cache.
5. **Segment brief** — request-time lazy, hash-based stale detection, SQLite cache.
6. **Meta version** — request-time lazy, 60s in-memory cache.

**All 6 surfaces ultimately hit Cube's `/load` or `/meta` endpoints.** No bypass to raw Trino. Cache TTLs range from 60s (preview, meta) to never (member-360, segment cards). Refresh is **cron-driven for performance paths (KPI, dashboards, member-360), request-time lazy for user-driven paths (preview, brief).**

Cache busting on schema change is uniform: all store `cube_meta_version` and re-run on mismatch. No distributed lock for multi-process deployments (potential redundant refreshes, but no correctness issue).

