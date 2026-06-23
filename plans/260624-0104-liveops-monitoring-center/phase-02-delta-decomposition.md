# Phase 02 — Delta decomposition (Diagnostics tab 1)

**Priority:** P0 (flagship) · **Status:** ✅ · Depends: 01

> **Built (2026-06-24):** `chat-service` POST `/liveops/delta-decompose` (service `delta-decomposition.ts` + route, additivity from /meta) + FE `diagnostics/delta/*` (api client, hook, curated `game_key_metrics` config, banded-axis waterfall, contributor table w/ Explore deep-links). Decomposes any of rev/npu/nru/installs/cost_vnd by platform/country/media_source/paid/campaign, WoW/MoM, all 8 games. **Deferred (fragile, noted):** anomaly→Delta cross-link (anomaly metrics don't map to the curated cube set) and chat-prefill handoff (no `/chat` URL-prefill contract exists yet) — "Ask in chat" is a plain nav for now.

## Goal
"Why did it move?" — pick a KPI + period comparison, auto-decompose the delta across dimensions,
render a contribution waterfall + ranked contributor table. Matches mockup tab 1.

## Key insights
- Pure descriptive attribution over existing cubes (level + mix-shift) — NO model. Frame as attribution, not forecast.
- Reuse `assistant-chart-section.tsx`, `Segments/visuals/{segmented-bar,bar-list}.tsx`, composition-card query pattern.
- The chat `diagnose` skill already does narrative root-cause; this is the structured/visual sibling → add a handoff link ("Explain in chat") rather than duplicate logic.

## Architecture
- Backend `chat-service` (or `server`) endpoint `POST /liveops/delta-decompose`:
  input = {game, measure, dimensions[], periodA, periodB} → for each dimension value, query measure for both
  periods, compute Δ and % of total swing; return ranked contributors + residual. Bound dimension cardinality (top-N + "other").
- Reuse Cube query shape: `{ measures:[m], dimensions:[d], timeDimension }` two windows, diff in service.
- FE: `Liveops/diagnostics/delta/` — controls (measure seg, decompose-by picker, period compare), waterfall (hand-rolled SVG from mockup), contributor table (BarList-derived), `Explore →` deep-link per row (reuse `open-in-playground`).

## Files
- Create: `src/pages/Liveops/diagnostics/index.tsx` (hub w/ liveops-tabs), `.../delta/delta-decomposition-view.tsx`, `.../delta/contribution-waterfall.tsx`, `.../delta/use-delta-decomposition.ts`, `.../delta/decompose-api.ts`.
- Backend: `chat-service/src/api/delta-decompose.ts` (Fastify route) + `chat-service/src/services/delta-decomposition.ts`.
- Reuse: `assistant-chart-section.tsx`, `Segments/visuals/bar-list.tsx`, `Liveops/anomaly-inbox/open-in-playground.ts`.

## Steps
1. Backend service: two-window Cube query per requested dimension, compute contribution + % swing + residual; cap top-N.
2. Fastify route + types; guardrail metadata (descriptive attribution note).
3. FE hook + view; waterfall SVG (banded axis like mockup); contributor table with segment chips + Explore links.
4. Wire into Diagnostics hub as tab 1; add "Explain in chat" handoff to `diagnose` skill prefilled with the same scope.
5. Anomaly cross-link: from Anomaly Inbox row → open Delta decomposition prefilled with that metric/date.

## Success criteria
- [ ] Selecting DAU + WoW returns ranked contributors summing (±residual) to the headline delta.
- [ ] Waterfall + table render on tokens; Explore deep-links land in `/explore` with correct query.
- [ ] Works for cfm_vn + jus_vn; degrades gracefully when a dimension is absent.
- [ ] Anomaly→Delta and Delta→chat-diagnose handoffs work.

## Risks
- Non-additive measures (ratios like payer_rate, arppu) can't be summed — decompose the numerator/denominator or label "ratio: shown as level change, not additive". Decide per measure in service.
- High-cardinality dimensions → enforce top-N + "other" bucket, `log()` what's bucketed.
