---
title: "Experiment Command Center"
description: "CS-actuated closed-loop experiment platform: registry → hash-split assignment → CS work queue → pmt_user_daily outcome scorecard."
status: pending
priority: P2
effort: ~6d
branch: main
tags: [experiment, segments, care, lakehouse, monetization, poc]
created: 2026-06-14
---

# Experiment Command Center

A CS-actuated A/B experiment platform riding the surfaces already shipped
(Segments cohort, Care console, CS-ticket readers, lakehouse snapshot writer).
POC scope: ONE experiment, ONE game — "lapsing high-LTV payer win-back".
Treatment is delivered by the CS team (no player push); their actions sync back
via `cs_ticket_logs` as the exposure/compliance signal. Outcome measured on
`billing.pmt_user_daily` (live to yesterday).

Design source: `plans/reports/scout-260613-1854-stag-iceberg-enrichment-and-experimentation-map-report.md` §4.
Visuals/design reference: `plans/260614-0018-experiment-command-center/visuals/`.

## Architecture at a glance

```
Registry (SQLite) → Assignment (hash split over segment_membership_daily,
  immutable log in stag_iceberg.khoitn) → CS Work Queue (treatment arm, no PII)
  → CS acts → Compliance reader (cs_ticket_logs) + Outcome reader (pmt_user_daily)
  → Scorecard (ITT + treated-on-treated, lift/CI/significance) → Experiment-360
```

Two measured edges: **outcome** (`pmt_user_daily`) + **compliance** (`cs_ticket_logs`).
Reuses: `segment-snapshot-writer` pattern (assignment log), `cs-ticket-detail-reader`
pattern (compliance reader), Segments cohort (population), Care console (work-queue surface).

## Principles
- KISS/YAGNI: one game, one experiment type (CS cold-reach). Path-agnostic so a promo-push exposure plugs in later. No CUPED/sequential testing yet.
- DRY: reuse `lakehouse-trino-connector`, `trino-rest-client`, `inline-sql-params`, Care/Segments React patterns, design tokens.
- NO raw PII in product. Target list = game `user_id` + reachability flags only.

## Phases

| # | Phase | Status | Depends on |
|---|-------|--------|-----------|
| 1 | [Data layer: cohort/outcome/exposure readers](phase-01-data-layer-readers.md) | pending | — |
| 2 | [Experiment registry + assignment service](phase-02-registry-assignment.md) | pending | 1 |
| 3 | [Gateway API routes (CRUD / queue / scorecard)](phase-03-gateway-api-routes.md) | pending | 1, 2 |
| 4 | [CS Work Queue UI](phase-04-cs-work-queue-ui.md) | pending | 3 |
| 5 | [Scorecard / readout UI](phase-05-scorecard-readout-ui.md) | pending | 3 |
| 6 | [Experiment-360 drilldown + command-center home](phase-06-experiment-360-home.md) | pending | 3, 4, 5 |
| 7 | [Tests + docs](phase-07-tests-docs.md) | pending | 1–6 |

## Key dependencies / external facts (verified 2026-06-14, do not re-derive)
> **CATALOG CORRECTION:** cross-cutting ops data is canonical in **`iceberg`**, NOT `stag_iceberg` (stale/write-scoped). The original scout used the wrong catalog. Memory: `iceberg-vs-stag-iceberg-source-catalog`.
- **Outcome:** `iceberg.billing.std_billing_delivery_trans_gds` — txn grain, 58.6M, LIVE hourly; `user_id` = GDS snowflake → joins game `mf_users` directly. **Gross only (no refund table anywhere).**
- **Cohort LTV tier:** `iceberg.billing.pmt_users_history` (18.5M lifetime). **Lapse = recency from the LIVE txn table, not this.**
- **Per-game gate:** `iceberg.mdm.map_product_code` — cfm = `A49` ONLY (exclude dead `267`); jus = `A70`. cfm VND-only; **jus mixed USD+VND**.
- **Exposure:** `iceberg.cs_ticket.cs_ticket_info` → `cs_ticket_logs` + `cs_rating_processes`; game scope via `customer_id → customers_v2.product_id` = `856`(cfm)/`832`(jus) (99.9%). Member-level uid match is SPARSE (cfm ~23%).
- **Prefer the new ops cubes** (`billing_detail`/`billing_lifetime`/`cs_ticket_detail`, branch `feat/per-game-ops-enrichment-cubes`, plan `260614-0040`) over raw readers where they expose the grain — DRY + inherits the verified gate/joins.
- **Assignment log** → `stag_iceberg.khoitn` (correct: that catalog is for our own writes), nightly `segment_membership_daily` via `segment-snapshot-writer.ts`.
- Latest SQLite migration = `051`; new experiment migration = `052`.

## Cross-cutting risks
- **Freshness skew:** RESOLVED — lapse derived from the LIVE txn table (`std_billing_delivery_trans_gds`), lifetime table used only for the slow-moving LTV tier.
- **Compliance blind spot:** member-level CS match is sparse (cfm ~23%) AND outbound outreach must be logged with a resolvable uid (open Q#8). Mitigate: ITT primary + unaffected; treated-on-treated is best-effort, surface match-rate.
- **No refund table → gross revenue only.** Every readout must say "gross". (Resolves report Q#1.)
- **jus mixed-currency:** normalize USD→VND or report per-currency. cfm (A49, VND-only) is the clean POC game.
- **PII:** strictly user_id + numeric metrics + action codes; no contact columns ever selected. Per-phase Security sections.
- **Identity namespaces:** CS join via `customer_id → customers_v2.product_id` (99.9%), NOT the old `split_part` (~8%). Cohort/outcome share the GDS-snowflake `user_id` namespace.

## Unresolved questions
See each phase's "Risks" + report §Unresolved (#8 outbound-ticket logging, #9 CS capacity, #10 metric semantics). #1 refunds = RESOLVED (none → gross only).
