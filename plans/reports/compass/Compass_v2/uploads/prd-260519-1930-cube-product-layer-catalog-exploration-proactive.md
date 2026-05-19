# PRD — Cube Product Layer: Catalog + Exploration + Proactive/AI Surfaces

**Status:** Draft for design handoff
**Date:** 2026-05-19 19:30
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

A non-technical game-ops person opens the product, types "whales in VN" or speaks the question to a chat box, finds the right measure with its plain-English definition, compares to last week with one click, saves the view to a Slack digest, and gets a notification tomorrow when the number moves more than usual.

The platform is the same one a data analyst uses to *author* new metrics (segments, dimensions, audiences) and the same one Liveops/MCP/CDP read from. **One vocabulary, three audiences (consumer / author / system), tightly integrated surfaces.**

### What we are building, named honestly

A **metric catalog** (industry term) integrated with an **exploration scaffold** (BI term) and a **proactive surface** (digest/anomaly). Differentiators vs Atlan/Cube Cloud Catalog: (a) scoped to semantic-layer concepts not warehouse tables, (b) authoring loop closes back to YAML via the wizard, (c) clicking a measure opens Explore in the same surface, not a side-car docs page.

### What we are NOT building

- Not a new BI tool replacing Tableau/Looker.
- Not a warehouse data catalog replacing Atlan/Collibra.
- Not an autonomous AI analyst (that's a Phase 4 stretch goal).
- Not a dashboard builder for marketing/exec users — we have one (Catalog detail + saved views).

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

### 5.1 [P1] Extended Catalog — measures, dimensions, segments with rich metadata

**Replaces:** Today's `/catalog`, which is cube-centric (browse by cube, click a measure) and shows only field name + type.

**New behavior:**
- **Concept-first browse.** Default landing is a flat grid of "concepts" — each card is one measure, dimension, or segment, with its business label, short description, certified badge, and freshness indicator.
- **Filter rail:** by type (measure/dim/segment), domain (acquisition/engagement/revenue/retention/payments/concurrency/marketing/custom), certified status (certified/beta/draft/deprecated), and owner.
- **Search bar:** synonym-aware substring search across label, description, synonyms[], formula_text. Returns ranked concept cards. (See §5.3 for the grounded NL search box that lives next to this.)
- **Tab switch:** "By concept" (default, flat grid) | "By cube" (existing grouping) | "Schema" (existing schema view).
- **Concept card content (compact):**
  - Business label (large, primary)
  - Type icon (measure / dim / segment) + domain chip
  - One-line description
  - Unit / format (e.g. `VND`, `%`, `count`)
  - Certified badge (see §5.6 cross-surface pattern)
  - Freshness chip (e.g. "Refreshed 12m ago" — derived from cube `refresh_key`)
  - Hover: surfaces sample-question if defined
  - Click: opens Metric Detail (5.2)

**Existing components to extend:**
- `catalog-grid.tsx` — add concept-level grid mode
- `cube-card.tsx` — keep for "By cube" tab
- `catalog-toolbar.tsx` — add filter rail
- `catalog-tabs.tsx` — add "By concept" as default tab

**States to design:** loading, empty (no concepts match filter), error (catalog fetch failed), "GDS-1.8 import in progress" banner, drift-warning ("this game's definition of `revenue` differs from canonical — review").

---

### 5.2 [P1] Metric Detail (extended)

**Replaces:** Today's `/metric/:cube/:member` — already has how-to-slice / joinable-with / similar-measures panels (good foundation).

**New panels to add (alongside existing):**
1. **Vocabulary panel**
   - Business label (editable inline by authorized users)
   - Description (markdown, editable)
   - Synonyms list (chip input)
   - Sample questions (list, editable)
   - Domain (single-select chip)
2. **Formula panel**
   - Formula text in business terms (markdown, editable)
   - Cube YAML snippet (read-only, collapsible)
   - For parameterised families: parameter picker (`n = [1, 3, 7, 14, 30, 60, 90, 120, 150, 180]`)
3. **Lineage panel (P2)**
   - Visual graph: source table → cube → measure → views referencing this measure
   - Click any node to navigate
4. **Trust panel**
   - Certified status (badge + state machine: draft → proposed → approved → deprecated)
   - Owner + last-edited-by + audit timestamps
   - Freshness SLA (from cube `refresh_key`)
   - "Used in N dashboards / N MCP tools / N CDP audiences" — usage tracker
   - Feedback widget: 👍 / 👎 with optional comment (queues `metadata_feedback` for owner)
5. **Sliced-view panel (existing how-to-slice, refined)**
   - Common dimension/segment combos this measure works with
   - Each is a one-click into Explore with the cut pre-applied
6. **Activity panel**
   - Recent edits (who changed what)
   - Recent feedback
   - Recent saves-as-view

**Authoring affordances:**
- Inline edit (Notion / Linear style) for vocabulary, formula, sample questions
- Permission-gated: anyone can `draft`, owner approves to `approved`
- Save button per panel; draft-vs-approved indicator

**States:** view mode, edit mode (inline per field), proposing-change mode (non-owner submits to owner), conflict mode (concurrent edit), drift-warning mode (canonical GDS-1.8 differs from this game's overlay).

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

### 5.4 [P1] New Metric Wizard — extended

**Replaces:** Today's `/metrics/new` 6-step wizard, which produces YAML only.

**New behavior:**
- **Step 6 (final) adds metadata authoring** before publishing:
  - Business label (required)
  - Description (required, markdown)
  - Synonyms (chip input, optional)
  - Sample questions (list, optional but encouraged)
  - Domain (select)
- **On publish:** both the YAML *and* the metadata entry are written atomically.
- **Branch the wizard** to also author **dimensions** and **segments** (currently measures only). Same 6-step shape but with type-specific fields in the middle steps.
- **Pre-fill from GDS-1.8** if the author selects a known concept ("Are you authoring `paying_users`? Here's the canonical definition; edit if your game's version differs").

**States:** stepper navigation, mid-edit save-draft, publish-confirmation modal, drift-warning if author's metadata diverges from GDS-1.8 canonical.

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
/catalog                           Concept-first browse (5.1)
  ├── tab=concept (default)        Flat concept grid
  ├── tab=cube                     Existing cube-centric view
  └── tab=schema                   Existing schema view
/metric/:cube/:member              Metric Detail (5.2) — vocabulary + formula + lineage + trust + sliced views + activity
/build                             Explore / QueryBuilder (existing) + verb chips (5.7) + save-view (5.8)
/build/views/:viewId               Re-run a saved view
/metrics/new                       Wizard (5.4) — measure | dimension | segment authoring
/metrics/new/success               Wizard confirmation
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

- **Vocabulary coverage:** 80%+ of GDS-1.8's 53 concepts have at least a label + description + formula + sample-question in the catalog within 1 week of ship.
- **Discovery time:** Non-tech user opens Catalog, types a business word, opens correct measure detail in <30 seconds (measured via test scenarios with 5 game-ops users).
- **Trust signal:** 90%+ of measures used in MCP/CDP/dashboards carry a `certified` badge (i.e., owner-approved metadata).
- **Authoring activity:** 5+ unique authors (not just DEs) editing metadata within 2 weeks of ship.
- **Feedback loop:** at least 1 owner-actioned 👎 → metadata edit cycle observed (validates the loop is real, not theatre).

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
- `metric-mapping-260519-poc-gds-vs-cubes.md` — POC coverage (21/53 GDS metrics)
- `_GDS__-_1_8_Metrics_Definition.md` — 53-metric glossary, seed data

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

1. **Storage substrate for metadata store** — backend table (Postgres) vs local-first with sync? Affects "anyone can author" reality.
2. **OSI standard commitment** — make metadata schema a superset of OSI from day one (vs adopt later)?
3. **Cross-game permission model** — can a Game A author edit Game B's metadata? Default: no.
4. **Phase 4 timing for multi-step agent** — committed quarter, or only if Phase 1-3 evidence shows need?
5. **Tenant scoping in catalog** — POC is single-tenant (Ballistar VN). When does multi-tenant land?
6. **MCP/CDP auto-publish migration** — Q13 of the business case. Webhook from Cube to MCP/CDP on metadata change — owned by which team?
