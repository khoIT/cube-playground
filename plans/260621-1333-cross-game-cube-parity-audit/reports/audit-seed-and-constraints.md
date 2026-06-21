# Audit seed findings + cross-cutting constraints

Grounding facts gathered before planning (3 parallel Explore sweeps + spot-checks). These seed the worklist so the audit starts from known-bug shapes, not from zero.

## Dev → prod oracle mapping rule
- Dev file: `cube-dev/cube/model/cubes/{game}/{entity}.yml`, cube `name: {entity}` (bare).
- Prod file: `/cube-prod/cube/model/cubes/{game_id}/{entity}.yml`, cube `name: {game_id}__{entity}` (prefixed).
- Game-id map: cfm→cfm_vn, jus→jus_vn, ballistar→ballistar_vn, cros→cros, tf→tf, **muaw→muaw, ptg→ptg, pubg→pubgm**.
- **CORRECTION (verified by Phase-0 harness run):** ALL 8 dev games have a populated oracle in cube-prod — muaw (23 cubes), ptg (27), pubgm (23), in addition to cfm_vn (41), jus_vn (29), ballistar_vn (20), cros (26), tf (26). The earlier "no oracle for muaw/ptg/pubg" premise was WRONG. The harness determines oracle availability per (game,cube) at runtime, so Phase 1 (oracle-backed) now covers all 8 games and Phase 2 reduces to dev-only cubes with no oracle counterpart. vga prod dir IS empty.

## Per-game cube counts (dev)
ballistar 17 · cfm 32–34 · cros 18 · jus 33 · muaw 17 · ptg 19 · pubg 17 · tf 18.
14 "canonical" cubes present in all 8 (generated from cfm template). Remainder = bespoke recharge + etl_* + (jus) role_* cubes, hand-authored.

## Known bug shapes to scan for (the audit's checklist)
1. **PK fan-out** — `primary_key` on a column that is not unique at the source grain, joined many-to-one and then SUM'd → inflated sums / deflated distinct counts. (Prototype: jus `transid`.)
2. **Non-additive measure in a rollup** — only count/sum/min/max/count_distinct_approx roll up; ratios/avg/count_distinct must not be pre-aggregated.
3. **Rollup time_dimension ≠ query dimension** — e.g. rollup keyed on `log_date` but queries filter `recharge_time`/`dteventtime` → rollup silently not used or wrong window.
4. **Identity-join breakage** — `user_id` namespace collisions; jus/muaw use `split_part(user_id,'@',1)` bridge. Verify the bridge is present where the upstream has dual-identity rows, absent where it shouldn't be.
5. **Dangling measure ref** — a business-metric / glossary / chat-seed member that resolves to no cube member in `/meta`.
6. **Cross-game measure parity gap** — a measure cfm has that a game with the same source table lacks (e.g. lapsed_this_month_count missing in cros; trailing_wpu/mpu missing in cros, tf).
7. **Ratio truncation** — ratio measures must `CAST(... AS DOUBLE)`, not `* 1.0`; integer division truncates to 0.

## Confirmed facts (verified this session)
- **jus `recharge` PK fix is PRESENT in dev** (`cube-dev/.../jus/recharge.yml:47-49` composite `account_id||pay_time||transid||role_id||prepaid_detail_item_id`). The dev-inventory sweep mis-summarized it as "Same as cfm (transaction_id)". → **Lesson for the audit: trust files, not summaries. Every finding re-read from the actual YAML + oracle YAML.**
- Prod oracle confirms the same composite jus recharge PK as the correct answer.
- cfm `recharge` PK = `transaction_id` (correct for cfm — transid IS unique there).

## Suspected-but-unverified (must confirm file-by-file in Phase 1/2)
- TF `mf_users` may lack the ingame_name role join (`ingame_last_active_role_name` 100% null per generator flag) — verify intended vs gap.
- TF rollup coverage lowest (~28%): missing retention / game_key_metrics / new_user_retention rollups — parity gap or by-design?
- jus `role_active_daily` / `role_recharge_daily` have no pre_aggregations — role-grain queries fall through to Trino.
- cros `mf_users` missing `lapsed_this_month_count`; cros/tf missing trailing_wpu/trailing_mpu.
- `revenue_vnd_real` cfm-only — verify measure parity across per-game recharge/user_recharge cubes.
- Globally blocked metric refs (no source): gacha (etl_lottery_shoot, cfm-only), tutorial (etl_newbie_tutorial, cfm-only), money_flow diamonds (etl_money_flow, cfm-only), funnel cvr_* (AppsFlyer not ingested). These → mark N/A, not "fix".

## Phase-0 harness run — real leads found (2026-06-21)
First run: 8 games, 373 findings (🔴 0 correctness · 🟡 121 parity · ⚪ 252 cosmetic). Ledger `cube-dev/scripts/reports/parity-findings.jsonl`; matrix `parity-matrix.md`. Top fix candidates (verify file-by-file in Phase 1, fix in Phase 5):
- **PK fan-out (HIGH):** muaw/ptg/pubg `recharge` declare `primary_key = transaction_id`, but each game's oracle uses a `composite_pk` — the SAME class fixed in jus (transid not unique at source grain → SUM inflation). Labeled `parity` by the harness (dev/oracle divergence is often intentional); escalate to correctness only after confirming transaction_id is non-unique at each game's source grain.
- **Ratio truncation:** jus `role_recharge_daily.arppu_vnd` = `SUM(...) / NULLIF(COUNT(DISTINCT user_id),0)` with no double cast → integer-division truncation (class already fixed in ballistar mf_users via `CAST(... AS DOUBLE)`).
- 118 `measure-missing-vs-oracle` (oracle measures dev lacks — parity gaps) + 140 `measure-dev-ahead` (dev-only measures, incl. leftover wizard junk like ballistar mf_users `asd`/`test`) + 91 `no-oracle-counterpart` (dev-only cubes) + 20 `identity-bridge` tags.

Harness false-positive caught + fixed during build: `{cubeName}.col` is valid Cube self/cross-cube column syntax, NOT a dangling measure ref — the detector now only flags `{name}` not followed by a dot. (Trust files, not the detector's first pass.)

## Existing checkers to REUSE (do not rebuild)
- `npm run audit:metric-trust` (server/) → `server/src/scripts/audit-and-promote-metric-trust.ts` — buckets metrics CERTIFIED/READY/GAP/N-A per game; `--promote` auto-certifies READY.
- `npm run check:metric-drift` (server/) → `server/src/scripts/check-metric-drift.ts` — read-only CI gate.
- `GET /api/business-metrics/coverage?game=G` → `server/src/services/metric-coverage-resolver.ts` — coverage matrix + broken refs + uncovered measures.
- `GET /api/glossary/integrity` → `server/src/routes/glossary.ts` — dangling term refs.
- Metric definitions: `server/src/presets/business-metrics/*.yml` (73); Zod schema `server/src/types/business-metric.ts`; loader `business-metrics-loader.ts`.
- Chat knowledge seed: `chat-service/seed/game-topic-knowledge-seed.json` (per-game members → must exist in `/meta`).
- Generator: `cube-dev/scripts/onboard-game-cube-model.mjs` + `cube-dev/scripts/lib/canonical-cube-config.mjs`.
- Docs: `docs/lessons-learned.md`, `docs/metric-trust-audit-playbook.md`.

## What the audit does NOT cover (out of scope)
- Editing the cube-prod oracle.
- Building new source tables / ingesting new upstreams (AppsFlyer funnel, etl_money_flow for jus/ptg) — these are upstream data work, only marked N/A here.
- Performance/rollup-build tuning beyond correctness (separate Query Performance Optimization Hub plan owns that).

## Open questions (resolve with user before Phase 5 fixes)
1. For oracle-less games (muaw/ptg/pubg) where cfm and prod disagree on a shared cube shape, which wins as reference — cfm dev, or the canonical generator config?
2. Parity gaps where the source EXISTS but the measure was never added (cros lapsed_*, trailing_*): fix now, or only flag and let owners prioritize?
3. revenue_vnd_real: backfill to all games' recharge cubes, or keep cfm-only and mark others N/A?
