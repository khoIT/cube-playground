# Query Paths & Service Topology

How a request travels from the browser to data, and back. This doc answers the
recurring confusion: **why are there two Cube ports (`:4000` and `:3004`), both
sitting behind the same Vite dev proxy on `:3000`, and which one is "real"?** It
then maps every path by which cube-playground reaches **game_integration on
Trino** — the slow, cold data source behind everything.

Companion docs:
- [`system-architecture.md`](./system-architecture.md) — runtime tiers + feature subsystems.
- [`service-api-surface-map.md`](./service-api-surface-map.md) — full HTTP endpoint catalog (per route: method, auth, headers, response, data source).
- [`codebase-summary.md`](./codebase-summary.md) — file-by-file code layout.

---

## 1. The processes and their ports

There are **four** long-running processes in dev. Each owns one port. Nothing
"routes to itself" — the confusion comes from one of them (Vite) being a
*reverse proxy* that forwards to the other three.

| Port | Process | What it is | Role |
|---|---|---|---|
| `:3000` | **Vite dev server** (`vite.config.ts`) | The React SPA + a dev-only reverse proxy. | Serves the UI bundle **and** forwards `/api`, `/cube-api`, `/cubejs-api`, `/playground` to the right backend. **The browser only ever talks to `:3000`.** |
| `:3004` | **Fastify gateway** (`server/src/index.ts`) | The app server: SQLite system-of-record, auth/RBAC, Cube **proxy**, chat **proxy**, token minting, telemetry. | Owns `/api/*`, `/cube-api/*`, `/internal/*`. The only tier that writes the DB and mints Cube tokens. |
| `:3005` | **chat-service** (`chat-service/src/index.ts`) | NL→Cube-query engine + chat session store. | **Never reachable from the browser** — only via the gateway's `/api/chat/*` proxy. |
| `:4000` | **Cube** (sibling `cube-dev` repo) | The semantic layer itself. Compiles YAML models → SQL, runs `/meta` `/load` `/sql`, owns CubeStore (pre-aggregations). | The actual query engine. Talks to Trino. In prod this is mirrored at `:16000`. |

> Key mental model: **`:4000` is Cube. `:3004` is *our* server that sits in
> front of Cube.** They are not two Cubes — `:3004` forwards to `:4000`.

---

## 2. The Vite proxy — why `:4000` AND `:3004` both appear behind `:3000`

In dev, the browser loads everything from `http://localhost:3000`. It never
hardcodes a backend host — every client uses a **relative** path. The Vite proxy
(`vite.config.ts`, `server.proxy`) decides where each path prefix goes:

```
                          Browser (SPA)
                  every fetch is RELATIVE → :3000
                                │
                  ┌─────────────┴──────────────────────────────┐
                  │            Vite proxy  :3000                │
                  │  (vite.config.ts → server.proxy)            │
                  ├─────────────────────────────────────────────┤
                  │  /api          → :3004   (Fastify gateway)  │
                  │  /cube-api      → :3004   (Fastify gateway)  │  ← workspace-aware Cube proxy
                  │  /cubejs-api    → :4000   (Cube direct)      │  ← legacy direct-to-Cube
                  │  /playground/*  → :4000   (Cube direct)      │  ← Cube's own Playground UI assets
                  └───────┬───────────────────────────┬─────────┘
                          │                            │
                          ▼                            ▼
                  ┌────────────────┐           ┌────────────────┐
                  │ Fastify :3004  │           │   Cube :4000   │
                  │  cube-proxy.ts │──forwards─▶│  /cubejs-api/  │
                  │  + auth + DB   │  to Cube's │   v1/meta,     │
                  │  + telemetry   │  native ep │   load, sql    │
                  └────────────────┘           └───────┬────────┘
                                                       │ pre-agg miss
                                                       ▼
                                                   T R I N O
                                               (game_integration)
```

So the same browser origin (`:3000`) fans out to **two** different Cube-facing
backends depending on the URL prefix:

- **`/cube-api/*` → `:3004` (Fastify)** — the path the real app uses. Workspace-aware, authenticated server-side, audited.
- **`/cubejs-api/*` → `:4000` (Cube)** — Cube's *native* REST endpoint, hit directly, bypassing the gateway. Legacy / escape-hatch only.

### Why the duplication exists (and why `/cube-api` won)

`/cubejs-api/v1/*` is **Cube's own API namespace** — it is not deprecated by
Cube; it's the endpoint Cube serves on. The playground originally pointed the
browser's Cube SDK straight at it (the textbook single-backend Cube setup). That
direct path short-circuited three things the app now depends on:

1. **Per-workspace backend switching.** The direct path hardcodes local `:4000`. It never inspects the `x-cube-workspace` header, so switching to **prod cube-dev** (for catalog / data-model / playground surfaces) was impossible. The Fastify proxy reads the workspace and routes to the correct Cube backend + token (`cube-proxy.ts`).
2. **Server-authoritative auth.** The proxy **drops any client `Authorization` header** and mints the per-game Cube JWT server-side (`req.cubeCtx`). The browser can't be trusted to hold the right token per workspace/game.
3. **Telemetry.** The activity spine records `query_run` shapes (member names only, never filter values/UIDs) — only possible if queries flow through our server.

So the move was: **insert a routing/auth proxy (`/cube-api` on `:3004`) in front
of Cube, and retire the browser's direct `/cubejs-api → :4000` shortcut.** The
proxy then *forwards* to Cube's native `/cubejs-api/v1/*`:

```ts
// cube-proxy.ts  — the /cube-api proxy's upstream is still Cube's native path
const url = `${target.cubeApiUrl}/cubejs-api/v1${upstreamPath}${qs}`;
```

`src/App.tsx` hard-forces the SPA onto the proxy: `context.basePath = '/cube-api'`
(App.tsx:132), overriding the SDK default of `/cubejs-api` in
`src/hooks/use-cube-api-bootstrap.ts`.

### What still uses `/cubejs-api → :4000`

- **Cube's bundled Playground UI** (`/playground/*` assets + its own data calls) — a dev-only debugging surface served by Cube itself.
- Any non-workspace-aware caller kept as an escape hatch. The **app proper does not use it.**

### This mirrors prod (it is not a divergence)

cube-prod fronts its Cube the same way — a stateless reverse-proxy "Cube Gateway"
on `:16000` with `?cube_id=<product>` query-param tenant routing; callers never
hit Cube's raw port there either. The playground's `/cube-api` Fastify proxy is
the **local analog of prod's gateway**. Differences are deliberate and reflect
the threat model:

| | cube-prod gateway (`:16000`) | playground `/cube-api` (Fastify `:3004`) |
|---|---|---|
| Tenant routing | `?cube_id=<product>` query param | `x-cube-workspace` + `x-cube-game` headers |
| Auth | **None** — relies on network isolation, self-asserted `cube_id` | **Server-authoritative** — drops client token, mints per-game JWT |
| Audit | None | Activity spine (`query_run` telemetry) |
| Multi-backend | Single prod Cube | Switches local ↔ prod cube-dev per workspace |

prod can skip auth because it is firewalled internal infra; the playground is a
multi-user app, so its proxy adds the auth + audit the prod gateway omits.

---

## 3. The three core request flows

### 3a. Interactive Cube query (QueryBuilder, dashboard tiles, KPI cards, member-360)

```
QueryBuilderV2 builds {measures, dimensions, filters, timeDimensions}
  → cube-api-factory  HttpTransport(apiUrl='/cube-api/v1', Bearer app-JWT)
  → Vite proxy  /cube-api → :3004
  → cube-proxy.ts forward(): resolve x-cube-workspace, DROP client auth,
                             attach server-minted per-game JWT
  → Cube :4000  /cubejs-api/v1/load
        checkAuth(JWT.game) → contextToAppId = cube_<game>
        driverFactory: catalog=game_integration, schema=GAME_SCHEMA[game]
        ├─ CubeStore pre-agg exists?  ── yes ─► rows from CubeStore   (NO Trino)
        └─ no / not built            ─────────► Trino game_integration.<schema> scan
  ← rows ← Cube ← cube-proxy ← Vite ← QueryBuilder renders
```

CubeStore is the fast layer; **Trino is only touched on a pre-agg miss or a live
(non-rollup) query.** A QueryBuilder query over a dimension/measure with no
matching rollup → cold `game_integration` scan, identical to the cold segment
cards.

### 3b. Chat turn (SSE)

```
SPA  POST /api/chat/sessions/:id/turn   (raw fetch, X-Owner-Id, x-cube-workspace, x-cube-game)
  → Vite /api → :3004
  → gateway chat.ts: inject Cube creds + server-authoritative X-Owner-Id,
                     gated by CHAT_FEATURE_ENABLED
  → chat-service :3005  /agent/turn
       resolves slots (disambiguation memory) → builds Cube query →
       may call back into Cube (via the gateway cube callbacks) to execute →
       streams SSE back THROUGH the gateway to chat-stream-store.ts
```

chat-service is never browser-reachable; the per-turn ring buffer in
`stream-registry.ts` lets a refreshed client reattach mid-turn.

### 3c. Persistence + onboarding (SQLite + YAML writes)

```
SPA → /api/* → :3004 gateway → better-sqlite3  (segments, analyses, dashboards,
                                                glossary, presets, drafts)
Onboarding additionally writes Cube YAML into the cube-dev repo atomically
(cube-model-writer.ts) and polls Cube /meta to validate.
```

---

## 4. Where cube-playground hits game_integration (Trino)

There are **four distinct paths** to Trino. Only one is "interactive"; the
others are background jobs, pre-agg builds, and direct (non-Cube) Trino calls.

```
                       cube-playground → game_integration (Trino)

 ENTRY POINTS
 ┌────────────────┬─────────────────┬───────────────┬──────────────────────┬─────────────────────┐
 │ FE QueryBuilder│ FE cards /       │ chat-service  │ server background    │ server services →   │
 │ cube-api-factory│ dashboards /    │ /agent/turn   │ jobs & routes        │ DIRECT Trino        │
 │ apiUrl=/cube-api│ member360 / size│               │ card-runner, refresh,│ trino-profiler,     │
 │       │         │ useCubejsApi    │     │         │ member360, anomaly,  │ lakehouse writer,   │
 │       │ (browser)│ apiUrl=/cube-api│     │ fetch   │ care/*, biz-metrics, │ connector-provision,│
 │       ▼         │       ▼         │     ▼         │ drift, preview       │ care-vip-profile    │
 │  ┌──────────────────────────┐    │ ┌──────────┐  │  cube-client.ts        │       │             │
 │  │ Vite proxy :3000         │    │ │          │  │  load/sql/meta         │       │             │
 │  │ /cube-api  → :3004       │    │ │          │  │  (BASE_URL → :4000)    │       │ trino-rest-  │
 │  │ /cubejs-api→ :4000(legacy)│   │ │          │  │   ◄ per-call budget    │       │ client.ts    │
 │  └───────────┬──────────────┘    │ │          │  │     (was a 15s cap)    │       │ straight to  │
 │              ▼                   ▼ ▼          ▼  ▼                        ▼       ▼ Trino        │
 │  ┌─────────────────────────────────────────────────────────────┐                 │             │
 │  │ server :3004 · cube-proxy.ts forward()                        │                │             │
 │  │ resolve workspace + mint per-game JWT (x-cube-workspace)      │                │             │
 │  │ → cubeApiUrl /cubejs-api/v1/<path>                            │                │             │
 │  └───────────────────────────┬──────────────────────────────────┘                │             │
 │                              ▼                                                     │             │
 │  ┌──────────────────────────────────────────────────────────────┐                │             │
 │  │ Cube :4000                                                     │                │             │
 │  │ checkAuth(JWT game) → contextToAppId = cube_<game>             │                │             │
 │  │ driverFactory: catalog=game_integration, schema=GAME_SCHEMA[game]              │             │
 │  │  /load,/sql ─► 1) CubeStore pre-agg ─hit─► fast, NO Trino                       │             │
 │  │               2) miss / not built  ─────► Trino scan ─┐                         │             │
 │  └──────────────────────────────────────────────────────┼──────┘                 │             │
 │  ┌──────────────────────────────────┐                    │                        │             │
 │  │ cube-refresh-worker (-dev)        │ scheduledRefresh   │                        │             │
 │  │ BUILDS pre-aggs on a schedule:    │ Contexts() per game│                        │             │
 │  │ query Trino → write partitions    │────────────────────┤                        │             │
 │  │ into CubeStore                    │ (Cube's own timeout)│                       │             │
 │  └──────────────────────────────────┘                    ▼                        ▼             ▼
 └────────────────────────────────────────────╔═══════════════════════════════════════════════════════╗
                                               ║  TRINO · catalog = game_integration                     ║
                                               ║  schema = GAME_SCHEMA[game] (cfm→cfm_vn, jus→jus_vn, …) ║
                                               ║  tables: mf_users, recharge, etl_*, std_*, cons_* …     ║
                                               ╚═══════════════════════════════════════════════════════╝
```

### The four paths, compared

| Path | Through Cube? | Hits Trino when | Bounded by |
|---|---|---|---|
| **A. Interactive serve** (FE QB, cards, dashboards, member360, chat) | Yes — `cube-proxy.ts` `:3004` → Cube `:4000` | CubeStore pre-agg miss | Cube `continueWaitTimeout` (25s); cube-proxy's own fetch cap |
| **B. Server precompute/jobs** (card-runner, refresh-segment, anomaly, care, business-metrics) | Yes — `cube-client.ts` → Cube `:4000` | pre-agg miss / live query | per-call budget (was a hard 15s cap — see §6) |
| **C. Pre-agg BUILD** (cube-refresh-worker) | Inside Cube — `driverFactory` | every scheduled build | Cube/CubeStore build timeouts (unaffected by app caps) |
| **D. Direct Trino** (trino-profiler, lakehouse writer, connector-provision, care-vip-profile) | **No** — `trino-rest-client.ts` straight to Trino | every call | `PROFILER_CAPS.statementTimeoutMs` |

### Per-game schema routing

Cube is multi-tenant. `cube-dev/cube/cube.js`:
- `checkAuth` reads the `game` claim from the JWT.
- `contextToAppId = cube_<game>` → a per-game compiled model.
- `driverFactory` pins `catalog = game_integration` and `schema = GAME_SCHEMA[game]` for that request.
- `repositoryFactory` loads only `model/cubes/<game>/` + `model/views/<game>/`.

`GAME_SCHEMA`: `ballistar→ballistar_vn`, `cfm→cfm_vn`, `jus→jus_vn`, `ptg→ptg`,
`muaw→muaw`, `pubg→pubgm`.

---

## 5. CubeStore vs Trino — the fast layer vs the cold layer

- **CubeStore** holds pre-aggregations (rollups): materialized, columnar, fast. A query that matches a built rollup is answered entirely from CubeStore — **Trino is never touched**.
- **Trino (`game_integration`)** is the cold source: raw fact/dimension tables. A query hits Trino when (a) no rollup matches the requested members/time-grain, or (b) the matching rollup's partitions **have not been built yet**.

Two failure modes you will see in practice:

1. **`Cube request timed out` / cold scan latency** — a heavy breakdown over a large cohort with no rollup → full `game_integration` scan (cold Trino: ~3.5–15s+).
2. **`No pre-aggregation partitions were built yet` (HTTP 400)** — the rollup is *defined* but its partitions are not built (worker hasn't run, or build failed). The fix is path **C** (build the rollup), not a timeout bump.

> The durable lever for interactive speed is path **C**: build the right
> pre-aggregations so CubeStore answers instead of Trino. Bumping timeouts only
> helps path **B** complete a cold query — it does not make the query fast.

---

## 6. Timeout caps at each layer

Latency budgets are enforced at several layers; mismatches between them cause
"works eventually but the client already gave up" bugs.

| Layer | Constant / setting | Default | Notes |
|---|---|---|---|
| `cube-client.ts` `cubeFetch` | `CUBE_FETCH_TIMEOUT_MS` | 15s (default) | AbortController on every server→Cube fetch. Now **overridable per call** — batch callers pass a larger budget. Interactive callers keep 15s. |
| `load-with-continue-wait.ts` | computed `remaining = deadline - now` | per-call | Gives each fetch the *remaining* budget, not a fixed 15s, so a heavy precompute query reaches the wire instead of being aborted before Cube's 25s continue-wait window. |
| `cube-proxy.ts` | its own `CUBE_FETCH_TIMEOUT_MS` | 15s | Separate from `cube-client.ts`; bounds the interactive proxy path (A). |
| Cube | `orchestratorOptions.continueWaitTimeout` | 25s | Cube returns HTTP 200 `{error:"Continue wait"}` while a pre-agg warms; callers poll until resolved or their deadline. |
| card-runner | `PER_CARD_TIMEOUT_MS` / `CARD_CONCURRENCY` / `CARD_PHASE_BUDGET_MS` | 30s / 4 / 90s | Per-card budget, parallelism, and total phase budget for the segment-card precompute. |
| Direct Trino | `PROFILER_CAPS.statementTimeoutMs` | — | Bounds path D (non-Cube). |

The historical bug: `cube-client.ts`'s **fixed** 15s cap aborted every
server→Cube fetch *below* Cube's 25s continue-wait, so card-runner's 30s budget
never reached the wire — heavy precompute queries were guaranteed to time out
and never cache. Fixed by threading a per-call budget through
`load() → cubePost() → cubeFetch()` and computing the remaining deadline in
`loadWithContinueWait()`.

---

## 7. Segment card precompute → SQLite card_cache (path B in detail)

The segment dashboard renders **instantly** because card values are precomputed
and stored in SQLite, not queried live on page load.

```
cron-runner.ts (60s tick)
  → enqueues predicate segments past refresh_cadence_min
  → refresh-segment.ts recomputes cohort
       → card-runner.ts loops `for (const tab of preset.tabs)` running EVERY card
            → loadWithContinueWait() → Cube (path B) → rows
            → upsertCardCache() → SQLite segment_card_cache
FE hydrates synchronously from segment.card_cache (GET /api/segments/:id).
  FRESH_FOR_MS = 15min; stale → live useSegmentCubeQuery (falls back to path A).
```

**Last-good preservation** (`card-cache-store.ts`): a failed refresh
(`status='error'`, empty rows) must NOT wipe a value computed successfully
earlier. When an incoming error would overwrite a prior `ok` entry, the store
keeps the prior rows + `fetched_at`, holds `status='ok'` so the card still
renders its last-good value, and records only the latest failure into `error`
for diagnostics. A fresh success fully replaces it. Without this, a transient
Cube timeout or an unbuilt rollup would destroy the cohort's last-good cards and
force the UI into a doomed live query.

**Monitoring this cron** (`/admin/segment-refreshes`, sibling to `/admin/preagg-runs`):
the **Segment Refreshes** tab in the sys-admin hub derives per-segment health
from `segments` + `segment_card_cache` (no new persistence) and surfaces two
signals nothing else shows — `wedged` (a row stuck in `refreshing`; the queue is
in-memory so any refreshing row at rest is an orphan) and `degraded` (cohort
refreshed fine but K-of-N KPI cards are erroring on cold queries / unbuilt
rollups, kept invisible by last-good preservation above). A **wedge watchdog**
runs each cron tick (`SEGMENT_REFRESH_WATCHDOG_ENABLED`, default on) and resets
any row stuck past `max(cadence, 10min)` to `stale` so the next tick re-runs it —
self-healing the deadlock between restarts that the boot-time reconcile can't
reach on a long-lived gateway. The tab is **per-instance** (reads the gateway's
own SQLite); the `:3000` host process and the `:11000` docker process each have
their own DB + cron, so they report different segment sets — see §1 and §8.

---

## 8. Local vs prod port/host summary

| Concern | Local (dev) | Prod (`playground.gds.vng.vn`, VPN) |
|---|---|---|
| Browser origin | `:3000` (Vite) | same-origin behind deployed Fastify gateway |
| `/api`, `/cube-api` | Vite → `:3004` | resolve to deployed gateway, no rewrite |
| `/cubejs-api`, `/playground` | Vite → `:4000` (Cube direct) | n/a for app (escape hatch only) |
| Cube backend | `cube-dev` `:4000`, per-workspace | prod cube-dev, **open** (`authMode='none'`, token `null`) + prod Cube Gateway `:16000` |
| Workspace shape | typically `game_id` workspace | **prefix** workspace (one Cube, per-game name prefixes) |
| Auth | often `AUTH_DISABLED=true` (synthetic dev/admin) | real Keycloak/JWT + `enforce-write-roles` |

Deploy: pushing to the `second` remote (`gitlab.gds.vng.vn/kraken/khoitn`)
**auto-deploys to prod**; `origin` (GitHub) does not. Prod has **no server-log
access** — debug by issuing the same request local vs prod and diffing
(see the probes section of [`service-api-surface-map.md`](./service-api-surface-map.md)).

---

## 9. Quick answers to the common confusions

- **"Why `:4000` and `:3004`?"** `:4000` *is* Cube. `:3004` is our Fastify gateway that proxies to Cube. They aren't two Cubes — `:3004` forwards to `:4000`.
- **"Both are behind `:3000`?"** `:3000` is the Vite dev proxy. It forwards `/cube-api → :3004` and `/cubejs-api → :4000` by URL prefix. The browser only ever talks to `:3000`.
- **"Is `/cubejs-api` legacy/dead?"** The *protocol* (`/cubejs-api/v1`) is Cube's native API — alive and forwarded to by our proxy. The *direct browser shortcut* (`/cubejs-api → :4000`) is retired for the app; kept only as Cube's Playground escape hatch.
- **"Why did we add `/cube-api`?"** Per-workspace backend switching + server-authoritative auth + telemetry. Mirrors prod's Cube Gateway topology.
- **"Why is a card slow / timing out?"** Either a cold Trino scan (no matching rollup) or an unbuilt rollup (400). The durable fix is building pre-aggregations (path C), not raising timeouts.

---

## Maintenance

Update this doc when: the Vite proxy mapping changes (`vite.config.ts`), a new
Cube-facing path is added, the timeout constants in `cube-client.ts` /
`cube-proxy.ts` / `load-with-continue-wait.ts` change, or the set of Trino access
paths (A/B/C/D) changes. Keep the port table in §1 consistent with the tiers
table in [`system-architecture.md`](./system-architecture.md).
