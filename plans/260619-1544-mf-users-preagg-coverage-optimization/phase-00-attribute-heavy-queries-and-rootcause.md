# Phase 00 — Attribute heavy queries + root-cause the moneyflow join

**Priority:** P0 (gates everything). **Status:** not started.
**Goal:** know *which app feature* emits the ≥5 min member-detail queries, and *why* they root
in `etl_ingame_moneyflow` instead of the cheap `mf_users` snapshot — before changing any YAML.

## Why this first

The expensive class (verified) is member-grain projections joining raw moneyflow, not the
churn_risk aggregate. Picking the wrong fix (a dimension rollup) would not touch the 8-min
queries. We must confirm the originating feature + the join-root cause empirically.

## Steps

1. **Attribute by SQL shape.** From the live Trino buffer (Grafana Infinity → coordinator
   `/v1/query`, user=`khoitn`, source=`nodejs-client`), bucket the ≥1 min `mf_users` queries by
   projection signature. Map each signature to its emitter by grepping the server for the
   measure/dimension set:
   - `user_id, ingame_name, ltv_total_vnd` (+rank) → segment members pull / refresh
     (`server/src/**` segment refresh + `/:id/members`).
   - `+ lifecycle_stage, last_active_date, install_date` → member-360 precompute.
   - `sum(...) ltv_total_vnd FROM (SELECT DISTINCT user_id …)` → segment size/preview.
   - `by churn_risk … whales` aggregate → segment-sizing / advisor / chat.
2. **Root-cause the join root.** Pull the full compiled SQL for query #1
   (`SELECT user_id FROM etl_ingame_moneyflow AS etl_money_flow LEFT JOIN mf_ingame_roles …`).
   Determine why Cube roots at `etl_money_flow`: which measure/dimension/segment in the
   request pulls the `mf_users → etl_money_flow` join (`cube-dev/cube/model/cubes/cfm/mf_users.yml`
   joins block). Candidate: a measure/dim defined over the moneyflow join rather than the
   snapshot column. Confirm with a `/dry-run` of that exact member request.
3. **Confirm snapshot sufficiency.** Check whether the fields member queries need
   (ltv_total_vnd, lifecycle_stage, etc.) all exist as columns on the `mf_users` snapshot
   table (so a moneyflow join is avoidable). Cross-check PKs/grain vs cube-prod oracle
   ([[cube-prod-pk-schema-oracle]]) to avoid fan-out.
4. **Quantify prod relevance.** Confirm whether prod (idle now) actually runs these shapes:
   grep advisor/segment/member features for the request builders; note expected prod
   frequency. Decides phase-02 rollout breadth.

## Deliverable

`plans/reports/scout-260619-1544-mf-users-heavy-query-attribution-report.md`:
- table: signature → emitter feature → count → p50/p95 elapsed → bytes;
- the join-root finding (which member/dim forces `etl_money_flow`), with compiled-SQL cite;
- snapshot-sufficiency verdict per needed field;
- recommended P1 direction (A/B/C) with rationale.

## Success criteria

- Every ≥1 min mf_users query class mapped to a concrete emitter (file/function).
- Documented, reproduced reason the heavy queries scan raw moneyflow.
- Clear A/B/C recommendation for phase-01 to execute.

## Decisions already locked (19 Jun)

- Counts = approx; P1 = all three A+B+C; rollout = all 8 games. Phase-00 no longer *chooses* a
  direction — it root-causes the join so phase-01 can apply B correctly and identifies which
  fields (if any) need C (upstream).
