# Starter + knowledge-bank rollout — all 6 games, workspace `local`

Date: 2026-06-07 (GMT+7) · Seeds frozen: `260607-1835` · Extends the ballistar/cfm report (`starter-question-batch-verify-260607-1729-…`)

## Verdict

- **Starter chips (108 questions, 6 games): tier-1 108/108** real, non-degenerate data.
- **Tier-2 real chat turns: 74/74** — 18×4 for cros/jus_vn/muaw/pubg + 2 re-driven cfm chips (changed text). Every turn ≥1 query artifact + clean done. Subscription auth lane; restored to `auto` after.
- **Knowledge bank (`get_topic_knowledge`, 204 questions): 204/204** verified post-repoint (sweeps + direct re-probes of infra flakes).
- Cumulative with yesterday: 110 turn-verified chips (36 + 74), both seeds consistent (shared ids carry identical text/targets).

## What the sweep caught (58/204 bank questions bad)

New automated **degeneracy checks** in tier-1 (previously manual): split dim with <2 distinct non-null values; measure zero/null across all rows. Failure classes:

| Class | Games | Fix |
|---|---|---|
| Dead dims (null `role_class`/`max_fighting_power`/`first_role_class`, single server, VN-only country, `lottery_box`→other) | ballistar, cfm, cros, pubg | repointed to verified dims |
| Zero measures (`roas`/`cpi` w/o cost data, `iap_rev`/`web_rev`, `rnru_d60/d90`, `ten_pull_count`, `completion_rate` null) | all 6 | repointed to additive measures with real data |
| jus_vn `mf_users` broken (ltv/paying_rate/whales all zero, `payer_tier`=non_payer only) | jus_vn | routed around mf_users entirely |
| Bank drift vs yesterday's starter fixes (8 renamed + 8 retexted) | ballistar, cfm | synced bank → starter versions |

43 repoints + 8 renamed-entry replacements + 2 cfm follow-ups (tutorial `completion_rate` null → players-per-step; gacha `total_cost_gold` all-zero → pulls-by-banner) + 1 cros follow-up (`paying_rate_30d` zero → paying-users-by-install-month). Replacement rules: lead with additive volume measure (NULL ratios sort first under desc); collision-guard against kept questions' target sets; members only from the run's verified-good pool.

## Code fix

`chat-service/src/tools/disambiguate-starter-passthrough.ts` — `timeDimensionOf` now prefers `*_date` dims when no `.log_date`/`.dteventtime` partition column matches. ballistar `recharge` cube has `recharge_time` (raw ts, listed first) + `recharge_date` (pre-agg partition col); bounding `recharge_time` → 400 "No pre-aggregation partitions were built". Python mirror in the skill updated. Unit test added (10/10 pass, tsc clean).

## Infra incidents (3, all diagnosed)

1. **CubeStore-dev metadata wedge**: worker spamming "Pre-aggregation table is not found … after it was successfully created" → 400/0-row on game_key_metrics/marketing_cost/active_daily lambdas. Fix: `docker restart cube-playground-cubestore-dev cube-playground-cube-refresh-worker-dev`.
2. **Host dev chat-service (:3005) crash-looped on turn start** (died mid-SSE → conn refused → tsx revived). Same code stable on fresh instance — stale process state. Drove batches against a sacrificial `PORT=3015 npx tsx src/index.ts` instance (shares chat.db → inherits persisted auth lane). User restarted their terminal.
3. **Self-inflicted load contention**: running the bank sweep concurrently with turn batches starved dev cube-api → turns saw 500/504, called `emit_query_artifact` but couldn't emit → `no-artifact` fails with inflated wall times (~1000s vs 240s budget). All 10 recovered when retried solo. Rule added to skill: probes and turn batches strictly sequential; retry no-artifact at `--concurrency 1` before treating as real.

## Verification matrix (tier-2 turn times)

cros 18/18 (35–218s) · jus_vn 18/18 (44–179s) · muaw 18/18 (39–1071s incl. queue-inflated pass) · pubg 18/18 (41–218s) · cfm re-driven 2/2. Raw SSE: `/tmp/starter-turns-4games/`; results `/tmp/tier2-4games.json`, `/tmp/tier2-cfm-fixes.json`; bank probes `/tmp/knowledge-tier1-final4.json` (+ flake re-probe in session log).

## State

- Both seeds at `260607-1835`; docker chat-service rebuilt with them (verify `/api/chat/starter-questions` serves new ids).
- Skill `.claude/skills/starter-question-batch-verify/` updated: `--seed-format knowledge`, automated degeneracy checks, `*_date` partition rule, CubeStore restart recipe, sequential-load + conc-1-retry rules, sacrificial-instance recipe. (gitignored, local-only)
- Uncommitted: both seed JSONs, passthrough TS + test.

## Unresolved questions

1. cfm `etl_lottery_shoot` fictional `lotteryid 1–6` CASE mappings still in cube-dev model (carried from yesterday) — data-team mapping or removal.
2. jus_vn `mf_users` measures all zero — likely same vopenid identity-namespace issue as cfm (memory: fixed for cfm via std bridge join). Worth applying the same bridge to jus?
3. pubg/jus `new_user_retention.is_paid_install` = 'na' only — UA attribution not flowing for these games; repointed around it, but the upstream gap remains.
4. Dev refresh-worker flaps under load (partitions transiently vanish) — consider bumping worker resources or `CUBEJS_REFRESH_WORKER` concurrency before next batch.
