---
type: brainstorm
date: 2026-05-19
slug: query-results-to-segments
status: design-approved-v3
revision: 3
ui-design-source: ~/Downloads/cube-segment (app.jsx, screen-*.jsx, data.jsx, styles.css)
next: plan at plans/260519-1610-query-results-to-segments/
---

# Brainstorm — Results-Row Selection → Persistent Segments Tab

> **Revision history**
> - v1 (2026-05-19): generic auto-pivot Profile + user-pinned analyses; raw Cube Query predicate; backend CRUD + cron.
> - v2 (2026-05-19): folded in `~/Downloads/cube-segment` UI design. Predicate becomes structured tree; analysis becomes preset bundles (`mf_users` preset ships in v1); modal-only push; multi-user with owner+tags; Import IDs + Copy/Paste round-trip; live cohort preview in editor. Sparkline + used-in counters deferred.
> - v3 (2026-05-19): pixel-perfect parity to `~/Downloads/cube-segment` added as explicit goal. New Phase 0 ships the mock's design system **globally** (replaces @cube-dev/ui-kit + antd defaults), 14 bespoke visual primitives + 4 chart primitives under `src/pages/Segments/visuals/`, existing-screen polish pass, and a Playwright pixel-diff CI gate at 1440×900 + 375×812 (≤2% delta). Baselines captured by rendering the mock HTML headless. Estimate revised: **9-10 weeks** single-engineer / **~6 weeks** with two engineers (P0+P1 parallel start).

## Problem statement

Playground's Results tab today is a read-only grid with per-cell copy. We want to:

1. Select 1+ rows from Results (rows that carry a user-identity column).
2. Push selection to a new persistent **Segments** workspace (top-nav tab next to Playground).
3. Segments page is the home for persistent `{predicate?, uids, analyses}` objects with library / detail / editor views.
4. Optional **live** mode auto-refreshes uids from the predicate (24/7, backend-driven).

## Locked requirements (v2)

| Concern | Decision |
|---|---|
| Persistence | New backend service colocated in repo (Fastify + SQLite + node-cron). |
| Refresh runtime | Hybrid — backend cron 24/7 + FE polling for instant feedback. |
| Backend stack | Node + Fastify + better-sqlite3 + node-cron. Single process. |
| "Available data in YAML" | Cube `/meta` endpoint only — no direct `.yml` file reads. |
| user_id identification | Per-cube identity-dim mapping; auto-suggested from `*_id` / `*.user_id`; user confirms. |
| Live mode | Backend cron is authoritative; FE poll for UI freshness. |
| Data model scope | **Generic backbone + `mf_users` preset.** Segment + predicate model is schema-agnostic; analysis tabs are preset bundles (TS const in v1). `mf_users` preset ships with v1 — others additive. |
| Predicate canonical form | **AND/OR tree** is canonical (UI form). Cube `Query` JSON cached on save for cron + drift detection. |
| Push UX | **Modal only.** Centered dialog with two tabs (`Create new` / `Append to existing`). Drops bar/sheet variants. |
| Analysis surfaces | Preset tabs (Overview / Engagement / Monetization / Retention) + Sample users + Saved analyses + Predicate (read-only). |
| Saved analyses | Pinned Cube queries with view-inline + "Open in Playground" round-trip. |
| Multi-tenancy | Owner field + per-segment tags. No full auth in v1; owner is a string from env or header. Multi-user UI affordances ship. |
| Round-trip with Playground | Yes — Import IDs (CSV), Copy as filter (segment → Playground), Paste from query (Playground predicate → editor). |
| Editor live preview | Yes — debounced Cube `/load` with `LIMIT 1` for cohort size; Cube `/sql` for SQL preview. |
| **Deferred to v1.5** | Sparkline trend on library row + used-in counters (dashboards/MCP/savedViews). |

## Approaches evaluated

### Approach A — FE-only polling + thin CRUD backend (rejected v1)
- Refresh stops when no tab is open. Contradicts "live".

### Approach B — Hybrid cron + FE poll (CHOSEN)
- Backend cron 24/7 authoritative; FE polling for UX freshness.
- Pros: durable freshness, snappy UI, single-process simplicity.
- Cons: single-instance only — documented constraint.

### Approach C — Backend-only refresh (rejected)
- Stale until next cron tick. Worse UX.

## High-level architecture

```
┌─────────────────────────── Browser ──────────────────────────┐
│  /build (Playground)               /segments (NEW pill)       │
│      │                                  │                      │
│      ▼                                  ▼                      │
│  Results table:                   Library | Detail | Editor   │
│  - row-select mode                  list + filters             │
│  - "Save as segment" → modal        7-tab detail               │
│                                     visual predicate editor   │
│                                                                 │
└──────────┬───────────────────────────────────┬────────────────┘
           │ Cube API (existing)               │ NEW /api/segments
           ▼                                   ▼
   ┌──────────────┐               ┌────────────────────────────┐
   │ Cube :4000   │               │ Fastify + SQLite :3001     │
   │  /meta /load │◄──────────────│  CRUD + node-cron worker   │
   │  /sql        │               │  refreshes live segments   │
   └──────────────┘   server-side │  every N min, 24/7         │
                       /load call │  + size_history (v1.5)     │
                                  └────────────────────────────┘
```

## Frontend deliverables

### 1. Header pill `/segments`
Edit `Header.tsx`. Position between `/build` and `/metrics/new`. `KeepAliveRoute` mount.

### 2. `QueryBuilderResults.tsx` — row-selection mode
- Leading checkbox column; indeterminate header state.
- Enabled when executed query includes the cube's mapped identity dimension.
- Selection persists across pagination within the same query result.
- Selection cleared on query re-run.

### 3. Push-to-segment **modal**
- Trigger: row-select bar shows `[N user_ids selected] [Save as segment ▾]`.
- Modal has 2 top tabs:
  - **Create new**: Name field + selection summary (count, top countries/tiers/channels, avg of one numeric column auto-picked) + Static/Live toggle + Type description.
  - **Append to existing**: dropdown of *static* segments only (live ones rebuild from predicate). Confirmation that uids will be merged + de-duplicated.
- Submit → POST `/api/segments` → toast `[Segment created · View segment →]` → optional jump to detail.

### 4. `/segments` route — three views routed by inner state

#### Library view (`pages/Segments/library.tsx`)
- Page header: title + subtitle (live count / static count / total ids).
- Top row: 4 KPI tiles — `Live segments`, `Static segments`, `Total user-ids`, `In use` (v1.5 — placeholder zero in v1).
- Toolbar: search box, type filter tabs (`All` / `Live` / `Static`), sort dropdown (`Recently updated` / `Size` / `Name`).
- Table columns: Segment (name + description + tags), Type (live badge with refresh interval / static badge), Last refresh (relative + next-refresh countdown for live), Size (+delta), Trend (sparkline — **v1.5 placeholder; static dash in v1**), Owner (avatar + name).
- Actions: `Import IDs` (CSV upload), `New segment` (jumps to editor with empty predicate).
- Empty state for filter mismatches.

#### Detail view (`pages/Segments/detail.tsx`)
- Breadcrumb: `Segments / <name>`.
- Header row: title + Live badge (placement option in v1.5; v1 = header pill only) + cube badge + actions (`Export IDs` / `Copy as filter` / `Edit predicate` / overflow menu).
- 4 headline KPIs from the preset (e.g. `Segment size`, `DAU`, `ARPU lifetime`, `Revenue 30d` for `mf_users` preset).
- Tabs (7 in v1):
  1. **Overview** — composition cards (channel / platform / country) + 2 line charts (DAU 14d, revenue 14d) + payment method bars + retention curve.
  2. **Engagement** — DAU today / MAU 30d / stickiness KPIs + DAU 14d chart + session-intensity histogram.
  3. **Monetization** — Revenue 30d / ARPU lifetime / ARPPU / paying rate KPIs + revenue 14d chart + payment method bars.
  4. **Retention** — D7 / D30 / median tenure KPIs + retention curve + first-active cohort buckets.
  5. **Sample users** — paginated table of N (default 50) randomly sampled uids with hub-cube columns. `Export all IDs` + `Reshuffle` actions.
  6. **Saved analyses** — user-pinned Cube queries; inline render + `Open in Playground` round-trip with the segment's uid filter pre-applied.
  7. **Predicate** — read-only tree view + "Edit" button → editor. For static segments: shows "Static · no predicate · N user-ids stored".

#### Editor view (`pages/Segments/editor.tsx`)
- Breadcrumb: `Segments / <name> / Edit predicate`.
- Identity card: Name + Description fields.
- **Visual predicate builder**:
  - Nested AND/OR groups. Root group + nested groups switchable AND ↔ OR.
  - Each leaf = `{ cube.column dropdown, operator dropdown, value input, type badge }`.
  - Operator set by column type (`string`: `=`, `!=`, `contains`, `IN`, `NOT IN`, `set`, `notSet`; `number`: `=`, `!=`, `>`, `<`, `>=`, `<=`, `set`, `notSet`; `time`: `inDateRange`, `beforeDate`, `afterDate`; `boolean`: `=`, `!=`).
  - Value input adapts to type (text / number / multi-select / date / boolean).
  - `Add condition` + `Add group` buttons per group.
  - `Paste from query` button: lifts Playground's active `Query.filters` into the tree.
- Refresh-behaviour card: Static / Live toggle. Live → interval picker (`5m` / `15m` / `1h` / `6h` / `24h`). Note: 5m only on small predicates.
- Right rail (sticky):
  - **Resolved cohort preview**: debounced (~500ms) call to backend `POST /api/preview` → executes a `LIMIT 1` style query against Cube `/load` to estimate uid count. Displays count + 14d sparkline of estimates (cached).
  - **Generated SQL**: pre-formatted, from Cube `/sql` endpoint. Refreshed on debounce.
  - **Cube browser**: collapsible list of available cubes + their members, click to insert into current leaf.
- Footer: `Cancel` / `Preview SQL` / `Save segment`.

### 5. Settings → Cube identity mapping
- Per cube from `/meta`: dropdown picking the identity dimension.
- Backend serves auto-suggested mapping on first load (matches `*.user_id` / `*_id`); user confirms or overrides. Persisted server-side.

### 6. Live polling hook
`useSegmentLivePolling(segmentId)` — `useInterval(30s)` → `GET /api/segments/:id` to pick up cron-refreshed uids.

### 7. Toast + status surfacing
- Post-push toast: "Segment created · View segment →".
- Broken-segment surfacing in Library (red badge) + Detail (error banner with "Edit predicate to fix").

## Preset model

A **preset** is a TypeScript constant in v1 (no runtime config table):
```ts
type Preset = {
  id: string;                  // 'mf_users-hub'
  label: string;               // 'Users (mf_users)'
  hubCube: string;             // 'mf_users'
  identityDim: string;         // 'mf_users.user_id'
  reachableCubes: string[];    // ['active_daily', 'user_recharge_daily', 'recharge']
  tabs: PresetTabDef[];        // Overview / Engagement / Monetization / Retention
};
type PresetTabDef = {
  id: string;
  label: string;
  kpis: KpiSpec[];             // { measure, label, format, deltaVs }
  cards: CardSpec[];           // { kind: 'line'|'bar'|'donut'|'kpi-grid', members, ... }
};
```
- `mf_users-hub` preset ships in v1 with the 4 tabs from the mock. Hardcoded in `src/pages/Segments/presets/mf-users-hub.ts`.
- Segment row carries `preset_id`. UI picks tabs from the preset registry at render time.
- v1.5+: externalize presets (settings UI or YAML extension), allow per-org preset bundles.

## Predicate model

### Canonical tree
```ts
type PredicateNode =
  | { kind: 'AND' | 'OR'; children: PredicateNode[] }
  | { kind: 'leaf'; column: string; op: string; value: string | string[]; type: 'string'|'number'|'time'|'boolean' };
```

### Translation to Cube
- `tree → Cube Query.filters` translator. Handles nested AND/OR by emitting Cube's `and`/`or` array forms.
- Cached `cube_query_json` field per segment, regenerated on save.
- For cron: server reads `cube_query_json` directly (skips re-translation).

### Drift detection
- On save: record `meta_version` (hash of `/meta`).
- On cron tick: compare current `/meta` hash to stored. On drift, attempt re-execution; on member-not-found from Cube, mark `status='broken'` with `last_error`.

## Backend deliverables (`/server`)

**Stack**: Fastify + `better-sqlite3` + `node-cron`. Single Node process. Vite dev proxy `/api → :3001`.

### Schema

```sql
CREATE TABLE segments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  preset_id TEXT NOT NULL,
  primary_cube TEXT NOT NULL,
  identity_dim TEXT NOT NULL,
  predicate_tree_json TEXT,         -- canonical AND/OR tree
  cube_query_json TEXT,             -- cached Cube Query (predicate-equivalent)
  predicate_meta_version TEXT,      -- /meta hash at last save
  uids_json TEXT NOT NULL,          -- JSON array of strings
  uids_updated_at INTEGER,
  is_live INTEGER DEFAULT 0,
  refresh_interval_sec INTEGER DEFAULT 900,
  status TEXT DEFAULT 'ok',         -- 'ok' | 'refreshing' | 'broken'
  last_error TEXT,
  owner TEXT NOT NULL,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE segment_tags (
  segment_id TEXT REFERENCES segments(id) ON DELETE CASCADE,
  tag TEXT,
  PRIMARY KEY (segment_id, tag)
);

CREATE TABLE segment_analyses (
  id TEXT PRIMARY KEY,
  segment_id TEXT REFERENCES segments(id) ON DELETE CASCADE,
  name TEXT,
  query_json TEXT,                  -- Cube Query
  chart_kind TEXT,                  -- 'table'|'bar'|'line'|'sql'|'json'
  query_meta_version TEXT,
  status TEXT DEFAULT 'ok',
  created_at INTEGER
);

CREATE TABLE cube_identity_map (
  cube_name TEXT PRIMARY KEY,
  identity_dim TEXT NOT NULL,
  source TEXT DEFAULT 'user',       -- 'user' | 'auto-suggest'
  updated_at INTEGER
);

-- v1.5
CREATE TABLE segment_size_history (
  segment_id TEXT REFERENCES segments(id) ON DELETE CASCADE,
  ts INTEGER,
  size INTEGER,
  PRIMARY KEY (segment_id, ts)
);
```

### Endpoints

```
GET    /api/segments                        list (filter: owner, type, search, sort)
POST   /api/segments                        create (from selection or empty)
GET    /api/segments/:id                    detail (incl. uids)
PATCH  /api/segments/:id                    update name/desc/predicate/live/interval/tags
DELETE /api/segments/:id
POST   /api/segments/:id/refresh            force recompute now
POST   /api/segments/:id/append             append uid list (de-duped)
POST   /api/segments/import-ids             create static from CSV upload

GET    /api/segments/:id/analyses
POST   /api/segments/:id/analyses           pin a Cube query
PATCH  /api/segments/:id/analyses/:aid
DELETE /api/segments/:id/analyses/:aid

POST   /api/preview                         body: { predicate_tree, identity_dim, primary_cube }
                                            returns { estimated_count, cube_query, sql_preview }
                                            -- used by editor's right-rail debounce
GET    /api/settings/identity-map           returns mapping (server merges saved + auto-suggested)
PUT    /api/settings/identity-map/:cube     persist override
GET    /api/meta/version                    current /meta hash
GET    /api/presets                         list of available presets (v1: returns the mf_users-hub preset only)
```

### Cron worker

`cron('* * * * *')` every 60s:
1. `SELECT id, cube_query_json, predicate_meta_version, identity_dim, refresh_interval_sec, uids_updated_at FROM segments WHERE is_live=1`.
2. Skip if `now - uids_updated_at < refresh_interval_sec`.
3. Set `status='refreshing'`.
4. Drift check: compare `predicate_meta_version` to current `/meta` hash; on drift, attempt rehydrate (re-translate tree → query); on failure → `status='broken'`.
5. POST `cube_query_json` to Cube `/cubejs-api/v1/load` with server-bootstrap JWT.
6. Extract `identity_dim` column, dedupe, JSON-encode → `uids_json`.
7. Set `status='ok'`, clear `last_error`; (v1.5: append row to `segment_size_history`).

### Owner / multi-tenancy

- v1: `owner` is a string read from `X-Owner` request header (set in FE from a `localStorage('gds-cube:owner')` or env). No login flow.
- Library list filters by owner unless `?owner=*` query.
- No row-level enforcement in v1 — a determined user can pass any owner header. Documented as dev-tool tradeoff.

## Data flow — "Save as segment"

```
[Results tab — query includes user_id dim mapped for primary cube]
  1. User checks N rows → action bar appears
  2. Clicks "Save as segment ▾" → modal opens (Create new tab default)
  3. Modal collects: name, mode (static | live), preset (auto-picked from primary cube)
  4. If live: warning that live segments inherit Playground predicate, not row selection
  5. POST /api/segments {
        name, preset_id, primary_cube, identity_dim, owner,
        predicate_tree_json: live ? translate(currentQuery.filters) : null,
        cube_query_json:    live ? currentQuery : null,
        uids_json: live ? [] : selectedRowIds,
        is_live: live, refresh_interval_sec: live ? 900 : 0
     }
  6. Server returns { id, status }
  7. Toast: "Segment created · View segment →" → navigates /segments → detail view
```

## Editor flow — live preview cycle

```
[User edits a leaf or toggles AND/OR]
  → debounced (500ms) POST /api/preview { tree, primary_cube, identity_dim }
    → server: translate(tree) → cube_query (with measures=[primary_cube.count])
    → call Cube /load with cohort-count query (LIMIT 1 returned aggregate)
    → call Cube /sql for the same query
    → return { estimated_count, cube_query, sql_preview }
  → editor's right rail updates: count + sparkline + SQL block
```

## v1 deliverable checklist (revised)

**FE — top-level**
- [ ] Header pill `/segments`
- [ ] `QueryBuilderResults` row-select mode (identity-dim gated, selection summary in modal)
- [ ] Push modal (Create new / Append to existing tabs)
- [ ] `/segments` library view (KPI tiles, search, type filter, sort, owner column, tags, broken-status surfacing)
- [ ] `/segments` detail view: 7 tabs — Overview/Engagement/Monetization/Retention/Sample users/Saved analyses/Predicate
- [ ] `/segments` editor view: visual AND/OR tree builder + live preview rail + cube browser + SQL preview
- [ ] Static/Live toggle + refresh interval picker
- [ ] Toast on segment creation
- [ ] Import IDs (CSV upload modal)
- [ ] Copy as filter (segment → Playground deeplink)
- [ ] Paste from query (Playground → editor)
- [ ] Owner header wiring (X-Owner from localStorage)

**FE — preset infrastructure**
- [ ] `presets/` registry + `mf-users-hub.ts` preset definition
- [ ] Preset-driven tab + card renderer (`<PresetTab spec={…}/>` style)
- [ ] KPI / line / bar / donut / barlist / table card components (existing recharts wherever possible)

**FE — Settings**
- [ ] Cube identity mapping section with auto-suggest

**Backend (`/server`)**
- [ ] Fastify bootstrap, SQLite init, migrations
- [ ] CRUD endpoints for segments + analyses + identity-map + presets list
- [ ] Predicate tree ↔ Cube Query translator
- [ ] `/api/preview` endpoint with Cube `/load` + `/sql` calls
- [ ] `/api/segments/import-ids` CSV parser + validator
- [ ] Cron worker + drift detection + status transitions
- [ ] Owner-header middleware (single-tenant pretend-auth)
- [ ] Vite dev proxy config + prod single-binary serve

**Cross-cutting**
- [ ] Unit tests: tree↔CubeQuery translator, identity-suggest, cron path, preview path
- [ ] Doc updates: `README.md`, `docs/system-architecture.md`, `docs/codebase-summary.md`

**Deferred to v1.5**
- [ ] Sparkline trend on library (needs `segment_size_history` accumulation + chart)
- [ ] "In use by N dashboards/MCP/savedViews" counters (needs cross-app hooks)
- [ ] Live-placement variants (banner / floating chip / all)
- [ ] Multi-preset support (more than `mf_users-hub`)
- [ ] Predicate baseline-compare overlay on preset charts (user picked this in v1 round but it now sits awkwardly with bespoke preset charts — defer until needed)
- [ ] Full multi-instance backend (advisory locks, externalize uid storage to Postgres)

## Risks (revised)

| Risk | Impact | Mitigation |
|---|---|---|
| Large segments (≥5k uids) blow up Cube `IN(…)` | Cron failures, broken status | v1 hard cap 5k uids; UI warning; document. |
| Predicate decay on YAML rename | Live refresh fails | `predicate_meta_version` drift detection + `status='broken'` UI; user re-saves via editor. |
| Tree predicate is less expressive than full Cube Query | Editor can't reproduce all Playground filters | Document supported subset; "Paste from query" warns on unsupported operators. |
| Editor live preview hammers Cube on every keystroke | Cube load spike | 500ms debounce + last-response caching + manual `Refresh preview` fallback. |
| Cron in-process — multi-instance double-fires | Duplicate writes | Documented single-instance assumption; add advisory locks if multi-instance ever needed (v1.5). |
| Owner-header pretend-auth is bypassable | Cross-user data leak in shared envs | Documented dev-tool tradeoff; add real auth as v1.5 if exposure widens. |
| Preset hardcoded for `mf_users` | Other schemas have no analysis tabs | v1.5 adds preset registry + per-org definitions. v1 falls back to Sample users + Predicate tabs only for non-`mf_users` cubes. |
| Saved-analysis Cube Query breaks on schema change | Stale pinned charts | Track `query_meta_version` per analysis; mark `status='broken'`. |
| `Import IDs` accepts malformed CSV | Backend crash / corrupt segment | Server-side validator: cap rows, dedupe, normalize to strings, reject non-UTF8. |

## Success metrics

- "Select 50 rows → segment created with Overview tab loaded" ≤ 5s against warm Cube.
- Editor live-preview latency ≤ 1.5s p95 from keystroke to count+SQL update.
- Cron tick processes 100 live segments in ≤ 2s.
- Zero crashes on Cube `/load` error — broken-status path covers all failure modes.
- 1 engineer ships v1 in **6–7 weeks** including tests + docs.

## Validation criteria

1. Select 50 rows from Results with `mf_users.user_id` in query → modal → create static segment → detail view loads with Sample users tab populated.
2. Create live segment from Playground predicate → wait one cron tick → FE polling shows refreshed count.
3. Open editor → drag AND→OR on root group → add leaf → live count + SQL preview update within 1.5s.
4. Rename a dim in Cube schema → next cron tick marks segment `broken` → UI banner offers "Edit predicate to fix".
5. Pin a chart from Playground to a segment → "Open in Playground" round-trip applies segment uid filter.
6. Import a 1000-row CSV → static segment created → Sample users tab shows random 50.
7. Click "Copy as filter" on a segment → Playground URL deeplinks with `filters=[{member:identity, op:'in', values:[…]}]`.
8. Owner header changes → library list reshuffles to current owner; segment from other owner not visible by default.

## Sequencing recommendation (revised, ~6–7 weeks)

Internal phase order (one delivery):
1. **Backend skeleton + schema + tree↔CubeQuery translator** (1.5 wk)
2. **FE row-select + push modal + segment Library list view + Members/Sample users tab** (1 wk)
3. **Settings identity mapping + auto-suggest + Import IDs** (4 d)
4. **Preset infrastructure + `mf_users-hub` preset + 4 preset tabs (Overview/Engagement/Monetization/Retention)** (1.5 wk)
5. **Visual predicate editor + live preview rail + SQL preview** (1 wk)
6. **Cron worker + live mode + FE polling + status transitions** (4 d)
7. **Saved analyses tab + Copy as filter + Paste from query round-trip** (4 d)
8. **Broken-status flow + drift detection + tests + docs** (3 d)

## Unresolved questions

None. All forks resolved across v1 (8 questions) and v2 (4 questions).

## Open trade-offs to revisit in v1.5

- Whether multi-instance + advisory locks become necessary (driven by deployment plans).
- Whether preset registry should externalize to YAML or stay in TS.
- Whether full auth (Better Auth or similar) is required (driven by team size + shared envs).
- Whether baseline-compare overlay survives preset-driven UI (might be redundant with bespoke charts).

## Next steps

- Optionally run `/ck:plan` against this report to produce phased plan files in `plans/260519-1610-query-results-to-segments/`.
- Otherwise this report stands as the design-of-record (v2).
