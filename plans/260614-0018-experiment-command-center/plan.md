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

## Key dependencies / external facts (verified, do not re-derive)
- `billing.pmt_user_daily` — live to yesterday, keyed `user_id`, `rev_vnd`/`trans`/`npu`/`dpu` per day. Outcome source.
- `billing.mf_payment_user_history` — lifetime VND tiers + `last_payment_date` (lags ~5mo). Cohort source.
- `cs_ticket.cs_ticket_logs` + `cs_ticket_info` (join via `split_part(user_id,'@',1)`) + `cs_rating_processes`. Exposure/CSAT source.
- Assignment over `stag_iceberg.khoitn`.`segment_membership_daily` (nightly snapshot already written by `segment-snapshot-writer.ts`).
- No billing reader exists yet — Phase 1 is greenfield (`grep pmt_user_daily server/src` = 0 hits).
- Latest SQLite migration = `051`; new experiment migration = `052`.

## Cross-cutting risks
- **Freshness skew:** cohort table lags ~5mo while outcome is live — `last_payment_date` defines "lapsed" against a stale snapshot. Mitigate: validate recency against live `pmt_user_daily` MAX(day) per uid at assignment time, OR derive lapse from `pmt_user_daily` directly (preferred — see Phase 1).
- **Compliance blind spot:** outbound CS outreach must create a logged ticket/action, else compliance edge is blind (open question #8 in report). Mitigate: ITT is primary and unaffected; treated-on-treated degrades to "no contacts matched" not a wrong number.
- **PII:** strictly user_id + aggregate reachability. Enforced server-side; no contact columns ever selected. See per-phase Security sections.
- **Identity namespaces:** route uid joins through existing `split_part` convention; do NOT hardcode new join logic.

## Unresolved questions
See each phase's "Risks" + the report §Unresolved questions (#1 refunds, #8 outbound-ticket logging, #9 CS capacity, #10 npu/dpu semantics).
