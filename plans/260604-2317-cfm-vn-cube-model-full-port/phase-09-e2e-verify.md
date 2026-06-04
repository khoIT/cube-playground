---
phase: 9
title: E2E Verify (all tenants)
status: completed
priority: P1
effort: 1d
dependencies:
  - 3
  - 4
  - 5
  - 6
  - 7
  - 8
  - 10
  - 11
---

# Phase 9: E2E Verify (active tenants)

<!-- Updated: Validation Session 1 - vga deferred; verify cfm + cros + tf only. -->

## Overview
Prove every active tenant works end-to-end: each folder compiles under its JWT, views resolve, and a sample entity returns data. Primary gate = the cfm `cfm-user360` dashboard (6 views, bare + physicalized `cfm_*`). Also verify cros/tf 360 views. (vga deferred — Phase 12.)

## Requirements
- Functional: `cube` dev server compiles cfm folder with zero schema errors; `/v1/meta` lists all cfm cubes+views; `/v1/load` returns rows per view.
- Non-functional: parity check — bare query result == physicalized query result shape.

## Architecture
- Run local cube-dev (docker-compose) with a cfm-scoped JWT (`game: "cfm"`). Hit `/v1/meta` + `/v1/load`.
- Reuse Phase 1 Trino harness to pick a real high-activity `user_id` (one with roles, devices, recharge, recent activity) as the test fixture.
- Test the resolver path: run a bare query (`user_profile.user_id`...) directly; run the physicalized form (`cfm_user_profile....`) to confirm prod-shape works if local also serves physical (per open question).

## Related Code Files
- Create: `plans/260604-2317-cfm-vn-cube-model-full-port/scripts/verify_views.py` (loops the 6 views, asserts rows)
- Read: all `cubes/cfm/*.yml`, `views/cfm/user_360.yml`, `cube.js`

## Implementation Steps
1. Start cube-dev locally; confirm cfm folder compiles (no duplicate-name / missing-join errors).
2. `GET /v1/meta` (cfm JWT) → assert all ported cubes + the ~26 views present.
3. Pick fixture `user_id` via Trino (has roles + devices + ips + recent recharge + activity).
4. For each of the 6 dashboard views: `POST /v1/load` with `user_id` equals filter (+ bounded `log_date` for behavior panels) → assert non-empty, columns match the dashboard's requested members.
5. Cross-check 2–3 values against a direct Trino query (e.g. `ltv_vnd`, role count, recent recharge sum).
6. Guardrail check: an unbounded behavior-panel query is rejected.
7. Optional prod-parity: replay the dashboard's actual `cfm_user_*` query shape (via resolver `physicalizeQuery`) and confirm equivalence.

## Per-tenant checks
- **cfm:** all 6 dashboard views return data for a fixture user; physicalized `cfm_*` shape resolves equivalently via the resolver.
- **cros / tf:** `user_360.yml` views compile + `user_profile`/`user_activity_timeline`/`user_recharge_timeline`/`user_roles_panel` return data for a fixture user under their JWT (schema cros/tf).
- **vga:** deferred (Phase 12).

## Success Criteria
- [ ] cfm/cros/tf folders compile; `/v1/meta` complete per tenant JWT.
- [ ] cfm: 6 dashboard views non-empty + Trino-reconciled; physicalized shape OK.
- [ ] cros + tf: 360 views non-empty for a fixture user.
- [ ] 2–3 measures per tenant reconcile against direct Trino aggregates.
- [ ] Unbounded behavior query rejected by guardrail.
- [ ] Update `docs/lessons-learned.md` with any bug-shape; update `docs/codebase-summary.md` / changelog for the new cfm/cros/tf models.

## Risk Assessment
- Compile passes but a view returns 0 rows (silent join-key mismatch). Mitigation: step 5 value reconciliation against Trino, not just "non-empty".
- Stale event tables → behavior panels empty for recent dates; use in-range historical date for those, don't fail the gate on freshness.
- Resolver edge: a member already physical passing through `physicalizeQuery` must not double-prefix (covered by resolver idempotency tests `src/lib/__tests__/cube-member-resolver.test.ts` — re-run them).
