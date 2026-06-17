# Cube Cloud — Product Discovery (end-to-end)

Date: 2026-06-17. Instance: `khoi-analytics.cubecloud.dev`. Method: authenticated headless drive (Playwright, reused session) + passive capture of the app's own API calls + Trino cross-check of the connected warehouse. Screenshots + raw captures in `plans/reports/cubecloud-discovery-260617/`.

## TL;DR

- You connected the **data source** (Trino → `stag_iceberg.khoitn`), not yet the **data model**. The semantic layer still holds only Cube's default sample `orders` cube. Explore is empty ("No Semantic Views"). No pre-aggregations. So: warehouse wired, modeling not started.
- Cube Cloud = managed **Cube** (open-source semantic layer) + a control-plane UI, IDE, BI Explore, caching (Cube Store), and a prominent **AI/agentic** layer. Same engine as your in-repo `cube-dev`, just hosted.

## Two hosts / two auth models (the part you asked about)

| Plane | Host | Auth | Serves |
|---|---|---|---|
| Control plane / UI | `khoi-analytics.cubecloud.dev` | Express **session cookie** `connect.sid` (HttpOnly, Secure, SameSite=None) | the SPA + Apollo **GraphQL** (`/graphql/`, introspection disabled in prod) |
| Data plane | `green-locust.aws-us-east-1.cubecloudapp.dev` | **JWT** `Authorization` header (minted by control plane; signed with the deployment's API secret) | Cube Core **v1.6.57**: `/cubejs-api/v1/*` (data) + `/cubejs-system/v1/*` (deploy ops) |

- For headless access to the **UI**: replay `connect.sid` (what `scripts/cubecloud-session.mjs` does). Different domain `cubecloudapp.dev` won't accept that cookie → its calls need the JWT, which the app injects. So bare `fetch` to the data host 403s ("Authorization header isn't set"); driving through the browser carries the JWT automatically (how `cube-meta.json` was captured).
- `connect.sid` is short-lived (~24h rolling, re-issued each response). Durable automation should script the login to mint fresh state, not hardcode the cookie.

## Deployment surfaces (nav, deployment id = `1`, branch `master`, Dev Mode toggle)

1. **Overview** `/d/1` — deployment landing.
2. **Data Model / IDE** `/d/1/model` — file-tree editor of the Cube project: `model/cubes/orders.yml`, `model/views/example_view.yml`, `cube.py` (Python config), `requirements.txt`. Top-right **Security Context** selector (test RLS as a user) + **Dev Mode** + branch picker. Right rail = AI **"Build semantic model"** chat. Notable `agents/` folder → **agentic analytics** config: `certified-queries/` (blessed Q→query pairs), `rules/` (e.g. default-timeframe), `config.yml`.
3. **Explore** `/d/1/explore` — BI explorer over **semantic views**; Results/Chart/SQL tabs, Sort/Limit/Run, **AI chat "Explore data and build charts"**, Save → **Workbook**. Empty now (no views).
4. **Playground** `/d/1/playground` — marked **LEGACY** ("use Explore"). Still the clearest API teaching surface: tabs **Generated SQL / SQL API / REST API / GraphQL API** — the four ways to query the same model. Member icons show PK / public / filterable.
5. **SQL Runner** `/d/1/sql-runner` — raw SQL against the warehouse/SQL API.
6. **Pre-Aggregations** `/d/1/pre-aggregations` — tabs Pre-Aggregations + Build History; columns Last started / Duration / Partition size / Partitions. Empty (none defined).
7. **Query History** `/d/1/query-history` — Requests, Average Response Time.
8. **Chat History** `/d/1/chat-history` — monitor AI chat threads across all users (banner: "moving to Admin panel soon").
9. **Performance Insights** `/d/1/performance` — **PREMIUM-gated** on this account. Cube Store utilization & cache insights, query duration/error analysis, API-instance autoscaling, requests by cache type / by data-model compilation.
10. **Status** `/d/1/status`.
11. **Settings** `/d/1/settings/edit` — Deployment config + Danger Zone.

## Data plane facts (captured)

- Core version: **v1.6.57**. Settings: `defaultLimit 10000`, `maxLimit 50000`, `autoRunMode true`.
- `pre-aggregations`: `[]`. `timezones`: `[]`. `security-contexts`: `[]`.
- `meta`: one cube `orders` — measures `count` (count), `amount` (sum); dims `id` (PK, hidden), `status`. = stock scaffold.

## Warehouse (Trino cross-check)

- `stag_iceberg.khoitn` holds the real tables Cube is pointed at: `cfm_vn__*` and `jus_vn__*` in etl_/std_/cons_/mf_/map_ tiers (same flat game-prefixed layout as the MCP/loader data). None of these are modeled in Cube yet — the gap to close.

## How this maps to your own repo

- Cube Cloud's engine == your `cube-dev` Cube. The in-repo per-game YAMLs (`cube-dev/cube/model/cubes/{game}/*.yml`) are exactly what Cloud's IDE edits. You could push those models here to model `stag_iceberg.khoitn` instead of the `orders` stub.
- Cloud's AI layer (model-build chat, Explore chat, certified-queries, rules, chat-history monitor) overlaps conceptually with your chat-service / advisor / query-perf hub — useful reference for comparing your build vs. their managed product.

## Tooling produced

- `scripts/cubecloud-session.mjs` — `login` (headed, mint session) / `check` / `shot` / `graphql`. Session file `.cubecloud-auth.json` is gitignored (live credential).
- `scripts/cubecloud-discover.mjs` — drives routes, screenshots, captures GraphQL ops + data-API hosts.

## Population (DONE — 2026-06-17)

Replaced the `orders` stub with a curated starter model for cfm_vn + jus_vn and pushed it live.

- **Pushed**: 10 cubes (5/game: game_key_metrics, mf_users, active_daily, user_recharge_daily, new_user_retention) + 10 single-cube wildcard views, via the managed git remote `https://khoi-analytics.cubecloud.dev/repos/deployment_1` (commit `86f0f89`). Cloud compiled immediately — `/meta` now lists 20 members, `orders` gone.
- **Verified end-to-end**: live Cube query `cfm_vn_game_key_metrics` (rev/installs/nru by month) returned real data — Jun-2026 rev 15.53B VND / 130,648 installs; May-2026 15.84B / 80,789. Explore lists all 10 views.
- **Port mechanics** (`scripts/cubecloud-port-model.mjs`, output `cube-cloud-model/`):
  - Namespaced every cube + cube-ref by game (`cfm_vn_*`/`jus_vn_*`) — single deployment compiles both games together, so bare cube-dev names would collide.
  - Fully-qualified tables → `stag_iceberg.khoitn.{ns}__<table>` (Cloud's flat game-prefixed layout vs cube-dev's bare per-schema names).
  - Dropped joins to out-of-set cubes (`mf_users → recharge`).
  - **Stripped `pre_aggregations`** — not needed for Explore (queries fall through to Trino), avoids Cube Store build load/failures on Shared tier. *To revisit when demonstrating the Pre-Aggregations surface.*
- **Git credentials**: generated via the UI (rotatable); plaintext capture deleted from /tmp. Re-pushing requires regenerating or reusing them.

## Unresolved questions

1. **Pre-aggregations** were stripped for the first push — want one simple rollup (e.g. `game_key_metrics` by source/day) re-added so you can watch a Cube Store build on the Pre-Aggregations board?
2. **Expand scope?** Current set is 5 cubes/game. Full port adds event/funnel cubes (etl_*), monthly rollups, billing, cs_ticket, and the full `user_360` view (needs those cubes present).
3. Goal of learning Cloud — evaluate as replacement for self-hosted, or specifically study their **agentic analytics** (certified-queries/rules/chat) vs your chat-service?
4. Performance Insights is Premium-locked — need its data, or is Query History enough?
