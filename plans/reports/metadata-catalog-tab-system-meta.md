# Metadata Catalog Tab — `/cubejs-system/v1/meta`-Driven Discovery Surface

**Date:** 2026-05-16
**Author:** khoi
**Status:** Superseded / pivoted — see `## Pivot Note (2026-05-16)` below
**Trigger:** Surface `/cubejs-system/v1/meta` content as a searchable, faceted catalog so Data Analysts can explore what already exists before building new metrics.

---

## Pivot Note (2026-05-16)

**This brainstorm is superseded.** Post red-team verification:

1. `/cubejs-system/v1/meta` **does not exist** on the target Cube backend. All `/cubejs-system/*` routes return 404 (probed empirically). The endpoint was assumed based on Cube docs that don't match this deployment.
2. The fallback (`/cubejs-api/v1/meta`) is missing the rich fields this design depended on across all 11 cubes / 58 measures / 215 dimensions:
   - `meta.*` populated: **0 / 0 / 0** → adaptive Tier 2 facets have no schema support
   - `measure.sql` populated: **0 / 58** → per-measure SQL snippets are impossible
   - `dataSource`, `preAggregations`, `joins[]`: **0 / 11** each → all corresponding facets impossible
   - Hidden members (`public: false`): **0 / 11** → schema doesn't use the flag

**Outcome:** Plan `plans/260516-1521-metadata-catalog-tab/` cancelled. New direction: enrich the existing Playground sidebar with a per-cube / per-measure details popover (~0.5 day work, fits inside `src/QueryBuilderV2/QueryBuilderSidePanel.tsx`). The catalog tab UX is fine — the data isn't ready for it.

The brainstorm content below is retained as historical record of the rejected design.

---

---

## TL;DR

New top-level nav pill **Metadata** (sibling of Playground + Models) → `/metadata`. Page fetches `/cubejs-system/v1/meta` once via a browser-signed HS256 JWT using `VITE_CUBE_API_SECRET` (env-baked, internal/localhost only). Renders a **faceted card grid** with adaptive filters that self-tune to the schema's `meta.*` conventions. Detail drawer surfaces SQL snippets, sibling measures, and joinable cubes to short-circuit metric duplication. No changes to `/build` or `/schema`.

---

## Problem Statement

A DA building a new metric today has no way to answer "does this already exist?" without grepping YAML or asking a teammate. `/cubejs-system/v1/meta` exposes everything — descriptions, owners, pre-agg coverage, joins, `meta` tags — but the playground only uses the JWT-scoped `/cubejs-api/v1/meta`, which hides `public: false` and lacks the same field depth.

Result: duplicated metrics, lost authorship context, stale definitions, and zero discoverability of existing work.

---

## Requirements

### Functional
- One-click access from main nav to a discovery surface.
- Fetch full schema (cubes, views, measures, dimensions, segments, joins, pre-aggs, refresh keys, `meta`) from `/cubejs-system/v1/meta`.
- Faceted filtering with adaptive facets driven by `meta.*` conventions.
- Search across cube + member names, titles, descriptions, `meta` values.
- Detail drawer per cube with member list, raw JSON, deep-link to Playground.
- Zero changes to existing `/build` and `/schema` pages.

### Non-functional
- Internal-tool / localhost posture. `VITE_CUBE_API_SECRET` baked at build time.
- Hard-disable the tab in `npm run build` artifacts via `import.meta.env.PROD` guard (recommended) — soften later if leadership asks.
- Client-side filtering/search OK up to ~500 cubes; virtualize beyond that (defer).

---

## Audience

Data Analysts exploring the schema to (a) build new metrics, (b) avoid duplicating existing ones, (c) find ownership for trust/escalation, (d) understand join topology for composite metrics.

---

## Architecture

### Auth & fetch path
```
Browser
  ├─ Read VITE_CUBE_API_SECRET (build-time env)
  ├─ Sign HS256 JWT { exp: now+1h } via `jose`
  │   └─ NOTE: try raw secret as Bearer first; if Cube accepts, drop the lib
  └─ GET /cubejs-system/v1/meta (via Vite proxy → :4000)
       Authorization: Bearer <jwt>
       ↓
     Full schema payload → in-memory cache → memoized selectors → UI
```

### Page layout
```
┌─────────────────────────────────────────────────────────────────┐
│ Header: nav pills [Playground] [Models] [Metadata*]             │
├──────────┬──────────────────────────────────────────────────────┤
│ Filter   │ ┌─ Search bar ─────────────────────────────────────┐ │
│ Rail     │ └──────────────────────────────────────────────────┘ │
│          │                                                       │
│ Tier 1   │ ┌─ CubeCard ─┐ ┌─ CubeCard ─┐ ┌─ CubeCard ─┐         │
│  Type    │ │ icon + name │ │  ...        │ │  ...        │         │
│  Source  │ │ description │ │             │ │             │         │
│  Joins   │ │ counts      │ │             │ │             │         │
│  Aggr.   │ │ owner chip  │ │             │ │             │         │
│  PreAgg  │ │ tag chips   │ │             │ │             │         │
│  Desc    │ └─────────────┘ └─────────────┘ └─────────────┘         │
│  Visib.  │                                                       │
│          │ ...                                                   │
│ Tier 2   │                                                       │
│  (auto)  │                                                       │
└──────────┴──────────────────────────────────────────────────────┘
                                              [DetailDrawer →]
```

### File layout

**New:**
- `src/hooks/use-system-meta.ts` — fetch + JWT sign + cache + refresh
- `src/hooks/system-meta-selectors.ts` — memoized facet derivation, filter, search
- `src/pages/Metadata/MetadataPage.tsx` — route entry, layout shell
- `src/pages/Metadata/FilterRail.tsx` — left facets (Tier 1 + auto-detected Tier 2)
- `src/pages/Metadata/SearchBar.tsx` — top fuzzy search
- `src/pages/Metadata/CatalogGrid.tsx` — card grid layout
- `src/pages/Metadata/CubeCard.tsx` — single card
- `src/pages/Metadata/DetailDrawer.tsx` — slide-in detail (members, SQL snippets, JSON, deep-link)
- `src/pages/Metadata/EmptyState.tsx` — no-secret / no-results / error
- `src/pages/Metadata/index.ts`

**Touched:**
- `src/components/Header/Header.tsx` — third NavPill `/metadata`
- `src/pages/index.tsx` — export `MetadataPage`
- Routes config (App.tsx or routes file) — register `/metadata`
- `vite.config.ts` — proxy `/cubejs-system → :4000`
- `.env.example` — `VITE_CUBE_API_SECRET=`
- `README.md` — env var + internal-only warning

**Dependency add (conditional):**
- `jose` for browser-side JWT sign. Test raw-secret-as-Bearer first; if Cube accepts, skip.

---

## Filter Rail Design (DA-optimized)

### Tier 1 — Always-on (Cube built-in fields, work for any schema)

| Facet | Why a DA cares |
|---|---|
| **Type** (cube / view) | Cubes = raw model, views = curated. Sets expectations. |
| **Data source** (auto-grouped from `dataSource`) | "Prod warehouse or events DB?" — affects join feasibility. |
| **Has joins** | Standalone vs. blendable into composite metrics. |
| **Aggregation type** (when filtering measures: `count` / `countDistinct` / `sum` / `avg` / `min` / `max` / `number`) | DAs find existing unique-user patterns by searching for `countDistinct` before recreating one. |
| **Has pre-aggregations** | Performance-tier filter for dashboard candidates. |
| **Has description** | Trust/completeness filter; undescribed cubes are landmines. |
| **Visibility** (public / hidden `public: false`) | Hidden = experimental/in-progress signal. |

### Tier 2 — Adaptive (auto-detected from `meta.*`)

Scan every cube + member's `meta` object. Any key appearing in **≥3 cubes** AND having **≤20 unique values** renders as a multi-select facet.

- Self-tunes to schema conventions without hardcoding.
- Zero conventions → only Tier 1 shows; no empty UI.
- Conventions added later → appear automatically next refresh.
- Rewards schema hygiene (good `meta.owner` / `meta.domain` / `meta.tag` discipline becomes visibly useful).

---

## Card Content (per cube/view)

- Type icon + name + title
- Type badge (cube / view)
- Description (1-line, truncated)
- Measure / dimension counts
- `meta.owner` chip (if present)
- Pre-agg count badge
- Public / hidden indicator
- Tag chips (top 3 from auto-detected meta values)
- Click → DetailDrawer

---

## DetailDrawer (P3) — DA-Building-Metrics Bonuses

Three additions that turn the catalog from "list" into "discovery":

1. **Per-measure SQL snippet** (collapsed by default) — DA sees what's actually computed, not just the name. Catches "this measure already does what I'm about to build."
2. **"Other measures in this cube of the same type" strip** — surfaces patterns ("3 other `countDistinct` measures here") before duplication.
3. **Joinable cubes chips** — clickable links to cubes this one joins to. Visualizes the topology.

Also in drawer: full member table, raw JSON tab, "Open in Playground" deep-link (with `public: false`-aware warning).

---

## Phasing

| Phase | Scope | Effort |
|-------|-------|--------|
| **P1** | env + JWT + Vite proxy + nav pill + bare card grid (no filters, no drawer) — validates auth path end-to-end | 1–2 days |
| **P2** | Top search + FilterRail with Tier 1 facets + adaptive Tier 2 detection | 1–2 days |
| **P3** | DetailDrawer with member list + SQL snippets + sibling-measure strip + joinable-cubes chips + Open-in-Playground deep-link | 1–2 days |
| **P4** | Polish: loading skeletons, error states, missing-env empty state, refresh button, PROD-guard | 1 day |

≈ **1 week focused work.**

---

## Tradeoffs

| Aspect | Win | Cost |
|--------|-----|------|
| Discoverability | DAs find existing metrics before duplicating | New page surface to maintain |
| Schema hygiene | Adaptive facets reward `meta.*` conventions visibly | Without conventions, only Tier 1 (still useful) |
| Auth simplicity | Env-baked secret + browser JWT sign — no backend | Secret leaks into bundle → must guard in PROD builds |
| Page isolation | Zero impact on `/build` and `/schema` | Some duplication of cube/member rendering |
| Performance | Single fetch + client-side filter/search | Won't scale past ~500 cubes without virtualization |

---

## Risks

1. **Secret leaks into bundle.** PROD guard (`import.meta.env.PROD` → hide tab) recommended in P1, not retrofitted. README warning + on-page banner reinforce.
2. **CORS** — needs Vite proxy entry for `/cubejs-system`. Trivial.
3. **Hidden members in Playground deep-link** — JWT-scoped `/build` queries will fail for `public: false`. Drawer flags this on the link.
4. **Schema scale** — virtualize beyond ~500 cubes (defer until measured).
5. **`jose` may be unnecessary** — test raw secret as Bearer first.

---

## Security Considerations

- `VITE_CUBE_API_SECRET` env value is **client-readable** once built. This page is designated **internal/localhost only**.
- Default PROD guard: `if (!import.meta.env.PROD) registerMetadataRoute()`. Inverting this in prod requires an explicit code change — friction by design.
- On-page banner: "Internal tool — secret embedded in client JS. Do not share this URL or expose this build."
- No new server-side surface, no new auth model — same posture as the existing JWT field.

---

## Success Criteria

- DA can open `/metadata` and within 30 seconds find every cube/view in the schema.
- DA can filter by aggregation type, data source, and any present `meta.*` convention.
- DA can search across all member names/descriptions/tags.
- DA can click into a cube and see SQL for every measure.
- DA can identify joinable cubes and open one of them in the same drawer flow.
- Existing `/build` and `/schema` behaviors unchanged.

---

## Reference

- Cube docs — system meta: https://cube.dev/docs/reference/rest-api#system-endpoints-meta
- Related prior docs in this repo:
  - `plans/reports/poc-scoping-and-leadership-decisions.md` § 5.3 — Catalog / discovery (Layer 5) — first call-out of `/cubejs-system/v1/meta` as catalog source
  - `plans/reports/cube-vs-cdp-metrics-architecture.md` — option #2 (system-meta polling) for schema sync

---

## Open Questions

1. PROD guard now or later? (Recommended: now — easier to soften than retrofit.)
2. Drop "Open in Playground" from P3 to ship leaner v1?
3. Drop the JWT-sign step entirely if Cube accepts raw secret as Bearer — needs one curl test against your backend.
4. Should the Metadata tab also surface `refreshKey` / last-known refresh time per pre-agg? Not in v1 scope, but cheap addition in P3 if DAs ask.
5. Future: lineage view (cube → upstream tables via `sql_table` / `sql`) — out of scope for v1, worth flagging as Phase 5.
