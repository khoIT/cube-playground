# Situational Chat Answers: Orientation Carve-Out + Live Churn/Reach Validation

**Date**: 2026-06-17 06:30 GMT+7
**Severity**: High
**Component**: chat-service explore skill, retention metrics (cfm_vn/jus_vn), cubestore rollup
**Status**: Resolved (code); blocked (cubestore restart pending)

## What Happened

Task 4 completed: reworked the explore skill's orientation branch from a qualitative metric-dictionary dead-end into a 3-step flow: short knowledge-bank orientation → **REQUIRED** `emit_query_artifact` WITH chart → `offer_choices` chips instead of prose question list. The agent must measure something and show a number before offering follow-ups.

Task 5 partially validated: retention.churned_d30 + cohort_size resolve live on cfm_vn AND jus_vn (dev cube :4000). Churn_rate certified + reachable. Pre-agg rollup deferred due to cubestore build/verify risk.

## The Brutal Truth

We've been letting the agent talk in circles — orientation without ever grounding in actual data. The fix sounds simple (chart before choice chips) but required explicit carve-outs to the ≤3 round budget AND the one-chart-per-turn rule. Why? Because a compliance-optimizing agent could skip the measure step to stay under round count. That's the entire point being undermined. So we wrote lines like "orientation + measure step DO NOT count toward round budget; measure MUST emit_query_artifact with chart."

The retention metrics work live. But cubestore doesn't have the pre-agg, so rollup advisor + full serve-side optimization can't ship yet. Dev works; prod doesn't. That's a hard blocker for go-live.

## Technical Details

**Code changes (commit 9f0dbdec):**
- `chat-service/.claude/skills/explore/SKILL.md`: orientation carve-out (lines ~145–165) exempts the knowledge-bank + measure steps from round budget. Orientation path skips `disambiguate_query` entirely and re-anchors empty previews via `get_time_coverage` so charts don't drop.
- `chat-service/src/core/mode-prompts.ts`: strengthened FIELD_CHIP_TOKEN_GUIDANCE with `{{field:cube.member}}` syntax + right/wrong example. Regenerated 5 prompt snapshots (no API change, just internal spec).
- Primitives (chart, chips, offer_choices) pre-existed. Change is instruction-level only.

**Metrics validation:**
- cfm_vn: `retention.churned_d30` (alias d30) + `retention.cohort_size` both resolve. Demo pivot [time, game] → [churn_rate]. ✓
- jus_vn: same. Both live in prod Cube (kraken/cube), certified + listed in business metrics. No knowledge-bank topic needed (explicit skip in availability check).
- Serving instance :17001 is stale: lacks churned_d30 definition. **Needs restart.** Dev :4000 has it.

**Test suite:** 1199/1199 green, typecheck clean.

## What We Tried

1. **Naive approach**: just call emit_query_artifact + offer_choices. Failed because agent's round-budget arbitration could defer measure step (saves tokens, breaks UX).
2. **Explicit carve-outs**: added lines clarifying that orientation + measure do NOT count against round limit and measure MUST emit with chart. Agent now follows.
3. **Retention rollup**: attempted to verify cubestore build for pre-agg. High friction (multi-min build, race conditions, future-seal bugs from prior work). Deferred pending ops handoff.

## Root Cause Analysis

**Why orientation was broken:** the agent treated it as a free pass to ask a prose question without proving any data existed or was relevant. No forcing function. Adding the chart requirement forces the agent to ground orientation in a real metric + a number, immediately validating that the metric resolves and is answerable.

**Why the round-budget carve-out was needed:** the original spec said "≤3 rounds" and "one chart per turn." An agent optimizing for compliance could say "I've hit round 3, skip the measure step, offer choices in round 3 itself, done." We needed to make it impossible to do that wrong. Explicit lines in the prompt do that better than hoping the model arbitrates correctly.

**Why cubestore is deferred:** pre-agg rollup builds are slow (5–15min per game) and cubestore has a history of race conditions (sealed partitions, future-date bugs from 7b5c8f1 / bf355f2). Verify-by-query is the safer path, but requires ops to restart the serving instance first so the new measure is visible.

## Lessons Learned

1. **Don't trust agent arbitration on conflicting rules.** If you say "do X and do Y" but don't say "X exempts you from Z," the agent may choose to skip X to comply with Z. Make constraint conflicts explicit in the prompt.

2. **Carve-outs belong in skill files, not just in conversation notes.** Write them into SKILL.md or mode-prompts.ts so they survive code review + future model changes. A comment like "orientation + measure are exempt from round budget" is cargo-cult without a line in the actual instruction.

3. **Parallel sessions can be clean if you stage files carefully.** A sibling Claude session committed unrelated CCU work (5feb679e, 79da539e) while I was staging chat-service changes. Per-file staging meant my commit was clean — never `git add -A` in this repo.

4. **Measure carve-outs need tests, not just prompts.** All 1199 tests passed because the new carve-out doesn't change the API — it's instruction-level. But there's no test that says "offering choices without a measure is a failure mode." Future work: add a test asserting measure precedes offer_choices.

5. **Cubestore pre-agg validation is a separate operational concern.** Code-side metrics work; serving-side optimization can't be verified until ops restarts. Don't conflate the two in PRs. Metrics are DONE, rollup is deferred.

## Next Steps

1. **Live re-ask smoke (pending restart):** ops restarts serving instance :17001 so churned_d30 is visible. Then re-verify churn_rate query end-to-end on prod.

2. **Retention pre-agg follow-up:** after serving restart, queue a cubestore rollup build for retention pre-agg. High risk due to historical race conditions — run with explicit verify loop (`measure-preagg-build.sh` harness in docs/lessons-learned.md).

3. **Measure-step test:** add a test case asserting that `offer_choices` without a prior `emit_query_artifact` fails schema validation (or add a runtime assertion in the agent).

4. **Prompt snapshot review:** regenerated 5 internal snapshots in mode-prompts.ts. Code-reviewer should spot-check that chip-token guidance example is clear.

## Unresolved Questions

- Serving instance :17001 restart: when? (ops timeline?)
- Retention rollup pre-agg: high cubestore risk — worth blocking go-live or ship metrics + skip rollup for Phase 1?

## Update (2026-06-17 15:05 GMT+7) — rollup shipped, not deferred

Reversed the deferral after confirming the build was low-risk in practice. Commit `8ede5517`.

- Added `cohort_retention_batch` (rollup) + `cohort_retention` (rollup_lambda, union_with_source_data) to `cfm/retention.yml` + `jus/retention.yml`, mirroring the proven `new_user_retention` lambda+batch template. Additive sums; `time_dimension: install_date` (already `CAST AS TIMESTAMP` → sidesteps the log_date DATE-grain seal bug); 120-day rolling window, monthly partitions, `build_range_end` capped at `MAX(log_date)`.
- Built + sealed locally via `trigger-preagg-build.sh <game> --restore`. The fear was overblown: 1–2 transient errors that self-retried, all rollups sealed.
- **Verified by compiled SQL, NOT usedPreAggregations** — the `rollup_lambda` reports `usedPreAggregations: []` even when serving from CubeStore. The `/sql` endpoint showed `FROM preagg_cfm.retention_cohort_retention_batch` / `preagg_jus.…` for both games. Latency 0.2s vs ~14s cold.
- **Prod auto-build** (answering the go-live question): the dedicated `cube_refresh_worker` (`CUBEJS_SCHEDULED_REFRESH_TIMER=300`) picks the rollup up on its next 5-min sweep AFTER a deploy/restart (DEV_MODE=false → no hot reload), then keeps it fresh hourly (`refresh_key: every 1 hour, incremental`). No manual trigger on prod; the serving `cube_api` reads the same CubeStore. So the earlier :17001 staleness resolves itself on the next deploy.
- Lesson reinforced: for a `rollup_lambda`, ALWAYS verify routing via compiled SQL — `usedPreAggregations` lies.
- Remaining follow-up: port the same rollup to other games' `retention.yml` (currently only cfm/jus, matching the plan's acceptance scope).
