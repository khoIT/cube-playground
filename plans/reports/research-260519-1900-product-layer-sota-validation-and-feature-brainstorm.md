# Product Layer on Cube Semantic — SOTA Validation + Feature Brainstorm

**Date:** 2026-05-19 19:00
**Author:** khoitn
**Scope:** Generalize user personas/usecases from the 13 (claimed 16) business-case questions, validate the v2 plan in `research-260518-1841-product-gaps-non-tech-question-flow.md` against state-of-the-art tools (Tableau Pulse, ThoughtSpot Sage/Spotter, Databricks AI/BI Genie, Snowflake Cortex Analyst, dbt Semantic Layer / MetricFlow, Atlan, Hex, Mode), and propose product surfaces *missing* from the current proposal.

**Status:** Research output, not a plan. Hand to planner once direction is chosen.

---

## TL;DR

1. **v2 thesis is correct and aligned with SOTA convergence.** Every serious 2025-26 tool (Cortex Analyst, Genie, dbt SL, Cube Cloud, ThoughtSpot Spotter) is now organized around: *semantic layer ⇒ rich metadata ⇒ AI/search as a surface*. v2's sequencing (metadata first, AI last) is right.

2. **v2 covers the "find a metric + compose a question" gap well.** Gaps A–D handle Discovery/Framing/Execution, which are the dominant SOTA themes for non-tech self-serve.

3. **v2 underserves four other modes that SOTA tools now treat as table-stakes:**
   - **Interpretation** (why did it move?) — SpotIQ change analysis, Tableau Pulse Insight Summaries.
   - **Monitoring/Proactive** (push KPI digests, anomaly alerts) — Tableau Pulse Metric digests, ThoughtSpot Monitor.
   - **Delivery/Subscription** (email/Slack/Notion embed, scheduled push) — every BI vendor.
   - **Trust/Lineage** (certified metric, owner, freshness, column-level lineage view) — Atlan, Select Star, Cube Cloud Catalog.

4. **Generalised persona model: 6 personas × 6 modes.** Most of the 13 questions probe Discovery/Framing/Execution; only Q13 hits Delivery; Interpretation and Monitoring are absent from the question set but are the dominant SOTA value props.

5. **Twelve product surfaces missing from v2.** Listed in §5 with effort/impact. Strongest five to consider for Phase 2.5 or 3: **Certified-metric badge + freshness SLA**, **Metric digest / subscription**, **Anomaly detection + change-analysis drill**, **Lineage panel from metadata**, **Slack/Teams ask-the-catalog bot**.

6. **Two strategic threats to v2's "AI is Phase 4" sequencing:**
   - Cortex Analyst and Genie set user expectations — non-tech users will arrive *expecting* NL Q&A. Phase 4 may need to be Phase 3 or run partially in Phase 1 as a *grounded* assistant (retrieval over the metadata catalog, no SQL gen) to manage that expectation.
   - The Open Semantic Interchange (OSI) standard emerging in 2025 (dbt + Snowflake + Salesforce) may pull metric definitions toward a vendor-neutral YAML format. v2's metadata schema should be OSI-aware day one to avoid a rewrite later.

---

## Section 1 — Generalised User Personas

Distilled from the 13 questions in `business-case-260518-cube-semantic-layer-tables.md`. (Title says "v3" but the file present is the 13-question version; the 16-question version implied in the slash-command brief was not located in the working tree. Personas below are inferred from the 13 + the 4-cube POC mapping in `metric-mapping-260519-poc-gds-vs-cubes.md`.)

| Persona | Owns | Asks questions like | Question coverage |
|---|---|---|---|
| **Liveops / Campaign Manager** | Tomorrow's push, IAP-shop schedule, soft re-engagement triggers | "Audience size for whales-VN-lapsed-14d by channel"; "users on 5-loss streak now"; "live count of paying users in VN" | Q1, Q10, Q12 |
| **Growth / UA Marketer** | Acquisition channel mix, cohort conversion, channel WoW health | "Top channels by 30d LTV"; "7d revenue per channel with WoW%"; "% of Jan cohort that converted in 30d" | Q3, Q6, Q7 |
| **Product Analyst / PM** | Pricing tiers, retention curve, spend banding | "ARPPU by tier × country"; "D1/D7/D30 retention paid vs organic"; "users grouped by 7d spend tier" | Q4, Q8, Q9 |
| **Finance / Exec** | Revenue splits, board deck, MTD-vs-prior | "Revenue this month split IAP vs Web"; "this-month vs last-month per OS"; "sub-second DAU dashboard" | Q2, Q5, Q11 |
| **Data Author (DA/DE)** | Authoring new metrics, dimensions, segments, audiences | "Define `whales`, publish to MCP+CDP, no code" | Q13 |
| **Data Engineer (upstream)** | Warehouse views, cube YAML, refresh SLAs | "Materialize streaks view; tune pre-agg refresh" | Q12 (upstream half) |

### Common traits across non-tech personas (Liveops, Growth, Product, Finance)

- **SQL-illiterate** but business-fluent. Reads "ARPPU" not `SUM(charged_value) / NULLIF(COUNT(DISTINCT user_id ...), 0)`.
- **Time-bounded** — most questions arrive with a deadline (tomorrow's push, this week's standup, monthly board deck).
- **Refines through comparison** — "vs last period", "vs last cohort", "vs another channel", "vs paid". A single number is rarely the answer; the *delta* is.
- **Trusts a number only if traceable** — needs to see source, formula, definition, owner before quoting it upward.
- **Wants the answer, not the chart** — if the answer is a single number or list, no visualisation needed. Chart is a tax for known answers.

---

## Section 2 — Generalised User Modes (the missing axis)

The 13 questions all probe one of three modes (Discovery, Framing, Execution). Real non-tech users cycle through **six** modes. v2 covers the first three well; the remaining three are where SOTA tools are pulling away.

| # | Mode | What user is doing | v2 coverage | SOTA coverage |
|---|---|---|---|---|
| 1 | **Discovery** | "What data do we have? What metrics exist?" | ✓ Gap A (metadata catalog), Gap C (dim/seg in glossary) | Atlan, Select Star, Cube Cloud Catalog |
| 2 | **Framing** | "I have a vague question — help me sharpen it" | ✓ Gap A (sample_question), Gap D (verb chips) | ThoughtSpot Sage, Hex Magic, Cortex Analyst |
| 3 | **Execution** | "Run my query, give me the answer" | ✓ Explore + Gap D verbs | All BI tools (table-stakes) |
| 4 | **Interpretation** | "Is this number normal? What's driving the change?" | ✗ Not in v2 | ThoughtSpot SpotIQ change analysis; Tableau Pulse Insight Summaries; Databricks Genie Research (beta) |
| 5 | **Monitoring / Proactive** | "Tell me when something moves; don't make me check" | ✗ Not in v2 | Tableau Pulse Metric digests; ThoughtSpot Monitor; AI agents that watch KPIs |
| 6 | **Delivery / Action** | "Send to my team / push pipeline / dashboard / Slack" | Partial — Q13 mentions MCP/CDP; nothing about Slack/email/embed | ThoughtSpot Liveboards in Slack; Tableau Pulse Slack digests; Hex embeds |

**Insight.** The 13-question set is a *Discovery-Framing-Execution* sample. It's a non-representative slice of real non-tech analytic work. A product designed solely against those 13 will hit the same wall every BI tool hit in 2018: users can find numbers but can't tell what they mean or be told when they change. SOTA tools spent 2023–2026 fixing exactly this.

---

## Section 3 — SOTA Landscape (May 2026 snapshot)

### Three convergent moves across vendors

1. **Semantic layer ⇒ AI** is the new orthodoxy. Cortex Analyst (Snowflake), Genie (Databricks), Spotter (ThoughtSpot), Hex Magic, Mode AI, and Looker AI all explicitly attribute AI accuracy to the underlying semantic layer. Tools without one "rely on raw schema inference, which breaks on any question that requires business context."

2. **Metric digests / proactive surfaces** are replacing dashboards as the default consumer surface. Tableau Pulse is the canonical example: a *digest* arrives in email/Slack with KPI movement + an AI-generated narrative, and the dashboard is the drill-down, not the homepage.

3. **Multi-step investigation agents** are emerging (Genie Research beta, ThoughtSpot Spotter, Databricks AI/BI agents). The pitch is: user asks one fuzzy question, agent decomposes into sub-queries, returns synthesised answer with citations to the underlying queries. Early; uneven quality; high LLM cost; but where the puck is going.

### Per-vendor brief

| Vendor | Surface | Standout feature vs v2 |
|---|---|---|
| **Snowflake Cortex Analyst** | NL → SQL grounded in semantic model YAML | Same architecture v2 proposes. Validates that "metadata is the moat, AI is a surface." |
| **Databricks AI/BI Genie** | Conversational BI grounded in Unity Catalog | Same. But: "not self-service" — still needs data eng to set up. Implies v2's authoring-by-business-user is the harder problem. |
| **ThoughtSpot Sage / Spotter** | NL search + drill-anywhere + agentic decomposition | "Drill anywhere" matches v2's verb chips. Spotter agent surfaces what's coming after that. Human feedback loop trains the NL mappings — v2 should design for this from day one. |
| **Tableau Pulse** | Metric digest + auto-narrative + anomaly | Not in v2 at all. This is the consumer-surface gap. |
| **Hex Magic / Mode AI** | NL → notebook cell with SQL + chart, branchable | Bridges analyst and non-tech; non-tech reads the result, analyst inherits the SQL for forking. v2's "saved exploration" should adopt this branching semantic. |
| **dbt Semantic Layer (MetricFlow)** | YAML metric definitions, GA Oct 2024, 18% adoption | Same model as Cube. **OSI standard convergence** means v2's metadata schema should anticipate vendor-neutral export. |
| **Atlan / Select Star / Castor (Coalesce)** | Data catalog + business glossary + lineage | Column-level lineage view is the missing piece in v2. Authoring UX is what v2 is trying to build *inside* the playground rather than in a separate catalog tool — defensible if integrated tightly with Explore. |
| **Cube Cloud Data Catalog** | Cube's own catalog of measures/dims/segments with descriptions | Direct competitor to v2's Gap A. Why v2 is correct anyway: Cube Cloud Catalog is read-only on the YAML; v2 adds the authoring + governance + vocab overlay that Cube Cloud does not. |

### What v2 gets right (validated by SOTA)

- **Metadata as moat, not AI as moat.** Every leading vendor in 2026 confirms this ordering.
- **Two-store architecture (YAML + metadata overlay).** dbt's MetricFlow YAML + Atlan's overlay catalog mirrors this exactly.
- **Verb-first composition.** ThoughtSpot's "Drill anywhere" + drill-down suggestions; Hex's branching cells; Cortex Analyst's follow-up Q&A — all variants of v2's verb-chip thesis.
- **Authoring open to business users with governance state machine.** Atlan's enterprise RBAC + AI-assisted documentation pattern.
- **Synonyms / sample questions for grounding NL.** Cortex Analyst's "verified queries" + glossary terms; ThoughtSpot Sage's feedback loop.

### What v2 leaves on the table

(Detailed in §5.)

- No proactive surface (digests, alerts, anomaly).
- No interpretation aids (change analysis, narratives, "why did X move?").
- No delivery surface beyond MCP/CDP (Slack, email, embed).
- No lineage visualisation (where does this number come from upstream?).
- No certified-metric / trust-badge layer.
- No human-feedback loop for metadata quality.
- No multi-step investigation agent (premature in Phase 1, but should not be ruled out for Phase 4).

---

## Section 4 — Validation Verdict on v2

**Build Phase 1 as written.** Metadata MVP + GDS-1.8 importer + Catalog tooltip is correct and validated by every SOTA reference architecture. ~2 weeks effort vs months of value — favourable ratio.

**Two adjustments to v2 before committing:**

### Adjustment 1: OSI-awareness in metadata schema

The Open Semantic Interchange standard (dbt + Snowflake + Salesforce, emerged late 2025) is consolidating semantic-layer YAML across vendors. v2's `(cube, member, business_label, description, …)` schema should be a *superset* of OSI's metric/dimension structure so that future export to dbt SL, Cortex, or Genie is mechanical.

**Practical impact on Phase 1:** Name fields to match OSI where possible (`label` → `display_name`, `description` stays, `synonyms[]` → `aliases[]`). 1 day of upfront naming reconciliation; saves a migration later.

### Adjustment 2: AI cannot be entirely Phase 4

Non-tech users arrive in May 2026 *expecting* a NL box (Cortex Analyst, Genie, ChatGPT have set this expectation). v2's "AI is Phase 4" risks a delivery-day reaction of "where is the chat?"

**Recommendation:** Ship a *grounded* NL search box in Phase 1 — but constrain it ruthlessly:
- Retrieval over metadata only (synonyms, descriptions, sample_questions). Returns ranked candidate measures/dims/segments.
- *Does not* generate SQL, *does not* generate cube queries.
- One-click to populate Explore with the candidate.
- Manages expectation: "I'm a smart catalog search, not an analyst."

Effort: S — vector embeddings over `description + synonyms + sample_question` already exist in any retrieval stack. ~3 days incremental on Phase 1.

This is *not* full Cortex Analyst-style NL→SQL. That stays Phase 4. But "type a phrase, find the right measure" is what Phase 1 vocabulary work makes immediately tractable — and shipping it day one signals "AI native" without taking on hallucination risk.

---

## Section 5 — Twelve Missing Product Surfaces

Ordered by my recommendation strength. Each carries effort (S/M/L), impact (low/med/high), and the SOTA reference that validates it.

### 5.1 ⭐ Certified-metric badge + freshness/SLA layer (M / high)

**What:** Visual badge on every measure: `Certified` / `Beta` / `Draft` / `Deprecated`, plus owner, last-validated date, refresh frequency (from cube's `refresh_key`), and "used in N dashboards / N MCP tools."

**Why it matters:** v2 has `status: approved` in the metadata schema, but the UI surface is implicit. SOTA tools (Atlan, ThoughtSpot, Tableau Catalog) all expose this prominently because non-tech users *will not quote a number upward without it*.

**SOTA refs:** Atlan certified-data badge, dbt Exposure tracking, Tableau Certified Data Sources.

**Effort:** M — schema already in v2 Gap A; UI affordance + freshness derivation from cube YAML + usage-count instrumentation.

**Recommendation:** Pull into Phase 1. Without it, the metadata layer feels like a wiki, not a trust layer.

---

### 5.2 ⭐ Metric digest / subscription surface (L / high)

**What:** User picks 5–20 metrics, sets cadence (daily, weekly, on-change), gets an email/Slack digest with KPI value + sparkline + delta vs previous period + AI-generated one-line narrative.

**Why it matters:** SOTA's biggest shift. Tableau Pulse, ThoughtSpot Monitor, and Databricks AI/BI all moved here in 2024-25 because "open the dashboard" is high friction. **Digest replaces dashboard as the default surface.**

**SOTA refs:** Tableau Pulse Metric Digest (canonical), ThoughtSpot Monitor, Hex Apps subscriptions.

**Effort:** L — needs a scheduler, a renderer, an email/Slack adapter, and (for the narrative) a small LLM call grounded in the metadata's `description + unit + format`. Approx 3-4 weeks for v1.

**Recommendation:** Phase 3 (after Phase 2 verbs land — gives the digest something to *link to* when the user clicks "explore further").

---

### 5.3 ⭐ Anomaly detection + change-analysis drill (M / high)

**What:** On each digest item (and inside Explore), surface "this moved X% vs expected." If user clicks: auto-decompose the change into contributing dimensions ("VN dropped 18%, IAP channel -22%, payer_tier=whale -34%"). Like SpotIQ.

**Why it matters:** *Interpretation* mode is the dominant SOTA value prop. Game ops gets value from "DAU dropped — why?" not from "DAU is 124,500."

**SOTA refs:** ThoughtSpot SpotIQ change analysis, Tableau Pulse Insight Summaries, Looker Liquid (for anomalies).

**Effort:** M for v1 — naive z-score / day-over-day anomaly on each measure with a known time dimension; cube already exposes all the inputs. Change-analysis drill is heavier (probably MultiAttributeContribution-style decomposition), defer to v2 of this feature.

**Recommendation:** Phase 3, alongside digest. Pair: digest surfaces anomaly badge → click → opens decomposition view.

---

### 5.4 ⭐ Lineage / formula panel from metadata (M / med)

**What:** On any measure detail pane, render: source table → cube → measure with the formula in business terms, plus links to upstream cubes/joins. Visual graph for measures that compose other measures (`arppu_vnd = ltv_total_vnd / paying_users`).

**Why it matters:** SOTA catalogs (Atlan, Select Star, Castor) lead with column-level lineage. v2's `formula_text + lineage_note` are text fields, but a *visual* lineage panel is much higher-trust for non-tech users and discoverable cross-cube relationships ("what is `paying_users` actually counting?").

**SOTA refs:** Atlan column-level lineage, dbt Exposures graph, Cube Cloud Data Catalog DAG view.

**Effort:** M — parse cube YAML for `joins`, `measures` referencing other measures via `{}`, and the metadata's `formula_text`. Render with Dagre / ReactFlow. 1 week.

**Recommendation:** Phase 2 (alongside verb chips — both are "trust and navigate" surfaces).

---

### 5.5 ⭐ Slack/Teams "ask-the-catalog" bot (S / high)

**What:** Slack slash command `/metric <phrase>` (or @mention the bot) → retrieves from metadata catalog → returns top 3 candidates with description + link to Explore. *Same retrieval as Adjustment 2's grounded NL box*, just exposed in Slack.

**Why it matters:** Non-tech users do not visit a dashboard daily; they live in Slack. Putting the catalog *where they already are* is the cheapest distribution surface.

**SOTA refs:** Tableau Pulse Slack integration, ThoughtSpot Spotter for Slack, Hex Slack app, Atlan's Slack-native catalog access.

**Effort:** S (cheapest big-impact item on this list) — one Slack app + a search endpoint reusing Phase 1's catalog search. ~3 days.

**Recommendation:** Phase 2, paired with the grounded NL search box from Adjustment 2.

---

### 5.6 Saved-view / curated workspace (M / med)

**What:** A user assembles a small collection of metrics + verb-chained explorations + filters into a named workspace. Shareable, with permission scopes. Comments / annotations per view.

**Why it matters:** v2's Gap G (saved exploration) covers the single-query case. Workspaces collect them into a *page*. Mirrors Hex Apps / ThoughtSpot Liveboards / Tableau Workbooks at a smaller scope.

**SOTA refs:** Hex Apps, ThoughtSpot Liveboards, Tableau Workbooks, Notion-style canvas.

**Effort:** M — storage + permissioning + simple grid layout + share-link generation. ~2 weeks.

**Recommendation:** Phase 3 — Workspaces are a stronger deliverable target than dashboard parity. Defer until Phase 2 verbs validate the single-query exploration.

---

### 5.7 Human feedback loop on metadata + retrieval (S / high)

**What:** On every catalog tooltip, NL search result, and Explore measure picker, surface a thumbs-up/down. Negative responses queue a `metadata_feedback` item visible to the metric owner. Positive responses contribute to ranking signal.

**Why it matters:** ThoughtSpot's Sage explicitly built this as a core feature in 2024; the feedback loop is *how the NL surface becomes accurate without curation work scaling.* If metadata authoring is open to anyone (v2 thesis), feedback is the lightweight signal that compounds quality.

**SOTA refs:** ThoughtSpot Sage feedback loop (canonical), GitHub Copilot Telemetry, OpenAI RLHF pattern.

**Effort:** S — UI affordance + a backend table + a daily owner-notification job. ~2 days for v1, scaling later.

**Recommendation:** Phase 1 (cheap, compounds quality across Phase 2-4).

---

### 5.8 Multi-step investigation agent (L / med — high risk)

**What:** Non-tech user asks one fuzzy question ("why is whale retention down?"). Agent decomposes into sub-queries against the catalog: probe D7 vs D30 by tier × country, look for anomalies, surface the dominant driver, suggest follow-up. Like Genie Research, Spotter, or Databricks AI/BI agents.

**Why it matters:** Where the puck is going. But: expensive (LLM cost), uneven quality, requires high-quality metadata to ground (Phase 1-2 prereq).

**SOTA refs:** Databricks Genie Research (beta), ThoughtSpot Spotter, Hex Magic agentic mode.

**Effort:** L — multi-turn agent loop, retrieval over metadata, query construction, result synthesis. ~4-6 weeks for a respectable v1, plus ongoing LLM cost.

**Recommendation:** Phase 4 (later). v2's ordering is right for this one. But: instrument Phase 1-3 so the metadata + saved explorations form a training corpus the agent will eventually use.

---

### 5.9 Embedded views (S / med)

**What:** Iframe / oEmbed / Slack unfurl + Notion-card surface for any saved exploration or metric. One URL, one image preview, opens to read-only result. Permission-scoped.

**Why it matters:** Same distribution argument as 5.5 (Slack bot). Non-tech users paste links into PRDs, ticket descriptions, Slack threads. An embedded preview is a passive distribution surface for the catalog.

**SOTA refs:** Hex App embeds, ThoughtSpot embed, Linear/Notion oEmbed.

**Effort:** S — `<iframe>` route + a Slack unfurl handler + a static thumbnail generator. ~3 days.

**Recommendation:** Phase 3, alongside Workspaces (5.6) since both share the share-link infrastructure.

---

### 5.10 Cross-game / cross-tenant browse mode (M / med)

**What:** A separate surface where a stakeholder (BD, finance corp-level) can compare a single metric (e.g., DAU, ARPPU) across multiple game tenants in one view. Respecting RBAC.

**Why it matters:** VNG runs multiple game titles. The current cube playground is single-tenant in spirit (POC = Ballistar VN). A multi-tenant browse layer becomes valuable once 2-3 games are live on the platform. Aligns with Section 2 (Business case Section 2 row 1, tenancy model).

**SOTA refs:** Cube `securityContext.tenant_id` row-level filters; dbt Project Evaluator multi-project view; Tableau cross-workbook reuse.

**Effort:** M — backend RBAC + a "compare across tenants" UI gesture. Likely 1-2 weeks.

**Recommendation:** Phase 4 or later. Unblocked by tenancy model decision (open question in business case Section 2).

---

### 5.11 "What-if" parameter simulation (M / low — niche)

**What:** On a derived measure (e.g., `arppu_vnd = ltv_total_vnd / paying_users`), let user override one component ("if we acquire 20% more paying users at same LTV, ARPPU becomes…"). Same idea for thresholds — "raise whale cutoff to 20M VND, how does the count change?"

**Why it matters:** Useful for Product/Finance personas modelling pricing scenarios. Niche but high-fit for the 4-tier ARPPU question (Q4).

**SOTA refs:** Looker user attributes + parameters; ThoughtSpot what-if; Hex parameters.

**Effort:** M — needs a parameterised query layer on top of Cube. Adjacent to Gap B (parameterised metric families) but bigger scope.

**Recommendation:** Phase 4 (or never). Validate user demand in Phase 2-3 first.

---

### 5.12 Mobile / glanceable surface (M / low — defer)

**What:** Mobile-responsive view of digest + a handful of pinned metrics. Push notifications when KPIs breach thresholds.

**Why it matters:** Execs scan KPIs on phones during meetings. But: probably solved by 5.2 (Slack/email digest reaching them on phone anyway). Native mobile is overkill unless ops manager needs glance during a campaign.

**SOTA refs:** Tableau Mobile, Looker Mobile, ThoughtSpot Mobile.

**Effort:** M.

**Recommendation:** Defer. Re-evaluate after digest (5.2) lands.

---

## Section 6 — Recommended additions to v2's phasing

Sequencing rule remains: metadata first, exploration second, AI last. **Additions slot into existing phases:**

| Existing v2 phase | Additions |
|---|---|
| **Phase 1 (~2wk) — Metadata MVP** | + Adjustment 1 (OSI-aware schema), + Adjustment 2 (grounded NL search box), + 5.1 (certified-metric badge + freshness/SLA UI), + 5.7 (feedback loop on metadata) |
| **Phase 2 (~3-4wk) — Verbs + dim/seg coverage** | + 5.4 (lineage panel), + 5.5 (Slack ask-the-catalog bot, paired with NL search box) |
| **Phase 3 (~3-4wk) — Authoring extensions** | + 5.2 (metric digest), + 5.3 (anomaly + change drill), + 5.6 (workspaces), + 5.9 (embedded views) |
| **Phase 4 (later) — AI rendering + delivery** | + 5.8 (multi-step investigation agent), 5.10 (cross-tenant), 5.11 (what-if). 5.12 (mobile) deferred. |

Cumulative effort delta vs original v2:
- Phase 1: +~1 week (badge UI + NL search box + feedback loop). Total ~3 weeks.
- Phase 2: +~1 week (lineage panel + Slack bot). Total ~4-5 weeks.
- Phase 3: +~4-5 weeks (digest is the heavy item). Total ~8-9 weeks.
- Phase 4: substantially heavier with the agent + cross-tenant + what-if. Not estimated.

---

## Section 7 — Risks specific to the additions

| Risk | Mitigation |
|---|---|
| **Grounded NL search box (Adj 2) gets misread as full Cortex Analyst.** Users type "what's revenue this month?" and expect a number, get a list of candidate measures. Disappointment. | Position copy explicitly: "Search the metric catalog" — not "ask me anything." Hide the search until vocabulary is rich enough that results are clearly relevant. |
| **Digest fatigue.** Users subscribe to 20 metrics, ignore the email by week 3. | Default to *change-only* digests; only fire when anomaly score crosses threshold. Tableau Pulse learned this in 2024. |
| **Anomaly false positives.** Naive z-score on noisy game metrics produces an alert a day, trust dies. | Calibrate per metric; allow user "this isn't anomalous, suppress" → trains the threshold per metric per user. Same feedback-loop pattern as 5.7. |
| **OSI standard drift.** OSI evolves, v2's schema diverges. | Treat OSI alignment as a periodic audit (quarterly), not a rigid binding. v2's schema is a superset and exports project to OSI; the reverse import is opt-in. |
| **Multi-step agent burns LLM budget.** $0.20 per investigation × 1000 users/day = real money. | Defer to Phase 4 with explicit cost gating; cache decompositions; require user to opt in. |
| **Feedback loop privacy.** "User X thumbed-down `whales` definition" — owner sees this. Is that OK? | Aggregate-only for negative signals in v1; named feedback opt-in via a comment field. |

---

## Section 8 — Strategic ordering observations

1. **Phase 1 is more valuable than v2 alone suggests.** With the four Phase 1 additions (OSI-aware schema, grounded NL search box, certified badge + freshness, feedback loop), Phase 1 already covers a meaningful chunk of what Atlan / Cube Cloud Catalog deliver — at the cost of ~3 weeks vs the months of vendor-procurement + onboarding. Build vs buy is favourable *if* the playground stays as the home of authoring (not just consumption).

2. **Phase 2 + Slack bot is the wedge for non-tech adoption.** Verbs alone are an analyst feature; Slack-where-they-live is the distribution surface. Pair them in Phase 2.

3. **Phase 3 is where the proactive surface earns its keep.** Digest + anomaly is what makes the platform a *daily* destination for non-tech users instead of a once-per-quarter destination.

4. **Phase 4 ambitions need a kill criterion.** Multi-step agents are 6-week investments that may not beat the digest + grounded NL search combo from Phase 1-3 in practice. Set an explicit success metric (e.g., "20% of weekly active users invoke the agent at least once") before committing to the build.

5. **The biggest non-obvious risk** is that Cube Cloud Data Catalog ships authoring UX before v2 does. The differentiator must be tight Explore integration + the verb chips + the parameterised metric family handling — Cube Cloud's read-only catalog won't do those. If Cube Cloud ships an authoring layer in 2026, re-evaluate build-vs-adopt.

---

## Section 9 — What this does NOT change in v2

- v2's core thesis (metadata as moat, verbs as primitive, AI as polish) is unchanged. SOTA aligns.
- v2's gap-letter labels (Gap A-J) are preserved.
- v2's effort estimates for the original gaps are preserved.
- v2's references and codebase touch points (Catalog detail pane, Explore picker, New Metric Wizard) are preserved.

Only addition: §5's twelve new surfaces and §6's phase-by-phase integration.

---

## Open Questions

1. **NL search box positioning (Adjustment 2)** — is "smart catalog search" a clear-enough framing in copy/UX to avoid the "where's the chat?" reaction, or do we need to ship something closer to Cortex Analyst sooner?
2. **OSI alignment** — committed (a superset schema with periodic audit) or deferred (revisit when OSI hits 1.0)?
3. **Slack/Teams choice** — Slack-first (VNG team current usage?), or design for both with a thin adapter layer?
4. **Digest delivery target** — email, Slack, or in-app notification center first? Likely Slack given non-tech users.
5. **Anomaly engine** — naive z-score in Phase 3 v1, or skip naive and go straight to a small forecasting model (Prophet / statsforecast)? Latter is heavier but produces fewer false positives.
6. **Where does multi-step agent live?** Inside the playground, or as an MCP tool that any agent (Claude, internal LLM stack) can call? The latter is cheaper and aligns with Q13's auto-publish story.
7. **Workspace permission model** — flat (anyone in tenant) or RBAC-aware? Affects scope significantly.

---

## References

### Source documents (this repo)
- `business-case-260518-cube-semantic-layer-tables.md` — 13 questions, business case for Cube semantic layer
- `research-260518-1841-product-gaps-non-tech-question-flow.md` — v2 product-gap analysis (the proposal being validated)
- `metric-mapping-260519-poc-gds-vs-cubes.md` — POC scope, 4 cubes, 21 of 53 GDS metrics
- `_GDS__-_1_8_Metrics_Definition.md` — 53-metric glossary (seed for Gap A)

### SOTA references (web)
- [Best AI Analytics Platforms in 2026: 13 Tools Compared (Holistics)](https://www.holistics.io/blog/ai-analytics-platforms/)
- [Snowflake Cortex Analyst — Getting Started Guide](https://www.snowflake.com/en/developers/guides/getting-started-with-cortex-analyst/)
- [Databricks AIBI Genie — Features and Use Cases (Zenlytic)](https://www.zenlytic.com/blog/databricks-ai-bi-genie)
- [The Future of AI/BI: Cortex Analyst vs Databricks Genie (Medium)](https://medium.com/@nair.g.deepa/the-future-of-ai-bi-snowflake-cortex-analyst-vs-databricks-genie-6b65073a43c6)
- [ThoughtSpot Agents: Spotter, SpotterModel, SpotterViz, SpotterCode](https://www.thoughtspot.com/product/agents)
- [ThoughtSpot Sage — AI-Powered Analytics with GPT](https://www.thoughtspot.com/blog/enhanced-ai-powered-analytics-with-gpt)
- [ThoughtSpot Sage — Feedback Loop (TechTarget)](https://www.techtarget.com/searchbusinessanalytics/news/366568363/ThoughtSpot-update-adds-feedback-loop-to-help-train-GenAI)
- [Tableau Pulse — Automated Business Insights (Tableau blog)](https://www.tableau.com/blog/tableau-pulse-automated-business-insights)
- [Tableau Pulse Guide: Real-Time Personalised Analytics (B-Eye)](https://b-eye.com/blog/tableau-pulse-real-time-personalized-analytics/)
- [dbt Semantic Layer overview (dbt Labs)](https://docs.getdbt.com/docs/use-dbt-semantic-layer/dbt-sl)
- [About MetricFlow (dbt docs)](https://docs.getdbt.com/docs/build/about-metricflow)
- [Top 10 Semantic Layer Tools in 2026 (Promethium)](https://promethium.ai/guides/top-10-semantic-layer-tools-2026-definitive-comparison/)
- [Best Semantic Layer Solutions for Data Teams 2026 (Kaelio)](https://www.kaelio.com/blog/best-semantic-layer-solutions-for-data-teams-2026-guide)
- [Atlan — Data Catalog: Discovery, Lineage, Governance](https://atlan.com/data-discovery-catalog/)
- [Atlan vs Select Star — Full Product Comparison (Castor)](https://www.castordoc.com/compare/atlan-vs-select-star)
- [Proactive KPI Tracking with AI (ThoughtSpot)](https://www.thoughtspot.com/data-trends/kpi/tracking-kpis)
- [SpotIQ — Augmented Analytics (ThoughtSpot)](https://www.thoughtspot.com/product/analytics/spotiq)
- [Top 9 Agentic Analytics Tools for AI-Driven Teams (OvalEdge)](https://www.ovaledge.com/blog/agentic-analytics-tools/)
