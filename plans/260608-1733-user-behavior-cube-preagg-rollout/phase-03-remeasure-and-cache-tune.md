# Phase 3 — Re-Measure + Tune Playground Caches

**Priority:** P2. **Status:** pending. **blockedBy:** Phase 1, Phase 2.

## Why
Once CubeStore actually serves user/behavior cubes, the playground's own SQLite caches were partly compensating for slow source queries. Re-measure to quantify the win and decide whether cache TTLs/machinery can relax (fresher data, less moving parts).

## Steps
1. **Before/after table:** re-run the harness for every Phase 1/2 cube; record cold `usedPreAggregations`+latency vs the 2026-06-08 baseline (mf_users ~10s, retention 3.5–>15s, etc.). This is the deliverable that proves business impact.
2. **Segment path end-to-end:** time `POST /api/preview` (segment count) and a segment refresh on a user-grain predicate — confirm the count card now resolves from CubeStore, not a multi-second Trino scan.
3. **Cache review (do NOT rip out — these serve non-Cube purposes):**
   - `segment_card_cache`, `liveops_result_cache`, `dashboard_tile_cache`: consider shorter TTL / less aggressive cron now that source is fast → fresher data.
   - Keep: chat `response_cache` (LLM), `segment_brief_cache` (LLM), `segment_member360_cache` (row-level fan-out) — unaffected by rollups.
4. Sanity: confirm chat + query-builder cold first-asks on these cubes dropped from seconds to sub-second.

## Success criteria
- Documented before/after latency proving the impact (interactive paths sub-second; no 15s timeouts).
- Decision recorded on each cache: keep-as-is / relax TTL, with rationale.
- Update `docs/service-api-surface-map.md` + `docs/lessons-learned.md` (entry: "rollup defs without a building worker are inert — validate `usedPreAggregations`, never assume").

## Risks
- Relaxing a cache TTL increases CubeStore/Trino QPS — fine at current low volume, revisit if volume grows.
- Don't reduce caches that protect the row-level/LLM paths.

## Open question
Should the 15s gateway `CUBE_FETCH_TIMEOUT_MS` (`cube-proxy.ts`) be raised as a safety net for any remaining non-rollup user query, or left to fail-fast? Decide after re-measure shows residual slow paths.
