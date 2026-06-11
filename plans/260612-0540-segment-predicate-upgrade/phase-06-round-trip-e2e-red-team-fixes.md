---
phase: 6
title: "Round-trip E2E + red-team fixes"
status: pending
priority: P1
effort: "4h"
dependencies: [1, 2, 3, 4, 5]
---

# Phase 6: Round-trip E2E + red-team fixes

## Overview
Prove the loop end-to-end on the live local stack and burn down red-team findings. The user's bar: "make sure it works completely."

## Requirements
- Functional: full matrix below passes on the local stack (jus_vn).
- Non-functional: no regression in segment CRUD/refresh suites; all new code tsc + vitest green; FE hub/editor suites green.

## Fidelity matrix (each row = one e2e pass)

| # | Start | Action in /build | Expected after Update |
|---|-------|------------------|----------------------|
| 1 | predicate seg, string filter + sidecar | add second string filter | tree has 2 leaves AND; sidecar preserved; refresh fires; size shrinks |
| 2 | same | remove sidecar segment chip→off in query | sidecar removed (admin), confirm fired if time-bounding; size grows |
| 3 | same | add dateRange on log_date | tree gains inDateRange leaf; refresh OK |
| 4 | manual seg (small) | add filter, Update | confirm dialog → converted to live, predicate stored, first refresh enqueued |
| 5 | predicate seg | untranslatable construct (measure filter w/ grouping) | Update blocked with tooltip; Save-as-new offered |
| 6 | predicate seg, non-owner | open Update | PATCH 403 surfaced as toast; edit mode dropped |
| 7 | cross-cube: active_daily seg + mf_users filter (post phase 1+2) | Update | refresh completes; enriched Members tab consistent |
| 8 | predicate seg w/ relative "last 30 days" tree leaf | zero-edit round-trip (open → Update immediately) | tree byte-equivalent; relative literal preserved (C2 guard) |
| 9 | query with operator the tree can't express (`notInDateRange`) | attempt Update | gate blocks with named construct; Save-as-new works (C3 guard) |
| 10 | deeplink from jus segment while active game = cfm | open | warned/switched game context; no silent no-op filters |
| 11 | sidecar carrying `mf_users.whales` (cross-cube) | toggle primary chip, Update | cross-cube entry preserved verbatim |
| 12 | load saved analysis while in edit mode | — | edit mode dropped with banner notice; segment untouched |
| 13 | same cube name, different game (`cfm active_daily` segment) | check identity resolution | C1 guard: no jus mapping bleed (per audit/scoped-map outcome) |

## Implementation Steps
1. Script the matrix as vitest integration tests where the seam allows (translator round-trip, payload shapes); manual-verify the browser-only rows and record results in this file.
2. Run red-team (`/ck:plan red-team` output) findings burn-down — fix or explicitly defer with rationale here.
3. Full suites: `server vitest`, FE editor/hub suites, `tsc --noEmit` both sides.
4. Update `docs/codebase-summary.md` (segment editor + playground round-trip section) via docs-manager at finalize.
5. Journal entry.

## Success Criteria
- [ ] All 7 matrix rows pass (recorded per-row in this file)
- [ ] Red-team findings: zero open criticals; deferrals documented
- [ ] Suites + tsc green both sides

## Risk Assessment
Residual risks documented per red-team output; conflicts policy (last-write-wins) re-confirmed acceptable with user if any finding challenges it.
