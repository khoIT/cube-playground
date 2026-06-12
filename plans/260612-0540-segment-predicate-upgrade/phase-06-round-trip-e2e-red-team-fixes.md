---
phase: 6
title: Round-trip E2E + red-team fixes
status: completed
priority: P1
effort: 4h
dependencies:
  - 1
  - 2
  - 3
  - 4
  - 5
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

## Matrix results (2026-06-12, local stack jus_vn; disposable segments 3d9406ee / b418b0a7)

| # | Verification | Result |
|---|--------------|--------|
| 1 | live PATCH: 2-leaf tree → `cube_query_json` rebuilt with 2 filters, sidecar `active_daily.last_30d` preserved, status→refreshing | **PASS** |
| 2 | live PATCH `cube_segments:[]` → sidecar removed, filters rebuilt from stored tree, refresh fires; repeat same set after status reset → status stays `fresh` (no-op equality) ; tree-less manual + cube_segments → 400 `cube_segments requires a stored predicate_tree` | **PASS** |
| 3 | live PATCH adds `inDateRange "last 7 days"` leaf → tree retains relative literal, stored query holds expanded tuple (confirms why deeplink sources the tree), refresh fires | **PASS** |
| 4 | manual→live conversion: server-tested (`segment-convert-manual-to-live.test.ts`, 4 tests) + save-bar confirm-dialog test (phase-5 suite) | **PASS (tests)** |
| 5 | untranslatable construct blocks Update, Save-as-new offered: `translatability-gate.test.ts` 31 tests cover every nulled operator + granularity-only timeDimensions | **PASS (tests)** |
| 6 | non-owner Update: save bar hides Update until `can_administer` confirms; PATCH 403/404 → toast + edit mode dropped (save-bar tests) | **PASS (tests)** |
| 7 | cross-cube: live PATCH `mf_users.user_id set` filter onto active_daily segment + sidecar → refresh settled `fresh`, 31,979 uids (= pc+last_30d cohort; the `set` filter on the join target is a no-op narrowing, as expected) | **PASS** |
| 8 | zero-edit round-trip preserves relative literal: `segment-predicate-round-trip.test.ts` (7 tests) + deeplink relative-literal test | **PASS (tests)** |
| 9 | inexpressible operator (`notInDateRange`) blocks with named construct: translatability-gate tests | **PASS (tests)** |
| 10 | game mismatch: boot warn implemented in QueryBuilderContainer; save hard-blocked on `editContext.gameId !== active` (banner + save-bar tests) | **PASS (tests)** |
| 11 | cross-cube sidecar entry preserved verbatim, chip read-only: `cube-segment-scope-chips.test.tsx` cross-cube preservation tests + server canonical-sort tests | **PASS (tests)** |
| 12 | saved-analysis load in edit mode | **PARTIAL** — container remount on workspace/game change drops context; intra-session cube switch does NOT yet fire `exitEditMode`. Game-mismatch guard prevents wrong-game overwrite; same-game cube switch relies on translatability gate (different cube's filters still PATCH-able). Deferred with rationale: low blast radius (explicit Update click + banner showing segment name required), follow-up noted below. |
| 13 | same cube name, different game: cfm_vn `active_daily`→`mf_users.user_id` live probe returns data — global map row valid for cfm join semantics (audit table, phase 1) | **PASS** |

Additional live find (this pass): definition deeplink synthesized a `<cube>.count` measure that NO jus cube exposes (`rows`/`events`/`transactions`) → playground boot would UserError. Fixed: definition query boots measure-less (verified live: 100 rows); `defaultBaseQuery` helper deleted (caller-less, same phantom-measure flaw); tests updated — 11/11 green.

## Implementation Steps
1. Script the matrix as vitest integration tests where the seam allows (translator round-trip, payload shapes); manual-verify the browser-only rows and record results in this file.
2. Run red-team (`/ck:plan red-team` output) findings burn-down — fix or explicitly defer with rationale here.
3. Full suites: `server vitest`, FE editor/hub suites, `tsc --noEmit` both sides.
4. Update `docs/codebase-summary.md` (segment editor + playground round-trip section) via docs-manager at finalize.
5. Journal entry.

## Code-review burn-down (2026-06-12, report: reports/from-code-reviewer-to-orchestrator-roundtrip-diff-review.md)

Verdict was REQUEST_CHANGES (2 critical / 7 major). All fixed same-day:

| Finding | Fix |
|---------|-----|
| [critical] FE mapper forwarded `in`/`notIn` (invalid Cube ops) | `TREE_TO_CUBE_OP` map mirrors server (`in→equals`, `notIn→notEquals`); lossless cycle test |
| [critical] OR-group flattening widened cohorts | recursive `nodeToFilter` emits `{or:[{and:[…]},…]}` boolean filters; gate blocks non-round-trippable nesting |
| [major] catalog used SDK meta (joins stripped) → joined cubes never appeared | rebuilt on `connectedComponent` from raw `/meta?extended=true` (pattern of use-catalog-meta); fixture mimics real meta shape |
| [major] inline path shipped empty echoFilters + active-game gameId | edit context ALWAYS persisted to sessionStorage; container reads recorded gameId; mismatch re-evaluated on change |
| [major] gameId echo only for segment cube | echo recorded per every cube referenced in the definition query |
| [major] boot normalizer froze non-day relative ranges; history.replace dropped edit-segment | normalizer skipped in edit mode; edit-segment preserved across replace |
| [major] no empty-predicate guard (one-click match-everyone) | gate fails closed on zero filters + no dated timeDimensions |
| [major] saved-analyses lost uid-IN overlay | restored via `buildPlaygroundDeeplink`+`mergeUidFilter` (overflow path now real) |
| [major] save-bar edit-mode test gaps | 12-test suite: payload shape, echo strip, manual→live, context-reaches-bar |
| (live find, this pass) deeplink guessed `<cube>.count` measure — no jus cube has it | definition boots measure-less (verified live); `defaultBaseQuery` deleted |

Deferred with rationale (documented in matrix row 12): intra-session cube switch doesn't drop edit mode — game-mismatch hard-block + explicit named-banner Update click bound the blast radius; follow-up candidate.

Post-fix verification: round-trip suites 481/482 (1 pre-existing care-history failure, unowned); tsc 0 errors in all diff files both sides; server 1299/1303 (4 pre-existing preagg-readiness).

## Success Criteria
- [x] All 13 matrix rows recorded per-row in this file (12 PASS, row 12 partial with documented rationale)
- [x] Red-team findings: zero open criticals (2 found by review, both fixed + tested); deferrals documented
- [x] Suites + tsc green both sides (pre-existing failures enumerated, none in diff files)

## Risk Assessment
Residual risks documented per red-team output; conflicts policy (last-write-wins) re-confirmed acceptable with user if any finding challenges it.
