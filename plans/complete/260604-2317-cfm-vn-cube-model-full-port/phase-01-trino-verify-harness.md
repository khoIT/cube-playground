---
phase: 1
title: Trino Verify Harness
status: completed
priority: P1
effort: 0.5d
dependencies: []
---

# Phase 1: Trino Verify Harness

## Overview
Build a small, reusable Trino query helper + produce table/column inventories for the active tenants: `game_integration.cfm_vn`, `game_integration.cros`, `game_integration.tf`. (vga/`iceberg.vga` deferred — Validation S1.) Every later phase verifies YAML against this ground truth instead of trusting upstream comments.

## Multi-tenant scope note
<!-- Updated: Validation Session 1 - vga/iceberg deferred. Active inventory = cfm_vn/cros/tf only. -->
- **Active:** cfm/cros/tf → catalog `game_integration`, schemas `cfm_vn`/`cros`/`tf`.
- **Deferred (vga):** `iceberg.vga` inventory only when vga (Phase 12) resumes. Optional now: a one-line iceberg reachability probe to de-risk the future vga phase, but not required.

## Requirements
- Functional: run arbitrary read-only SQL against `game_integration.cfm_vn`; list tables; describe columns; sample N rows.
- Non-functional: read-only; creds never printed/committed; reusable by phases 3–9 and the E2E check.

## Architecture
- No `trino` CLI installed. Use the **trino python client** (`pip install trino` into `.claude/skills/.venv` or a local venv) OR the running cube-dev container's REST `/v1/load` SQL path. Python client preferred (deterministic, no container dependency).
- Creds: read host/port/user/password/catalog from `cube-dev/.env` (and `~/.trino-creds`). The cube-dev driver-patch strips `SET SESSION query_max_run_time` (Trino role lacks `SET_SYSTEM_SESSION_PROPERTY`) — replicate by setting only allowed session props, or none.
- Helper script lives under the plan dir (not shipped): `plans/260604-2317-cfm-vn-cube-model-full-port/scripts/trino_q.py`.

## Related Code Files
- Create: `plans/260604-2317-cfm-vn-cube-model-full-port/scripts/trino_q.py` (CLI: `--sql`, `--describe <table>`, `--sample <table>`, `--list`)
- Create: `plans/260604-2317-cfm-vn-cube-model-full-port/reports/cfm_vn-table-inventory.md` (generated inventory)
- Read: `cube-dev/.env`, `~/.trino-creds`, `cube-dev/docker-compose.yml`

## Implementation Steps
1. Parse `cube-dev/.env` for `CUBEJS_DB_HOST/PORT/USER/PASS/PRESTO_CATALOG`. Confirm catalog = `game_integration`.
2. Write `trino_q.py` using `trino.dbapi.connect(... http_scheme, auth=BasicAuthentication)`; default `schema='cfm_vn'`. Fail closed if creds missing.
3. `--list`: `SHOW TABLES FROM game_integration.{cfm_vn,cros,tf}` → capture full table lists per tenant. (vga/iceberg deferred.)
4. For each table the port needs, `DESCRIBE` → column name + type:
   - cfm/cros/tf: mf_users, mf_ingame_roles, map_ingame_devices_and_userid, map_ingame_ips_and_userid, std_ingame_user_active_daily, std_ingame_user_recharge_daily, std_ingame_user_active_monthly, std_ingame_user_recharge_monthly, etl_ingame_* event tables (cfm has the full FPS set; cros/tf only login/logout/register), cons_* marts.
5. Write `cfm_vn-table-inventory.md`: table → columns(type) + a 3-row `LIMIT 3` sample for the non-PII columns of each.
6. Note any expected upstream table that is **absent** or **empty** (esp. `mf_ingame_roles` recharge cols, `etl_ingame_moneyflow`/`etl_ingame_game_detail` freshness via `SELECT max(log_date)`).

## Success Criteria
- [x] `trino_q.py --list` returns table lists for cfm_vn/cros/tf (game_integration) without leaking creds.
- [x] Inventory doc lists every table + column the port touches, per tenant, with types. → `reports/multi-tenant-table-inventory.md` (3183 lines).
- [x] Freshness recorded: live tables current to 2026-06-04; **etl_ingame_moneyflow + etl_ingame_game_detail STALE (max 2026-05-01)** — confirmed; keep + comment.
- [x] Absent/empty flagged: **all referenced tables exist**. Correction: `mf_ingame_roles` per-role recharge cols DO exist in schema (kraken's "NOT populated" note is about values) — Phase 3 keeps the measures.

## Outcome (Phase 1)
- Harness `scripts/trino_q.py` (`--list/--describe/--sample/--maxdate/--sql`) self-reads creds, zero session props. `scripts/build_inventory.sh` regenerates inventory.
- cros/tf = identical clean clones (login/logout/recharge/register; no FPS event tables); cfm has full FPS `etl_*` set.
- kraken cfm event-cube `sql_table` drift resolved → `etl_ingame_roommatchflow` / `etl_ingame_teamstartmatchflow` (both exist). `user_active_monthly` has no `sql_table` (derived `sql:` — confirm Phase 3).

## Risk Assessment
- Trino role lacks session-prop perms → mirror cube-dev's driver patch (don't set forbidden props). Mitigation: set zero session props.
- PII columns (`device_id`, `client_ip`) — sample only counts/hashes for those, never raw values into the committed inventory.
- Creds in `~/.trino-creds`/`.env` are sensitive — script reads at runtime, never echoes; inventory file contains no secrets.
