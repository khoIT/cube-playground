# AI Segment Brief — auto-generated executive narrative on segment open

> Advisor brief — idea `5aefe808-3af3-4296-99ac-bdf1a251a3df` · product-data-experience · impact 5 / effort 3 / confidence 4

When any segment opens, an LLM-written 3-sentence brief (behavioral identity + commercial signal + forward risk label) auto-generates from predicate and enrichment data so a business leader reads a plain-language story before touching a single chart.

## Problem
Cube Playground is built for hypothesis-driven analysts — you come with a question, build a predicate, validate. A business leader opening a saved segment faces: a segment name, a predicate tree, and a size chart. There is no executive summary — no plain-language answer to 'What kind of players are in this cohort? Why does it matter? What should I worry about?' The chat agent can answer these if asked, but the insight should surface automatically on open, not require knowing what to ask. The gap answer from discovery captures this exactly: the tool is designed for people who come with a hypothesis; it needs to be legible for people who just need to decide.

## Evidence
- **file** src/pages/Segments/detail/detail-view.tsx — “Segment header shows name + game chip + owner + member count only — no narrative, no plain-language description, no commercial framing”
- **file** src/pages/Segments/detail/tabs/insights-tab.tsx — “Insights tab is chart-heavy and preset-gated; non-preset segments return empty-state — no narrative layer anywhere in segment detail”
- **file** chat-service/ — “LLM layer is production-ready, bilingual (EN/VI), with Cube query tool access and disambiguation memory — currently Q&A-only, not proactive generation”
- **file** plans/260604-2319-segment-snapshot-pull-api/plan.md — “definition_hash for cheap 'changed since last pull?' (ETag) — reusable as cache key for brief so it only regenerates when the segment definition meaningfully changes”

## Proposal
A collapsible AI Brief card positioned between the segment title row and the tab strip, auto-generating on segment open (lazy, skeleton loader). New /api/segments/:id/brief endpoint: (1) fetches segment metadata (name, predicate summary, game, owner, member count); (2) runs the same enrichment aggregation as the Revenue Intelligence Header (payer_tier distribution, lifecycle_stage distribution, ltv_usd median, days_since_last_active P50) via existing Cube enrichment path; (3) sends structured context to chat-service LLM with a brief-generation prompt enforcing business language only (no SQL, no Cube member names). Output schema is hardcoded: a label from a fixed enum ('High-value churn risk' / 'Upsell candidate' / 'Engaged non-payer' / 'Healthy growth cohort' / 'New user wave') rendered as a chip using semantic tokens; a 3-4 sentence narrative; 2-3 signal bullets from data. Brief cached server-side per definition_hash (reuses ETag strategy from snapshot plan) so it does not regenerate on each open. Card is collapsible; expanded by default.

## Risks
- Brief quality degrades for non-mf_users games: without enrichment KPIs, LLM relies only on predicate analysis — produces weaker narratives; must surface a 'Limited data — predicate analysis only' disclaimer rather than a confident-sounding thin brief
- Cache invalidation: brief must regenerate when definition changes; until snapshot plan's definition_hash lands, use a predicate-hash fallback
- Executive misread: unhedged language may cause execs to treat estimates as facts — the 'AI-generated · estimated · N members' byline is non-negotiable

## Suggested next step
Run `/ck:plan` against this brief to expand it into phased implementation work.
This is a starting point, not a finished plan.
