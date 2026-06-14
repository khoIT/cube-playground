# Phase 01 — Data Layer: cohort / outcome / exposure readers

> **CATALOG CORRECTION (2026-06-14).** The original scout sourced `stag_iceberg`, which is write/exploration-scoped and stale. Cross-cutting ops data (monetization / identity / CS) is canonical in the **`iceberg`** catalog. All table refs below are corrected. `stag_iceberg` is used ONLY for our own segment-membership + assignment-log writes (Phase 2). See memory `iceberg-vs-stag-iceberg-source-catalog`.
>
> **PREFER THE NEW OPS CUBES.** A sibling effort (`plans/260614-0040-per-game-ops-enrichment-four-layers/`, branch `feat/per-game-ops-enrichment-cubes`) already implements `billing_detail`, `billing_lifetime`, `cs_ticket_detail`, `user_identity` cubes over these exact `iceberg` tables for cfm+jus. **Where a cube already exposes the needed grain, read through Cube (semantic layer) instead of a new raw-Trino reader** — DRY, and it inherits the verified per-game gate + joins. Raw readers below are the fallback for grains the cubes don't expose (e.g. the cohort recency scan).

## Context links
- Sibling plan + verified join map: `plans/260614-0040-per-game-ops-enrichment-four-layers/` + its `reports/bridge-spec-cfm-jus.md`.
- Reader template: `server/src/lakehouse/cs-ticket-detail-reader.ts` (build SQL → `runQuery` → map rows).
- Connector: `server/src/lakehouse/lakehouse-trino-connector.ts` (`lakehouseConnectorFromEnv`); cross-catalog 3-part refs work from the `game_integration` session (proven by `cube/model/_shared/segment_membership.yml`).
- SQL literal helper: `server/src/lakehouse/inline-sql-params.ts` (`toSqlLiteral`).

## Overview
- **Priority:** P0 (everything downstream reads these).
- **Status:** pending.
- Read-only access to three signals — cohort, outcome, exposure. First choice: **Cube query** against the new ops cubes. Fallback: raw-Trino reader under `server/src/lakehouse/` reusing `lakehouseConnectorFromEnv()` + `runQuery`.

## Verified sources (iceberg)
| Signal | Source | Grain | Notes |
|---|---|---|---|
| Outcome (re-pay) | `iceberg.billing.std_billing_delivery_trans_gds` (or cube `billing_detail`) | txn, 58.6M, **LIVE hourly** | `user_id` = GDS snowflake → joins game `mf_users.user_id` directly. **Gross only — no refund table anywhere.** |
| LTV tier (cohort gate) | `iceberg.billing.pmt_users_history` (or cube `billing_lifetime`) | per-user lifetime, 18.5M | lifetime VND/USD/txn; slow-moving. |
| Per-game gate | `iceberg.mdm.map_product_code` (`product_code → game_id`) | lookup | **cfm = `A49` ONLY** (exclude `267` — dead legacy, tanks match to 78%); jus = `A70`. |
| Currency | — | — | **cfm A49 = VND-only; jus A70 = MIXED USD+VND** → jus outcome must normalize currency. |
| Exposure (compliance) | `iceberg.cs_ticket.cs_ticket_info` → `cs_ticket_logs` (action) + `cs_rating_processes` (CSAT) | per-ticket / per-action | Game scope via `cs_ticket_info.customer_id → customers_v2.product_id` = `856`(cfm)/`832`(jus), 99.9%. |

## Key insights
- **Lapse = recency from the LIVE txn table** (`std_billing_delivery_trans_gds`: `MAX(txn_time)` per user 21–60d ago), NOT from a lagging lifetime table. LTV-tier gate from `pmt_users_history` (lag fine for a lifetime sum).
- **Cohort/outcome share one id namespace** (`user_id` GDS snowflake) → no cross-table id translation; joins straight to game `mf_users`.
- **Exposure member-match is inherently sparse** (cfm ~23%, jus ~9.5% of tickets resolve to a game uid — ~75% are Facebook PSID tickets that never map; see `cs-facebook-aihelp-uid-unresolvable`). Game-aggregate CS is solid, member-level is sparse. ⇒ **ITT (assigned) is primary and unaffected; treated-on-treated is best-effort.** Whether *outbound* win-back contacts carry a resolvable uid is open-question #8 (ops).
- **No refund table → "re-pay" = gross `rev_vnd`/`trans`.** This resolves report open-Q1: net revenue is not computable; state "gross" in every readout.

## Requirements
Functional:
1. **Cohort reader** (`payer-cohort-reader.ts`): gameId + thresholds (LTV-VND floor, lapse window 21–60d) → candidate `user_id[]`. LTV gate from `pmt_users_history`; lapse gate from `std_billing_delivery_trans_gds`. Per-game gate via `map_product_code` (cfm→A49).
2. **Outcome reader** (`payment-outcome-reader.ts`): uid list + assignment date + window (14d) → per-uid post-window `sum(gross_vnd)`, `sum(trans)`, `repaid` bool; plus arm-level daily cumulative series for the chart. jus: normalize USD→VND (or split by currency).
3. **Exposure reader** (`cs-exposure-reader.ts`): uid list + window → per-uid `contacted` flag, first `action_code`/name, `log_time`, staff id, CSAT. Join via `customer_id → customers_v2.product_id` (NOT split_part).

Non-functional: date-partition prune; `LAKEHOUSE_STATEMENT_TIMEOUT_MS`; uid sanitize; empty short-circuit.

## Related code files
Create (only for grains not covered by the ops cubes):
- `server/src/lakehouse/payer-cohort-reader.ts`
- `server/src/lakehouse/payment-outcome-reader.ts`
- `server/src/lakehouse/cs-exposure-reader.ts`
- `server/src/lakehouse/experiment-reader-types.ts`

Read for context: the 4 new cubes (`cube/model/.../billing_detail.yml`, `billing_lifetime.yml`, `cs_ticket_detail.yml`, `user_identity.yml`) on branch `feat/per-game-ops-enrichment-cubes`; `cs-ticket-detail-reader.ts`; `lakehouse-trino-connector.ts`; `inline-sql-params.ts`; `cs-product-map.ts` (verify it maps cfm→856/jus→832 for customers_v2; older `267` is wrong).

## Implementation steps
1. **Decide cube-vs-raw per signal.** DESCRIBE the cubes' `/meta`; if `billing_detail` exposes per-user daily gross + txn, read outcome via Cube. Cohort recency scan likely needs a raw reader (range scan over txn). Document the decision in `experiment-reader-types.ts` header.
2. `experiment-reader-types.ts`: `CohortCandidate`, `OutcomeRow`, `OutcomeSeriesPoint`, `ExposureRow`, `ExperimentArm`.
3. `payer-cohort-reader.ts`:
   - CTEs: `ltv` from `iceberg.billing.pmt_users_history` (HAVING lifetime_vnd >= floor); `recency` from `iceberg.billing.std_billing_delivery_trans_gds` (`MAX(txn_time)` per user); gate via `iceberg.mdm.map_product_code` (product_code = `A49` for cfm). `WHERE date_diff('day', maxTxn, asOf) BETWEEN lapseMin AND lapseMax`.
   - **DESCRIBE `iceberg.billing.std_billing_delivery_trans_gds` + `pmt_users_history` + `mdm.map_product_code` via `scripts/trino-query.mjs` before finalizing column names** (the stag_iceberg column names in the old scout are NOT reliable).
4. `payment-outcome-reader.ts`: agg + daily-series SQL over `std_billing_delivery_trans_gds`, gross VND; jus currency-normalize; uid IN-list chunked (~1000/query).
5. `cs-exposure-reader.ts`: `cs_ticket_info` (gate `customer_id → customers_v2.product_id = 856/832`, `log_date BETWEEN`) → `cs_ticket_logs` on ticket_id (`log_time BETWEEN`) ⟕ `cs_rating_processes` CSAT; row_number dedup to first action per uid.
6. Sanitize uids, short-circuit `[]`, throw on connector-missing → 502.
7. Compile: `npm --prefix server run build`.

## Todo
- [ ] cube-vs-raw decision per signal (read `/meta` of the 4 ops cubes)
- [ ] `experiment-reader-types.ts`
- [ ] `payer-cohort-reader.ts` (+ DESCRIBE the 3 iceberg tables first)
- [ ] `payment-outcome-reader.ts` (gross VND; jus currency handling)
- [ ] `cs-exposure-reader.ts` (customers_v2 join, not split_part)
- [ ] uid sanitize + empty short-circuit
- [ ] compile clean

## Success criteria
- Cohort reader returns a non-empty `cfm_vn` list (A49, gross VND) for sane thresholds; outcome reader returns gross rev/trans for a known recent payer; exposure reader returns contacted flags for a uid with a recent ticket (accepting sparse member-match).
- No contact-PII columns selected anywhere (grep the new files).

## Risks
| Risk | L×I | Mitigation |
|---|---|---|
| Column names unknown (txn table) | M×M | DESCRIBE `iceberg.billing.*` + `mdm.map_product_code` before SQL; types file = single source. |
| jus mixed-currency skews outcome | M×H | Normalize USD→VND at query time or report per-currency; cfm (A49 VND-only) is the clean POC game. |
| Exposure member-match sparse (~23% cfm) | H×M | ITT primary (unaffected); ToT labeled best-effort; surface match-rate in UI. |
| Txn-table range scan cost (58.6M) | M×H | Partition prune on txn date; chunk uid IN-list. |
| Including dead product `267` for cfm | L×H | Gate to `A49` ONLY via `map_product_code`. |

## Security (PII)
- Readers return `user_id` + numeric metrics + action codes ONLY. NEVER select phone/email/msisdn/customer contact columns. Enforce via column allow-list in each `build*Sql`; covered by the Phase 7 regression test.

## Next steps
Phase 2 consumes cohort reader (assignment); Phase 3 consumes outcome/exposure (scorecard). The assignment log (Phase 2) writes to `stag_iceberg.khoitn` — that catalog stays correct for our own writes.
