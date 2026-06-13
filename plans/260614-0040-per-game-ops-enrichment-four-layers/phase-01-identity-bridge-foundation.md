# Phase 01 — Identity-Bridge Foundation (dependency root)

## Context Links
- Reports: `plans/reports/scout-260613-1854-stag-iceberg-enrichment-and-experimentation-map-report.md` §2.1–2.4, §5
- Pattern to copy: `cube-dev/cube/model/cubes/cfm/recharge.yml:42-63` (vopenid→gds_user_id std bridge)
- Trino client: `cube-dev/examples/trino_q.py` (env: TRINO_HOST/USER/PASS/CATALOG/SCHEMA; cfm schema `cfm_vn`, jus `jus_vn`)
- Spine: `cube-dev/cube/model/cubes/cfm/mf_users.yml`, `cube-dev/cube/model/cubes/jus/mf_users.yml`

## Overview
- **Priority:** P0 — blocks phases 2–5. No cube is authored until its join key is empirically proven.
- **Status:** pending
- **Description:** For cfm + jus, introspect Trino and resolve each cross-cutting table's RELIABLE join
  key to `mf_users.user_id` (GDS snowflake). Each table has its own id-namespace hazard. Output = a
  per-table **bridge spec** (one section per table) capturing: source schema.table, grain, id column(s),
  bridge SQL (if a translation table is needed), measured match-rate vs mf_users, one-row-per-grain proof,
  and freshness max-date. This spec is the input contract for phases 2–5.

## Key Insights
- mf_users.user_id is the canonical GDS snowflake. Cross-cutting tables key on foreign namespaces:
  - **pmt_user_daily.user_id** — format VARIES (numeric vs game-account string); prefer `vga_id` where populated (report §2.1).
  - **cs_ticket_info.user_id** — needs `split_part(user_id,'@',1)` (report §2.3).
  - **thinking_data {game}__events/user_profiles** — key = `user_ingame_id` (+ game scope); `user_vga_id` often NULL.
  - **vga.ingame_user_profile.user_id** — social form (`gg.x`, `fb.y`).
  - **mf_ip2location** — game × user, key `user_id` (verify it matches mf_users.user_id directly).
- The recharge.yml bridge proves the local pattern: LEFT JOIN a std bridge on a stable key (+ log_date for
  partition pruning) to translate foreign id → gds_user_id, THEN join mf_users. Replicate per table.
- Bridge must be proven, not assumed: a wrong key silently zero-matches (looks empty) OR fans out (inflates).

## Requirements
- Functional: for EACH of {pmt_user_daily, mf_payment_user_history, pmt_billing_ff_callback_trans,
  ingame_user_profile, mf_ip2location, thinking_data events+user_profiles, cs_ticket_info, cs_ticket_logs,
  cs_rating_processes} × {cfm, jus}: resolve + document the join path to mf_users.user_id.
- Non-functional: each bridge cites the verification SQL + observed match-rate (% of cross-cutting rows that
  resolve to a real mf_users.user_id) and grain proof (rows per join key ≤ expected).

## Architecture
- Discovery only — NO cubes authored in this phase. Data flow: Trino `DESCRIBE` + sample + COUNT/match-rate
  queries → bridge-spec markdown. Where a translation table is required (e.g. recharge's
  std_ingame_role_recharge), name it + the join key + partition-prune column.
- member-resolver impact: decide the LOGICAL cube name for each table (e.g. `payer_daily`, `payment_history`,
  `user_geo`, `behavior_profile`, `cs_ticket_detail`). On `local` these are passthrough; record them so the
  `prefix` mapping (prod) stays consistent if rolled out later. Do NOT register physical joins in app code.

## Related Code Files
- Read (context): `cube-dev/cube/model/cubes/cfm/recharge.yml`, `.../cfm/mf_users.yml`, `.../jus/mf_users.yml`, `cube-dev/examples/trino_q.py`
- Create: `plans/260614-0040-per-game-ops-enrichment-four-layers/reports/bridge-spec-cfm-jus.md` (the per-table bridge spec)
- Modify: none (discovery phase)

## Implementation Steps
1. Confirm Trino creds work: run `trino_q.py "SHOW TABLES FROM billing"` (and `payment`, `vga`, `gds_da`,
   `thinking_data`, `cs_ticket`) — record exact schema/table names per cfm (`cfm_vn`) and jus (`jus_vn`).
2. For each target table: `DESCRIBE` + 3-row sample + max-date freshness check.
3. For each table, run a match-rate probe against the game's `mf_users`:
   `SELECT count(*) total, count(mu.user_id) matched FROM <table> t LEFT JOIN mf_users mu ON <candidate key>`
   — try each candidate key (raw, split_part, via std bridge). Pick the highest reliable match.
4. Prove grain: `SELECT <key>, count(*) FROM <table> GROUP BY 1 ORDER BY 2 DESC LIMIT 5` — confirm user-grain
   tables are 1:1 and event/txn tables are 1:N (flag for separate-grain modeling + pre-agg in phase 8).
5. Record freshness tier per table (live / lagging / archive) from max-date.
6. Write `bridge-spec-cfm-jus.md`: one section per table with key, bridge SQL, match-rate, grain, freshness,
   logical cube name. Mark any table whose key cannot be reliably resolved as BLOCKED (escalate, do not author its cube).

## Todo List
- [ ] Verify Trino access for both schemas
- [ ] DESCRIBE + sample all 9 table families × cfm/jus
- [ ] Match-rate probe each → pick reliable key
- [ ] Grain proof per table
- [ ] Freshness max-date per table
- [ ] Assign logical cube names
- [ ] Write bridge-spec-cfm-jus.md
- [ ] Flag any unresolvable bridge as BLOCKED

## Success Criteria
- Every table in scope has a documented join path with a MEASURED match-rate (not assumed) and grain proof.
- Tables with no reliable bridge are explicitly flagged BLOCKED (their cube is dropped this round, not faked).
- Logical cube names assigned for member-resolver consistency.

## Risk Assessment
- **Wrong key chosen** (High×High): silent zero-match or fan-out. Mitigate: empirical match-rate + grain probe is the gate.
- **cs/thinking_data id unresolvable for jus** (Med×High, per report §5 + memory `cs-facebook-aihelp-uid-unresolvable`):
  some CS sources (FB/AIHelp PSID) cannot join to game uid. Mitigate: accept partial match-rate, document it,
  scope CS cube to resolvable sources only; flag unresolvable share.
- **Trino cold-scan slow on big tables** (Med×Med): use partition-prune columns (log_date) in every probe.

## Security Considerations
- Read-only Trino introspection. Do NOT copy raw PII (phone/email/IP) into the spec — record column NAMES + match-rates only.
- Bridge SQL must use partition columns to avoid full-table scans of 100M+ row tables.
