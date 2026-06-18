# GDS Cube

A data-modeling and analytics workspace on top of a **Cube semantic layer**. The product is four runtime tiers: a React SPA, a Fastify **gateway server** (persistence + auth + proxying), a separate **chat-service** (natural-language → Cube query), and the **Cube** backend itself. See [`docs/system-architecture.md` → System Overview](./docs/system-architecture.md#system-overview) for the topology and request flows.

Surfaces:

- **Chat** — NL assistant that resolves an English/Vietnamese question into a Cube query, streams results over SSE, and remembers disambiguation choices across sessions.
- **Playground** — meta-driven query builder, results table, recharts bar/line, compiled-SQL preview, JSON preview, deep-linkable query state. Alias + icon picker for cubes/views (client-side, localStorage-persisted).
- **Data Model & Catalog** — browse cubes/views/concepts, register business metrics, monitor metric↔cube coverage.
- **Data (onboarding)** — connect a warehouse, introspect raw schemas, and stage draft Cube models (bootstrap → reconcile → repair lifecycle).
- **Segments** — build and persist audience segments; identity-map management. Sub-daily/daily snapshots of per-user canonical state + KPI time-series; movement analytics (kpi-trend, state-distribution, entry/exit series) via tokenless read API.
- **Dashboards & LiveOps** — saved dashboards, KPI hero strip, cohort retention grid, anomaly inbox.
- **Drift Center** — triage schema/member drift against the live model.
- **Settings** — Cube workspace, token status, remembered chat defaults.

## Architecture

| Tier | Process | Port (dev) | Role |
|---|---|---|---|
| SPA | Vite / React / TS | `:3000` | UI. Talks to the gateway (`/api`, `/cube-api`); dev-only direct Cube (`/cubejs-api`). |
| Gateway server | Fastify + better-sqlite3 | `:3004` | API gateway + system of record. Persists segments/dashboards/presets/onboarding drafts; proxies Cube (workspace-aware) and chat-service (creds-injecting); mints Cube tokens; RBAC. `server/`. |
| chat-service | Fastify + SQLite | `:3005` | NL→query, disambiguation memory, sessions, per-turn stream registry. Reached only via the gateway proxy. `chat-service/`. |
| Cube (cube-dev) | external semantic layer | `:4000` local / `:16000` prod-mirror | Compiles YAML models → SQL; serves `/meta` `/load` `/sql`. Sibling `cube-dev` repo, selected per workspace (`workspaces.config.json`). |

The SPA never reaches chat-service or Cube URLs directly — the gateway proxies both and injects credentials. Full diagrams and the chat/query/onboarding request flows live in [`docs/system-architecture.md`](./docs/system-architecture.md).

## Stack

- Vite 5, React 18, TypeScript strict.
- `@cubejs-client/core`, recharts ^2.12, zustand (chat streaming store).
- react-router-dom 6 (browser history).
- antd 4.16.13 + design-token overrides (see `src/theme/`).
- styled-components 6 (peer of `@cube-dev/ui-kit`).
- lucide-react 1.16.0 (icon picker for cube aliases).
- Backend: Fastify + better-sqlite3 (gateway) and Fastify + SQLite (chat-service); LiteLLM for chat NL inference; Keycloak for RBAC.

## Quick start

```bash
cp .env.example .env.local
# edit .env.local — at minimum VITE_CUBE_API_URL (+ VITE_CUBE_TOKEN for local Cube).
# For chat: CHAT_FEATURE_ENABLED=true, CHAT_SERVICE_URL, LITELLM_* .
# For onboarding: TRINO_PROFILER_*, CONNECTOR_SECRET_KEY.
npm install --legacy-peer-deps

npm run dev:all      # vite + gateway + chat-service + Cube watchdog (concurrently)
# or run tiers individually:
npm run dev          # SPA only — http://localhost:3000, proxies /api,/cube-api → :3004
npm run server:dev   # gateway server — :3004
npm run chat:dev     # chat-service — :3005

npm run build        # tsc + vite build (SPA); server:build / chat:build for the backends
npm run test         # vitest (SPA); server:test / chat:test for the backends
npm run typecheck    # tsc --noEmit
```

`npm run dev:all` (`scripts/dev-all.mjs`) also boots a Cube watchdog (`scripts/ensure-cube-api.mjs`) that brings up **this stack's** in-stack `cube_api`+`cubestore` on `:4000` — in a standalone dev posture (file-based auth, no in-stack server needed) — and keeps it alive. No separate `cube-dev` checkout is required; the same Cube backs both the dev loop and `npm run stack`. The SPA dev server self-times-out gracefully if Cube isn't up.

### Run the full prod-mirror stack locally (Docker)

`npm run dev:all` is the fast inner loop (Vite HMR, external Cube). To verify a change against the **exact** production composition before pushing — same images, same nginx origin, same in-stack Cube — run the whole stack in Docker:

```bash
cp .env.docker.local.example .env.docker.local   # fill in Trino + ANTHROPIC creds (optional for /meta + browsing)
npm run stack            # build all images + start detached → http://localhost:11000
npm run stack:logs       # follow combined logs
npm run stack:down       # stop (append -- -v to also drop volumes)
```

`npm run stack` (`scripts/stack-local.mjs`) layers `docker-compose.local.yml` (host-only deltas) on `docker-compose.prod.yml` (the single source of prod topology) — what runs locally **is** the prod stack, so it can't drift. It auto-selects the arm64 `cubestore` image on Apple Silicon and feeds `.env.docker.local`. Any compose subcommand passes through: `npm run stack -- ps`, `npm run stack -- up -d server`. See [`docs/deployment-guide.md` → Local prod-mirror](./docs/deployment-guide.md#local-prod-mirror-run-the-prod-stack-on-a-laptop).

## Auth & Personalization

- **Cube workspace** selects which Cube backend the gateway proxies to (`workspaces.config.json`); the client only ever sees workspace ids, never Cube URLs.
- **Cube tokens** are minted server-side per game via `GET /api/playground/cube-token` (env override → HS256 mint with `CUBEJS_API_SECRET` → fallback). A pasted JWT via **API Settings** is still supported and validated before use.
- **Identity / RBAC**: pretend-auth `X-Owner` header in dev (`AUTH_DISABLED`); Keycloak realm (`keycloak/realm-export.json`) backs `editor`/`admin` roles for write-gating. Connector secrets are sealed at rest (AES-256-GCM via `CONNECTOR_SECRET_KEY`) and never returned to the browser.
- Cube/View aliases and icons (localStorage key `gds-cube:cube-aliases`) are per-browser, client-only; YAML model files are never modified by aliasing.

## Routes

| Route | Area |
|---|---|
| `/chat/:id?` | Chat assistant |
| `/build` | Playground (query builder); `/` redirects here |
| `/catalog`, `/catalog/models`, `/catalog/metric/:id` | Data Model & Metrics Catalog |
| `/data` | Connect sources & model onboarding |
| `/segments`, `/segments/:id`, `/segments/identity-map` | Segments |
| `/dashboards`, `/dashboards/:slug` | Saved dashboards |
| `/liveops`, `/liveops/cohort`, `/liveops/anomalies` | LiveOps console |
| `/drift-center` | Metric drift triage |
| `/data-model/new` | Data-model wizard (`/metrics/new` redirects here) |
| `/settings` | Cube workspace, token status, chat defaults |
| `/dev/chat-audit/*` | Dev tooling (chat audit, cache, search) |

`/build` accepts a URL-encoded `query` param holding the Cube `Query` JSON; the "Open in Playground" button on a cube detail uses this to pre-seed a measure.

## Endpoints

- **SPA → gateway** (`:3004`): `/api/*` (segments, dashboards, presets, onboarding, business-metrics, chat proxy …) and `/cube-api/*` (workspace-aware Cube proxy).
- **Gateway → Cube**: `GET /cubejs-api/v1/meta`, `POST /cubejs-api/v1/load`, `POST /cubejs-api/v1/sql`.
- **Gateway → chat-service**: `/api/chat/*` forwards to `CHAT_SERVICE_URL` (default `:3005`), injecting Cube creds + `X-Owner-Id`. Gated by `CHAT_FEATURE_ENABLED`.

## Production hosting

Serve the SPA `dist/` behind the same origin as the gateway/Cube to avoid CORS; SPA fallback required (`try_files $uri /index.html`). The gateway and chat-service deploy as separate Node processes. See [`docs/deployment-guide.md`](./docs/deployment-guide.md) and `docker-compose.prod.yml`.

## License

Internal use. Reference structure inspired by `cube-js/cube` `cubejs-playground` (Apache-2.0).
