---
phase: 6
title: Port Event Stream
status: completed
priority: P2
effort: 1d
dependencies:
  - 1
  - 2
  - 5
  - 8
---

# Phase 6: Port Event Stream

## Overview
Port the remaining cfm_vn event-stream cubes that don't replace anything local — the rest of the `etl_*` set behind the 360 behavior panels: `etl_lottery_shoot`, `etl_newbie_detail`, `etl_prop_flow`, `etl_room_match_flow`, `etl_team_start_match_flow`. (`etl_game_detail`/`etl_login`/`etl_logout`/`etl_money_flow`/`etl_newbie_tutorial` landed in Phase 5.)

## Requirements
- Functional: each compiles; bounded sample query returns rows; unbounded rejected by guardrail.
- Non-functional: every cube carries the "Partition column — REQUIRED filter" doc note; large-table warnings preserved.

## Architecture
- These are wide raw-event cubes (1M–1.3B rows). They are queried only via the VIEW panels (Phase 7) filtered by `playerid` + bounded `log_date`.
- Keys: `playerid`/`playeropenid` (game-detail/match/lottery/prop), `clientsdkuserid`+`roleid` (login/logout). Bridge to `mf_users` happens in views, not cubes.
- Apply Phase 2 bare-rename; final names: `etl_lottery_shoot`, `etl_newbie_detail`, `etl_prop_flow`, `etl_room_match_flow`, `etl_team_start_match_flow`.

## Related Code Files
- Create: `cube-dev/cube/model/cubes/cfm/etl_lottery_shoot.yml`
- Create: `cube-dev/cube/model/cubes/cfm/etl_newbie_detail.yml`
- Create: `cube-dev/cube/model/cubes/cfm/etl_prop_flow.yml`
- Create: `cube-dev/cube/model/cubes/cfm/etl_room_match_flow.yml`
- Create: `cube-dev/cube/model/cubes/cfm/etl_team_start_match_flow.yml`

## Implementation Steps
1. Confirm Phase 8 guardrail matches all these bare `etl_*` names.
2. Fetch + bare-rename each; Trino-verify `sql_table` + columns + `max(log_date)` (these are partitioned event tables; some may be huge — DESCRIBE only, sample with a tight `log_date` + `playerid` filter, never full scan).
3. Write cube files. Preserve all upstream segments (`diamond_only`, `ladder_only`, `last_7d`, etc.) and the cumulative/derived measures.
4. Spot-verify 2–3 high-signal measures per cube against a hand-written Trino aggregate for one player+day (e.g. `kdr`, `success_rate`, `total_delta`).

## Success Criteria
- [ ] 5 event-stream cubes created, bare-named, Trino-verified.
- [ ] Each has the required-filter doc note + matches the guardrail.
- [ ] Bounded `playerid`+`log_date` sample returns rows; a few derived measures match a manual Trino check.
- [ ] No unbounded scan run during verification.

## Risk Assessment
- Accidental unbounded scan during verification could OOM the Trino coordinator. Mitigation: harness enforces a `LIMIT` + `log_date` filter on all `etl_*` sample queries; guardrail already merged.
- Column-type coercion: many numeric stats stored as VARCHAR upstream — preserve kraken's `TRY_CAST(... AS DOUBLE)`; verify a couple cast correctly (non-numeric → NULL, not error).
- Stale tables (match/money/game-detail) → sample with in-range historical dates.
- `etl_player_join_match` intentionally OMITTED upstream (stale, namespace mismatch) — do NOT port; note it.
