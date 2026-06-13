# Phase 01 — Data Layer: cohort / outcome / exposure readers

## Context links
- Report §2.1 (monetization tables), §4.1 (two-edge loop), §4.2 (POC).
- Template: `server/src/lakehouse/cs-ticket-detail-reader.ts` (reader shape: build SQL → `runQuery` → map rows).
- Connector: `server/src/lakehouse/lakehouse-trino-connector.ts` (`lakehouseConnectorFromEnv`, catalog `game_integration` session; billing/cs are sibling catalogs `stag_iceberg.billing` / `iceberg.cs_ticket`).
- SQL literal helper: `server/src/lakehouse/inline-sql-params.ts` (`toSqlLiteral`).

## Overview
- **Priority:** P0 (everything downstream reads these).
- **Status:** pending.
- Three read-only Trino readers, each in its own file under `server/src/lakehouse/`. No new connector — reuse `lakehouseConnectorFromEnv()` / `getConnector()` + `runQuery`. Greenfield: `grep pmt_user_daily server/src` returns 0 hits.

## Key insights
- `pmt_user_daily` is the ONLY live (yesterday-fresh) monetization table → use it for BOTH the lapse definition AND the outcome window. This sidesteps the cohort-table 5-month lag risk (don't trust `mf_payment_user_history.last_payment_date` for recency).
- `mf_payment_user_history` used ONLY for the lifetime-VND tier (LTV quartile) gate — its lag doesn't matter for a slow-moving lifetime sum.
- Compliance reader mirrors `cs-ticket-detail-reader`: join `cs_ticket_info` (`split_part(user_id,'@',1)`) → `cs_ticket_logs` filtered to the assignment window, return per-uid contacted-flag + action + CSAT.
- Catalog note: cs tables are `iceberg.cs_ticket.*` (per existing reader `const CS = 'iceberg.cs_ticket'`); billing is `stag_iceberg.billing.*`. Both are fully-qualified, session catalog irrelevant.

## Requirements
Functional:
1. **Cohort reader** (`payer-cohort-reader.ts`): given gameId + thresholds (LTV quartile floor in VND, lapse window 21–60d), return candidate `user_id` list. LTV gate from `mf_payment_user_history`; lapse gate from `pmt_user_daily` (MAX(day) per user 21–60d ago).
2. **Outcome reader** (`payment-outcome-reader.ts`): given uid list + assignment date + window (14d), return per-uid post-window `sum(rev_vnd)`, `sum(trans)`, and a `repaid` boolean (trans>0). Also a daily series (uid optional → arm-level cumulative) for the timeseries chart.
3. **Exposure/compliance reader** (`cs-exposure-reader.ts`): given uid list + window, return per-uid `contacted` flag, first action_code/name, action `log_time`, staff id, CSAT rating.

Non-functional: date-partition pruning on `day`/`log_date` (cost); statement timeout reuse `LAKEHOUSE_STATEMENT_TIMEOUT_MS`; all uid lists sanitized (alphanumeric, like detail reader's `sanitizeUid`).

## Data flow
```
gameId+thresholds → cohort-reader → user_id[]  (population)
user_id[] + assignDate+window → outcome-reader → {uid, revVnd, trans, repaid}[]
user_id[] + window           → exposure-reader → {uid, contacted, action, csat, staff, at}[]
```

## Related code files
Create:
- `server/src/lakehouse/payer-cohort-reader.ts`
- `server/src/lakehouse/payment-outcome-reader.ts`
- `server/src/lakehouse/cs-exposure-reader.ts`
- `server/src/lakehouse/experiment-reader-types.ts` (shared row interfaces)

Read for context (no edit): `cs-ticket-detail-reader.ts`, `cs-ticket-detail-signals.ts`, `lakehouse-trino-connector.ts`, `inline-sql-params.ts`, `services/trino-rest-client.ts`.

## Implementation steps
1. `experiment-reader-types.ts`: `CohortCandidate`, `OutcomeRow`, `OutcomeSeriesPoint`, `ExposureRow`, plus `ExperimentArm = 'treatment' | 'control'`.
2. `payer-cohort-reader.ts`:
   - `buildCohortSql(schema, ltvFloorVnd, lapseMinDays, lapseMaxDays, asOf)` — CTE: `ltv AS (SELECT user_id, sum(cumulative_vnd) FROM stag_iceberg.billing.mf_payment_user_history WHERE … GROUP BY user_id HAVING sum >= ltvFloor)`, `recency AS (SELECT user_id, max(day) FROM stag_iceberg.billing.pmt_user_daily WHERE day <= asOf GROUP BY user_id)` then `WHERE date_diff('day', maxDay, asOf) BETWEEN lapseMin AND lapseMax`.
   - Confirm exact column names against the live table via `scripts/trino-query.mjs DESCRIBE stag_iceberg.billing.pmt_user_daily` before finalizing SQL (report lists `rev_vnd`,`trans`,`npu`,`dpu`,`first_payment_date`).
   - `fetchPayerCohort(opts)` → `CohortCandidate[]`.
3. `payment-outcome-reader.ts`:
   - `buildOutcomeAggSql(uids, fromDate, toDate)` → per-uid `sum(rev_vnd)`,`sum(trans)`.
   - `buildOutcomeSeriesSql(uids, fromDate, toDate)` → per-day `sum(rev_vnd)`,`sum(trans)`,`count(distinct user_id where trans>0)`.
   - uid IN-list chunked (cap ~1000/query; loop+merge if larger — KISS cap, document).
   - `fetchOutcome(opts)` / `fetchOutcomeSeries(opts)`.
4. `cs-exposure-reader.ts`:
   - `buildExposureSql(productId, uids, fromDate, toDate)` — `cs_ticket_info` (`split_part(user_id,'@',1) IN (…)`, `log_date BETWEEN`) join `cs_ticket_logs` on ticket_id (`log_time BETWEEN`), LEFT JOIN `cs_rating_processes` for CSAT. row_number dedup to first action per uid.
   - Reuse `csProductId(gameId)` from `cs-product-map.ts`.
   - `fetchExposure(opts)` → `ExposureRow[]`.
5. Each reader: sanitize uids, short-circuit `[]` on empty input, throw on connector-missing (caller maps to 502).
6. Compile check: `npm --prefix server run build` (or `tsc --noEmit`).

## Todo
- [ ] `experiment-reader-types.ts`
- [ ] `payer-cohort-reader.ts` (+ verify column names via trino DESCRIBE)
- [ ] `payment-outcome-reader.ts` (agg + series)
- [ ] `cs-exposure-reader.ts`
- [ ] uid sanitize + empty short-circuit in all three
- [ ] compile clean

## Success criteria
- Each reader callable in isolation; against live Trino, cohort reader returns a non-empty list for `cfm_vn`/`jus_vn` with sane thresholds; outcome reader returns rev/trans for a known recent payer; exposure reader returns contacted flags for a uid with a recent ticket.
- No contact-PII columns (phone/email/msisdn) selected anywhere — grep the new files to confirm.

## Risks
| Risk | L×I | Mitigation |
|---|---|---|
| Column names differ from report | M×M | DESCRIBE live table before writing SQL; types file is single source. |
| `pmt_user_daily` 35.5M rows scan cost | M×H | Always date-partition prune (`day` predicate); chunk uid IN-list. |
| `mf_payment_user_history` lag distorts LTV tier | L×L | Lifetime VND is slow-moving; acceptable. Lapse from live table only. |
| Identity mismatch (`user_id` form across tables) | M×M | Reuse `split_part(...,'@',1)` for cs join; cohort/outcome both key raw `pmt_user_daily.user_id` — same namespace, no cross-table id translation. |

## Security (PII)
- Readers return `user_id` + numeric metrics + action codes ONLY. NEVER select `msisdn`, `customer_msisdn`, `customer_email`, phone, or email. This is the compliance boundary — enforce at the SQL layer (column allow-list in each `build*Sql`).

## Next steps
Phase 2 consumes cohort reader (assignment) + Phase 3 consumes outcome/exposure (scorecard).
