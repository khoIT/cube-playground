---
phase: 12
title: "vga: Full Port"
status: deferred
priority: P3
effort: "1.5d"
dependencies: [1, 2, 8]
---

# Phase 12: vga — Full Port (VNG Game Account platform)

<!-- Updated: Validation Session 1 - DEFERRED. Not in active scope. Kept as the resumption spec; build only after cfm/cros/tf ship and iceberg-catalog routing is approved. -->

> **DEFERRED (Validation S1).** vga is out of the current build scope. This file is the spec to resume from. Resuming requires: Phase 1 confirms `iceberg` catalog reachability, and Phase 8 adds the per-tenant `GAME_CATALOG` override (`vga → iceberg`).

## Overview
Port the upstream `vga` domain: 16 cubes + 5 dashboard views. vga is NOT a per-game 360 — it's the cross-game account / payment / CS platform. Different catalog (`iceberg`), canonical `vga_` naming kept verbatim, heavy cube-to-cube joins, bilingual descriptions, `.yaml` ext, non-360 view patterns. Highest-novelty phase.

## Requirements
- Functional: vga folder compiles under a `game: "vga"` JWT routed to the `iceberg` catalog; the 5 views resolve.
- Non-functional: keep `vga_` names + `.yaml`; PII cubes (`vga_user_pii`) + raw identifiers stay `public: false`; preserve `prefix: true` join modifiers in views.

## Architecture
- **No rename** (Phase 2 vga profile = passthrough). Copy cubes + views verbatim, then Trino-verify against `iceberg.vga` + wire catalog routing (Phase 8 `GAME_CATALOG.vga = 'iceberg'`).
- 16 cubes: `vga_user_master, vga_user_pii, vga_social_profile, vga_provider, vga_tier_config, vga_tier_profile, vga_client, vga_login_channels, vga_product_map, vga_payment_history, vga_payment_delivery, vga_redeem_code, vga_provider_active_daily, vga_provider_active_monthly, cs_ticket_report` (+ confirm count vs inventory).
- 5 views: `user_overview_view`, `user_acquisition_view`, `payment_delivery_view`, `payment_history_view`, `game_activity_view`.
- Some cubes are derived (`sql:` not `sql_table:`) and reference other vga cubes via joins — verify the join graph compiles as a unit.

## Related Code Files
- Create: `cube-dev/cube/model/cubes/vga/*.yaml` (~16 files)
- Create: `cube-dev/cube/model/views/vga/*.yaml` (5 files)
- Depends: Phase 8 `GAME_CATALOG` (iceberg) + `GAME_SCHEMA.vga`.

## Implementation Steps
1. Confirm Phase 1 reported iceberg catalog reachable + vga tables inventoried; confirm Phase 8 routes `vga`→iceberg.
2. Fetch all `cubes/vga/*.yaml` + `views/vga/*.yaml` verbatim (vga passthrough — no `bare_rename`).
3. Resolve `sql_table` qualifiers: decide whether to keep explicit `iceberg.vga.` prefix in YAML or rely on tenant catalog+schema injection (match how cfm/cros/tf strip schema — but vga's catalog differs, so explicit `iceberg.vga.` may be safest). Pick one, apply consistently, document.
4. Trino-verify each cube's table/columns in `iceberg.vga`; for derived `sql:` cubes, run the embedded query with a `LIMIT`.
5. Verify the cross-cube join graph (vga_user_master → pii/social/provider/tier) compiles; preserve `prefix: true` modifiers.
6. Mark PII (`vga_user_pii`, raw `id`/`vga_id_hash` reversal, phone/email) `public: false`.
7. Compile vga folder; load each of the 5 views.

## Success Criteria
- [ ] ~16 vga cubes + 5 views created (verbatim `vga_` names, `.yaml`).
- [ ] vga JWT routes to iceberg + compiles.
- [ ] Each cube Trino-verified in `iceberg.vga` (incl. derived `sql:` cubes).
- [ ] 5 views return data; cross-cube joins resolve.
- [ ] PII cubes/fields `public: false`.

## Risk Assessment
- **iceberg catalog access** is the top risk — if Trino creds can't read `iceberg`, vga is fully blocked (flagged in Phase 1). Mitigation: gate early; if blocked, ship cfm/cros/tf and defer vga.
- Per-tenant catalog override in `cube.js` is new behavior — risk of breaking single-catalog assumption for other tenants. Mitigation: default-to-`game_integration`, override only `vga`; unit-test routing.
- vga `vga_` names + the resolver: vga is its own workspace/domain; confirm the FE workspace-context treats vga as `game_id` model (resolver no-op) so `vga_` names aren't double-processed. If vga is ever a `prefix` workspace, the resolver would mangle `vga_user_master` — keep vga on the `game_id`/no-op path.
- Derived `sql:` cubes may embed cross-schema refs or functions not portable as-is. Mitigation: run each embedded query in Trino before trusting.
- Bilingual (Vietnamese) descriptions — keep verbatim; do not translate/normalize.
