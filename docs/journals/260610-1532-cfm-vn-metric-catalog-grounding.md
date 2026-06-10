# cfm_vn Metric Catalog — Trino Grounding + Fast/Cold/Blocked Taxonomy

**Date:** 2026-06-10 (GMT+7) · **Plan:** `plans/260610-1446-cfm-vn-metric-catalog-fast-query/` · **Commits:** `b50895c` (feat), `6714994` (docs) on `main`

## What shipped

Re-grounded the business-metric catalog for cfm_vn so every listed metric resolves against modeled cubes and the common daily slice routes to a CubeStore pre-aggregation. Audit found only **20/57** presets resolving with live data. Outcome: ~36 fast, ~10 cold, 12 blocked (+12 new) — kept, not dropped.

- **Revenue correctness fix:** `revenue`/`gross_bookings`/`arppu`/`arpdau` repointed off `recharge.revenue_vnd` (raw `iamount`, ~15× inflated by unbridged test traffic) → `user_recharge_daily.revenue_vnd_total` (bridged). Monitoring stack already used the correct measure; only the preset catalog + chat agent were affected. Logged in changelog as an intended value shift.
- **Recovered ~16** broken metrics by repointing unwired `mf_users.*` refs to `game_key_metrics.*` / `new_user_retention.*` (+6 post-agg ratio measures, `nnpu`/`iap_rev` into the daily rollup). Deferred as draft: `ltv`/`ltv_30`, `roas_07`, `organic_installs`/`paid_installs` (semantics / missing filtered measures).
- **Added 12** event-cube exploration metrics (diamond economy, gacha, onboarding tutorial, session time, IAP).
- **Taxonomy:** per-game `meta.serving` (cold) + existing `meta.applicability` (blocked); `?filter=available` excludes blocked + broken-ref but keeps resolvable drafts; Catalog badges. 12 structurally-absent metrics (funnel/concurrency/roles) kept as blocked stubs.
- **Agent surface:** seeds + chat-service templates + glossary synonyms rebuilt to fast metrics only (`gross_bookings` folded into `revenue`). New resolution-baseline eval harness (`chat-service/test/metric-resolution-eval/`); cross-game master list + per-game rollout template in `docs/`.

## Decisions

- cfm recharge PK **verified unique** (vng_transaction is globally unique) → no composite-PK fan-out, unlike jus. Phase-4 build unblocked.
- "Keep cold, don't drop" (user call): meaningful-but-slow metrics stay in the catalog labeled cold rather than excluded. Latency modeled **per-game** (`serving` array), since `transactions` is cold for cfm_vn but may be fast elsewhere.
- ARPDAU stays cold by design: cross-cube ratio, no single-rollup fast path without a conforming mart (upstream ETL).

## Lessons

- **"Modeled ≠ has data"** and **"broken-ref ≠ wrong cube"** — most of the 36 "broken" metrics were *unwired formula refs pointing at the wrong cube*, recoverable with formula edits alone, not a data-platform gap. The first audit over-attributed them to missing mf_users data; a second read of the already-modeled `game_key_metrics`/`new_user_retention` marts found the columns.
- **Per-game latency must be per-game.** A global `latency_class` field on a shared preset would be wrong for any metric whose rollup coverage differs across games.
- **Local pre-agg verification is routing-only.** Restarting `cube-api-dev` (required for new measures, DEV_MODE=false) drops local partitions, and batch rollups >100k rows can't seal without an export bucket → warm `<2s` and `game_key_metrics` data presence are **prod-confirm** items. Correctness was proven via compiled SQL (`FROM prod_pre_aggregations.*`), not wall-time.

## Follow-ups (not done this round)

- Run the Phase-0 resolution scorer live (changes are additive → low regression risk) to confirm zero agent-resolution drift.
- Prod: confirm `game_key_metrics` populated for cfm_vn + warm `<2s` after partition build.
- Marketing-ops: `roas_07` D7-cohort vs period semantics; LTV cohort definition; organic/paid install split (needs 2 filtered measures).
- Roll out to other games via the new `docs/metric-catalog-per-game-rollout-template.md`.
