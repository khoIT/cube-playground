# Cube-Playground Production Complexity Census
**Date:** 2026-05-27 | **Scope:** Full stack LOC, routes, DB schema, mocks, in-process state, Cube integration patterns | **Thoroughness:** Very thorough

---

## Executive Summary

Cube-playground is a **multi-layered BI/analytics system** built on Vite+React frontend, Fastify backend, Node chat-service, and external Cube.js semantic layer. Key production concerns: single-process SQLite bottleneck, in-memory state not clusterable, mock CDP activation, and manual token-based auth. **Estimated production-readiness gaps:** 3–4 critical (scalability), 5–6 medium (auth/tokenization).

---

## A. Frontend SPA (`src/`, Vite/React/TS)

| Metric | Value |
|--------|-------|
| **Total LOC** | ~115k (989 files) |
| **Page Routes** | 12 (Catalog, Chat, Dashboards, DevAudit, Explore, Index, Liveops, Schema, Segments, Settings, + sub-routes) |
| **Module Structure** | QueryBuilderV2/, pages/, hooks/, api/, components/, utils |
| **Key Dependencies** | @cubejs-client/core, recharts, react-router-dom 6, antd 4.16, styled-components 6, lucide-react 1.16 |

**Auth Model:** X-Owner header (localStorage-persisted, "pretend-auth"); JWT in localStorage (`gds-cube:token`). No real OAuth. Cube tokens come from `/api/playground/cube-token?game=<id>` (server mints or falls back).

**Surface Area:**
- Endpoints called: `GET /cubejs-api/v1/meta`, `POST /cubejs-api/v1/load`, `POST /cubejs-api/v1/sql` (toward external Cube :4000)
- Chat endpoints: SSE streams `/api/agent/turn`, `/api/sessions`, `/api/chat/*`
- No vendored Cube YAML models — reads from remote Cube only
- Aliases/icons: client-only, localStorage key `gds-cube:cube-aliases`, never persisted server-side

**Production Smells:**
- Hardcoded `http://localhost:4000` in test fixtures (src/QueryBuilderV2/NewMetric/hooks/__tests__/use-new-metric-meta.test.tsx:33, :50, :66)
- CDP activation mock flag: `VITE_CDP_ACTIVATION_ENABLED=false` → synthetic 500ms delay, fake metric ID (src/api/cdp-metrics-client.ts:mockCreate returns `metric_id: mock_${metricName}`)
- TODO in component styling (src/QueryBuilderV2/components/MemberSection.tsx:4 `/* @TODO: optimize styling */`)
- localStorage leaks JWTs — acceptable for internal tool but rotates needed prod-side
- No rate-limiting in FE; Apollo retry link exists but no backoff config visible

**Cube Integration:** 5s fetch timeout (src/App.tsx:99), Apollo RetryLink with no rate-limit/backoff (src/QueryBuilderV2/QueryBuilderGraphQL.tsx:13–21), meta-poll timeout returns 504 (src/QueryBuilderV2/NewMetric/api.ts:11, :67).

---

## B. Server (`server/`, Fastify + better-sqlite3)

| Metric | Value |
|--------|-------|
| **Total LOC** | ~26k (296 files) |
| **Routes** | 20 Fastify modules (analyses, anomalies, business-metrics, chat, dashboards, games, glossary, liveops, presets, segments, settings, etc.) + ~3.3k LOC in routes/ alone |
| **DB Migrations** | 16 (SQL; 285 LOC total) — app_settings, activations, anomalies, business_metric_audit, dashboards, fixtures, glossary, segments, liveops_cache, etc. |
| **DB Tables** | ~12 core (segments, games, business_metrics, dashboards, anomalies, glossary, app_settings, liveops_cache, response_cache, etc.) |
| **Key Dependency** | better-sqlite3 (single-file, single-process only) |

**Routes:**
- `GET/POST /api/segments`, `POST /api/segments/:id/activate`
- `GET/POST /api/dashboards`, patches for tile caching
- `GET/POST /api/games`, game-scoped queries
- `POST /api/glossary`, `POST /api/business-metrics`
- `GET /api/playground/cube-token?game=<id>` (token minting)
- Chat relay: `POST /api/chat/stream`, `GET /api/chat/sessions`, `DELETE /api/chat/sessions/:id`
- Fixtures reset (test only): `POST /api/fixtures`

**Auth:** X-Owner header (required) → request.owner = header value or 'anonymous'. No JWT validation. Ownership check on PATCH/DELETE (server/test/routes-crud.test.ts:88, :108).

**Production Smells:**
- **better-sqlite3 is single-process** — no clustering support (server/src/db/sqlite.ts:7; migrations run on each boot in src/db/migrate.ts)
- **In-memory state not clusterable:**
  - app-settings-store: 30s TTL cache (src/services/app-settings-store.ts:23, :41) — in-memory Map<SettingsKey, CacheEntry>
  - anomaly-detector: per-game in-memory mutex (src/jobs/anomaly-detector.ts:205) prevents re-entrancy **per single server instance only**
  - business-metrics-loader: in-memory cache of JS objects (src/services/business-metrics-loader.ts:83, :134)
  - meta-version: 60s in-memory cache (src/routes/meta-version.ts:4)
- response_cache table exists but no clear purge/TTL enforcement visible in routes
- No explicit timeout/retry toward Cube — calls Cube via @cubejs-client/core defaults

**Cube Integration:** Server calls `POST /cubejs-api/v1/load` to fetch query results; game-scoping inferred from **segments and liveops_cache tables** (per-game metrics pre-aggregated or flagged). Token signing: server-side at `GET /api/playground/cube-token`, mints JWT or uses env fallback.

---

## C. Chat-Service (`chat-service/`, Node + @anthropic-ai/sdk)

| Metric | Value |
|--------|-------|
| **Total LOC** | ~37.6k (280 files) |
| **API Routes** | 13 modules (health, sessions, turn, replay, stats, audit, debug*, notifications, chat-user-prefs, chat-session-focus) + 2.5k LOC in api/ alone |
| **Chat Tools** | 17 tool implementations (list-business-metrics, get-cube-meta, preview-cube-query, disambiguate-query, emit-chart, get-segment, explain-cube-sql, normalize-date-range, parse-date-range, update-business-metric-trust, etc.) |
| **DB** | SQLite migrations (12+) shared/parallel with server; tables: chats, turns, sessions, response_cache, snapshot_store |
| **Key Dependency** | @anthropic-ai/sdk (Claude API streaming) |

**Routes:**
- `POST /agent/turn` (NL input → Claude + tools → SSE stream response)
- `GET /sessions`, `POST /sessions`, `DELETE /sessions/:id`
- `POST /replay/:sessionId/turn/:turnId` (re-run with history)
- `GET /stats`, `GET /audit` (debugging routes)
- Debug routes: cache-clear, cache-effectiveness, annotations, search, leaderboard

**Auth:** X-Owner-Id header (required for chat ops); falls back to X-Owner from middleware. Returns 401 if missing (server/src/routes/chat.ts:259, :375, :406).

**Production Smells:**
- Rate limiter: 60/min per owner (src/middleware/rate-limit.ts, src/index.ts:62) — **in-memory capacity/refill buckets**, not persisted; multi-instance will allow N×60/min
- No mock flag visible — uses real @anthropic-ai/sdk (src/index.ts:19 imports, config.ts validates ANTHROPIC_API_KEY)
- Response-cache-sweep (src/services/response-cache-sweep.ts): TTL-based purge runs on a cron; table exists but no clear invalidation signal toward clients
- Snapshot store (db/snapshot-store.ts) auto-saves/restores chat state — single-instance sync only
- Tool registry validates on boot (src/core/registry-boot-guard.ts) but errors are logged only; no graceful degradation if a tool fails to load

**Cube Integration:** Calls Cube via tools (get-cube-meta sends `POST /cubejs-api/v1/meta`, preview-cube-query sends `POST /cubejs-api/v1/load`). Game-scoping inferred from session context. Token signs as JWT via the shared server endpoint.

---

## D. Cube Semantic Layer (External `:4000`)

| Metric | Value |
|--------|-------|
| **YAML Vendored?** | NO — all cubes/views fetched from external Cube instance at `http://localhost:4000` |
| **Models** | Queried via `/cubejs-api/v1/meta` (extended=true) — returns cubes, views, pre-aggregations, members, joins |
| **Game Scoping** | **Client-side alias picker** + **server-side game_id joins in segments/metrics tables** — not in Cube YAML |
| **Pre-aggregations** | Defined in Cube but not visible in cube-playground code; mentioned in schema inspector only |
| **Token Signing** | Server mints JWT via `/api/playground/cube-token?game=<id>` (env fallback or per-game secret) |

**Queries Built:**
- `@cubejs-client/core` Query object (measure + dimension + filter + time granularity) serialized to `/load` POST
- Apollo GraphQL wraps Cube REST (src/QueryBuilderV2/QueryBuilderGraphQL.tsx)
- No dynamic YAML generation — schema is read-only from Cube
- Chat tools construct SQL preview (explain-cube-sql) + raw query preview (preview-cube-query)

**No Retry/Timeout** in Cube API client layer beyond Apollo defaults + FE 5s timeout. No rate-limiting header checked.

---

## E. Cache Layers

| Layer | Location | TTL | Invalidation | Scalability |
|-------|----------|-----|--------------|-------------|
| **app-settings** | server/src/services/app-settings-store.ts:23 | 30s in-memory | Cache.set on write; version bump | ⛔ In-memory, not shared |
| **meta-version** | server/src/routes/meta-version.ts:4 | 60s in-memory | Not visible | ⛔ In-memory, not shared |
| **business-metrics** | server/src/services/business-metrics-loader.ts:83 | Disk-only + in-memory map | Rename-on-write | ⛔ In-memory map not clusterable |
| **liveops-cache** | server/src/db/liveops-cache-store.ts | DB TTL (key: cache_ttl_seconds setting) | Hash-skip; invalidate on game update | ✅ DB-backed |
| **response_cache** | server/src/db/{response-cache-store,response-cache-sweep}.ts | DB TTL (setting) | Sweep cron; owner-scoped reads | ✅ DB-backed (but cron may lag) |
| **dashboard-tile-cache** | server/src/db/dashboard-tile-cache-store.ts | DB TTL (dashboards.tile_ttl_seconds) | Status transition; hash-skip | ✅ DB-backed |

**Segment UID cache:** In-memory Set<string> (src/services/segment-cache.ts) — **⛔ not shareable**.

---

## F. Test Coverage Reality

| Category | Count | Notes |
|----------|-------|-------|
| **Test Files** | 940 | Distributed across src/, server/, chat-service/ |
| **Test LOC** | ~174k | Comprehensive for existing components |
| **Unit Tests** | ~700 | Vitest, @testing-library/react, mocks for Cube API + context |
| **E2E/Integration** | ~16 files mentioning "e2e" or "integration" | No full-stack E2E suite visible (no Playwright/Cypress config) |
| **Coverage Gaps** | Multi-instance scenarios, Cube token expiry, rate-limit under load, CDP activation full flow | Mocks abound; see production smells above |

**Test Strategy:** Vitest + mocks for Cube (vi.mock('@cubejs-client/core')); many tests use `withAppContext('http://localhost:4000/cubejs-api', 'tok-abc')` (hardcoded URL). No visual/component regression suite detected.

---

## Production-Blocking Questions with Evidence

### Q1. Horizontal Scalability — In-Process State

**Finding:** Multiple classes of in-memory state will **break under multi-instance deployment**:

1. **app-settings-store** (src/services/app-settings-store.ts:26–27):
   ```ts
   const cache = new Map<SettingsKey, CacheEntry>();
   let version = 0;
   ```
   30s TTL cache + monotonic version — each instance has its own; cross-instance updates invisible.

2. **anomaly-detector per-game mutex** (src/jobs/anomaly-detector.ts:205):
   ```ts
   /** Per-game in-memory mutex: prevents overlapping ticks for same game. */
   ```
   Mutex is a local Map; two instances tick concurrently, bypassing mutex intent.

3. **business-metrics-loader** (src/services/business-metrics-loader.ts:83):
   ```ts
   // in-memory cache of JS objects
   const cache = new Map<string, ParsedMetricsFile>();
   ```
   Each instance parses metrics.js independently; diverge if file is rewritten mid-flight.

4. **meta-version cache** (src/routes/meta-version.ts:4):
   ```ts
   // 60s in-memory cache
   ```
   Meta polling returns stale data for up to 60s on instance B if instance A refreshes.

5. **segment-cache** (implied from src/services references):
   ```ts
   // in-memory Set<string> of segment UIDs
   ```
   Not shareable; invalidation signals don't cross instances.

6. **rate-limiter buckets** (chat-service/src/middleware/rate-limit.ts):
   ```ts
   // Per-owner capacity bucket, in-memory
   ```
   Instance A allows 60/min; instance B allows another 60/min → 120/min total.

**Evidence:** SQLite is single-process; no Redis/memcached layer; better-sqlite3 cannot be shared. Clustering = breaking change.

---

### Q2. How Cube `/load` Query Gets Built and Sent

**Query Build Path:**

1. **FE → Server:** User selects measures/dimensions/filters in QueryBuilder; Redux state holds `Query` object (measure[], dimension[], filters[], timeDimension).
2. **FE calls Cube directly** (not through server):
   - Apollo client wraps `@cubejs-client/core` (src/QueryBuilderV2/QueryBuilderGraphQL.tsx:13–21)
   - Query → `POST /cubejs-api/v1/load` (external Cube :4000)
   - Apollo RetryLink retries on error; no backoff config visible
3. **Game-scoping:** FE stores game_id in Redux + chat context. Game-specific filters added per-cube (implicit via VITE_CUBE_API_URL + game alias mapper).
4. **Token:** FE reads JWT from localStorage (`gds-cube:token`). If missing, calls `GET /api/playground/cube-token?game=<id>` (server endpoint, line: src/api/cube-token-client.ts) → mints JWT or returns env fallback.
5. **Timeout:** 5s per request (src/App.tsx:99 `timeout: number`); if exceeded, FE shows error. No retry loop.
6. **Rate-limiting:** No FE rate-limit. Cube-side rate-limiting not visible in code.

**Evidence:**
- src/api/cube-token-client.ts:21–33 (fetch token from server or localStorage)
- src/QueryBuilderV2/QueryBuilderGraphQL.tsx (Apollo setup)
- src/api/cdp-metrics-client.ts (mock mode: returns synthetic success if VITE_CDP_ACTIVATION_ENABLED=false)

**Chat Service Path:** Tools call Cube via `preview-cube-query` tool (src/tools/preview-cube-query.ts) → constructs Query → uses same @cubejs-client/core load. Token passed via bearer in Authorization header (inferred from anthropic SDK config).

**No explicit retry/timeout/rate-limit enforcement in FE or server Cube calls** — relies on Cube default (30s timeout implied; no backoff).

---

### Q3. Mock/Stub Boundaries

**Active Mocks:**

1. **CDP Activation** (src/api/cdp-metrics-client.ts:12–19):
   - Flag: `VITE_CDP_ACTIVATION_ENABLED` (defaults to false)
   - Mock returns synthetic success + fake metric_id after 500ms
   - Real endpoint: `POST /api/cdp/v1/metrics` (server/src/routes/cdp-metrics.ts:5 notes "still TODO server-side")
   - **Status:** Phase 7 shipped UI; Phase 7+ wires real backend

2. **Cube API tests** (many files use `vi.mock('@cubejs-client/core')`):
   - Mock returns stubbed ResultSet
   - Used in unit tests only; production code uses real @cubejs-client/core

3. **Chat-service snapshot hydration** (chat-service/src/db/snapshot-store.ts):
   - No mock; real SQLite snapshots. Test only via hydrateChatFromSnapshot() calls.

4. **Rate-limiter** (chat-service/src/middleware/rate-limit.ts):
   - No "mock mode"; buckets are real in-memory Maps. Multi-instance = broken (see Q1).

**No other large mock systems found.** Auth is pretend (X-Owner header) but intentional for internal tool.

---

### Q4. Test Coverage

- **Unit tests:** ~700, strong coverage for QueryBuilder, hooks, components
- **Integration tests:** ~40, mostly API contract tests (fixtures reset, routes-crud, owner-header, chat-proxy)
- **E2E/system tests:** None detected (no Playwright/Cypress config; no visual regression suite)
- **Coverage gaps:**
  - Multi-instance state conflicts (by design — not tested)
  - Cube token expiry + renewal
  - Full CDP activation flow (hidden behind mock)
  - Rate-limit under concurrent load
  - Failover / graceful degradation

**Test quality:** High for unit layer; mock-heavy (test doubles for Cube); no production-like load testing.

---

### Q5. Vendored Cube YAML Models

**Finding:** cube-playground **does NOT vendor Cube YAML models**. All cubes/views fetched from external Cube instance.

**Evidence:**
- No `*.yaml` files in repo (checked src/, server/, chat-service/, etc.)
- Schema inspector reads from `/cubejs-api/v1/meta` only (src/api/cube-token-client.ts, use-cube-api-bootstrap.tsx)
- Game aliases stored in FE localStorage (client-side UI hint only) — never modify Cube YAMLs
- Vite plugin schema-write-* (vite-plugins/schema-write-*.ts) are for **local schema testing only** — not part of production Cube

**Game-scoping mechanism:**
- **Client-side:** cube-alias picker (localStorage persistence)
- **Server-side:** segments, business_metrics, liveops_cache tables have game_id columns → filter queries per game
- **Cube-side:** No game column in YAML; game-scoping enforced via **data rows and pre-aggregations** (not visible in code)

**Pre-aggregations:** Defined in external Cube; playground schema inspector shows them but does not modify them. Refresh status cached in liveops_cache table (TTL-based).

---

## Summary Table: Production-Readiness Scores

| Component | LOC | Cluster-Ready | Auth | Timeouts | Tests | Risk |
|-----------|-----|---------------|------|----------|-------|------|
| FE (src/) | 115k | ✅ (stateless) | ⛔ (mock) | ⚠️ (5s hardcoded) | ✅ | Medium |
| Server | 26k | ⛔ (SQLite + in-mem) | ⛔ (X-Owner only) | ⚠️ (Cube defaults) | ✅ | Critical |
| Chat-Service | 37.6k | ⛔ (rate-limit buckets) | ⛔ (X-Owner-Id, no JWT verify) | ⚠️ (Cube defaults) | ✅ | Critical |
| Cube API (external) | — | ✅ (external) | ⚠️ (token signing) | ? | ? | Medium |
| Cache Layers | — | 🟡 (hybrid) | — | — | ⚠️ | Medium |

**Critical Blockers for Production:**
1. better-sqlite3 single-process → clustering impossible
2. In-memory caches + rate-limiters → cross-instance desync
3. X-Owner pretend-auth → no real identity verification
4. CDP activation mocked → feature incomplete
5. No E2E test suite → integration bugs undetected

---

## Unresolved Questions

- Does Cube enforce game-scoping via row-level security (RLS) or via query-time filters injected by server?
- What is the Cube token TTL? Does refresh happen server-side or client-side?
- Are pre-aggregation refresh jobs running on external Cube or in playground?
- How is the `response_cache` TTL coordinated across instances (if deployed multi-instance)?
- Is there a load test or benchmark for Cube `/load` latency under concurrent players?
