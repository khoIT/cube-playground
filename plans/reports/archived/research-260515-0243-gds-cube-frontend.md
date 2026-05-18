# Research Report: GDS Cube — From-Scratch Frontend for Cube API (:4000)

- **Date:** 2026-05-15 02:43 (Asia/Saigon)
- **Source code studied:** `/Users/lap16299/Documents/code/cube/packages/cubejs-playground` (cube-js/cube v1.6.46)
- **Target:** `/Users/lap16299/Documents/code/cube-playground` — net-new Vite + React app named **GDS Cube**, talking to a Cube backend on `http://localhost:4000`.

---

## Executive Summary

The reference `cubejs-playground` is a **dual-mode** SPA: it doubles as (a) a Cube **API client** for query authoring and (b) a **dev-server UI** for the Cube Core dev mode at :4000 (data model file editing, DB schema introspection, schema generation, live preview). For GDS Cube we only get **mode (a)** for free, because **mode (b) requires `CUBEJS_DEV_MODE=true` and a server with `/playground/*` endpoints** (`DevServer.ts`). Two of the three "Data Model" capabilities in the reference (`/playground/db-schema`, `/playground/generate-schema`, `/playground/files`) are server-side dev-only and will be unavailable in production-style deployments.

Recommended path: copy the **Playground** feature (QueryBuilder V2 + meta-driven UI + chart renderer) almost wholesale, and **replace the Data Model page** with a **read-only data-model browser** built on the public `/cubejs-api/v1/meta` endpoint (cubes, views, members, joins, segments, pre-aggregations). Optionally, gate the original file/schema-generation UI behind a build-time `VITE_CUBE_DEV_MODE=true` flag for users running Cube Core locally.

Stack: **Vite + React 18 + TypeScript + `@cubejs-client/core` + `@cubejs-client/react` + `@cube-dev/ui-kit` + Ant Design 4 + styled-components 6 + react-router 5 + recharts**. Drop: `cloud/`, `rollup-designer`, `vizard`, `cube-bi`, `frontend-integrations`, `connection-wizard`, `live-preview`, GraphiQL, Apollo. Keep auth UX: paste-a-JWT modal (no dev-mode bypass on :4000 in production).

---

## Research Methodology

- Sources: 5 WebSearch queries (Gemini CLI disabled — auth missing), full read of reference TSX entry points & hooks, file inventory of `src/` (21 560 LOC TSX).
- Date range of materials: Cube docs 2024–2026, code at commit shipping v1.6.46.
- Key terms: `/cubejs-api/v1/meta`, `/load`, `/sql`, `/dry-run`, `CUBEJS_DEV_MODE`, JWT `CUBEJS_API_SECRET`, DevServer playground endpoints, `@cubejs-client/core` `CubeApi`.

---

## Key Findings

### 1. Reference App Anatomy

```
src/
├── index.tsx                      Router (hash) + AppContextProvider + 6 routes
├── App.tsx                        Bootstraps via GET /playground/context
├── pages/
│   ├── Index/IndexPage.tsx        Redirect → /build or /schema (uses /playground/files)
│   ├── Explore/ExplorePage.tsx    /build → mounts QueryBuilderContainer  ★ KEEP
│   ├── Schema/SchemaPage.tsx      /schema → DB-schema tree + file viewer ⚠ DEV-ONLY
│   ├── ConnectionWizard/*         dev-server driver setup                ✗ DROP
│   ├── FrontendIntegrations/*     copy-paste snippets                    ✗ DROP
│   └── CubeBI/*                   Cube BI promo                          ✗ DROP
├── QueryBuilderV2/                ★ HEART of Playground — keep as-is
│   ├── QueryBuilder.tsx           top-level; consumes apiUrl+apiToken
│   ├── hooks/query-builder.ts     state machine: meta(), load(), sql()
│   ├── QueryBuilderInternals.tsx  layout: side panel + tabs (Chart/SQL/JSON/GraphQL/REST/Pivot)
│   └── Pivot/ components/ icons/ utils/
├── QueryBuilder/                  Legacy v1 leftovers (used only by SchemaPage ButtonDropdown) — port the dropdown only
├── components/
│   ├── PlaygroundQueryBuilder/    ★ QueryBuilderContainer (wraps QBv2 + CubeProvider)
│   ├── QueryTabs/                 ★ multi-tab query state (localStorage)
│   ├── ChartRenderer/             ★ recharts/embed renderer
│   ├── Settings/, Order/, Pivot/  ★ side panels
│   ├── SecurityContext/           ★ JWT paste modal — keep
│   ├── Header/                    ★ top nav — rewrite branding + drop CubeCloud/Slack
│   ├── LivePreviewContext/        ✗ DROP (dev-only)
│   ├── Vizard/                    ✗ DROP (AI viz preview, separate vizard build)
│   ├── GraphQL/                   optional: keep if GraphQL API on backend
│   ├── DrilldownModal/, CachePane ★ keep
│   └── ChartRenderer/sandbox      uses CodeSandbox SSE — optional drop
├── rollup-designer/               ✗ DROP (uses /playground/schema/pre-aggregation)
├── grid/, atoms/, shared/         ★ helpers — port subset
├── playground/                    Public playground bundle for Cube Cloud — ignore
└── cloud/                         ✗ DROP
```

Total ~21.5k LOC TSX. After cuts, **target ~9–11k LOC** for GDS Cube.

### 2. Cube Backend Endpoints — What's Available on :4000

| Endpoint | Mode | Purpose | GDS Cube |
|---|---|---|---|
| `GET /cubejs-api/v1/meta` | always | cubes/views/members/joins | ✅ data-model browser |
| `POST /cubejs-api/v1/load` | always | run query → result set | ✅ |
| `POST /cubejs-api/v1/sql` | always | compiled SQL preview | ✅ |
| `POST /cubejs-api/v1/dry-run` | always | validate + pivot info | ✅ |
| `/cubejs-api/v1/run-scheduled-refresh` | always | trigger refresh | optional |
| `/cubejs-api/graphql` | always | GraphQL data API | optional |
| `/cubejs-api/v2/cubesql` | always | SQL API (Postgres wire on :15432) | n/a (different port) |
| `GET /playground/context` | **dev only** | telemetry, dockerVersion, basePath | ⚠ replace |
| `GET /playground/db-schema` | **dev only** | DB introspection for Generate Data Model | ✗ |
| `GET /playground/files` | **dev only** | list `model/*.{js,yml}` files w/ content | ⚠ optional dev-mode tab |
| `POST /playground/generate-schema` | **dev only** | scaffold cubes from tables | ✗ |
| `POST /playground/token` | **dev only** | sign JWT server-side for security context | ⚠ user pastes JWT instead |
| `/playground/live-preview/*` | **dev only** | Cube Cloud live preview | ✗ |
| `/playground/test-connection`, `/playground/driver` | **dev only** | connection wizard | ✗ |

**Conclusion:** in non-dev deployments, GDS Cube uses **only** the four `/cubejs-api/v1/*` endpoints. Auth is by Bearer JWT signed with `CUBEJS_API_SECRET`. In dev mode auth is skipped server-side; the frontend can still send any JWT (the server tolerates the missing signature when `CUBEJS_DEV_MODE=true`).

### 3. Reference Auth Flow → What GDS Cube Needs

Reference flow:
1. SPA boots → `GET /playground/context` → returns `{ cubejsToken, basePath, anonymousId, livePreview, isDocker, … }`.
2. `apiUrl = window.location.origin + basePath + '/v1'`.
3. User can override token via "Add Security Context" modal which `POST /playground/token` (server signs).

**GDS Cube replacement (no server-side token endpoint):**
1. Read `apiUrl` from `import.meta.env.VITE_CUBE_API_URL` (default `http://localhost:4000/cubejs-api/v1`).
2. Read **bootstrap token** from one of:
   a. `import.meta.env.VITE_CUBE_TOKEN` (dev convenience), OR
   b. `localStorage['gds-cube:token']` (user pastes), OR
   c. Dev-mode: empty string is accepted by `CUBEJS_DEV_MODE=true` servers.
3. Surface a "Set API Token" header button → modal — same UX as `SecurityContextProvider`.

### 4. Data Model Feature — Pragmatic Rewrite

The reference `SchemaPage` does three things:
- **(A) Browse DB tables** (`/playground/db-schema`) — drop. Not available without dev server.
- **(B) Generate cube files from tables** (`/playground/generate-schema`) — drop.
- **(C) View existing data-model files** (`/playground/files`) — optional dev-only tab.

Replace with a **Cube-aware data model browser** built only on `/v1/meta`:

```
┌─────────────── Data Model ───────────────────────┐
│ Sidebar: tree of [Cubes, Views]                  │
│  • orders (cube)                                  │
│    ├─ measures: count, total_amount …             │
│    ├─ dimensions: status, created_at, …           │
│    ├─ segments: high_value                        │
│    └─ joins: customers, line_items                │
│  • orders_view (view)                             │
│    └─ includes from orders, customers             │
│                                                   │
│ Main: selected cube/view detail:                  │
│  - Name, title, description, meta tags            │
│  - Tabbed: Members | Joins | SQL preview | YAML   │
│  - Each member: type, format, public flag, sql    │
│  - "Open in Playground" → pre-fill query          │
└──────────────────────────────────────────────────┘
```

Source of truth: `cubeApi.meta()` returns `Meta` with `cubes[]`, each with `measures[]`, `dimensions[]`, `segments[]`, `nestedAlias` and (if exposed) `type: 'cube' | 'view'`. The current `QueryBuilderV2/hooks/query-builder.ts:332` already calls `cubeApi.meta()` and computes this exact shape — we can extract the same parser into a shared `useMeta()` hook.

**YAML view of an individual cube is not available via /meta** — that file content lives only behind `/playground/files`. Acceptable trade-off; rendered detail page is richer than a raw YAML dump.

### 5. Tech Stack Decision

| Concern | Reference | GDS Cube |
|---|---|---|
| Build | Vite 8 | Vite 8 (keep) |
| Framework | React 18 | React 18 |
| Lang | TS 5.2 | TS 5.x |
| Router | react-router-dom 5 (hash) | **react-router-dom 6** browser history — fewer surprises |
| UI primitives | `@cube-dev/ui-kit` 0.52 + antd 4 | keep both for fast port; antd 4 is unmaintained but works |
| Styles | styled-components 6 + less | keep (UI kit needs it) |
| Cube client | `@cubejs-client/core` 1.6 + `react` 1.6 | same |
| Charts | recharts 2 | recharts 2 |
| State | useReducer + custom hooks (no Redux) | same |
| Data model docs | n/a (uses playground server) | new `useMeta()` + browser route |
| Testing | vitest | vitest |
| Auth | playground/token POST | paste-JWT modal + localStorage |

**Drop list (dependencies):** `@apollo/client`, `@graphiql/toolkit`, `graphiql`, `graphql-ws`, `cron-validator`, `codesandbox-import-utils`, `customize-cra`, `js-cookie`, `jwt-decode` (we don't decode), `react-beautiful-dnd` (only used by rollup designer), `prismjs` keep (code preview), `sql-formatter` keep, `recursive-readdir` (server-only).

### 6. Routing & Page Map

```
/                     → redirect to /playground
/playground           → QueryBuilderContainer  (= Explore)
/data-model           → Cubes/Views browser    (replaces Schema)
/data-model/:cubeName → detail view
/settings             → API URL + JWT + recent tabs cleanup
```

Hash history is fine; the reference uses `createHashHistory`. **Switch to browser history** in GDS Cube for cleaner URLs — react-router 6 supports `?query=` deep links via `useSearchParams`.

### 7. Critical Files to Port (priority order)

1. `QueryBuilderV2/**` — entire dir (rename color tokens if rebranding).
2. `components/PlaygroundQueryBuilder/QueryBuilderContainer.tsx` — strip CubeCloud + Rollup designer wrappers.
3. `components/QueryTabs/**` — multi-tab support.
4. `components/ChartRenderer/**` — recharts adapter (drop CodeSandbox export button).
5. `components/SecurityContext/**` — replace POST with local-only signing or skip signing.
6. `components/Settings/**`, `Order/`, `Pivot/`, `DrilldownModal/`, `CachePane.tsx`.
7. `hooks/cubejs-api.ts`, `hooks/index.ts` subset.
8. `atoms/`, `shared/helpers.ts` (drop `playgroundFetch` 500-handling — keep generic fetch wrapper).
9. `components/AppContext.tsx` — slim down `PlaygroundContext` type.
10. `components/Header/Header.tsx` — rebrand to GDS Cube, drop Slack/CubeCloud/CubeBI links.
11. `events.ts` — telemetry: replace `trackImpl` with a no-op or wire to internal analytics.

---

## Comparative Analysis: 3 Approaches

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **A. Fork-and-strip** the playground package | Fastest path; preserves QBv2 fidelity | Carries dead code; harder to rebrand cleanly | ❌ |
| **B. New Vite app, copy QBv2 subtree only** | Clean repo; lean deps; clear ownership | Some glue work for routing/auth/context | ✅ Recommended |
| **C. Build QBv2 from scratch on `useCubeQuery`** | Smallest bundle; full control | ~3–6 weeks of UI work; loses pivot/filter polish | ❌ |

---

## Implementation Recommendations

### Quick Start (Phase 0 — bootstrap, ~1 day)

```bash
mkdir -p src && cd /Users/lap16299/Documents/code/cube-playground
npm create vite@latest . -- --template react-ts
npm i @cubejs-client/core @cubejs-client/react \
      @cube-dev/ui-kit @ant-design/icons @ant-design/compatible \
      antd@4.16.13 styled-components@6 less \
      react-router-dom recharts prismjs sql-formatter \
      moment date-fns mitt flexsearch fast-deep-equal uuid \
      react-hotkeys-hook react-responsive html-entities best-effort-json-parser
npm i -D @types/react @types/react-dom @types/uuid @vitejs/plugin-react vitest jsdom
```

`vite.config.ts` proxy:
```ts
server: {
  port: 3000,
  proxy: {
    '/cubejs-api': 'http://localhost:4000',
    '/cubejs-api/v2/cubesql': { target: 'http://localhost:4000', ws: false },
  }
}
```

`.env.local`:
```
VITE_CUBE_API_URL=http://localhost:4000/cubejs-api/v1
VITE_CUBE_TOKEN=
```

### Phase 1 — App shell + auth (~1 day)

- `src/main.tsx`: Router, ConfigProvider, Root from `@cube-dev/ui-kit`.
- `src/app.tsx`: header + outlet, no `/playground/context` fetch — use env + localStorage.
- `src/context/cube-context.tsx`: `apiUrl`, `token`, `setToken`. Memoized `cubeApi` via `useCubejsApi`.
- `src/components/header/header.tsx`: GDS Cube logo, two nav items (Playground, Data Model), "API Settings" button.
- `src/components/security/security-context-modal.tsx`: paste JWT, validate by attempting `cubeApi.meta()`.

### Phase 2 — Playground (~2–3 days)

- Port `QueryBuilderV2/**` 1:1 (it's already self-contained — only depends on `@cubejs-client/core` and `@cube-dev/ui-kit`).
- Port `components/QueryTabs`, `ChartRenderer`, `Pivot`, `Order`, `Settings`, `DrilldownModal`.
- Wire `/playground` route → `QueryBuilderContainer`.

### Phase 3 — Data Model browser (~2–3 days)

- `src/hooks/use-meta.ts`: wraps `cubeApi.meta()`, groups by `type: cube|view`, returns `{ cubes, views, byName, isLoading, error }`.
- `src/pages/data-model/data-model-page.tsx`: split layout (sidebar tree + detail).
- `src/pages/data-model/cube-detail.tsx`: tabs for Members / Joins / Pre-aggregations / Raw JSON.
- "Open in Playground" → `navigate('/playground?query=' + encodeURIComponent(JSON.stringify({ measures: [cubeName + '.count'] })))`.

### Phase 4 — Polish (~1 day)

- Telemetry stub.
- Error boundaries (copy `App.tsx` componentDidCatch).
- Deep links for tabs (`/playground?tab=t1&query=...`).
- Build script: `vite build` → static assets; serve behind same nginx that fronts Cube on :4000 (CORS-free).

### Code Examples

**Cube client init (no `/playground/context` dependency):**
```ts
// src/lib/cube-api.ts
import cube, { CubeApi } from '@cubejs-client/core';

export function getApiUrl(): string {
  return import.meta.env.VITE_CUBE_API_URL || 'http://localhost:4000/cubejs-api/v1';
}

export function getToken(): string {
  return localStorage.getItem('gds-cube:token')
      || import.meta.env.VITE_CUBE_TOKEN
      || '';
}

export function makeCubeApi(token: string, apiUrl: string): CubeApi {
  return cube(token, { apiUrl });
}
```

**Meta-driven data-model hook:**
```ts
// src/hooks/use-meta.ts
import { useEffect, useState } from 'react';
import { useCubeApi } from '../context/cube-context';

export function useMeta() {
  const cubeApi = useCubeApi();
  const [state, setState] = useState({ cubes: [], views: [], loading: true, error: null });

  useEffect(() => {
    if (!cubeApi) return;
    cubeApi.meta()
      .then((m) => {
        const all = m.meta.cubes;
        setState({
          cubes: all.filter(c => c.type !== 'view'),
          views: all.filter(c => c.type === 'view'),
          loading: false,
          error: null,
        });
      })
      .catch((e) => setState((s) => ({ ...s, loading: false, error: e })));
  }, [cubeApi]);

  return state;
}
```

### Common Pitfalls

- **antd v4 + React 18**: works but warns; `@ant-design/compatible` patches; do not upgrade to antd v5 — `@cube-dev/ui-kit` 0.52 is built against antd 4.
- **styled-components 6**: peerDep of `@cube-dev/ui-kit`; do not downgrade.
- **less + javascriptEnabled: true** required by antd 4 themes.
- **Hash vs browser history**: if you serve behind nginx without rewrites, use hash; otherwise add `try_files $uri /index.html`.
- **CORS**: in prod, host SPA on same origin as `/cubejs-api`. In dev, use Vite proxy.
- **JWT auth on prod Cube**: empty token will be rejected; show a clear error in the SecurityContext modal.
- **`cubeApi.meta()` returns view-typed entries** only on Cube ≥ 0.32; for older servers, fall back to treating everything as cube.
- **Recharts ≥ 3 breaks v2 APIs**: pin to ^2.12.
- **Vite 8 + `process.env`**: the reference defines `process.env.SC_DISABLE_SPEEDY`; keep that for styled-components SSR speedy mode.

---

## Resources & References

### Official Documentation
- [REST API | Cube docs](https://cube.dev/docs/product/apis-integrations/core-data-apis/rest-api)
- [REST API reference](https://cube.dev/docs/product/apis-integrations/core-data-apis/rest-api/reference)
- [@cubejs-client/core reference](https://cube.dev/docs/product/apis-integrations/javascript-sdk/reference/cubejs-client-core)
- [JWT authentication](https://cube.dev/docs/product/auth/methods/jwt)
- [Security context](https://cube.dev/docs/product/auth/context)
- [Playground feature page](https://cube.dev/docs/product/workspace/playground)
- [Development mode](https://cube.dev/docs/product/workspace/dev-mode)
- [Environment variables](https://cube.dev/docs/reference/configuration/environment-variables)
- [Cubes reference](https://cube.dev/docs/product/data-modeling/reference/cube)
- [Views reference](https://cube.dev/docs/product/data-modeling/reference/view)

### Source Code
- [cube-js/cube — cubejs-playground package](https://github.com/cube-js/cube/tree/master/packages/cubejs-playground)
- [DevServer.ts (server endpoints)](https://github.com/cube-js/cube/blob/master/packages/cubejs-server-core/src/core/DevServer.ts)
- [@cubejs-client/core on npm](https://www.npmjs.com/package/@cubejs-client/core)
- [@cubejs-client/playground on npm](https://www.npmjs.com/package/@cubejs-client/playground)

### Related
- [Connecting Embeddable to Cube Cloud](https://docs.embeddable.com/data/cube-cloud) — pattern for embedded clients
- [REST API method to get cubes meta — custom metadata issue #7740](https://github.com/cube-js/cube/issues/7740)

---

## Appendices

### A. Glossary

- **Cube / View** — semantic-layer entities. View is composed from one+ cubes via joins.
- **Meta** — JSON describing all cubes/views/members; pulled from `/v1/meta`.
- **Pre-aggregation / Rollup** — materialised summary table; managed server-side.
- **Security Context** — payload encoded in JWT; consumed by `SECURITY_CONTEXT` in cubes.
- **Dev mode** — Cube server flag enabling `/playground/*` UI APIs.

### B. Version Compatibility Matrix

| Component | Min | Recommended | Notes |
|---|---|---|---|
| Node | 18 | 20 | Vite 8 requires ≥ 18 |
| Cube backend | 0.32 | 1.x | View typing & GraphQL stable from 0.32 |
| React | 18 | 18 | UI kit pinned to 18 |
| antd | 4.16.13 | 4.16.13 | Don't bump to v5 |
| @cubejs-client/core | 0.30 | 1.6.x | meta() shape stable |

### C. Routes vs. Endpoints — Quick Map

| GDS Cube route | Calls | Required cube endpoints |
|---|---|---|
| `/playground` | `meta()`, `load()`, `sql()`, `dryRun()` | `/v1/meta`, `/v1/load`, `/v1/sql`, `/v1/dry-run` |
| `/data-model` | `meta()` only | `/v1/meta` |
| `/settings` | none (token sanity check by `meta()`) | `/v1/meta` |

---

## Unresolved Questions

1. **Authentication model in target environment** — is GDS Cube going to (a) require users to paste a long-lived JWT, (b) embed a short-lived token built by a separate auth proxy, or (c) run against a dev-mode Cube on :4000 where no token is needed? Recommendation hinges on this.
2. **Branding scope** — colour palette, logo asset, app name capitalisation ("GDS Cube" vs "gds-cube"). Need a logo SVG for the header.
3. **Telemetry** — drop entirely, or wire `events.ts` to an internal analytics endpoint?
4. **GraphQL tab** — keep `QueryBuilderGraphQL.tsx` (depends on `graphql` + `graphiql`)? Only useful if downstream consumers actually use Cube's GraphQL API.
5. **Pre-aggregation viewer** — the reference has a "Cache" pane and rollup designer; rollup designer hits `/playground/schema/pre-aggregation` (dev-only). Keep a read-only "pre-aggregations" tab in data-model detail (sourced from `meta.cubes[].preAggregations`) instead?
6. **Multi-tenant security context modal** — keep the "Set Security Context" modal that lets users craft a JWT payload? Without `POST /playground/token` we'd have to sign client-side (needs the secret on the frontend — security smell) or accept only pre-signed tokens.
7. **License / OSS lineage** — cube-js/cube is Apache-2.0 + some packages MIT (playground is MIT). Need to keep `LICENSE` notices on any ported file.
