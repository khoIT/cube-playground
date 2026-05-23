---
type: brainstorm
date: 2026-05-22 16:32 ICT
audience: leadership / liveops (consumer surface) + analyst / data author (secondary)
status: design-locked
related:
  - plans/reports/compass/Compass_v2/HANDOFF.md
  - plans/reports/research-260522-1145-data-product-demo-flows.md
  - plans/reports/_GDS__-_1_8_Metrics_Definition.md
---

# Catalog — Compass v2 Redesign (Two-Layer Semantic Catalog)

## TL;DR

Replace current 2-tab Catalog (cube cluster browser + Schema) with a **4-tab Catalog** centred on a Compass-style **two-layer architecture**:

1. **Metrics tab (default)** — named business KPIs (DAU, ARPDAU, paying_users…) from a new `business-metrics/*.yml` registry. Consumer surface.
2. **Data Model tab** — measures + dimensions + segments concept-first grid. Author surface.
3. **Cubes tab** — current cluster browser, preserved as-is.
4. **Models tab** — current SchemaPage, preserved as-is.

Same shell hosts a new **ConceptDetailPage** that subsumes `MetricCardPage` and unifies the 3 building-block kinds plus business metrics. Right-rail "Push to activation" closes Flow 5 from research file. Two wizards: rebranded current (building block) + new Metric Composition. Trust / Freshness signals mocked v1 from YAML + `refresh_key`. Anomaly + Drift + NL search + Digest land in later phases. Lead-with-leadership phasing: P1 shell → P2 Metrics consumer surface → P3 Activation hook → P4 Data Model → P5 wizards → P6+ depth.

---

## 1. Problem statement

**Current Catalog is cube-first.** Cards represent cubes; concepts (measures/dims/segments) are buried inside per-cube detail panels. Demo target is leadership / liveops — they don't think in cubes, they think in named KPIs ("ARPDAU is down 12%, why?"). Cube-first layout adds friction.

**Current `New Metric` button is misleading.** It actually creates building blocks (measures / dimensions / segments via Step 0 kind picker), not business KPIs. The label fights the audience expectation.

**No business-metric registry.** GDS-1.8 metric definitions live in a doc; no in-app registry of named KPIs with tier / owner / synonyms / parameterisation. Without it, the consumer surface cannot land.

**Demo value loop is incomplete.** Research file argues lead with Flow 5 (Activation), Flow 3 (Metric Tree), Flow 4 (Anomaly push). Current Catalog is exploration-only — no activation hook from concept detail, no metric tree decomposition, no anomaly surface.

---

## 2. Decision log

| Q | Decision | Rationale |
|---|---|---|
| Scope | Full Compass v2 surface | User confirmed; phased over 8 phases |
| Tab IA | 4 sibling tabs: Metrics / Data Model / Cubes / Models | Honest about audience split (consumer vs engineering) |
| Signals (Trust / Freshness / Anomaly / Drift) v1 | Mocked from YAML + `refresh_key`; Anomaly + Drift deferred | No backend signals today; YAML default for Trust; refresh_key diff for Freshness |
| Wizards | Two distinct wizards | Current = "New building block" (rename); new = "Metric composition" (compose blocks into named KPI) |
| Metrics registry | New `business-metrics/*.yml` in **cube-dev** repo, seeded from GDS-1.8 | Consistent with existing YAML pattern in cube-dev/cube/model/ |
| Detail pages | New `ConceptDetailPage` subsumes `MetricCardPage` | Existing is measure-only; new handles 4 kinds (measure / dim / segment / business-metric) |
| `cdp-projection` | Fold into ConceptDetail Slices-tab section + filter chip | Keep functionality, rehome content |
| Cube rename | Not supported in v1 | Removes alias-table scope; renames → 404 (acceptable) |
| Audience | Leadership / liveops; focus features + UX | Re-orders phases — consumer surface ships before author surface |
| AI agent (⌘K) | Plan for future Monet-style FastAPI/SSE service; v1 substring scorer | Substring works today; agent wire later |
| Anomaly detector | Plan for one; v1 mocked YAML state, v2 scheduled z-score job | Research said no ML needed for v1 |
| No deadline | Phase ruthlessly anyway | Avoid open-ended scope creep |

---

## 3. Information architecture

```
/catalog                       (Page shell + 4 tabs)
  ├─ /catalog                  →  Metrics tab (default)
  ├─ /catalog/data-model       →  Data Model tab (NEW concept-first grid)
  ├─ /catalog/cubes            →  Cubes tab (current cluster browser, preserved)
  └─ /catalog/models           →  Models tab (current SchemaPage, preserved)

/catalog/metric/:id            →  MetricDetailPage  (business KPI detail, 5 tabs)
/catalog/concept/:type/:fqn    →  ConceptDetailPage (measure/dim/segment detail, 5 tabs)

/metric/:cube/:member          →  Redirect → /catalog/concept/measure/:cube.:member
```

**Tab content per audience**

| Tab | Audience | Source | Card unit |
|---|---|---|---|
| Metrics | leadership / liveops / analyst | `business-metrics/*.yml` registry | one card per named KPI |
| Data Model | analyst / data author | Cube `/meta` projected per-concept | one card per measure OR dimension OR segment |
| Cubes | engineering / data modeller | Cube `/meta` (unchanged) | one card per cube (unchanged) |
| Models | engineering | unchanged SchemaPage | n/a |

---

## 4. Business metrics registry (new)

**Location:** `/Users/lap16299/Documents/code/cube-dev/business-metrics/*.yml` (sibling of `cube/`)

**Backend integration risk:** cube-playground frontend needs to consume this. Two options for backend wire:
- (A) New endpoint on Cube backend that mounts `business-metrics/` (preferred — consistent with `/meta`)
- (B) Static file mount + JSON index file generated at build time

Decision deferred to planner — pick whichever the cube-dev backend can ship fastest.

**YAML schema (per file):**

```yaml
id: arpdau                               # unique slug; matches filename
label: ARPDAU                            # display name
description: Average revenue per daily active user.
synonyms: [arpu_daily, avg_rev_per_dau]  # NL search hits
tier: 1                                  # 1=North-star  2=Driver  3=Operational  4-6=Diagnostic
domain: revenue                          # revenue|engagement|acquisition|retention|payments|concurrency|marketing
owner: data-platform@vng                 # group or person
trust: certified                         # certified|beta|draft|deprecated|orphaned
formula:
  type: ratio                            # ratio|passthrough|parameterised
  numerator: orders.revenue_vnd          # FQN ref into Data Model layer
  denominator: sessions.dau
parameter:                               # optional family — controls Compass parameterised picker
  name: cohort_window
  options: [d1, d7, d30]
related_concepts:                        # commonly-used slicers; auto-bootstraps Slices tab
  - users.country
  - users.platform
  - segments.paying_users
```

**Seed:** ~20 metrics from `plans/reports/_GDS__-_1_8_Metrics_Definition.md`. Default all to `trust: certified` since they're canonical GDS definitions. Anything authored post-seed defaults to `trust: draft`.

---

## 5. Metrics tab spec (P2)

Maps `compass/page-catalog.jsx#MetricsTab` 1:1.

**Layout:** filter rail (left) · search row · grid OR table (right)

**Filter rail** — 6 facets:
- Domains (7 chips with colour swatches)
- Trust (5 states — Tweak-controlled prominence: quiet / medium / loud)
- Owners (avatar list)
- Tiers (1-3 visible by default; "Show diagnostic 4-6" toggle)
- Parameterised toggle (Compass §5.2)
- "Show deprecated/orphaned" toggle

**Search row:**
- Substring input on label / synonyms / description
- "Smart search" CTA → opens ⌘K overlay (lands P6)
- Result count `X of Y`
- View toggle: grid / table

**Card content** (one per business metric):
- TypeIcon (function-square) + TierBadge
- Label (`ARPDAU`) + synonyms inline (smaller)
- Description (2-line truncate)
- TrustBadge · FreshnessChip · DomainChip
- Sparkline (Phase 2 placeholder; Phase 7 real)
- Owner avatar (right)
- AnomalyBadge (Phase 7; placeholder slot only in P2)

**Click card →** `/catalog/metric/:id`

**Header CTA:** `+ New metric` → opens **Metric Composition wizard** (lands P5).

**Empty state:** Import banner with "Seed from GDS-1.8" action (visible when registry < N entries).

---

## 6. Data Model tab spec (P4)

Maps `compass/page-catalog.jsx#DataModelTab`.

**Layout:** filter rail · search row · concept grid

**Filter rail:**
- Type (measure / dim / segment, multi)
- Domain
- Cube (multi)
- Trust state
- "Show CDP-projected only" (folds in `cdp-projection` filter)
- "Unreferenced only" (orphans not used by any business metric)

**Card content:**
- TypeIcon (orange=measure, blue=dim, purple=segment)
- Concept FQN (`orders.revenue_vnd`)
- Owner cube name (small)
- Description (from cube YAML `meta`)
- TrustBadge · FreshnessChip · DomainChip
- "Used by N metrics" (count of business-metrics referencing this concept)

**Click card →** `/catalog/concept/:type/:fqn`

**Header CTA:** `+ New building block` → opens existing wizard at `/metrics/new?v=2` (rebrand only — URL change deferred to P5).

---

## 7. Detail pages (P2 + P4)

**Two routes, shared 5-tab shell.**

```
/catalog/metric/:id            → MetricDetailPage    (P2)
/catalog/concept/:type/:fqn    → ConceptDetailPage   (P4)
```

**Shared 5-tab layout** (per `compass/page-metric-detail.jsx`):

| Tab | MetricDetailPage | ConceptDetailPage |
|---|---|---|
| Overview | description · tier · synonyms · owner · trust · freshness · sparkline · linked-dashboards count | description · trust · freshness · owner · sample distribution (reuse existing histogram code from `analysis/distribution-mode.tsx`) |
| Formula | ratio expression w/ clickable FQNs · compiled SQL preview | YAML preview (read-only) · compiled SQL preview |
| Lineage | 3-col static: upstream cubes → this metric → downstream metrics/views/dashboards | upstream cube → this concept → downstream metrics that ref it |
| Slices | reachable dims+segments · "How to slice" · related metrics that share dims | "How to slice" + "Joinable with" + "Similar measures" — rehome existing `metric-card-how-to-slice.tsx`, `metric-card-joinable-with.tsx`, `metric-card-similar-measures.tsx` modules. For measure kind: also include `cdp-projection-card.tsx` section. |
| Activity | edit history · subscribers · usage trend (stub P2; real P8) | edit history · referenced-by · usage trend (stub P4; real P8) |

**Right rail (both pages):**
- "Open in Explore" → preload QueryBuilder with metric or concept selected
- **"Push to activation"** ⭐ — wires to existing `push-modal` (Flow 5 hook; lands P3 for MetricDetail, P4 for ConceptDetail of segment kind)
- "Subscribe" → digest stub (real P8)
- "Edit metadata" → inline edit (Compass Tweak: inline vs toggle)

**Migration:** `MetricCardPage.tsx` (`/metric/:cube/:member`) becomes a permanent redirect to `/catalog/concept/measure/:cube.:member`. The 3 metric-card-* content modules and cdp-projection module are *moved*, not rewritten — they become content sources for the Slices tab.

---

## 8. Wizards (two distinct, P5)

| Wizard | Route | Creates | Reuses |
|---|---|---|---|
| **Building Block** (current, rebranded) | `/metrics/new?v=2` (URL stays; rename to `/data-model/new` is a P5 cleanup detail) | YAML for measure / dimension / segment | Full existing `NewMetricPage` step graph |
| **Metric Composition** (new) | `/catalog/metric/new` | YAML in `business-metrics/` | Borrows step-chrome / left-rail / right-rail from existing wizard |

**Metric Composition wizard steps** (per `compass/page-wizard.jsx`):

1. **Type** — passthrough · ratio · parameterised family
2. **Numerator** — pick a measure (search Data Model concepts; cross-link to Building Block wizard if missing)
3. **Denominator** — pick another measure (skipped for passthrough)
4. **Slices** — pick recommended dims + segments (suggested from cube join graph)
5. **Parameter** — optional family (e.g. `cohort_window: [d1, d7, d30]`)
6. **Metadata** — id · label · synonyms · domain · tier · owner · trust=draft · description

The Metric Composition wizard *reads* Data Model concepts but cannot create them — if a needed measure is missing, deep-link to Building Block wizard with a return URL.

**Shared shell:** extract `WizardShell` / `WizardLeftRail` / `WizardStepChrome` components used by both wizards. Don't duplicate.

---

## 9. Demo-flow integrations (P3)

The new Catalog is the launchpad for the three demo-value flows from `research-260522-1145-data-product-demo-flows.md`.

### Flow 5 — Segment → Activation ⭐ LEAD

**Wire:** MetricDetail (segment kind) right-rail "Push to activation" → existing `push-modal` (verified at `src/pages/Segments/push-modal/push-modal.tsx`).

**Cohort path:** MetricDetail (measure kind) → "Open as cohort" → QueryBuilder preloaded → save as segment → push.

**Build cost:** wiring only. push-modal already exists.

### Flow 3 — Metric Tree drill-down

**Surface:** MetricDetailPage Lineage tab.

**v1 (P3):** static 3-column layout (upstream cubes → metric → downstream metrics). Authored from `formula:` refs in business-metric YAML.

**v2 (P5+ via Metric Composition wizard):** decomposition tree. Click parent metric → contribution math (ARPDAU = DAU × revenue/DAU). Click child → slice-by-dim → land in QueryBuilder. Authoring belongs in Metric Composition wizard's Formula step (Step 1 type = `decomposition`).

### Flow 4 — Anomaly push

**Surface:** AnomalyBadge on Metrics tab cards + MetricDetail header.

**v1 (P3):** ChangeAnalysisModal stub (per `compass/page-extras.jsx#ChangeAnalysisModal`) — click anomaly badge → modal with mocked Country / Channel / Tier breakdowns → "Save as segment" → push-modal.

**v2 (P7):** scheduled z-score / EWMA detector job over Cube queries. Writes anomaly state to a JSON store / DB; UI reads it. Slack/in-app delivery deferred to P8.

---

## 10. ⌘K NL search (P6)

Maps `compass/app-shell.jsx#GlobalSearchOverlay`.

**Scope:** searches business metrics + concepts (eventually + dashboards).

**P6 v1:** substring scorer per mockup (`searchConcepts()` from `app-shell.jsx`). Component mounted in `App.tsx`, ⌘K / Ctrl+K trigger. Zero backend dependency.

**P6 v2:** plug into future Monet-style FastAPI service (port 3002 pattern per `~/Downloads/monet-v1.3-20260519/README.md`):
- POST query → SSE stream of typed events (reasoning trace + final answer)
- 10 event types from monet template — adapt to "match", "snippet", "open-route" events
- Reuse monet's MCP plumbing if our agent needs to call cube `/meta`

---

## 11. Signal sources strategy

| Signal | v1 (P1–P5) | v2 (P7) |
|---|---|---|
| Trust | YAML field `trust:` per metric/concept. Seed `certified` for GDS-1.8. Default `draft` for new. | (no change) |
| Freshness | Computed at render from cube `refresh_key` timestamp diff. Buckets: ok <1h / warn 1-24h / stale >24h | (refine bucketing per cube) |
| Anomaly | YAML placeholder field `anomaly: { state, deltaPct }` — empty for most concepts. UI renders badge when present. | Wire to scheduled detector job (z-score / EWMA over Cube queries, no ML) |
| Drift | Deferred entirely | YAML overlay vs canonical GDS-1.8 entry comparison |

---

## 12. Phasing (concrete deliverables)

Audience-first ordering: consumer surface (Metrics + Activation) ships before author surface (Data Model + wizards).

| Phase | Deliverables | Approx scope |
|---|---|---|
| **P1 — Shell** | 4-tab Catalog routing. Empty `Metrics` + `Data Model` placeholder tabs. `Cubes` + `Models` preserved as-is. Redirects: `/catalog` → Metrics; `/metric/:cube/:member` → `/catalog/concept/measure/...` | ~200 LOC + routing |
| **P2 — Metrics tab + MetricDetail** | `business-metrics/*.yml` registry (seed ~20 from GDS-1.8) · backend endpoint (cube-dev side) · Metrics tab grid · filter rail · MetricDetailPage 5-tab shell · Overview + Formula + Slices + Activity (Activity stub, Lineage placeholder) | Largest phase |
| **P3 — Demo value loop** | Right-rail Activation hook → push-modal · ChangeAnalysisModal stub on Anomaly badge · Lineage tab v1 static 3-col layout · AnomalyBadge placeholder on Metrics cards | Closes the leadership demo |
| **P4 — Data Model tab + ConceptDetail** | Data Model tab grid · filter rail · ConceptDetailPage subsumes MetricCardPage · rehome metric-card-* + cdp-projection modules · 3 redirects | Author surface |
| **P5 — Wizards** | Rebrand current wizard (label + success copy) · extract WizardShell · build Metric Composition wizard (6 steps) · entry from Metrics tab "+ New metric" | Author tools |
| **P6 — ⌘K NL search** | v1 substring overlay · v2 (when agent ships) HTTP/SSE client | Discovery polish |
| **P7 — Signal upgrades** | Freshness real wiring · Trust seeding pass · AnomalyBadge wired to scheduled detector | Quality layer |
| **P8 — Long tail** | Digest / Subscribe / Saved Views / Workspaces / Notifications | Depth |

**P1–P3 = leadership demoable core.** Cut here if scope pressure arrives.

---

## 13. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Backend endpoint** for `business-metrics/` not yet planned — cube-dev side change required | Decide A (Cube backend mount) vs B (static + JSON index) in P2 planning. Flag to cube-dev maintainers early. |
| R2 | **Existing `MetricCard` component graph is measure-only** (`MetricCardPage.tsx:93`) | Don't reuse `MetricCard` shell. Rehome only the 3 content modules. New shell per ConceptDetailPage. |
| R3 | **`cdp-projection` is wired into measure-row expansion today** (`src/pages/Catalog/cdp-projection/cdp-projection-card.tsx`) | Rehome to Slices tab; preserve `use-cdp-verify` hook intact; remove inline mount from current detail panel as part of P4. |
| R4 | **Two wizards diverging UX** | P5 explicitly extracts shared `WizardShell` package; both wizards depend on it from day one. |
| R5 | **Trust state seeding noise** | Default existing concepts to `beta` (not `draft`) so badges aren't a sea of "draft". GDS-1.8 metrics → `certified`. Known-deprecated → `deprecated` (manual pass). |
| R6 | **Compass mockup uses Babel-in-browser + window-globals** | Mockup is spec, not source. Estimate each phase's rewrite cost in TS/React honestly. |
| R7 | **Cube name in concept URL = stale-link risk** if a cube is renamed | Accepted (out of scope). Documented as known limitation. Renames return 404 with a "back to Catalog" link via existing not-found UI. |
| R8 | **Phase 2 is heaviest** — registry + endpoint + grid + detail shell + 5 tabs in one phase | P2 will likely break into 2-3 plan phases when planner expands. Brainstorm-level "phase" ≠ plan-level "phase". |

---

## 14. Out of scope (anti-YAGNI)

- ❌ Cohort comparison surface (research file: skip v1)
- ❌ Notebook surface (Hex-style — too technical for audience)
- ❌ Anomaly ML — P7 uses simple thresholds
- ❌ Embedded views (Compass §5.14)
- ❌ Workspaces canvas (P8 light shell only)
- ❌ Multi-step agent (⌘K reserved space only — P6 v1 substring; v2 monet wire)
- ❌ Real-time websocket subscriptions — Digest is poll/scheduled
- ❌ Cube rename support (R7)
- ❌ External activation destinations beyond existing `push-modal` for v1

---

## 15. Success criteria

**P1 (Shell):**
- 4 tabs render with correct routing
- `/metric/:cube/:member` redirects work; no broken bookmarks
- Cubes + Models tabs functionally unchanged
- All current Catalog tests still pass

**P2 (Metrics tab + Detail):**
- 20 seed metrics from GDS-1.8 visible on Metrics tab
- Click → MetricDetailPage opens with 5 tabs populated
- Filter rail filters work (Domains / Trust / Tier)
- Substring search finds metric by label / synonym
- Freshness chip shows correct bucket for at least one metric

**P3 (Demo loop):**
- From MetricDetail → "Push to activation" opens push-modal preloaded
- AnomalyBadge clickable → ChangeAnalysisModal renders mocked breakdowns → "Save as segment" lands in segments page
- Lineage tab shows static upstream/downstream for ratio-type metrics

**P4 (Data Model tab):**
- Concept-first grid replaces cube-row expansion as the primary measure/dim/segment surface
- ConceptDetailPage works for all 3 kinds
- `MetricCardPage` redirects to ConceptDetailPage with all old content preserved
- CDP-projected filter chip + Slices-tab section work end-to-end

**P5 (Wizards):**
- Building Block wizard rebranded (no behaviour change)
- Metric Composition wizard creates a valid `business-metrics/*.yml` that appears on Metrics tab without refresh
- Shared `WizardShell` extracted; both wizards depend on it

**Demo readiness criterion (after P3):** Run the research file's 4-step demo order (Flow 5 → Flow 3 → Flow 4 → Flow 1/2) end-to-end from the new Catalog without dropping into the QueryBuilder for setup.

---

## Unresolved questions

1. **Backend wire** for `business-metrics/` (cube-dev mount vs static + JSON index). Planner decides per cube-dev backend feasibility.
2. **Inline-edit vs toggle-edit** on detail pages (Compass Tweak §10.3). Default in P2; revisit after first user trial.
3. **Trust badge prominence** (Compass Tweak §10.4: quiet / medium / loud). Default = medium; pick after seeding the registry.
4. **Sparkline data source** in Metrics tab cards — last-30d via Cube query at render time, vs pre-computed snapshot. Affects P2 perf budget.
5. **Lineage v2** — does the decomposition tree authoring belong in Metric Composition wizard (P5) or in a dedicated "Edit lineage" affordance in MetricDetail (later)?
6. **Anomaly detector hosting** (P7) — runs inside cube-dev as a scheduled job, or as a small standalone service alongside Monet?
7. **GDS-1.8 import banner** (Compass `page-catalog.jsx`) trigger threshold — show until N seed metrics installed? Or always-dismissible?
