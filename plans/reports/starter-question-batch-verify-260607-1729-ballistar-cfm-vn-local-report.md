# Starter-question batch verification — ballistar + cfm_vn, workspace `local`

Date: 2026-06-07 (GMT+7) · Seed version frozen: `260607-1730` · Verifier owner: `starter-question-verifier`

## Verdict

**36/36 questions pass end-to-end** (18 ballistar + 18 cfm_vn):
- **Tier-1** (composed pass-through query vs Cube): 36/36 return real, non-degenerate data
- **Tier-2** (real chat turn over SSE, subscription auth lane): 36/36 → ≥1 query artifact, clean `done`, real narrative answer (34–217 s/turn)
- **Sliceability**: every artifact query has ≥1 measure + a slicing axis (dimension and/or `granularity: day`) → opens in query builder ready for segment slicing. 0 not-sliceable.

## What was broken and how it was fixed

### 1. Trend chips collapsed to one aggregate row (code fix)
`buildStarterQuery` bounded the time window but never set granularity → "WAU trend", "per day" chips returned 1 row (nothing to chart/slice).
**Fix** `chat-service/src/tools/disambiguate-starter-passthrough.ts`: a time-dimension target now means *time axis* → `granularity: 'day'`, chronological order, `limit: 1000` (measure-desc + limit 50 was dropping random middle days of multi-series). Ranking chips (no time target) unchanged. Unit test added (9/9 pass), tsc clean.

### 2. Dead dimensions — questions split on data that doesn't exist (seed repoints)
| Game | Old question | Problem (probed) | Replacement |
|---|---|---|---|
| ballistar | dau-by-role-class | `role_class` 100% null | **dau-by-country** (15 countries) |
| ballistar | session-length-by-role | same null dim | **online-time-by-platform** (ios/android/pc) |
| ballistar | dau-by-fighting-power | `max_fighting_power` 100% null | **dau-by-os-platform** daily trend (61 rows) |
| cfm_vn | top-servers-by-online-time | single server "101" | **online-hours-per-day** trend (30 rows) |
| cfm_vn | recharge-density-by-server | single server | **payer-share-by-role-level** (50 levels, uses `paying_dau`) |
| cfm_vn | dau-by-country-30d | VN-only | **matches-per-day-trend** (30 rows) |
| cfm_vn | newbie-first-game-mode | `first_game_mode` = "-2" only | **prologue-completion-time-trend** (30 rows) |
| cfm_vn | gacha-tenpull-vs-single-ratio | `ten_pull_count` always 0 (fictional id mapping) | **gacha-gold-vs-diamond-spend** by banner (23 rows) |
| cfm_vn | gacha-diamond-spend-by-banner | `lottery_box` CASE maps real ids (1931, 1925, …) to `other` | retargeted to raw **`lottery_id`** (23 banners) |

### 3. "Top X" chips exploding into day series; NULL ratios sorted first (seed repoints)
- `top-servers-by-dau`, `top-channels-by-nru`: dropped the time target → clean top-N ranking (50 rows).
- `cpi-roas-by-channel`, `arppu-by-acquisition-channel`: now lead with an additive volume measure (`cost_vnd` / `rev`) so order-by-desc surfaces real channels instead of NULL-ratio ones.
- Window-honesty retexts: "8 weeks"→"30 days", "60 days"→"30 days", "Top 10 servers… 7 days"→"last 30 days", "last 3 monthly cohorts"→"recent monthly cohorts".

### 4. ballistar `game_key_metrics` pre-agg partitions missing (infra fix)
3 chips 400'd/empty: `key_metrics_by_source_daily` lambda rollup had no 2026-05/06 partitions (refresh worker stalled by a CubeStore clock-skew error — "second time provided was later than self" — after host sleep; source mart is a rolling window so old partitions hold Feb–Mar data the source no longer has).
**Fix**: forced partition build via `renewQuery` on the refresh-worker API (admin JWT). All 3 chips return data now. Skew error cleared itself; worker grinding backlog normally.

## Full matrix (tier-1 rows / tier-2 turn)

ballistar: dau-by-country 50 · top-servers-by-dau 50 · online-time-by-platform 3 · retained-vs-recalled 30(day) · wau-trend 28(day) · dau-by-os-platform 61(day) · retention-curve 28(day) · paid-vs-organic-d7 3 · cpi-roas 50 · d30-cohort-compare 2 · top-channels-by-nru 50 · ios-vs-android-ua 3 · revenue-by-payer-tier 4 · ltv-by-install-cohort 2 · churn-risk 7 · whales-by-server 50 · iap-vs-web 30(day) · arppu-by-channel 50 — **all 18 turn-verified ✓**

cfm_vn: wau-vs-trailing 30(day) · dau-mau-ratio 3 · online-hours-per-day 30(day) · matches-by-game-mode 11 · login-peak 50 · drop-rate-by-map 12 · matches-per-day 30(day) · dau-by-os-platform 90(day) · trailing-mau 30(day) · tutorial-completion 50 · prologue-completion 30(day) · backflow-by-channel 2 · payer-count-per-day 60(day) · payer-share-by-platform 3 · payer-share-by-role-level 50 · gacha-diamond-by-banner 23 · diamond-spend-by-reason 7 · gacha-gold-vs-diamond 23 — **all 18 turn-verified ✓**

Verify transcripts: sessions under owner `starter-question-verifier` (dev chat.db); raw SSE in `/tmp/starter-turns/`; results `/tmp/tier1-results.json`, `/tmp/tier2-results.json`.

## Reusable tooling (new skill)

`.claude/skills/starter-question-batch-verify/` — SKILL.md + `tier1_compose_and_probe_starter_queries.py` + `tier2_drive_starter_chat_turns.py`. SKILL.md hard-codes the rule: **batches run on the subscription auth lane** (`PUT /internal/llm-auth-mode`), never gateway keys; lane restored to `auto` after this run. Note: `.claude/` is gitignored → skill is local-only.

## State / follow-ups

- Docker chat-service rebuild (new code + seed `260607-1730`) kicked off — :11000 serves the fixed chips when it lands. Verified during testing against the host dev service (same code/seed).
- Uncommitted: `disambiguate-starter-passthrough.ts` (+1 test), `starter-questions-seed.json`. Say the word to commit.
- Charts render client-side from the artifact query; every query now has a chartable shape (series or categorical split). No turn emitted an explicit `chart` event — that's normal for pass-through chips.

## Unresolved questions

1. `cube-dev/cube/model/cubes/cfm/etl_lottery_shoot.yml` still carries the fictional `lotteryid 1–6` mappings (`lottery_box`, `is_ten_pull`, `ten_pull_count`, `diamond_pulls`, 3 segments) — real ids are 1931/1925/1820/…. Needs domain mapping from the data team or removal.
2. `game-topic-knowledge-seed.json` entries referencing the replaced question concepts (server-density, country-spread, gacha box labels) may now disagree with the live seed — owned by the parallel generation workflow; re-sync there?
3. Seed `coverage` for ballistar `game_key_metrics.report_date` (2026-06-04) was correct against the source mart but the mart is a **rolling window** — pre-aggs hold history the source loses. Worth a coverage-probe rule for marts with retention windows?
4. Other 4 seeded games (cros, jus_vn, muaw, pubg) very likely share the granularity/meaningfulness issues — rerun this skill for them?
