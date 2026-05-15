# GDS Cube

Vite + React + TypeScript frontend for a Cube backend on `http://localhost:4000`. Provides:

- **Playground** — meta-driven query builder, results table, recharts bar/line, compiled-SQL preview, JSON preview, deep-linkable query state. Alias + icon picker for cubes/views (client-side, localStorage-persisted).
- **Query State Pill Bar** — 4 inline rows (Dimensions, Measures, Time granularity, Filters) + global date range picker (7d/14d/30d/QTD/Custom) + Run button.
- **Data Model** — read-only browser of cubes/views from `/cubejs-api/v1/meta` (members, joins, pre-aggregations, raw JSON).
- **Settings** — current API URL + token status.

## Stack

- Vite 5, React 18, TypeScript strict.
- `@cubejs-client/core`, recharts ^2.12.
- react-router-dom 6 (browser history).
- antd 4.16.13 + design-token overrides (see `src/theme/`).
- styled-components 6 (peer of `@cube-dev/ui-kit`).
- lucide-react 1.16.0 (icon picker for cube aliases).

## Quick start

```bash
cp .env.example .env.local
# edit .env.local — set VITE_CUBE_API_URL and optional VITE_CUBE_TOKEN
npm install --legacy-peer-deps
npm run dev          # http://localhost:3000, proxies /cubejs-api → :4000
npm run build        # tsc + vite build
npm run test         # vitest
npm run typecheck    # tsc --noEmit
```

## Auth & Personalization

- Bootstrap token comes from env (`VITE_CUBE_TOKEN`) or localStorage (`gds-cube:token`).
- Use the **API Settings** button in the header to paste a JWT; it is validated against `/cubejs-api/v1/meta` before being persisted.
- JWT is stored in localStorage at runtime. Acceptable for an internal dev tool; rotate tokens regularly and avoid pasting prod-tier credentials.
- Cube/View aliases and icons (localStorage key `gds-cube:cube-aliases`) are per-browser, client-only; YAML model files never modified.

## Routes

| Route | Purpose |
|---|---|
| `/playground?query=…` | QueryBuilder + result tabs (results / chart / SQL / JSON) |
| `/data-model` | Sidebar with cubes & views |
| `/data-model/:cubeName` | Detail tabs for one cube/view |
| `/settings` | API URL and token status |

`/playground` accepts a URL-encoded `query` param holding the Cube `Query` JSON; the "Open in Playground" button on a cube detail uses this to pre-seed a measure.

## Endpoints used

`GET /cubejs-api/v1/meta`, `POST /cubejs-api/v1/load`, `POST /cubejs-api/v1/sql`.
No calls to `/playground/*` (dev-only on Cube Core).

## Production hosting

Serve `dist/` behind the same origin as the Cube API to avoid CORS. SPA fallback required (`try_files $uri /index.html`).

## License

Internal use. Reference structure inspired by `cube-js/cube` `cubejs-playground` (Apache-2.0).
