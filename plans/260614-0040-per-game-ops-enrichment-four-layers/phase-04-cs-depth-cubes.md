# Phase 04 — CS Depth Cubes (support-ops)

## Context Links
- Bridge spec (input): `reports/bridge-spec-cfm-jus.md` (phase 1)
- Reports: scout §2.4, §4.1 (compliance edge via cs_ticket_logs); §5
- Memory: `cs-ticket-schema-join` (iceberg.cs_ticket; join via `split_part(user_id,'@',1)`, ~8% match; dedup multi-row master/label),
  `cs-facebook-aihelp-uid-unresolvable` (FB/AIHelp PSID cannot join to game uid)
- Prod oracle: `/Users/lap16299/Documents/code/cube-prod/cube/model/cubes/vga/cs_ticket_report.yaml`, `.../vga/vga_cs_customer.yaml`
- Source tables: `cs_ticket.cs_ticket_info` (4.26M), `cs_ticket.cs_ticket_logs` (action trail), `cs_ticket.cs_rating_processes` (CSAT)
- Already used: `cs_ticket_new_master` (do NOT rebuild — these ADD depth)

## Overview
- **Priority:** P1 — VIP routing + CSAT + support-volume-per-segment.
- **Status:** pending · **Depends on:** Phase 1.
- **Description:** Author game-scoped CS-depth cubes from cs_ticket_info (ticket metadata + vip_id + routing
  hierarchy), cs_ticket_logs (action trail — who/when/what/status-transition), cs_rating_processes (CSAT +
  handling time). Join to mf_users via `split_part(user_id,'@',1)` per phase 1. Tag `[freshness: lagging]` (~3mo).

## Key Insights
- CS join is partial: `split_part(user_id,'@',1)` matches only ~8% (memory `cs-ticket-schema-join`); FB/AIHelp
  PSID tickets are unresolvable to game uid (memory `cs-facebook-aihelp-uid-unresolvable`). Phase 1 measures the
  real match-rate per game — scope the cube to resolvable tickets + expose an "unresolved share" so users don't
  assume full coverage.
- cs_ticket_logs is the compliance/exposure edge for the future experiment loop (scout §4.1): action_code,
  status_before→after, staff, log_time. Model at action grain (1:N per ticket) — separate cube, pre-agg if large.
- cs tables have multi-row master/label dups (memory) → dedup in cube SQL (filter to a canonical status, like
  prod's `ticket_status = 'New'`) to get one-row-per-ticket.
- CS is ~3mo lagging → triage/historical OK, NOT live SLA alerting.

## Requirements
- Functional: per game, `cs_ticket_detail` (ticket grain, routing + vip + resolution dims/measures),
  `cs_action_log` (action grain, compliance trail), `cs_rating` (CSAT + handling time). Join mf_users via phase-1 key.
- Non-functional: ticket cube deduped to 1 row/ticket; action/rating cubes at their own grain (flag pre-agg if >5M).

## Architecture
- Data flow: cs_ticket source → cube SQL (dedup + `split_part` bridge to user_id) → join mf_users many_to_one →
  routing/vip/CSAT dims. Unresolved-share surfaced as a measure (count where bridge NULL).
- Files in `cubes/{cfm,jus}/` → game-scoped. Filter to the game: cs tables are cross-product, so the bridge JOIN
  to the game's mf_users IS the game filter (rows that don't resolve to this game's users drop out).

## Related Code Files
- Create: `cube-dev/cube/model/cubes/cfm/cs_ticket_detail.yml`, `.../jus/cs_ticket_detail.yml`
- Create: `cube-dev/cube/model/cubes/cfm/cs_action_log.yml`, `.../jus/cs_action_log.yml`
- Create: `cube-dev/cube/model/cubes/cfm/cs_rating.yml`, `.../jus/cs_rating.yml`
- Read: prod `cs_ticket_report.yaml`, `vga_cs_customer.yaml`; existing `cs_ticket_new_master` cube (find via grep) for dedup precedent

## Implementation Steps
1. Lift phase-1 cs keys + measured match-rate (cfm, jus). Confirm dedup status filter.
2. `cs_ticket_detail.yml`: dims (ticket_id PK, vip_id, dept/pillar/ticket_type/category/source, country, created/closed
   times), measures (total/closed/rejected/active tickets, resolution_rate, avg_resolution_time, unresolved_share).
   `[freshness: lagging]`.
3. `cs_action_log.yml`: action grain (action_code/name, status_before→after, staff, log_time). `[freshness: lagging]`.
   Flag pre-agg if row count warrants (phase 8).
4. `cs_rating.yml`: CSAT rating + handling time per process. `[freshness: lagging]`.
5. Mirror prod dedup (canonical status filter) to enforce one-row-per-ticket; verify with GROUP BY ticket_id probe.
6. Compile + per-game /meta verify; confirm bridge match-rate equals phase-1 measurement.

## Todo List
- [ ] cs_ticket_detail.yml (cfm, jus) + unresolved_share measure + freshness:lagging
- [ ] cs_action_log.yml (cfm, jus) action grain + freshness:lagging
- [ ] cs_rating.yml (cfm, jus) CSAT + freshness:lagging
- [ ] Dedup to 1-row/ticket verified
- [ ] Match-rate matches phase-1; unresolved share surfaced
- [ ] Compile + per-game /meta verification

## Success Criteria
- 3 CS-depth cubes compile per game, browsable, deduped to expected grain.
- Bridge match-rate documented + unresolved-share exposed (no false "full coverage").
- Tagged lagging; not wired into any live SLA alert.

## Risk Assessment
- **Low CS match-rate misread as data loss** (Med×Med): ~8% match looks broken. Mitigate: unresolved_share measure
  + description explaining PSID-namespace limit (memory). Scope to resolvable tickets.
- **Outbound CS outreach not logged** (Med×Med, unresolved Q8): compliance edge blind if outbound isn't a ticket.
  Mitigate: document as open question; CS-depth cube still valid for inbound triage.
- **Action-log fan-out** (Low×Med): Mitigate: separate grain + pre-agg flag.

## Security Considerations
- NO raw contact PII (login_info/social_id are PII-risk per prod `vga_cs_customer`) — keep `public: false`.
- CSAT/handling-time aggregate only; vip_id is a tier, not PII.
