# Product-Layer Gap Analysis: From Cube YAML to Self-Serve Exploration

**Date:** 2026-05-18 (revised 19:21)
**Scope:** What product layers are missing between the cube YAML semantic model and a non-tech user who arrives with a question (any question, not just the 16 in the business case).

**Status:** Revised after pushback. v1 mis-framed the problem as "build templates for the 16 known questions"; v2 reframes around metadata-as-product + open-loop exploration. AI is a future rendering layer on top of these, not a foundation.

---

## Revision note

v1 of this report (above timestamp 18:41) proposed a question-template surface as the Phase 1 wedge. That framing is wrong and is replaced. Reasons:

- The 16 questions are stimuli, not the target. Real users will ask questions we haven't anticipated. Templates only cover today's list and dead-end on tomorrow's.
- A template surface trains users to wait for someone to build a template rather than explore. Worse than a blank query builder.
- The actual bottleneck for non-tech self-serve is **metadata an LLM, a search box, or a faceted browser can ground on**. Cube YAML has field names and types; it lacks business labels, synonyms, descriptions, formulas, lineage, and worked examples. Add those and three different rendering surfaces (LLM, typed search, faceted browse) all work. Skip them and none work.
- AI-only framing smuggles in a hidden claim that the bottleneck is language understanding. It isn't; it's the grounding payload.

The 16 questions still inform what intent shapes the UI must support (Section 1 retained). The recommendation set has changed.

---

## TL;DR — Revised Gap Summary

1. **Semantic layer (cube YAML) is complete.** All 16 question shapes are queryable. No data-model work needed.

2. **Vocabulary layer is missing.** Cube has field names; users have business words. The bridge (synonyms, descriptions, formulas, worked examples, lineage notes) does not exist in any structured form on the cube model. `_GDS_-_1.8_Metrics_Definition.md` is the seed glossary for measures, but it isn't bound to anything.

3. **Authoring of that vocabulary must be open to DA, DE, and business users.** That forces a two-store architecture: cube YAML in git (DE-owned, data model truth) + a metadata store keyed by `(cube, member)` (UI-edited, vocab truth, anyone can author with a governance state machine).

4. **The 16 questions cluster into 8 intent shapes** that are open-ended in their parameters — open-loop exploration over a rich-metadata catalog covers them, structured templates do not.

5. **Verb-first composition is the open-loop primitive.** From any result, one click to "by X", "compared to Y", "drilled into Z", "filtered to W". This replaces templates as the central UX.

6. **Two things the glossary doesn't yet cover:** dimensions/segments (the "by country / payer tier" axis) and parameterized metric families (A(n), PU(n), R*(n), RevRPI(n), ROAS(n), LTV(n) — ~10 of the 53 GDS entries are families, not single metrics).

7. **AI is a polish on top of #2–#5, not a substitute.** With metadata rich enough that a search box works, an LLM works too.

**Phase 1 wedge:** Metadata store + minimal authoring UI (label, description, synonyms[]) + GDS-1.8 importer + parameterized-family schema + Catalog tooltip integration. ~2 weeks. Validates the whole thesis before committing to Phase 2.

---

## Section 1: The 16 Questions, Clustered by Intent Shape (unchanged)

Retained from v1 — useful as a catalogue of what shapes the exploration UI must handle. **Not** a checklist of templates to build.

| Intent Cluster | Questions | User wants | Query primitives |
|---|---|---|---|
| **Single-number snapshot** | Q1, Q2, Q4 | One KPI, optional breakdown | measure + segment + dimensions |
| **Ranking / top-N** | Q3, Q10 | Sorted list | measure + dimension + order + limit |
| **Time series / trend** | Q5, Q6, Q11 | Line/heatmap, deltas | measure + time-dim + dimension + (time-shift / rolling) |
| **Cohort / conversion / retention** | Q7, Q9 | Rate(s) per cohort | filtered measures + cohort filter + dimension |
| **Per-user computed column** | Q8 | Group users by derived band | sub-query dimension + case |
| **Audience / ID list** | Q10 variant | Raw IDs, exportable | dimensions + segments, no aggregation |
| **Streak / sequence detection** | Q12 | Filtered user count | segment + dimension (needs upstream view) |
| **Auto-publish as metric** | Q13 | One metric → many outputs | metadata export, not a query |

---

## Section 2: Current Product Surfaces (unchanged)

| Surface | Who uses it | What it covers | What it doesn't |
|---|---|---|---|
| **Explore (Query Builder)** | SQL-fluent analysts, DEs | Any shape, blank canvas | Non-tech users get lost; no vocab affordances |
| **New Metric Wizard (6-step)** | Metric authors / DAs | Measure authoring → YAML | Dimensions, segments; no metadata-rich annotation |
| **Catalog** | Measure browsers | Browse all measures/dims/segments by cube | No business labels, descriptions, synonyms, worked examples; cube-centric not concept-centric |
| **Data Model (Schema)** | DEs / schema reviewers | Read-only cube definitions | Not user-facing |

---

## Section 3: Gap Matrix — Re-labelled (v2)

Same matrix as v1, but the gap labels are recategorised away from "needs a template" toward the real underlying need.

| Intent Cluster | Explore | Wizard | Catalog | Gap classification (v2) |
|---|---|---|---|---|
| Single-number snapshot | ✓ buildable | ✗ | ✗ | **Vocabulary + exploration verbs** — user can't find the measure or compose breakdowns |
| Ranking / top-N | ✓ buildable | ✗ | ✗ | **Exploration verbs** ("sort by", "top N") missing as one-click affordances |
| Time series / trend | ✓ buildable | ✗ | ✗ | **Exploration verbs** ("compare to last period", "show by week") missing |
| Cohort / conversion / retention | ✓ complex | ✗ | ✗ | **Metadata + composition** — needs cohort-aware filter UI on top of measures whose meaning is documented |
| Per-user computed column | ✗ author | ✓ measures only | ✗ | **Wizard scope** — dimensions/segments not yet authorable |
| Audience / ID list | ✓ buildable | ✗ | ✗ | **Output mode** — "no aggregation, export rows" missing as a query mode |
| Streak / sequence | ✗ | ✗ | ✗ | **Upstream data eng** — needs warehouse view first |
| Auto-publish | ✗ | ✓ wizard publishes | ✗ | **Delivery infra** — MCP/CDP integration |

**Key insight (unchanged):** the semantic layer supports every left-column query. The missing layer is *not* templates — it's **vocabulary** (so users can find concepts) plus **exploration verbs** (so users can compose them iteratively).

---

## Section 4: The Missing Pieces — Revised

v2 reorganises the gaps. **Gap A is the new prerequisite for everything else.**

### Gap A: Metadata-as-product layer (NEW — prerequisite)

**What users need to do:** Find the right cube member from a business word ("recharge", "DAU", "whales", "LTV at 30 days"), read what it means in plain English, see how it's computed, and trust the number before they use it.

**Why it matters:** Cube YAML carries field names and types, nothing else. A non-tech user sees `mf_users.successful_orders` and bounces. They want to see "Recharges — the number of successful payment transactions per user, computed from In-game logs, refreshed hourly, excluding refunds within 24h, used to answer Q1 in last QBR".

**UI shape:**
- **Two-store data model.** Cube YAML in git (data model truth, DE-owned, read-only from app). Metadata store keyed by `(cube_name, member_name)` with fields:
  - `business_label` (string, required) — what users call it
  - `description` (markdown) — plain-English meaning
  - `synonyms` (string[]) — alternate names ("recharge", "topup", "deposit", "успешный платеж")
  - `unit` ("count" | "VND" | "USD" | "%" | "ratio" | "days" | …)
  - `format` (display format hint)
  - `formula_text` (markdown) — the calculation in business terms (from GDS-1.8 "FORMULA" column)
  - `lineage_note` (markdown) — data source + caveats (from GDS-1.8 "DATA SOURCE" + "NOTE")
  - `sample_question` (string[]) — example business questions this answers
  - `domain` (enum: acquisition / engagement / revenue / retention / payments / concurrency / marketing / custom)
  - `parameter_decl` (optional) — for parameterized families (see Gap B)
  - `owner` (user id)
  - `status` (draft | proposed | approved | deprecated)
  - `last_edited_by`, `last_edited_at`, `approved_by`, `approved_at`
- **Authoring UI:** open to DA / DE / business user. Cheap field-level edit (think Notion / Linear-style inline editors), not a full wizard.
- **Governance state machine:** draft → proposed → approved → deprecated. Anyone can author a draft. Member-owner (or domain owner) approves. Approved is what the catalog/Explore renders by default; drafts visible only to author + owner.
- **Drift detection:** if a game's metadata for `revenue` differs from the canonical GDS-1.8 seed, surface the diff in the authoring UI ("Canonical definition is X; this game defines Y — confirm intentional or revert").

**Where it plugs in:**
- New backend table or local-first store (depends on infra). Backend route: `GET/POST /metadata/(:cube)/(:member)`.
- New surface in Catalog detail pane: edit-in-place fields (with permissions).
- Tooltip in Explore's member picker that pulls `business_label + description + unit + sample_question`.

**Effort:** M for v1 (label + description + synonyms[] + import GDS-1.8). L if governance state machine is included from day one. Suggest M first, governance in Phase 2.

**Impact:** Prerequisite. Every other gap below depends on rich metadata existing.

---

### Gap B: Parameterized metric families (NEW)

**What users need:** Pick "A(n) — Active Users in n Days" and choose n inline, not scroll past A1, A3, A5, A7, A14, A28, A30 in the catalog.

**Why it matters:** ~10 of the 53 GDS-1.8 entries are parameterized: `A(n)`, `PU(n)`, `Ruser(n)`, `RR(n)`, `Rpuser(n)`, `RP(n)`, `APR(n)`, `RevRPI(n)`, `ROAS(n)`, `LTV(n)`, `RevNRU(n)`, `CVR{funnel_step}`. Naive import to one-row-per-n produces ~100 catalog entries that bury the concept. Each family should be one concept in the metadata store, with the parameter rendered as a control.

**UI shape:**
- `parameter_decl` field in metadata: `{ name: "n", type: "enum", values: [1,3,7,14,30,60,90,120,150,180], label: "Days since install" }`.
- Catalog renders the concept once; member picker exposes a parameter dropdown.
- Cube member-name resolution: the parameter value maps to the underlying member (`PU(7)` → `mf_users.paying_users_7d`).
- Where the cube YAML uses a naming convention (e.g. `paying_users_7d`, `paying_users_14d`), the metadata declares the parameter family and a name template; the resolution layer maps `(family, param_value)` → concrete cube member.

**Effort:** M (data schema design + picker UI + resolution layer).

**Impact:** Without this, Gap A produces a noisy catalog. With it, the catalog shows ~40 distinct concepts instead of ~100+ near-duplicates.

---

### Gap C: Dimensions and segments are not in the glossary (NEW)

**What users need:** "by country", "by payer tier", "by media source", "whales in VN, lapsed 14d" all reference dimensions and segments. Right now, the GDS-1.8 glossary covers only measures. The metadata model from Gap A must extend to dimensions and segments from day one — same schema, empty content for now, populated as we go.

**Why it matters:** None of the 16 questions can be answered with measure vocabulary alone. Half the user's mental model is in the dimension/segment side ("which country, which payer tier, which lapsed window"). A search box that finds DAU but can't find "country" or "whales" fails immediately.

**UI shape:**
- Extend metadata store to include dimensions and segments (same `(cube, member)` keying — segments are just members with `type: segment`).
- Optional separate `domain` taxonomy for dimensions ("geo", "device", "monetization tier", "marketing attribution", …).
- Authoring flow is the same as for measures; no separate wizard.

**Effort:** S incremental on top of Gap A (no new schema, just extended content scope).

---

### Gap D: Verb-first composition (was Gap 1 — templates, reframed)

**What users need:** After getting any result, one click to "by X", "compared to Y", "drilled into Z", "filtered to W". This is the open-loop exploration scaffold that makes unknown questions answerable.

**Why it matters:** Templates close the loop on known questions and dead-end. Verb chips on every result keep the loop open — the user composes the next question from what they're looking at, not from a curated list. This is how Looker, Mode, Hex, Metabase, ThoughtSpot all let non-tech users self-serve.

**UI shape:**
- On every Explore result, render a chip row:
  - **By [dim ▾]** — adds a dimension to the current query
  - **Compare to [period ▾]** — adds a time-shift measure
  - **Drill into [row]** — for any row in a grouped result, opens a detail query filtered to that row's dimension values
  - **Filter to [segment ▾]** — adds a segment
  - **Granularity [day/week/month ▾]** — when a time dimension is present
  - **Sort by [measure ▾]** + **Limit [N]** — when ordering is implied
- Each chip is metadata-aware: only offer dims/segments relevant to the current cube context (using the cube model's reachability rules).
- "Save this exploration" replaces "save query" — captures the chip sequence, not just the final query JSON, so the user can resume and branch.

**Effort:** M for the chip framework + 3-4 verbs; L if all 6 verbs + reachability filtering are scope.

**Impact:** Replaces the templates pitch from v1. Closes the open-loop exploration gap that templates can't address.

---

### Gap E: Dimension authoring in New Metric Wizard (was v1 Gap 2 — retained)

Per-user computed columns like `spend_tier_7d` need a form-based authoring surface. Unchanged from v1; still needed for Q8 and similar.

**Note:** With Gap A in place, the wizard's output should also write metadata (label, description, sample_question) at publish time, not just YAML.

---

### Gap F: Segment authoring flow (was v1 Gap 3 — retained)

Visual filter-builder for segments like `whales_vn`, `lapsed_payer_14d`. Unchanged from v1.

**Note:** Same as Gap E — wizard must emit metadata alongside YAML.

---

### Gap G: Saved exploration (was v1 Gap 4 — reframed)

"Saved queries" reframed as "saved exploration sessions" — captures the verb sequence from Gap D, not just the final query JSON. Lets users resume *and branch* prior exploration. Parameterisable (date range, segment values).

**Effort:** M (storage + UI; localStorage for v1, backend later for sharing).

---

### Gap H: Drilldown handoff (was v1 Gap 5 — folded into Gap D)

Subsumed by Gap D's "Drill into [row]" verb. Not a separate gap.

---

### Gap I: Audience / ID-list output mode (was v1 Gap 7 — retained)

A query mode that returns user IDs instead of aggregates, with limits and CSV export. Still needed for Q10. Unchanged.

---

### Gap J: Metric-type badges in Catalog (was v1 Gap 8 — folded into Gap A)

Subsumed: the metadata `unit + format + parameter_decl + sample_question` give the user the same signal more richly. No separate badge layer needed once Gap A exists.

---

## Section 5: Revised Recommendations — Sequenced Build Plan

Sequencing rule: **metadata first, exploration verbs second, authoring extensions third, AI last.**

### Phase 1 (~2 weeks): Metadata-as-product MVP

Single shippable wedge that validates the whole thesis.

1. **Metadata store + minimal authoring UI.**
   - Schema: `(cube, member, business_label, description, synonyms[], unit, formula_text, lineage_note, sample_question[], domain, status, owner, audit fields)`.
   - Storage: backend table if infra allows; otherwise local-first with a sync path. Decision needed (see Open Questions).
   - Authoring: inline edit in Catalog detail pane, gated by permission (anyone can draft; status=approved is what Catalog/Explore renders).
   - Status state machine: minimal v1 — `draft | approved`. Full state machine (`proposed`, `deprecated`) in Phase 2.

2. **GDS-1.8 importer.**
   - Parse `_GDS_-_1.8_Metrics_Definition.md` → seed metadata for ~40 distinct concepts (~53 rows after collapsing parameterised families).
   - Manual reconciliation UI for measures whose cube member name doesn't match the GDS short name (expect 10-20% manual mapping).
   - Drift detection on subsequent re-imports.

3. **Parameterised-family schema** (Gap B).
   - `parameter_decl` field + name-template resolution.
   - Catalog renders one concept per family; picker exposes the parameter.

4. **Catalog + Explore integration.**
   - Catalog detail pane: render full metadata (label, description, formula, lineage, sample questions, parameter picker if family).
   - Explore member-picker tooltip: business_label + description + unit + first sample_question.
   - Synonym-aware search in Catalog (substring match on label, synonyms[], description).

**Acceptance:** A non-tech user opens Catalog, types "recharge", sees `Successful Orders / "Recharges" / Description: …` instead of a raw cube field name. They click "Use in query" and Explore opens with that measure selected and the same metadata visible in the tooltip.

**Effort:** ~2 weeks. ~1 frontend, ~0.5 backend (or all FE if local-first).

---

### Phase 2 (~3-4 weeks): Exploration verbs + dimension/segment coverage

5. **Verb-first composition chips** (Gap D).
   - Implement chip framework + first 3 verbs: **by X**, **compared to last period**, **drill into row**.
   - Render on every Explore result.
   - Save-as-exploration uses the chip sequence.

6. **Metadata for dimensions and segments** (Gap C).
   - Extend metadata store scope.
   - Author the first 10-20 dimensions (country, payer_tier, media_source, OS, days_since_install, etc.) — these are reusable across games.

7. **Governance state machine** (full).
   - `proposed` + `deprecated` states + owner approval flow.
   - Audit trail visible in detail pane.

**Acceptance:** A non-tech user runs "Revenue by country, this month", clicks "compared to last period" → query updates with a time-shift measure side-by-side. Saves the exploration. Comes back next week, clicks "Resume" → same query runs against new data.

---

### Phase 3 (~3-4 weeks): Authoring surfaces for non-tech authors

8. **Dimension authoring** (Gap E) — case-banded, derived-time, passthrough.
9. **Segment authoring** (Gap F) — visual filter-builder, no SQL.
10. **Audience / ID-list output mode** (Gap I) — query mode + CSV export + hard-cap on row count.

All three reuse existing wizard scaffolding from `src/QueryBuilderV2/NewMetric/`. Each emits both YAML *and* a seeded metadata entry (the author fills in label + description + synonyms during the wizard).

---

### Phase 4 (later): AI as a rendering layer + delivery infra

11. **AI agent.** Natural-language input mapped to metadata. Implementation is a retrieval pipeline over the metadata store (embeddings on description + synonyms + sample_question), returning candidate cube members with explanations the user can confirm. The LLM is the search interface, not the planner.
12. **Q12 streak / sequence view.** Requires data-eng work upstream (warehouse view) before any UI piece.
13. **Q13 auto-publish to MCP + CDP.** Backend / MCP work; metadata store is already the source of truth (publishing emits from `(cube, member)` + metadata fields).

---

## Section 6: Risks & Open Decisions

### Risks

| Risk | Mitigation |
|---|---|
| **Metadata authoring goes uncurated → low quality.** Anyone can write, no one approves. | Governance state machine (Phase 2). Approved-by-default rendering hides drafts from public surfaces. Owner notifications on `proposed` status. |
| **Drift between game definitions of canonical metrics.** Game A says `revenue = X`, Game B says `revenue = Y`. | Drift detection against the GDS-1.8 seed; surface diffs in authoring UI for explicit confirmation. Treat divergence as a feature (sometimes correct), not a bug. |
| **Two-store sync goes out of band.** Metadata references a cube member that no longer exists. | On YAML deploy, run reconciliation pass: metadata entries referencing missing members get `status: orphaned` + UI warning. |
| **Parameterised families confuse users.** "Why does A(n) have a dropdown but Revenue doesn't?" | Render parameter pickers inline with the metric name (`Active Users — n=7`), not as a separate control. |
| **Verb chips overwhelm the result UI.** 6 chips per row, screen clutter. | Progressive disclosure: 3 default verbs visible, "more" chevron exposes the rest. Reachability filtering removes chips that can't apply. |
| **AI built without rich metadata = hallucination.** Team builds the LLM layer too early. | Explicit sequencing: AI is Phase 4. Make this a written ordering, not a guideline. |

### Open Decisions (need product/eng input)

1. **Storage for metadata store.** Backend table (Postgres? Cube's existing schema-write API?) or local-first with sync? Affects what "anyone can author" actually means in practice.
2. **Who owns the canonical GDS-1.8 seed?** When the seed changes, how do per-game overlays inherit vs override?
3. **How parameterised families are represented in cube YAML.** Naming convention (`paying_users_7d`, `paying_users_14d`) or genuine `parameter` block in cube? The resolution layer is simpler if YAML uses a convention; richer if cube supports the concept natively.
4. **Search backend.** Substring + synonym match is enough for Phase 1. Vector embeddings (Phase 4 prereq) — same store or separate? When?
5. **Per-game permission boundaries.** Can a Game A author edit Game B's metadata? Assume no for now; needs confirmation.
6. **Wizard convergence.** Current New Metric Wizard authors measures and emits YAML only. To emit metadata too, the wizard's last step needs three new fields (label, description, synonyms). Same wizard for measures, dimensions, segments — or branched? Recommend unified landing + branched flows.

---

## Section 7: What this changes about the existing codebase

Concrete touch points (not exhaustive):

- **New backend (or local-first store):** metadata service. Routes: `GET /metadata/:cube/:member`, `POST /metadata/:cube/:member`, `GET /metadata/search?q=…`, `GET /metadata/by-cube/:cube`. ~2-3 days backend.
- **Catalog page** (`src/pages/Catalog/`): detail pane becomes editable for authorised users. Renders metadata fields. New search box bound to metadata search endpoint. ~3-5 days frontend.
- **Explore member picker** (`src/QueryBuilderV2/QueryBuilder*.tsx`): tooltip pulls metadata. Search box becomes synonym-aware. ~1-2 days.
- **New Metric Wizard** (`src/QueryBuilderV2/NewMetric/full-page/`): last step adds metadata-author fields (label, description, synonyms). ~1-2 days.
- **Importer script:** `scripts/import-gds-glossary.ts` — parse the markdown table, reconcile against cube `/v1/meta`, emit a seed batch with manual reconciliation UI for unmatched rows. ~2 days.
- **Parameterised-family resolution:** new module `src/data/parameterized-metrics.ts`. Maps `(family, param_value)` → concrete cube member name. Used by Catalog picker and Explore query construction. ~1-2 days.
- **Verb chips (Phase 2):** new component `src/components/ExplorationVerbs/`. Plugs into Explore result panel. ~3-4 days for v1 (3 verbs).

No changes to cube YAML, no changes to `/v1/meta` API, no changes to Cube's runtime. All work is at the application layer.

---

## Conclusion

The cube YAML is the data-model truth. Today's UI exposes it well to data-fluent users and poorly to everyone else. The missing layer is not templates, not an AI agent — it's **a metadata layer that translates cube field names into business vocabulary, plus an exploration scaffold that lets users iteratively compose questions against that vocabulary**.

Once both exist, AI is a polish — a search-input modality on top of the same retrieval target. Without them, AI hallucinates and a typed search box returns nothing useful. With them, three different rendering surfaces (typed search, faceted browse, LLM) all work, and the cost of asking the next question drops permanently because nothing in the system is question-specific.

**Build Phase 1 first.** Metadata MVP + GDS-1.8 import + Catalog tooltip is ~2 weeks. It validates the metadata-as-product thesis with the smallest possible commitment and lights up real measure-finding for non-tech users on day one of Phase 2.

---

## Open Questions

1. What's the storage substrate for the metadata store (backend, local-first, hybrid)?
2. Who owns canonical-seed vs per-game-overlay reconciliation?
3. Is the New Metric Wizard the right place to graft dimension and segment authoring, or a parallel surface?
4. Does cube support parameterised metric families natively, or do we layer it on top with a naming convention?
5. Permissioning: cross-game read? Cross-game edit? Default deny is the safe assumption — confirm.
6. Phase 4 AI: in scope after Phase 3, or only if Phase 1-3 evidence shows the typed/faceted surfaces aren't enough?

---

**References:**
- Business case: `business-case-260518-cube-semantic-layer-tables.md` (16 questions)
- Glossary seed: `_GDS_-_1.8_Metrics_Definition.md` (53 metrics, parameterised families included)
- Prior research: `archived/research-260515-1721-metric-request-ui-flow.md`, `archived/research-260517-measures-dimensions-segments-mental-model.md`
- Conversation thread that produced this revision: session 2026-05-18 19:13–19:21
