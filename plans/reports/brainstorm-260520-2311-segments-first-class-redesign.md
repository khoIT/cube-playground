# Brainstorm Report — Segments first-class redesign (VNGGames Player Hub DS)

**Date:** 2026-05-20 23:11 (Asia/Saigon)
**Owner:** khoitn@vng.com.vn
**Persona:** LiveOps manager
**Surfaces:** Playground (entry) → New Metric → Catalog → **Segments** (showcase)
**Design system:** VNGGames Player Hub (shadcn neutral foundation + orange #F05A22)
**Status:** Draft — pending user approval

---

## 1. Problem statement

Today `/segments` reads as a generic admin list — 4 fat KPI tiles, a long toolbar, a flat table. The page does not tell the LiveOps story: "after I explore in Playground, I create a cohort, watch it stay fresh, push it to CDP so push-noti / CRM / A/B tools can consume it." Activation (the step that makes a segment *useful* outside this tool) is invisible.

Symptoms on the current Library:
- **KPI strip eats ~140 px** of the most valuable header real estate. Three of the four KPIs duplicate signal already shown elsewhere (Live/Static in filter pills, Total UIDs in row sizes). The fourth ("In use") is hardcoded 0 with a `v1.5` tag — foreshadowing a feature that does not exist.
- **No destination visibility** — every segment looks alike; you cannot tell which ones are wired to CDP.
- **No lifecycle health** — no aggregate of "broken", no last-refresh-age, no push history.
- **Detail page has 7 sibling tabs** that mix preset analytics (overview/engagement/monetization/retention) with system-of-record concerns (predicate/sample-users/saved-analyses). Refresh + push history have nowhere to live.

Adjacent surfaces (Catalog, New Metric) feel disjoint from Segments because the foundation tokens are aligned-but-not-identical to the target DS and microcopy is inconsistent (mixed title/sentence case, decorative emoji elsewhere in the codebase).

---

## 2. Goals & non-goals

### Goals
1. **Introduce Game-Context** as a first-class, app-wide concept that filters Playground cubes, Catalogue/Metrics, YAML schema, Segments and Activation targets.
2. Compact Library header — remove the 4-tile strip, surface counts inline in filter pills.
3. Make the **liveops lifecycle visible**: define → monitor → activate-to-CDP.
4. Add **Destinations** as a first-class concept on every segment row + a dedicated Activation tab on Detail.
5. Align all surfaces to VNGGames Player Hub DS (tokens audit + pill buttons + sentence case + Lucide-only icons).
6. Make Catalog + New Metric **game-aware** (filter + look-and-feel pass).
7. Lay out a **Playground v3 direction sketch** to be deep-brainstormed in a follow-up session.

### Non-goals (this phase)
- Building the CDP push backend wiring (we ship the UI + data shape; backend lives in a later phase).
- Playground v3 full restructure (deferred to its own brainstorm).
- Identity-map workflow change (carry the existing page, re-skin only).
- Mobile/responsive polish below 992 px.
- Dark mode rollout (DS supports it; tokens already invert; ship in a follow-up).
- Multi-game *concurrent* views (one game active at a time; switching games re-scopes the app).

---

## 3. Persona & lifecycle model

**LiveOps manager**: runs campaigns inside the gaming title. Wants a stable cohort definition that auto-refreshes, that downstream CDP-driven systems (push-noti, CRM, A/B test) can consume by name.

```
   ┌───────────┐   select rows /   ┌───────────────┐   refresh   ┌──────────────┐
   │ Playground│ ─── aggregate ──▶ │ Push Modal    │ ─ policy ─▶ │  Segment     │
   │  /build   │                   │ create static │             │  (def + UID  │
   └─────┬─────┘                   │ create live   │             │   list)      │
         │                         │ append        │             └──────┬───────┘
         │                         └───────────────┘                    │
         │                                                              │
         │                                                  ┌───────────▼──────────┐
         │                                                  │  Library Monitor     │
         │                                                  │  size · health ·     │
         │                                                  │  destinations · age  │
         │                                                  └───────────┬──────────┘
         │                                                              │
         │                                                  ┌───────────▼──────────┐
         │                                                  │  Activate to CDP     │
         │                                                  │  (POST MM-01         │
         │                                                  │   /cdp/v1/metrics)   │
         │                                                  └───────────┬──────────┘
         │                                                              │
         │                                                  ┌───────────▼──────────┐
         └────── recall as filter ◀────── consumers ────────│ CDP downstream:      │
                  in Playground                             │  push-noti, CRM,     │
                                                            │  A/B cohort          │
                                                            └──────────────────────┘
```

Every screen we touch must make its position in this loop legible.

---

## 3.5 Game-Context foundation (cross-cutting)

`game_id` becomes an **app-level scope** that filters every data surface. One game active at a time; switching games re-scopes Playground, Catalog, Metrics, Segments, Activation.

### 3.5.1 UX
- **Game picker** in the Header, immediately right of `BrandBlock`, before the nav-pill row. Player Hub `Dropdown` chip showing the active game with the game's mark/logo. Sentence-case label e.g. `Playing Together · ptg`.
- Switching games:
  - Routes preserved (you stay on `/segments` when switching from `ptg` → `lin`).
  - Page state is invalidated and re-fetched with new `gameId` filter.
  - Toast: `Now showing data for {gameName}`.
- Persisted in `localStorage` (key `gds-cube:active-game`) + reflected as `?game=` URL param so deep-links carry game context.

### 3.5.2 Effects per surface

| Surface | Effect |
|---|---|
| **Playground** (`/build`) | Cube picker filtered: only cubes whose schema lives under the active game's namespace. Loading a saved query with a different game prompts to switch. |
| **Catalog** | Cube cards filtered. Metric cards filtered. `/catalog/models` becomes per-game. |
| **New Metric** | Wizard pre-fills `game_id`; source-cube picker is game-scoped. |
| **Segments** | Library list scoped to active game. Editor cube picker scoped. Identity-map scoped. |
| **Activation** | `game_id` auto-filled from active context; modal field shown read-only with "switch game" link. |

### 3.5.3 Game registry (source of `games`)

Options (decision pending — see §16):
- **Option A — Static config**: `gds.config.json` enumerates games (`{ id: 'ptg', name: 'Playing Together', cubeNamespace: 'ptg' }`). Cheap. New game = config edit + redeploy.
- **Option B — Derive from Cube schema dirs**: scan `schema/<gameId>/*.yml` at server startup. Zero config drift. Requires schema directory convention.
- **Option C — MM-01 companion endpoint** `GET /cdp/v1/games`: not in the spec yet, but the cleanest long-term home. Out of scope to add to MM-01 in this phase.

### 3.5.4 Data model
- **Segments**: add `game_id` column to `segments` table. Migration backfills all existing rows with the default game. List endpoint accepts `?game_id=` filter.
- **Catalog/Metrics**: server already serves Cube meta — augment `/playground/files` (or wherever the schema is exposed) with a `gameId` query param.
- **JWT (future)**: when auth introduces game-scope, AppContext reads `gameId` from token and the picker becomes a read-only badge.

### 3.5.5 Risk
- Switching games while a Playground query is in-flight: cancel + reset, don't try to merge.
- Existing segments with `game_id = null` (pre-migration): show in an "Unscoped" bucket; backfill UI in Library to assign a game.

---

## 4. Design system mapping (VNGGames Player Hub)

### 4.1 Token audit (token-by-token delta vs `src/theme/tokens.css`)

| Token | Current | DS target | Action |
|---|---|---|---|
| `--orange-700` | `#c2410c` | `#f54a00` | **align** (pressed-state mismatch — current is darker) |
| `--success` | `#009688` | `#059669` (`--emerald-600`) | **align** (current is teal, DS is emerald) |
| `--font-sans` | `Geist` | `Inter` (body) / `Geist` (alt) / `League Gothic` (display) | **expand** to two-stack + display |
| `--radius-pane` | `14px` | not in DS | **keep** as Playground-only |
| Chart palette | scattered | `--chart-1..5` (orange/blue/teal/amber/violet) | **add** |
| Button radius | `8px` default | pill (`9999`) per DS | **flip** to pill via `theme/antd-overrides.css` |
| Display headings | n/a | `text-h1..h4` League Gothic | **add** classes — used in page titles + empty states |

Net token edits ≈ 6 lines. Zero structural disruption.

### 4.2 Microcopy rules to enforce
- **Sentence case** everywhere ("Add segment", not "Add Segment").
- **No emoji**, ever (audit existing strings — there are a few).
- **No unicode arrows as type** — Lucide `ArrowRight`, `ChevronRight`.
- **Voice**: declarative, single-sentence descriptions (Player Hub style).

### 4.3 Component re-use map

| Surface | Existing | Player Hub component |
|---|---|---|
| Filter pills | `LibraryToolbar` filterTabs | `Tabs` (pills variant) |
| Status badge | `StatusPill`, `LiveBadge` | `Badge` (success/warning/destructive/info) |
| KPI tiles | `KpiTile` | **deprecated for Library** / `Card` for Detail Monitor |
| Buttons | antd `Button` | Player Hub `Button` (pill, primary/neutral/outline/ghost/destructive) |
| Modal | antd `Modal` | Player Hub `Dialog` (shadow-xl, 16px radius) |
| Table | bespoke grid | bespoke grid (re-skin only — antd Table inertia too high) |
| Icons | mostly `lucide-react` | **exclusive** Lucide (audit Ant icons) |

---

## 5. Library page redesign

### 5.1 Before / after (ASCII)

**Before** (current — ~340 px before table starts):
```
┌──────────────────────────────────────────────────────────────────┐
│ Segments                                                          │
│ Persistent cohorts built from Playground results or predicates.   │
│                                                                   │
│ ┌─LIVE──────┐ ┌─STATIC────┐ ┌─TOTAL UIDS─┐ ┌─IN USE────┐         │
│ │ 7         │ │ 3         │ │ 15.9k      │ │ 0   v1.5  │         │
│ └───────────┘ └───────────┘ └────────────┘ └───────────┘         │
│                                                                   │
│ [Search…]  All | Live | Static  [Sort ▾]    [⚙][Import][+ New]   │
│ ─────────────────────────────────────────────────────────────────│
│ SEGMENT  TYPE  LAST REFRESH  SIZE  TREND  OWNER                  │
└──────────────────────────────────────────────────────────────────┘
```

**After** (~140 px before table starts):
```
┌──────────────────────────────────────────────────────────────────┐
│ Segments                                  [Import]  [+ New segment]│
│ 10 segments · 15.9k users · last refresh 12m ago                  │
│                                                                   │
│ [All 10] [Live 7] [Static 3] [Broken 0]   [Search…]  [Sort ▾]  [⚙]│
│ ─────────────────────────────────────────────────────────────────│
│ Segment / cube           Health    Size    Trend    Used in  Owner│
│ ────────────────────────────────────────────────────────────────  │
│ High-LTV VN players      ● Fresh  82.4k  ▁▃▅▇▅▄   → CDP    khoi  │
│ monetization_summary     Live 15m         ↑2.1%    push-noti       │
│                                                                   │
│ Whales Q2 2026           ● Static 12.0k    —        —      khoi   │
│ monetization_summary                                              │
│                                                                   │
│ Reactivation 30d         ⚠ Broken  0     —        —       linh   │
│ player_lifecycle         dim removed                              │
└──────────────────────────────────────────────────────────────────┘
```

### 5.2 What changes
1. **Title block** — kept terse. Subtitle replaced by a one-line meta (`{n} segments · {totalUids} users · last refresh {ago}`). Inter 13 px, `--muted-foreground`.
2. **Action cluster** moves up to the title row right side. `+ New segment` is the primary pill (orange). `Import` is outline. `⚙ Identity` moves into the toolbar overflow (icon-only Lucide `Settings2` button).
3. **KPI strip removed.** Counts surfaced on filter pills (`All 10` etc.). Aggregate uid count moves to meta line. "Broken" promoted to a filter pill so health is one click away.
4. **New column: Used in** — destination chips. Reads from `segment.activations[]`. Empty cell = "—" (no decorative dash, just neutral).
5. **Health column** consolidates current Type + Status — `Fresh / Stale / Broken / Static` with semantic colored dot (success/warning/destructive/muted) + secondary line for the live cadence or broken reason.
6. **Trend** — sparkline (7-day uid count) rendered from a new lightweight history endpoint. If unavailable, render `—` (no skeleton noise).
7. **Row click area** unchanged (whole row).

### 5.3 Why this lands
- Saves ~200 px above-the-fold → 5–6 more rows visible at standard 900 px viewport.
- KPI signal preserved (filter-pill counters + meta line) without dedicating a strip.
- Destinations + Health make this a *monitoring* surface, not just a list.

---

## 6. Detail page redesign (5 tabs)

### 6.1 Tab strip
```
[ Monitor ]  Insights  Members  Definition  Activation
```

| Tab | Owns | Replaces |
|---|---|---|
| **Monitor** (default) | Size trend chart, refresh history, broken-state banner, "last push" timeline | current `Overview` for non-preset segments, plus surfaces previously orphaned |
| **Insights** | Preset-driven cards. Sub-pills inside: Overview · Engagement · Monetization · Retention. Saved Analyses appears as a "Pinned analyses" strip at the bottom. | current 4 preset tabs + `Saved Analyses` |
| **Members** | Sample users table + Export IDs | current `Sample Users` |
| **Definition** | Predicate tree (read-only by default, edit button), Identity field, Refresh cadence, source query / cube | current `Predicate` |
| **Activation** | Destinations list (CDP / future systems), per-destination status + last push time, **Activate to CDP** primary CTA, push history per destination | **new** |

Tab persistence via `?tab=monitor` URL param. Old tab IDs → mapping table so deep-links from the existing UI keep working.

### 6.2 Monitor tab anatomy (default landing)

```
┌─────────────────────────────────────────────────────────────────┐
│ Size trend (7d)                                  [7d ▾] [Export]│
│  82.4k  ↑ +2.1% vs last week                                    │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  ▁▂▂▃▄▅▆▇▆▅▆▇▆▇  (chart-1 orange line, area below)         ││
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│ Refresh history                                                  │
│  12m ago    ✓ success   82,412 users  +1.2k       [view diff]   │
│  1h12m ago  ✓ success   80,701 users  +0.8k                     │
│  2h12m ago  ✓ success   79,900 users  −0.1k                     │
├─────────────────────────────────────────────────────────────────┤
│ Activation summary                                               │
│  → CDP · ptg · prod        active     last push 12m ago         │
│  → CDP · ptg · stag        active     last push 12m ago         │
│  [+ Activate to CDP]                                            │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 KPI tiles on Detail
**Stay**, but compacted — Detail is where the at-a-glance dashboard pattern is *appropriate* (single-cohort focus). 4 tiles → 4 cards at 72 px height (current ≈ 100 px). Tiles render preset `headlineKpis` when a preset matches; fall back to Size / Last refresh / Owner / Status.

---

## 7. Editor redesign (workspace)

3-column workspace replaces current flat editor-view.

```
┌───────────┬─────────────────────────────────────┬──────────────────┐
│ Steps     │  Step body                          │  Live preview     │
│           │                                     │                   │
│ ● Identity│  Identity field                     │  Est. size        │
│ ○ Predicate│  [user_id ▾]                       │  ~82,400 users    │
│ ○ Refresh │  cube monetization_summary          │  ┌──────────────┐ │
│ ○ Activate│                                     │  │ ▂▃▅▇▆▅▆▇      │ │
│           │                                     │  └──────────────┘ │
│           │                                     │  drift vs saved   │
│           │                                     │  +0.2%            │
│           │                                     │                   │
│           │  [Back]              [Continue →]   │                   │
└───────────┴─────────────────────────────────────┴──────────────────┘
```

- **Left rail** 256 px: step list with check/active/inactive state. Identity-map enters here as a *sub-action* link ("Edit identity map →" opens the existing page in a side dialog or full-page).
- **Center**: active step content. Predicate step reuses existing `predicate-builder/`.
- **Right rail** 288 px: live size estimate from a sample Cube query, + drift vs saved baseline.

Identity-map standalone route stays for direct deep links but is no longer the primary entry.

---

## 8. Push modal — Activate to CDP

### 8.1 Modal layout

Three tabs (was two):
```
[ Create new ]  Append to existing  Activate to CDP
```

Activate-to-CDP body, derived from segment + Cube context:

| Field | Source | Editable? |
|---|---|---|
| `metric_name` | `segment_<slug>_member` from segment.name | yes — derived default |
| `metric_codename` | same as `metric_name` | yes |
| `source` | derived: `game_integration.bi_<game>.<materialized_segment_table>` | yes |
| `expression` | `COUNT(DISTINCT <identity_field>)` | hidden / advanced |
| `filter` | server-side translate `predicate_tree` → SQL | hidden / advanced |
| `dimensions` | multiselect from cube dims (`server_id`, `platform`) | yes |
| `game_id` | from app context (selected game) or dropdown | required |
| `environment` | radio: dev · stag · prod | required |
| `materialize` | checkbox | default false |
| `schedule` | cron input, visible when `materialize=true` | required when materialize |

Submit calls `POST /cdp/v1/metrics` (MM-01). On 200, append to `segment.activations[]`:
```ts
type Activation = {
  id: string;                    // synthetic
  destination: 'cdp';            // future: 'cdp' | 'crm' | 'push-noti'
  game_id: string;
  env: 'dev' | 'stag' | 'prod';
  metric_name: string;
  registered_at: string;
  last_pushed_at: string | null;
  status: 'active' | 'failed' | 'pending';
  last_error?: string;
};
```

### 8.2 Status surfacing
- **Library row**: chip cluster — one chip per destination, e.g. `→ CDP · prod`. Stacked when >2 → overflow `+2 more`. Failed activations get destructive red dot.
- **Detail Activation tab**: full list with last push, push history rows, re-activate / deactivate actions.

### 8.3 Why design now, build later works
The data model lives on the Segment record (no new backend table) → backend can ship a stub `activations: []` field today. UI renders empty-states cleanly. When the CDP wiring lands, only the activation modal submit handler + a `POST /segments/:id/activations` proxy need to flip from stub to real.

---

## 9. Identity-map page

Re-skin only. Keep route. Add a "Used by N segments" header chip linking to a filtered Library view. Page header inherits new sentence-case title + meta-line pattern.

---

## 10. Catalog + New Metric (look-and-feel pass)

| Item | Action |
|---|---|
| Headings | sentence case audit |
| Buttons | pill radius (DS) — via `antd-overrides.css` |
| Cards (cube cards, metric cards) | `--radius-lg 10px`, `--shadow-sm`, 24 px content padding |
| Icons | audit for Ant icons, swap to Lucide |
| Chart palette | rotate to `--chart-1..5` |
| Empty states | flat neutral panels, no decorative imagery, Player Hub-style microcopy |
| Page title | `text-h4` (Inter Semibold 20–24px), no League Gothic display unless hero |

No information-architecture change. Estimated ≤300 LOC across both surfaces.

---

## 11. Playground v3 — direction sketch (deep work deferred)

This brainstorm does **not** lock Playground v3. Sketch only:

**Direction**: Treat Playground as the **explore-and-launch** surface for liveops. Today it is a generic query builder. Add explicit liveops affordances without redesigning the query builder core yet:

1. **Persistent journey breadcrumb** at the top of results: `Explored → [Save as segment] → Activate`. Greys later steps until prereqs met. Sets liveops as the dominant story.
2. **Promote segments-save-bar** out of the results footer into a sticky right-edge launcher card when ≥1 row selected. Card titled `Ready to save N users as a segment`.
3. **Recent segments rail** — collapsible side panel on the Playground showing the last 5 segments the user opened/created, with "recall as filter" button (existing functionality, just promoted).
4. **Cube picker chrome** — DS pill chips, Lucide icons.
5. **Defer**: pane layout, filter chrome, measure picker, drilldown — these are the deep restructure work.

Output of this brainstorm: a 1-pager note that becomes the seed for `/ck:brainstorm` Phase 3 session.

---

## 12. Phased plan (proposed)

| Phase | Scope | Est. LOC | Surfaces touched |
|---|---|---|---|
| **P0 — Token audit** | `tokens.css` align (orange-700, success, fonts), pill button override, add `--chart-1..5`, audit copy/emoji/Ant-icons | ~120 | all |
| **P0a — Game-Context foundation** | Header game picker, `AppContext.gameId` + localStorage + URL param, game registry source, `?game_id=` filter on segments/catalog list endpoints, migration: add `game_id` column to `segments` table | ~600 | Header, AppContext, server routes, migrations, library |
| **P1 — Library compaction + sparkline** | Drop KPI tiles, meta line, filter-pill counts (+ Broken), Health column, Used-in chips column, **new `segment_refresh_log` table + sparkline column**, sentence-case sweep | ~550 | `library/*`, server `db/migrations/004-refresh-log.sql`, refresh-segment job writes log row |
| **P2 — Activation data model + stub** | Add `activations[]` to Segment type + API client + library row chips + empty-state Activation tab | ~250 | `types/`, `api/`, `library/`, `detail/` |
| **P3 — Detail 5-tab restructure** | New Monitor tab (size trend from refresh log, refresh history, activation summary), Insights tab with sub-pills, URL param mapping | ~600 | `detail/*` |
| **P4 — Editor workspace** | 3-column layout (steps rail, content, live preview), preview-size query | ~500 | `editor/*` |
| **P5 — Push-modal Activate to CDP tab + predicate→SQL** | Third tab, field-derivation logic, **new `server/src/services/predicate-to-sql.ts`**, MM-01 client, segment.activations[] append on success | ~600 | `push-modal/`, new `api/cdp-metrics-client.ts`, server services |
| **P6 — Catalog + New Metric game-aware polish** | Look-and-feel pass + `?game_id=` filter applied to cube/metric listing | ~400 | `Catalog/*`, `QueryBuilderV2/NewMetric/*` |
| **P6.5 — Dark mode pass** | Audit components for dark-mode regressions, ship `.dark` token verification | ~150 | all |
| **P7 (separate brainstorm) — Playground v3** | Journey breadcrumb, recent-segments rail, sticky save card | TBD | `Explore/*`, `QueryBuilderV2/*` |

P0–P6.5 in this brainstorm's plan. P7 is the follow-up.

**Sequencing dependency**: P0a (game context) MUST land before P1 (library), P3 (detail), P5 (activation), P6 (catalog/metric polish) — those all depend on `gameId` scoping. P0 (tokens) is parallel-safe with P0a.

---

## 13. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| KPI-tile removal upsets stakeholders who used the dashboard feel | M | Filter-pill counters + meta line preserve signal; surface aggregate strip on Detail Monitor instead |
| 7→5 tab consolidation breaks bookmarks | L | URL param mapping table for legacy `?tab=overview` → `?tab=insights§ion=overview` |
| MM-01 backend not ready → Activate fails silently | H | Ship Activate tab disabled with explanatory empty state behind a feature flag; only enable when backend reports ready |
| Token re-alignment shifts pixel-perfect screenshots | L | Visual diff sweep in P0 PR; baseline screenshots captured pre-merge |
| Pill button radius cascades into unintended components (modal close, segmented controls) | M | Scope override via selector specificity in `antd-overrides.css`; explicit allow-list of components |
| Playground deferred → user perceives "first class" only in Segments | M | P0 + P6 polish carries the brand consistency story across all surfaces; deep Playground v3 is a clearly-named next phase |
| Identity-map page neglect | L | Re-skin in P1 alongside Library; no structural change |

---

## 14. Success criteria

1. Library above-the-fold height (title to first row) ≤ 160 px (current ≈ 340 px).
2. Every Library row shows lifecycle health (one of Fresh / Stale / Static / Broken) at a glance — usability test with 1 liveops user.
3. Every segment row shows destinations OR a clear empty state.
4. Detail Monitor tab is the default for ALL segments (including those without a preset).
5. Activate-to-CDP flow renders end-to-end (modal opens, validates, submits — backend may stub a success).
6. Catalog + New Metric pass a DS audit: pill buttons, sentence case, Lucide icons, no emoji.
7. Token audit PR (P0) ships under 200 LOC.

---

## 15. Decisions captured

| Decision | Choice |
|---|---|
| KPI density (Library) | Drop tiles, inline counts on filter pills |
| CDP push timing | Design now, build later (stub) |
| Output artifacts | Design report (this) + HTML hi-fi prototype via `/huashu-design` + `/ck:plan` |
| Surfaces in scope | Playground (deferred to P7) · NewMetric · Catalog · Segments (full) · Identity-map · **Game Context (new foundation)** |
| Detail tab count | 5 — Monitor · Insights · Members · Definition · Activation |
| Activation persistence | Embedded `activations[]` on Segment record |
| Playground depth | **Direction sketch in this brainstorm, full rethink in a separate Phase 7 brainstorm** |
| Detail KPI strip | Kept on Detail, compacted to 72 px |
| Identity-map | Re-skin only this phase |
| **Game-id source for activation** | **Derived from app-level Game Context (Header picker). Modal shows read-only.** |
| **Predicate-tree → SQL** | **Server-side, new `server/src/services/predicate-to-sql.ts`** |
| **Trend & history** | **`segment_refresh_log` table in P1, sparkline rendered immediately (`—` for first 7 days post-deploy)** |
| **Dark mode** | **P6.5 follow-up phase, not P0** |
| **Refresh history retention (default)** | Last 50 rows on Monitor tab, table page-able |
| **`metric_name` convention** | `segment_<kebab-slug>_member` (lowercase, `[a-z0-9_]`, ≤ 64 chars) — derivable, editable in advanced mode |
| **Activations max per segment** | No hard cap; library row chip cluster overflows to `+N more` past 2 |

---

## 16. Remaining open questions (non-blocking)

1. **Playground v3 brainstorm timing** — Schedule the P7 brainstorm session: next sprint, or further out?
2. **League Gothic** as page-title display font — confirm with the design owner. Default if no decision: skip League Gothic, use Inter Semibold 20–24 px for page titles. (Player Hub spec lists it for display headings but our product UI is dense — display type may feel performative.)

## 17. Game registry seed (locked)

`gds.config.json` (committed to repo):

```json
{
  "games": [
    { "id": "ptg",       "name": "Playing Together",  "cubeNamespace": "ptg" },
    { "id": "ballistar", "name": "Ballistic Hero",    "cubeNamespace": "ballistar" },
    { "id": "cfm_vn",    "name": "Cross Fire Legend", "cubeNamespace": "cfm_vn" },
    { "id": "jus_vn",    "name": "Nghịch Thuỷ Hàn",   "cubeNamespace": "jus_vn" }
  ],
  "defaultGameId": "ptg"
}
```

P0a tasks:
- Server exposes `GET /playground/games` reading this config.
- AppContext exposes `gameId` + `games[]` + `setGameId(id)`.
- Migration `004-game-scoping.sql`: `ALTER TABLE segments ADD COLUMN game_id TEXT NOT NULL DEFAULT 'ptg';` (backfill all NULL → `ptg`, first registered game).
- `segments` list endpoint accepts `?game_id=` and defaults to active context.
- Header inserts `<GamePicker />` between `BrandBlock` and `PillRow`. Shows active game's `name` + chevron, opens Player Hub `Dropdown`.

---

*Report generated for `/brainstorm`. Next steps offered to user: (a) generate hi-fi HTML via `/huashu-design`, (b) produce phased implementation plan via `/ck:plan`, (c) write journal entry via `/ck:journal`.*
