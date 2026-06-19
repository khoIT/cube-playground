# Scout report — mf_users heavy-query attribution + moneyflow root-cause

Phase-00 deliverable. Investigation date 19 Jun (GMT+7). Read-only forensics +
live compiled-SQL probes against dev cube (`:4000`, workspace local, cfm_vn).

## Headline: the plan's central premise is FALSE

Plan.md "verified" evidence said the ≥5 min queries are **mf_users member-detail
rooting in / joining `etl_ingame_moneyflow`**. Two independent lines of evidence
disprove this:

1. **mf_users cube has no moneyflow.** Its base SQL is
   `SELECT base.*, latest_role.ingame_name FROM mf_users base LEFT JOIN (… mf_ingame_roles … GROUP BY 1) latest_role`
   (`cube-dev/cube/model/cubes/cfm/mf_users.yml:7-16`). Every measure/dim is a
   snapshot column. No join to `etl_money_flow` / `etl_ingame_moneyflow` exists.
2. **No member query pulls an event-table measure** (file:line forensics):
   - `server/src/services/member-profile-runner.ts:96-158` — dims + optional `ltv_total_vnd` rank only.
   - `server/src/services/member-profile-on-demand.ts:71-131` — same, capped 1000.
   - `server/src/services/member-tier-runner.ts` (called `jobs/refresh-segment.ts:395-404`) — identity + ltv + name.
   - `server/src/services/preview-service.ts:66-112` and `jobs/refresh-segment.ts:228-275` — identity projection / `user_count` only.
   - `server/src/presets/bundles/mf-users-hub.yml:43-51` — memberColumns = name, ltv, stage, last-active, joined. Zero recharge refs.

## Live compiled-SQL probe (gold standard)

| Shape | usedPreAgg | tables in compiled SQL | moneyflow? | verdict |
|-------|-----------|------------------------|-----------|---------|
| member-detail (user_id+name+ltv+stage+last_active) | none | `mf_users`, `mf_ingame_roles` | **no** | MISS → scans snapshot view |
| aggregate churn_risk × whales (ltv + exact user_count) | none | `mf_users`, `mf_ingame_roles` | **no** | MISS |
| composition payer_tier × lifecycle (approx + ltv) | **mf_users.user_composition_batch** (external:true) | `preagg_cfm.mf_users_user_composition_batch` | no | **HIT** |
| cohort ltv by country × install_date | **mf_users.ltv_by_install_cohort_batch** (external:true) | `preagg_cfm.mf_users_ltv_by_install_cohort_batch` | no | **HIT** |
| size identity projection (total) | none | `mf_users`, `mf_ingame_roles` | no | MISS (expected — identity projection) |

Probe script: `scratchpad/probe.py`. (Note: the dev pre-agg schema is
`preagg_cfm`, NOT `prod_pre_aggregations`; route on `usedPreAggregations` +
`external:true` + `FROM preagg_*`, not the prod string.)

## Where the real `etl_ingame_moneyflow` ≥5 min load comes from

`etl_money_flow` cube = `sql_table: etl_ingame_moneyflow` (1.35 BILLION rows),
joins `user_roles` via `playerid` (`cfm/etl_money_flow.yml:2-23`). Consumers:
- `server/src/presets/dashboard-starter-pack/economy-and-gacha.yml` (out_events, total_delta, distinct_players by log_date)
- `server/src/presets/business-metrics/{diamond_net_delta,economy_spenders,diamond_spend_events}.yml`

These are **diamond/currency-flow economy analytics**, a different cube and
feature from mf_users member lists. The buffer-era attribution that bucketed
these under "mf_users member-detail" was incorrect.

## Corrected problem map (what is actually true now)

- **P2 (segment-sizing / composition rollup): ALREADY BUILT + WORKING.** Commits
  `909d80df`, `2c7c4cbd` added `user_composition_batch` (approx counts +
  additive LTV over country/media/os/payer_tier/lifecycle_stage/is_paying_user).
  Verified HIT. Plan assumed it didn't exist.
- **Real remaining mf_users gaps (verified MISS today):**
  1. **churn_risk / engagement_segment aggregates** + the `whales` segment +
     exact `user_count` → no rollup covers these dims/segment → raw snapshot scan.
  2. **Member-detail projection + identity-size** → re-run the live snapshot view
     every refresh: full `mf_users` table scan **plus** the `mf_ingame_roles
     GROUP BY` (ingame_name) recomputed each time. This is the genuine member
     cost — a wide-snapshot scan, NOT a 1.35B-row event scan.

## Direction A/B/C reassessed vs the locked decision

- **A (originalSql materialised snapshot): VALID + valuable.** Materialising the
  `mf_users base LEFT JOIN mf_ingame_roles` derived view in CubeStore would let
  member-detail + identity-size + every existing rollup build off a cached table
  instead of recomputing the ingame_name GROUP BY live. Genuine win.
- **B (fix join-root so member queries read snapshot not moneyflow): NO-OP.**
  There is no moneyflow join in any mf_users query to fix. The premise is absent.
- **C (push missing fields upstream): not needed** for any verified shape — every
  field member queries use already exists on the snapshot.

## Recommendation for phase-01 (pending user re-confirmation — premise changed)

1. **A** — add `originalSql` pre-agg for the mf_users snapshot (member-detail +
   size + faster rollup builds). Highest real value.
2. **Extend composition rollup** to cover churn_risk / engagement_segment (and
   decide whales-segment / exact-count handling — approx already chosen) so the
   last aggregate MISS becomes a HIT. Small, additive.
3. **Drop B and C** — no problem to fix; flag don't fabricate.
4. **Separately:** the actual ≥5 min `etl_ingame_moneyflow` load is the economy
   dashboards on the 1.35B-row `etl_money_flow` cube — a distinct optimization
   (own rollups) outside this plan's mf_users scope.

## Unresolved questions

1. Locked decision D2 = "do all three A+B+C". B is a no-op and C unneeded against
   current code. Re-confirm scope: A + churn_risk rollup extension only?
2. Is the real target the **mf_users snapshot scan cost** (this plan, narrowed)
   or the **etl_money_flow 1.35B-row economy dashboards** (the actual ≥5 min
   queries, different cube)? The plan's title says mf_users; the cited heavy
   queries are money_flow.
