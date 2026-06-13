# Brainstorm — Unified Concept Fabric (data-model ↔ metrics ↔ glossary ↔ segments)

Date: 2026-06-03 · Mode: /brainstorm · Status: agreed, ready for /ck:plan

## Problem statement

Product has 4 concept layers but they are siloed and cross-linkage is thin:
- **Data Model** — fields (dims/measures) from cube `/meta`. Surface: Catalog → Data Model (**Schema Cartographer**, already exists: browse+search, `?focus=cube.member` deep-link, cube tree, member-detail).
- **Metrics** — curated business metrics (YAML, formula over fields, trust). Surface: Catalog → Metrics. Authoring: composition-wizard + scaffold (exist).
- **Glossary** — human concepts/vocabulary. Surface: Catalog → Glossary. Already has concept-tier fields (`entityCube`, `entityPk`, `defaultMeasureRef`, `defaultFilter`, `ranking`, `trustTier`), `secondaryCatalogIds[]`, `status`.
- **Segments** (cross-cut) — populations (filters over fields). Surface: Segments. Owner-scoped, no trust/visibility field.

Two gaps:
1. **Resolution gap** — `resolveGlossaryHref` reads only `primary_catalog_id`; ignores concept-tier fields. Terms w/ null primary (whale/dolphin/minnow) dead-end at glossary *index*. whale/dolphin/minnow are near-empty (only `category=segments`) while `spender` is fully modeled (entity_cube, default_measure_ref, primary_catalog_id, trust_tier). → data + routing gap.
2. **No single map** — Cartographer covers fields only; metrics/glossary/segments separate; no cross-layer navigation; no reverse edges (field→metrics, metric→terms, field→segments).
3. **Write path fragmented** — trust vocab differs per layer (metrics `trust`; glossary `status`+`trustTier`; segments none). Roles exist (`viewer|editor|admin` + `requireRole`). Opening creation on this = ungovernable.

## Business value (why a hub that resolves to metric/field/segment/query)

Closes the **semantic gap**: humans speak concepts, system speaks fields/metrics/filters. Hub externalizes the mapping (today in analysts' heads).
- Self-service discovery (word → definition + metric + segment + ready query) → less data-team dependence.
- Consistency / single source of truth for definitions (two analysts' "whale revenue" agree).
- Onboarding (company data vocabulary in one place).
- **AI grounding (strongest, product has chat)**: NL term → governed definition, not LLM guess (saw `IOS` vs `ios` guess earlier). Semantic layer = retrieval layer for reliable NL→query.
- **Executable** (term → action) is the line between dead data-dictionary and living semantic layer; broken refs surface → fights rot.

Value scales with ambiguity × traffic → scope to ambiguous concepts (whale, engaged, active, churned) + core metrics + chat-referenced terms; NOT every field.

## SOTA prior art (validated, 2024–2026)
- Semantic/metrics layers: **Cube (this product's base)**, dbt Semantic Layer/MetricFlow, Looker LookML, AtScale, Malloy, Lightdash. ("Open in Explore" = term→build-query.)
- Business glossary linked to assets: Collibra, Alation, Atlan, Microsoft Purview, data.world, Informatica (glossary term → columns/metrics/dashboards, with stewardship workflows).
- AI grounding over semantic layer (frontier, our differentiator): Snowflake Cortex Analyst, Databricks Genie + Unity Catalog metric views, Looker+Gemini, ThoughtSpot Sage, Power BI Copilot, dbt+AI. Consensus: **LLMs must query through a governed semantic layer.**
- Product-analytics analog for whale/dolphin: Amplitude Data/Governance + behavioral cohorts; Mixpanel Lexicon.
- Authoring/governance universal shape: **tiered trust + role-scoped authoring + promotion** (Looker personal→shared→certified; Amplitude personal vs governed; Collibra draft→review→approved; dbt code-review).

## Decisions (user-confirmed)
- Primary outcome: **canonical concept registry first** (foundation; linking + map derive from it).
- Map form: **extend Schema Cartographer to cross-layer** (reuse, KISS) — not a new graph engine.
- Model shape: **glossary as hub, typed multi-refs** (build on existing concept-tier + `secondaryCatalogIds`).
- **huashu hi-fi prototype** before build.
- Trust model: **unify into one ladder** `visibility(personal|shared|org) × trust(draft|certified|deprecated)`.
- Creation in scope: **propose-as-draft metrics + suggest glossary terms + promotion paths (segment→metric/term)**.
- Create UX: **role-scoped +Add/Promote inline in the map + trust badges**.

## Object model (the hub)
Glossary term = router. Namespaced typed refs (reuse `secondaryCatalogIds` grammar):
`business_metrics/<slug>` · `data_model/<cube.member>` · `segments/<id>` + `parent_term` (whale IS-A spender).
Reverse index computed server-side: field→metrics (formula refs), metric→terms, field→segments (predicate). Unified trust/visibility on every artifact; certified-first feeds AI grounding + search ranking.

## Creation × exposure matrix
| Layer | Who creates | Enters as | Certifies | End-user exposure |
|---|---|---|---|---|
| Fields (cube YAML) | data-eng / onboarding wizard | staged draft | admin/data-eng | **read-only** |
| Metrics | editor proposes | draft | admin/steward | certified prominent, drafts marked |
| Glossary | editor proposes | draft | steward/admin | official prominent, drafts marked |
| Segments | any user, freely | personal | share→team/org | own + shared |
| Saved build-queries | any user, freely | personal | share | own + shared |

Promotion ladder (grassroots→governed): Build → Segment → promote → Metric and/or Glossary term.

## Phases (dependency-sequenced)
- **P0 — huashu hi-fi prototype**: cross-layer map, term hover-cards, trust badges, +Add/Promote. Validate UX pre-code.
- **P1 — Canonical registry + unified trust model** (foundation): typed namespaced refs, `parent_term`, backfill ambiguous concepts (payer tiers first), reverse index; migrate 3 trust vocabularies → 1 ladder (back-compat mapping).
- **P2 — Linking & affordance** (needs P1): typed `resolveConcept()` (full model, deep-link to term not index), hover-cards, consistent chips across chat/build/catalog, chat grounding prefers certified.
- **P3 — Authoring & governance** (needs P1): role-gate create endpoints; propose-as-draft metrics + glossary terms; promotion paths; trust badges. Simple `draft→certify` toggle (no heavy review queues).
- **P4 — Unified map** (needs P1; surfaces P2+P3): extend Cartographer cross-layer, reverse-edge nav, layer filters, inline create/promote.

P2 & P3 parallel after P1. P4 last.

## Risks & mitigations
- **Trust-model migration** — touches metric/glossary rows + every `trust`/`status` consumer (biggest blast radius). Mitigate: back-compat mapping layer, migrate read-side first.
- **Curation rot** — auto-suggest refs from formulas/`/meta`; scope backfill to ambiguous concepts; the chat consuming it keeps it alive.
- **Ref integrity** — validate namespaced refs on write + coverage check (dead-`primary_catalog_id` lesson).
- **Scope creep** — map = browse+create, not a modeling IDE; no field authoring for end users; no multi-step approval workflow (YAGNI).

## Success metrics
Zero term→index dead-ends · every payer-tier term resolves to field+segment+definition · reverse navigation from any layer · certified-vs-draft legible everywhere · chat grounds NL terms to certified definitions · one URL explores all four layers.

## Unresolved questions
- Which exact `entity_cube` for payer tiers — `mf_users` (chat used `mf_users.payer_tier`) vs `players` (spender uses `players`)? Confirm during P1 backfill against live `/meta`.
- Segment trust/visibility migration: do existing owner-scoped segments default to `personal` or `shared`? Needs a default policy.
- Does chat grounding consume the registry via the server or chat-service tools — confirm the integration point in P2.
