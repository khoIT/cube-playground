# PRD — Cube Product Layer: Catalog + Exploration + Proactive/AI Surfaces

**Status:** Draft for design handoff — revised 2026-05-19 10:18 (two-layer model: Metrics + Data Model)
**Date:** 2026-05-19 19:30 (original) · 2026-05-19 10:18 (revision §1.1, §5.1, §5.2, §5.4, §6, §11, §13, Open Questions)
**Owner:** khoitn
**For:** Enterprise UI design (Claude Design)
**Source documents (read these first):**
- `metric-mapping-260519-poc-gds-vs-cubes.md` — POC scope, 21 of 53 GDS metrics, 4 cubes
- `research-260518-1841-product-gaps-non-tech-question-flow.md` — v2 product-gap analysis
- `research-260519-1900-product-layer-sota-validation-and-feature-brainstorm.md` — SOTA validation + 12 missing surfaces

---

## 0. Purpose of this PRD

Design brief for an integrated **metric catalog + exploration scaffold + proactive/AI surface** layered on top of the existing Cube semantic layer (YAML) and the existing Cube Playground UI in this repo.

This is **not** a new app. We are extending the existing Playground with new surfaces and modifying three existing ones (Catalog, Explore, New Metric Wizard). Designer needs to know both what is new *and* how it integrates with what is already shipped.

---

## 1. Product vision

> **"From business word to trusted number, in three clicks or one sentence — without writing SQL."**

A non-technical game-ops person opens the product, types "whales in VN" or speaks the question to a chat box, finds the right **metric** with its plain-English definition, compares to last week with one click, saves the view to a Slack digest, and gets a notification tomorrow when the number moves more than usual.

The platform is the same one a data analyst uses to *author* new metrics (and the building blocks they're made from) and the same one Liveops/MCP/CDP read from. **One vocabulary, three audiences (consumer / author / system), tightly integrated surfaces.**

### 1.1 Architecture: two layers, one product

Compass is **a metric layer on top of a semantic layer**. Two tabs, one product:

| Layer | Tab | Audience | What lives here | Source of truth |
|---|---|---|---|---|
| **Metric layer** | **Metrics** (default) | Liveops / Growth / Finance / PM (consumers) | Named business metrics (DAU, Revenue, ARPU, LTV(n), Paying Rate…). Each has a plain-English definition, unit, formula, owner, certified badge. Formula is a recipe that composes **other metrics** and/or **building blocks**. | A user-managed metric registry (Postgres or YAML side-file). Seeded from GDS-1.8 reference glossary; users curate per game/tenant. |
| **Data Model layer** | **Data Model** | Authors / DAs / power users | Cube primitives: measures, dimensions, segments — the building blocks metrics are composed from. | The cubes published in `cube/model/cubes/*.yml`, exposed via `/cubejs-api/v1/meta`. |

The **Metrics tab is the consumer surface.** Most non-tech users never leave it. They search by business name, open the metric, see the formula in plain English, run it in Explore.

The **Data Model tab is the author/power-user surface.** It surfaces what's exposed via `/cubejs-api/v1/meta` and is where DAs maintain measure/dimension/segment vocabulary. This is roughly what the existing `/catalog` (concept-first grid + filter rail + tabs) already solves well — we extend it, we don't rebuild it.

**Why this split:** Liveops thinks *"what's our DAU?"*, not *"give me the measure `active_daily.dau`."* A GDS metric like **PU(7)** isn't a single Cube member — it's a composition (`user_recharge_daily.paying_users` + 7-day filter). Without a metric layer, PU(7) doesn't appear in the catalog at all. With it, PU(7) is a first-class card whose formula references the underlying measure.

### What we are building, named honestly

A **metric registry + catalog** (industry term) integrated with an **exploration scaffold** (BI term) and a **proactive surface** (digest/anomaly), on top of the Cube semantic layer. Differentiators vs Atlan/Cube Cloud Catalog: (a) two-layer model — metric layer above semantic layer, not just a wrapper on warehouse tables, (b) authoring loop closes back to YAML (data model) *and* the metric registry (metric layer), (c) clicking a metric opens Explore in the same surface, not a side-car docs page.

### What we are NOT building

- Not a new BI tool replacing Tableau/Looker.
- Not a warehouse data catalog replacing Atlan/Collibra.
- Not an autonomous AI analyst (that's a Phase 4 stretch goal).
- Not a dashboard builder for marketing/exec users — we have one (Metric detail + saved views).
- Not a static GDS-1.8 viewer. GDS-1.8 is a **seed reference**, not the source of truth — users manage their own metric configs per game/tenant.

---

## 2. Personas (compressed)

| Persona | Primary goal | Pain today | Success looks like |
|---|---|---|---|
| **Liveops/Campaign Manager** | Build tomorrow's push audience, size it, export IDs | Asks DA, waits a day, gets a one-off SQL result they can't re-run | Finds `whales` + `lapsed_payer_14d` in 30s, gets size + ID list, saves the audience for next week |
| **Growth/UA Marketer** | Compare channel performance, track WoW % | Each new channel cut is a fresh ticket | One verb-chip away from "by channel", "vs last 7d", "by country" |
| **Product Analyst / PM** | Cohort retention, payer-tier banding, ARPPU breakdowns | Pulls from 3 dashboards into a deck | Single metric card with sample-question, formula, lineage, sliced view |
| **Finance / Exec** | MTD vs prior, revenue splits, glanceable | Dashboard takes 6-10s to load | KPI digest in Slack/email Monday morning |
| **Data Author (DA / DE)** | Publish new measure / dimension / segment | Wizard emits YAML only — vocabulary work happens nowhere | Wizard's last step captures label + description + synonyms + sample-question, auto-seeds catalog |
| **Data Engineer** | Author cube YAML, manage refresh SLAs | Untouched by this PRD | (out of scope for v0) |

(See `research-260519-1900` §1 for the long form of each persona and which of the 13 business-case questions map to each.)

---

## 3. Six user modes the product must serve

| # | Mode | Where the user is | Surface(s) that serve this mode |
|---|---|---|---|
| 1 | **Discovery** | "What metrics exist? Is there one for X?" | Catalog (extended), NL Search Box, Slack `/metric` |
| 2 | **Framing** | "I have a vague question — help me sharpen it" | Metric Detail (sample questions), Verb Chips, NL search refinement |
| 3 | **Execution** | "Run my query, give me the answer" | Explore (existing, extended), Catalog → Explore handoff |
| 4 | **Interpretation** | "Is this normal? What's driving the change?" | Anomaly badge, Change-Analysis Drill panel, AI narrative on digest |
| 5 | **Monitoring** | "Tell me when something moves" | Metric Digest (Slack/email), Anomaly alerts, in-app notification feed |
| 6 | **Delivery** | "Push this to Slack / dashboard / pipeline" | Save-as-view, Slack unfurl, MCP/CDP auto-publish, Export CSV/ID list |

---

## 4. Existing UI inventory (for design context)

Designer should walk through these routes in dev (`npm run dev`, then visit `http://localhost:4000/...`) before designing the new surfaces. Key reference points:

| Route | Code path | What's there today |
|---|---|---|
| `/` | `src/pages/Index/` | Landing — minimal |
| `/build` | `src/QueryBuilderV2/` | **The existing Explore surface.** Query builder with measures/dimensions/segments/filters/time picker, results table + chart, generated SQL / GraphQL / REST tabs. This is the canvas; new verb chips go *on the result panel*. |
| `/catalog` | `src/pages/Catalog/` | **The existing catalog.** Has `catalog-tabs.tsx`, `catalog-grid.tsx`, `catalog-toolbar.tsx`, `cube-card.tsx`, `detail-panel.tsx`, `metric-card.tsx` (with `how-to-slice`, `joinable-with`, `similar-measures`). Already cube-centric; v2 makes it concept-centric and adds the metadata layer. |
| `/metric/:cube/:member` | `src/pages/Catalog/metric-card-page.tsx` | **The metric detail page** — already shows measures with "how to slice / joinable with / similar measures" panels. Extend this with metadata fields. |
| `/metrics/new` | `src/QueryBuilderV2/NewMetric/full-page/NewMetricPage.tsx` | **The 6-step wizard.** Authors a measure today; PRD adds metadata fields at the last step and extends to dimensions + segments. |
| `/metrics/new/success` | `NewMetricSuccess` | Confirms publish |

Design system already in use:
- `@cube-dev/ui-kit` (Cube's UI kit) + `antd` (legacy)
- `styled-components` for component-level styles
- Theme tokens in `src/theme/tokens.css` (CSS vars: `--bg-app`, `--text-primary`, `--text-muted`, `--danger`, etc.)
- Cube color tokens in `src/QueryBuilderV2/color-tokens.ts`

**The new surfaces should feel like a coherent extension of this design system, not a separate app.** Use existing CSS vars; introduce new ones only when necessary.

---

## 5. New + extended surfaces — detailed specs

Surfaces are grouped by phase (P1 = ship in ~3 weeks, P2 = ~4 weeks, P3 = ~8-9 weeks, P4 = later). Designer should design all P1+P2 surfaces in this round; P3 in a follow-up round.

### 5.1 [P1] Catalog — two-tab structure: Metrics + Data Model

**Replaces:** Today's `/catalog`, which is cube-centric (browse by cube, click a measure) and shows only field name + type.

The catalog has **two top-level tabs**, reflecting the two-layer architecture (§1.1):

#### 5.1.A — Metrics tab (default; consumer surface; new)

Default landing. A flat grid of **named business metrics** (DAU, MAU, Revenue, ARPU, ARPPU, PU(n), LTV(n), Paying Rate, …). Each card represents one curated metric in the registry, not a Cube primitive.

- **Filter rail:** by domain (acquisition/engagement/revenue/retention/payments/concurrency/marketing/custom), certified status (certified/beta/draft/deprecated), owner, tier (POC / v0.5 / blocked-on-upstream-data — see metric-mapping doc), and "parameterised family" toggle (collapses A(n), PU(n), RR(n), LTV(n) groups into one card with a picker).
- **Search bar:** synonym-aware substring search across label, description, synonyms[], formula_text. (See §5.3 for the grounded NL search box.)
- **Metric card content (compact):**
  - Business label (large, primary) — e.g. *"Revenue"*, *"Paying Users (PU)"*, *"LTV(n)"*
  - Stand-for / short name — e.g. *"Total in-game item delivery value"*
  - Domain chip
  - Unit / format (`VND`, `%`, `count`, `users`)
  - **Formula in plain English** (one line) — composed of other metric names and/or building blocks. E.g.: `ARPU = Revenue / DAU`, `PU(7) = unique users paying in last 7 days`, `LTV(n) = RevNRU(n) / NRU`
  - For parameterised families (A(n), PU(n), RR(n), LTV(n), RevRPI(n), ROAS(n)): inline `n` picker on the card
  - Certified badge (§5.5)
  - Freshness chip — derived from the underlying cube's `refresh_key`
  - Hover: surfaces sample-question if defined
  - Click: opens Metric Detail (§5.2.A)

#### 5.1.B — Data Model tab (existing surface, extended; author/power-user surface)

The current `/catalog` (concept-first grid + filter rail + tabs) **solves this well**. We extend it; we don't rebuild it.

- **Sub-tab switch:** "By concept" (default, flat grid of measures + dimensions + segments) | "By cube" | "Schema". Matches the current Compass prototype's three-tab pattern.
- Source of cards: what `/cubejs-api/v1/meta` returns — Cube measures, dimensions, segments across the 4 cubes (currently 33 items).
- **Filter rail:** by type (measure/dim/segment), domain, certified status, owner. Same as Compass prototype.
- Card content: the existing `ConceptCard` design from the prototype — business label, type icon, description, formula text, certified badge, freshness, owner.
- Click: opens Building Block Detail (§5.2.B).

#### Shared across both tabs

- **View toggle:** grid / list.
- **Sort:** Most used, Recently edited, A → Z, Freshness.
- **States to design:** loading, empty (no items match filter), error (registry / `/cubejs-api/v1/meta` fetch failed), "GDS-1.8 seed import in progress" banner (Metrics tab only), drift-warning ("this game's metric definition diverges from GDS-1.8 reference — review").

**Existing components to extend:**
- `catalog-page.tsx` — add top-level Metrics / Data Model tab
- `catalog-grid.tsx` — already concept-grid capable; reuse for both metric cards and building-block cards (two card variants)
- `cube-card.tsx` — keep for Data Model → "By cube" sub-tab
- `catalog-toolbar.tsx` — add filter rail; same chrome, different filter fields per tab
- `catalog-tabs.tsx` — Data Model sub-tabs ("By concept" / "By cube" / "Schema")
- New: `metric-card.tsx` variant (currently shows Cube measures; needs metric-layer variant), `metric-registry.ts` data layer fetching from the metric registry endpoint.

---

### 5.2 [P1] Detail pages — two shapes

Two detail-page shapes, one per tab. Same six-panel skeleton, but the content of the Formula panel and the source of identity differs.

#### 5.2.A — Metric Detail (`/metric/:metricId`)

**For metric-layer items (Metrics tab cards).**

1. **Vocabulary panel**
   - Business label, "stand for" short name, description (markdown), synonyms list, sample questions, domain
   - All editable inline by authorized users
2. **Formula panel** — the heart of the metric layer
   - **Formula expression** in plain English, composable from:
     - **Other metric references** — e.g. `ARPU = Revenue / DAU` where `Revenue` and `DAU` are clickable metric tokens
     - **Building block references** — e.g. `PU(7) = unique({active_daily.user_id}) WHERE log_date BETWEEN today-6 AND today` references `active_daily.user_id` (a Cube measure/dim)
     - **Parameters** — for parameterised families (A(n), PU(n), RR(n), LTV(n), RevRPI(n), ROAS(n)). Parameter picker inline.
   - **Compiled Cube query payload** (read-only, collapsible) — the `{measures, dimensions, timeDimensions, filters, segments}` object the metric expands into. This is what Explore runs.
   - **Tier badge** — Tier 1 (existing measure) / Tier 2 (measure + time/segment) / Tier 3 (cohort filter) / Tier 4 (cohort + offset, deferred) / Tier 5 (needs new YAML) / Tier 6 (needs new data source). Surfaces blocker status honestly. See metric-mapping doc for the taxonomy.
3. **Lineage panel (P2)** — upstream chain: source table → cube → building block(s) → this metric → views/dashboards using it
4. **Trust panel** — certified status, owner, last-edited-by, freshness SLA (inherited from underlying cube's `refresh_key`), usage count
5. **Sliced-view panel** — common dimension/segment combos this metric works with; one-click into Explore with the cut pre-applied
6. **Activity panel** — recent edits, feedback, saves-as-view

#### 5.2.B — Building Block Detail (`/data-model/:cube/:member`)

**For data-model items (Data Model tab cards).** Replaces today's `/metric/:cube/:member` — already has how-to-slice / joinable-with / similar-measures panels (good foundation).

Same six panels as 5.2.A with two differences:
- **Formula panel** shows the Cube YAML snippet (the `sql:` expression) — building blocks have no metric-layer formula. They may show "Used in N metrics" (reverse reference into the metric layer).
- **Vocabulary panel** is simpler — no parameterised picker (parameters live on metrics).

Otherwise: panels 1, 3, 4, 5, 6 are identical to 5.2.A. The existing prototype's `page-metric-detail.jsx` is the right starting point for this shape.

#### Shared authoring affordances

- Inline edit (Notion / Linear style) for vocabulary, formula, sample questions
- Permission-gated: anyone can `draft`, owner approves to `approved`
- Save button per panel; draft-vs-approved indicator

**States:** view mode, edit mode (inline per field), proposing-change mode (non-owner submits to owner), conflict mode (concurrent edit), drift-warning mode (game's metric definition differs from GDS-1.8 seed reference).

---

### 5.3 [P1] Grounded NL search box

**Position:** Top of Catalog (`/catalog`) and a global slot in the app header (always available).

**Behavior:**
- Single text input, placeholder: "Search the metric catalog (e.g. 'recharge in VN', 'whale users', 'first day retention')"
- Retrieval-only: searches metadata (label + synonyms + description + sample_questions) using embeddings or substring (Phase 1 = substring; Phase 4 = embeddings).
- Returns ranked **concept candidates** (max 5), each rendered as a mini-card with label, description, and "Use in Explore" / "Open detail" CTAs.
- **Does NOT generate SQL or cube queries.** Critical for managing expectation set by Cortex Analyst / Genie / ChatGPT.

**Copy guideline (designer should honor):** Frame as *"smart catalog search"*, not "ask me anything." Empty-state placeholder and inline hints reinforce that this is search, not chat.

**Future (P4):** evolves into agentic Q&A with multi-step decomposition. Visual treatment should *allow* that evolution (e.g., space for a streaming response) without committing to it in P1.

---

### 5.4 [P1] Wizards — two shapes

Two wizards, one per layer. Same 6-step shape; different middle steps.

#### 5.4.A — New Metric Wizard (`/metrics/new`)

**For authoring metric-layer items.** Writes to the metric registry, not to YAML.

- Step 1: pick metric type — derived (formula references other metrics) | composed (formula references building blocks + filters + granularity) | parameterised family (n-grid)
- Steps 2–5: type-specific
  - **Derived** — formula editor with metric-token autocomplete (`Revenue / DAU` etc.); preview compiled Cube query
  - **Composed** — building-block picker (measure + dimensions + segments from `/cubejs-api/v1/meta`) + time-grain + cohort filter
  - **Parameterised** — base composition + `n` value list (`[1, 3, 7, 14, 30, 60, 90, 120, 150, 180]` defaults) + per-n override slots
- Step 6 (metadata): business label (required), description (markdown, required), synonyms (chip input), sample questions, domain (select), unit/format
- **On publish:** new row in metric registry. No YAML change. Atomic write.
- **Pre-fill from GDS-1.8 seed** if author selects a known reference metric ("Are you authoring *Revenue*? Here's the GDS-1.8 reference; edit if your game's version differs")

#### 5.4.B — New Building Block Wizard (`/data-model/new`)

**For authoring data-model items.** Writes Cube YAML (today's wizard behavior).

- Replaces today's `/metrics/new` 6-step wizard, which produces YAML only. (URL moves to `/data-model/new`; the existing wizard code at `NewMetricPage.tsx` stays, just under a new route.)
- Step 6 adds metadata authoring (business label, description, synonyms, sample questions, domain) — same as before.
- **Branches** to author measures, dimensions, or segments. Same 6-step shape, type-specific middle steps.

**States (both wizards):** stepper navigation, mid-edit save-draft, publish-confirmation modal, drift-warning if metadata diverges from GDS-1.8 seed reference.

---

### 5.5 [P1] Certified-metric badge + freshness/SLA layer (cross-surface)

**Cross-cutting visual treatment** applied on Catalog cards, Metric Detail trust panel, Explore measure picker tooltips, and (future) Digest items.

**States to design:**
- ✅ **Certified** (green) — owner-approved, in-use
- 🟡 **Beta** (yellow) — newer, owner-approved, used in <3 dashboards/tools
- ✏️ **Draft** (grey) — author-only, not yet approved
- ⚠️ **Deprecated** (red strikethrough) — being phased out, do not use
- ❓ **Orphaned** (red question mark) — metadata refers to a cube member that no longer exists (drift detection)

**Adjacent info:**
- Freshness: "Refreshed Xm/h ago" + colored dot (green if within SLA, yellow if approaching, red if breached)
- Owner: avatar + name
- "Used in N places" — a clickable count opening a usage list

---

### 5.6 [P1] Human-feedback widget (cross-surface)

**Position:** On every concept card (in Catalog), every measure tooltip (in Explore), every NL search result card.

**Behavior:**
- 👍 / 👎 affordance, small footprint
- Negative response opens an optional one-line comment field
- Aggregates into `metadata_feedback` queue for owner review
- Owner sees per-concept aggregated thumbs and recent comments in Metric Detail's Activity panel

**Why this matters for design:** the widget must be present but not visually loud — it's a quiet signal that compounds over time. Treat it like a "react" affordance, not a CTA.

---

### 5.7 [P2] Verb chips on Explore result panel

**Position:** Below the Explore result table/chart (in `QueryBuilderV2/QueryBuilderResults.tsx` and chart panel area).

**Behavior:** A horizontal row of contextual chips, each representing a composable next move:
- **By [dim ▾]** — adds a dimension to the current query
- **Compare to [period ▾]** — adds a time-shift measure (e.g., vs last period, vs last year)
- **Drill into [row]** — for any row in a grouped result, opens a detail query filtered to that row's dimension values
- **Filter to [segment ▾]** — adds a segment
- **Granularity [day/week/month ▾]** — when a time dimension is present
- **Sort by [measure ▾]** + **Limit [N]** — when ordering is implied

**Constraints:**
- Each chip is metadata-aware: only offer dims/segments that are reachable from the current cube context.
- Progressive disclosure: 3 default chips visible, "more" chevron exposes the rest.
- "Drill into [row]" only appears when a row in the result is hovered/selected.
- Each chip click *adds to the existing query*, doesn't replace it. The query is a sequence of moves, not a one-shot.

**States:** default (3 chips), expanded (all chips), disabled-chip-with-tooltip ("This dim is not joinable with this cube"), in-flight (loading after click).

---

### 5.8 [P2] Saved exploration views

**Behavior:**
- Above the verb-chip row, a "Save view" button. Captures the chip sequence + filter state + chosen visualisation.
- Saved views appear in the user's Workspace (P3) and as quick-access from the user's profile/menu.
- Re-running a saved view: parameters (date range, segment values) are editable on re-run.
- Optionally branchable: "Fork this view" creates a new view from the saved state.

**States to design:** unsaved, saving, saved with name, shared with team, renamed-by-other.

---

### 5.9 [P2] Lineage panel (Metric Detail extension)

**Position:** Inside Metric Detail, as a new "Lineage" tab or expandable panel.

**Behavior:**
- Visual graph (use ReactFlow or similar):
  - Upstream: warehouse table → cube → measure
  - Downstream: views referencing this measure → dashboards / MCP tools / CDP audiences using it
- Click any node to navigate (e.g., click warehouse table → opens schema view; click downstream dashboard → opens dashboard preview)
- For composed measures (`arppu_vnd = ltv_total_vnd / paying_users`), show the formula DAG

**States:** loading graph, sparse-graph (only 1-2 nodes), dense-graph (collapse panels), error.

---

### 5.10 [P2] Slack/Teams "ask-the-catalog" bot

**Surface:** Slack app (Teams variant later).

**Behavior:**
- `/metric <phrase>` command — returns top 3 concept candidates as Slack message blocks
- Each block has label, description, "Open in catalog" button, "Open in Explore with this measure" button
- `@catalog-bot <phrase>` works in any channel
- **Same retrieval as §5.3 (grounded NL search), just rendered for Slack.**

**Designer needs to provide:** Slack block-kit layouts for the 3 result types (concept card, no-results, error).

---

### 5.11 [P3] Metric Digest (Slack + email)

**Behavior:**
- User picks 5-20 concepts via Catalog ("Subscribe to this metric")
- Sets cadence: daily 9am / weekly Monday / on-change-only
- Receives a digest containing per-metric:
  - Current value + delta vs previous period
  - Sparkline (last 14 days)
  - One-line AI narrative ("Revenue is up 4.2% week-over-week, driven by IAP in VN")
  - Anomaly badge if change crosses threshold
  - Link to Explore with the metric pre-loaded
- "Open in catalog" / "Mute this metric" / "Snooze 1 week" controls

**Surfaces to design:**
- Subscribe modal (from Catalog or Metric Detail) — pick cadence + delivery channel
- Email template (HTML + plain text)
- Slack message template (block kit)
- In-app digest preview (so user can see what they'll receive)
- Digest preferences page (manage all subscriptions)

**Defaults (designer should honor):** opt into change-only (low-frequency, low-fatigue) — not daily-everything. Tableau Pulse learned this in 2024.

---

### 5.12 [P3] Anomaly detection + change-analysis drill

**Surface:** Anomaly badge appears on Catalog cards, Metric Detail, Explore results, and Digest items. Click opens a **Change Analysis modal**.

**Change Analysis modal content:**
- Header: "Why did [metric] move?"
- Top-line delta: "Revenue dropped 8.4% vs last week"
- **Decomposition view:** breakdown by available dimensions, sorted by contribution magnitude. E.g.:
  - Country: VN -22%, TH -3%, ID +5%
  - Channel: IAP -18%, Web +2%
  - Tier: Whale -34%, Dolphin -5%, Minnow flat
- Each row drillable — clicking opens Explore with the dimension applied.
- "Most likely cause" surfaced at top (highest-contribution dimension value).
- Confidence indicator on the analysis.

**Anomaly badge states:** none (no anomaly), low (slight unusual movement), high (significant), trending (multi-period pattern).

---

### 5.13 [P3] Workspaces — curated collections

**Behavior:**
- User assembles 1-N saved views + commentary + filters into a named "workspace"
- Notion-style canvas: drag charts onto a grid, add text/markdown blocks for context
- Shareable URL with permission scopes (private / team / org)
- Comments + annotations per block
- Re-runs use current data; parameters editable

**Distinguish from Digest:** Digest is push (delivered to you). Workspace is pull (you visit it). Same content can power both.

---

### 5.14 [P3] Embedded views

- Iframe / oEmbed route for any saved view or workspace
- Slack link unfurls into a preview card
- Notion / Linear / Confluence embed compatibility
- Permission-scoped (must respect user auth in the embedding context — most likely a token-in-URL or org-scoped public link)

---

### 5.15 [P4] Multi-step investigation agent (defer, but reserve UI space)

Out of scope for this design round. Mentioned so designer reserves visual space in the NL Search Box (§5.3) for future streaming agent responses.

---

## 6. Information Architecture / Sitemap

```
/                                  Landing (minimal, links to Catalog + Build)
/catalog                           Two-tab catalog (5.1)
  ├── tab=metrics (default)        Metric layer — named business metrics
  └── tab=data-model               Data Model layer — measures + dims + segments
      ├── sub=concept (default)    Flat concept grid (existing prototype design)
      ├── sub=cube                 Existing cube-centric view
      └── sub=schema               Existing schema view
/metric/:metricId                  Metric Detail (5.2.A) — vocabulary + formula (composes other metrics or building blocks) + lineage + trust + sliced views + activity
/data-model/:cube/:member          Building Block Detail (5.2.B) — vocabulary + YAML formula + lineage + trust + sliced views + activity
/build                             Explore / QueryBuilder (existing) + verb chips (5.7) + save-view (5.8)
/build/views/:viewId               Re-run a saved view
/metrics/new                       Metric Wizard (5.4.A) — write to metric registry
/data-model/new                    Building Block Wizard (5.4.B) — write Cube YAML (today's wizard, re-routed)
/metrics/new/success               Wizard confirmation (shared)
/workspaces                        (P3) User's workspaces index
/workspaces/:id                    (P3) Workspace canvas (5.13)
/digest/preferences                (P3) Subscriptions management (5.11)
/embed/:type/:id                   (P3) Embedded view route (5.14)
```

Global app shell elements (header / nav):
- Grounded NL search box (5.3) in header
- Notifications bell (anomaly alerts, mention feed) — P3
- User menu (saved views, workspaces, subscriptions, preferences)

---

## 7. Cross-surface patterns

These appear in multiple surfaces. Designer should create one canonical treatment per pattern.

| Pattern | Where it appears | Notes |
|---|---|---|
| **Certified-metric badge** | Catalog cards, Metric Detail, Explore tooltips, Digest items | 5 states (certified / beta / draft / deprecated / orphaned). Color + icon. |
| **Freshness chip** | Catalog cards, Metric Detail trust panel, Digest items | Time-since-refresh + traffic-light color |
| **Anomaly badge** | Catalog cards, Metric Detail, Explore results, Digest items | 4 states (none / low / high / trending) |
| **Feedback widget** | Concept cards, Metric Detail, NL search results, Explore tooltips | Subtle 👍/👎 with optional comment |
| **Concept card** | Catalog grid, NL search results, Slack messages, Digest items | Same data shape; visual variants per surface |
| **Verb chip** | Explore result panel | Composable next-move affordance |
| **Drift warning** | Catalog cards, Metric Detail, Wizard | When a game's definition diverges from GDS-1.8 canonical |

---

## 8. Visual & interaction principles for design

These come from non-tech persona needs + SOTA conventions. Designer should treat as starting constraints, not gospel.

1. **Trust is loud, AI is quiet.** Certified badge, freshness, owner avatar should be prominent. NL/AI should feel like a quiet helper, not the main feature, until P4.

2. **One-click verbs, not modal dialogs.** Verb chips, save-view, subscribe, share — all single-click affordances. No multi-step modals for routine moves.

3. **Empty states are content.** Empty Catalog = "Get started: import GDS-1.8 glossary". Empty Workspace = "Pin your first metric". Empty Digest = "Subscribe to 3 metrics to start". These are the first thing a new user sees.

4. **Read before edit.** Default mode of every authoring surface is read-mode. Edit mode requires explicit affordance (click, hover-icon). Reduces accidental drafts.

5. **Mode signal beats role permission.** A non-tech user should never see "this is read-only because you lack perms" — they should see "this is published; suggest an edit?" The UI implies governance, doesn't gate it harshly.

6. **Density tier for personas.** Liveops/Growth/Product need scannable density (lots of concept cards, compact metric detail). Finance/Exec need a sparser, glanceable view (digest, workspace).

7. **Existing playground tone.** Match the existing `@cube-dev/ui-kit` + antd visual language. Don't introduce a new design system; introduce new components within the existing one.

---

## 9. Out of scope (this round)

- Multi-tenant cross-game browse (P4)
- What-if simulation (P4 or never)
- Native mobile app (deferred indefinitely)
- Funnel analytics UI (not a Cube YAML capability; needs upstream view work — Q12 streak class)
- Multi-step investigation agent (P4, but reserve space in NL search box layout)
- Data warehouse browse / column-level Atlan parity (we are scoped to semantic-layer concepts)

---

## 10. Open design questions

Designer should resolve these in collaboration with PM + eng. Listed in priority order:

1. **NL search box framing.** Is "smart catalog search" copy enough to prevent users from typing "what's revenue?" and getting frustrated? Or do we need a stricter input shape (autocomplete-only)?

2. **Catalog default view.** Concept-first flat grid (new) vs cube-grouped (today)? My recommendation: concept-first default, cube-grouped as a tab. Designer to validate with user testing.

3. **Inline edit vs explicit edit mode.** Notion-style click-to-edit (no mode switch) vs Linear-style explicit edit-mode toggle? Affects authoring flow significantly.

4. **Trust badge visual prominence.** How loud is "certified"? Risk: too loud crowds the card; too quiet defeats the purpose. Designer to A/B in mid-fi.

5. **Verb chip presentation.** Pill chips below result vs dropdown buttons above vs a right-rail panel? Reference: ThoughtSpot uses bottom row; Tableau uses right rail. Try both.

6. **Workspace vs Saved View distinction in IA.** Are these two separate concepts or one with size variants? Hex collapses them into "Apps". We'd default to separate but designer should validate.

7. **Digest format.** Single weekly digest with all metrics vs per-metric digests with separate cadences? Tableau Pulse went per-metric; less fatigue, more notifications. Designer to choose.

8. **Anomaly modal entry point.** Click the badge directly vs click a "Why?" link next to the metric? Affects discoverability.

9. **Slack-vs-Teams primacy.** VNG team uses Slack primarily — confirmed? If so, Slack-first design, Teams as later add.

10. **Empty-state for newly-imported metric.** A GDS-1.8 metric that was bulk-imported has description but no synonyms, no sample questions, no formula text. How do we visually signal "this is partial, contribute" without making it look broken?

11. **Drift-warning prominence.** A game's `revenue` differs from canonical GDS-1.8 `revenue`. This is *sometimes* correct (game-specific override) and *sometimes* a bug. How does UI surface this without overclaiming?

12. **Parameterised family picker placement.** Inline next to the metric label, in a separate "settings" panel of the metric detail, or as a Catalog filter? Affects every parameterised metric (A(n), PU(n), LTV(n), ~10 of 53 GDS metrics).

---

## 11. Success criteria

For Phase 1 ship:

- **Metric-layer POC coverage:** all **21 Tier 1–3 metrics** from `metric-mapping-260519-poc-gds-vs-cubes.md` are in the metric registry with label + description + formula + tier badge + sample-question, and each runs successfully against the 4 published cubes.
- **Data-model coverage:** 100% of Cube `/cubejs-api/v1/meta` measures/dimensions/segments appear under the Data Model tab with at least label + description seeded.
- **Discovery time:** Non-tech user opens Catalog (Metrics tab), types a business word, opens correct metric detail in <30 seconds (measured via test scenarios with 5 game-ops users).
- **Trust signal:** 90%+ of metrics used in MCP/CDP/dashboards carry a `certified` badge (i.e., owner-approved metadata).
- **Authoring activity:** 5+ unique authors (not just DEs) editing metric registry entries within 2 weeks of ship.
- **Feedback loop:** at least 1 owner-actioned 👎 → metric definition edit cycle observed (validates the loop is real, not theatre).
- **GDS-1.8 seed import:** seed-import job successfully populates the metric registry from GDS-1.8 reference for Tier 1–3 metrics; users can edit any seeded entry post-import.

For Phase 2:

- **Exploration depth:** Average exploration session uses 2.5+ verb chips (vs current 0).
- **Saved view usage:** 30%+ of weekly active users have at least 1 saved view.
- **Slack bot adoption:** 20%+ of weekly active users invoke `/metric` at least once a week.

For Phase 3:

- **Digest engagement:** 60%+ of recipients open at least 1 digest per week.
- **Anomaly utility:** <20% of anomaly badges marked "not anomalous" by user (signal quality).

---

## 12. Suggested design deliverables for this round

To unblock engineering, designer should deliver (in roughly this order):

1. **Visual system extension** — new tokens (badge colors, freshness states, anomaly states), feedback widget, certified badge, freshness chip
2. **Cross-surface patterns** (§7) at hi-fi — single canonical treatment each
3. **Catalog redesign** (5.1) — concept-first grid + filter rail + tab switcher; states (loading, empty, error, drift-warning)
4. **Metric Detail extension** (5.2) — all six panels; view + edit modes; permission gating; activity panel
5. **NL Search Box** (5.3) — input + result rendering; empty / loading / no-results / results states
6. **Wizard extension** (5.4) — last step metadata fields; dim/segment branches; drift-warning state
7. **Verb chips on Explore** (5.7) — chip framework + 6 verbs; reachability filtering; progressive disclosure
8. **Saved views** (5.8) — save dialog + workspace integration
9. **Lineage panel** (5.9) — graph layout, node types, navigation
10. **Slack bot blocks** (5.10) — concept-card / no-result / error variants
11. **Digest** (5.11) — subscribe modal, Slack template, email template, preferences page
12. **Change-analysis modal** (5.12) — decomposition view + drill-back
13. **Workspaces** (5.13) — index + canvas + share dialog
14. **Embedded view** (5.14) — preview card + Slack unfurl + iframe shell

For each surface, deliver: hi-fi, all major states (loading, empty, error, edit-mode if relevant), and at least one mid-fi flow showing the surface in a multi-step journey.

---

## 13. Reference materials

### Source documents (this repo)
- `business-case-260518-cube-semantic-layer-tables.md` — 13 questions, business case
- `research-260518-1841-product-gaps-non-tech-question-flow.md` — v2 product-gap analysis (the proposal)
- `research-260519-1900-product-layer-sota-validation-and-feature-brainstorm.md` — SOTA validation, 12 missing surfaces
- `metric-mapping-260519-poc-gds-vs-cubes.md` — POC coverage (21/53 GDS metrics in Tiers 1–3). **This is the v0 metric registry seed.**
- `_GDS__-_1_8_Metrics_Definition.md` — 53-metric **reference glossary** (NOT the source of truth). Used to seed the metric registry on first import; users curate/override per game/tenant after that.

### Existing codebase pointers
- `src/pages/Catalog/` — extend
- `src/pages/Catalog/metric-card-page.tsx` — extend (Metric Detail)
- `src/QueryBuilderV2/` — extend (Explore, verb chips, save-view)
- `src/QueryBuilderV2/NewMetric/full-page/NewMetricPage.tsx` — extend (Wizard)
- `src/theme/tokens.css` + `src/QueryBuilderV2/color-tokens.ts` — extend (visual system)

### External design references
- **Atlan** (atlan.com) — for concept-first catalog + lineage panel
- **Tableau Pulse** (tableau.com/products/tableau-pulse) — for digest format + anomaly narrative
- **ThoughtSpot Sage / Spotter** — for NL search + drill-anywhere
- **Hex Apps** (hex.tech) — for saved views + workspace pattern
- **Cortex Analyst** (snowflake.com/cortex) — for grounded NL search expectation setting
- **Linear / Notion** — for inline-edit pattern in Metric Detail

---

## Open Questions (for PM, not designer)

1. **Metric registry storage substrate** — backend table (Postgres) vs YAML side-file in repo vs Cube views? Affects "anyone can author" reality, version control, and how the registry survives multi-tenant. Recommend Postgres for v1; YAML side-file as fallback for POC if Postgres is delayed.
2. **Metric registry schema** — minimum: `{ id, label, stand_for, description, synonyms[], domain, unit, formula_expression, compiled_cube_query, parameters[], tier, owner, certified_status, gds_ref_id?, drift_status }`. Confirm fields before implementation.
3. **Formula expression syntax** — DSL choice for the metric layer: simple-template (`{Revenue} / {DAU}`) vs MetricFlow-style YAML vs Cube views vs a small AST. POC can start with simple-template + a parser that resolves metric / building-block tokens.
4. **OSI standard commitment** — make metric registry schema a superset of OSI from day one (vs adopt later)?
5. **Cross-game permission model** — can a Game A author edit Game B's metric registry? Default: no.
6. **Phase 4 timing for multi-step agent** — committed quarter, or only if Phase 1-3 evidence shows need?
7. **Tenant scoping in catalog** — POC is single-tenant (Ballistar VN). When does multi-tenant land?
8. **MCP/CDP auto-publish migration** — Q13 of the business case. Webhook from Cube + metric registry to MCP/CDP on definition change — owned by which team?
