---
phase: 7
title: "Tests + docs sync"
status: pending
priority: P1
effort: "1d"
dependencies: [4, 5, 6]
---

# Phase 7: Tests + docs

## Overview
Lock behavior with tests across the new seams and sync the API-surface + design docs. No new
features — verification + documentation only.

## Requirements
- Functional: unit + integration coverage for contract compute, per-page audit, rollup, publish guard, lane split.
- Non-functional: all tests pass (no skips to go green); docs reflect the new endpoints + lifecycle.

## Architecture
Mirror existing test layout (`server/src/**/__tests__`, `src/pages/Segments/__tests__`).

## Related Code Files
- Create: `server/src/db/__tests__/migration-runner-recovery.test.ts` (boot at prior user_version → only 076/077 run; injected failing statement rolls back, re-runs clean, no `duplicate column` wedge — red-team #4,#5)
- Create: `server/src/services/__tests__/segment-serving-contract.test.ts` (next-ready: daily 00:00→clamp 08:00, sub-daily [00:00,08:00) clamp, null lastSnapshot, IGNORE_WINDOW — red-team #9)
- Create: `server/src/services/__tests__/segment-consumption-store.test.ts` (rate/p95/freshness over `audit_schema='v2'` only; key-rotation label caveat = two key_ids; wildcard entitled-vs-pulled; audit-derived consumer count — red-team #10,#11,#14)
- Create: `server/src/auth/__tests__/public-pull-audit-per-page.test.ts` (13-page → page_index 0..12 from token, same snapshot_ts incl page 1; 429 → rate_limited row; **bad token → NO audit row + a log line, assert no raw key bytes**; per-page rows roll up to one-per-pull in listPullAudit — red-team #3,#6,#7, Sec#6)
- Create: `server/src/routes/__tests__/segment-serve-endpoints.test.ts` (**non-owner/non-admin → 403**; publish requires snapshot enabled; `Off`→daily; demote atomic + blocked w/ consumers; **after demote the public pull path returns 403** — red-team #1,#8)
- Create: `server/src/routes/__tests__/consumption-routes-authz.test.ts` (**segment owner who is non-admin → 403** on consumption + tokens — red-team #2)
- Create: `src/pages/Segments/__tests__/library-lane-split.test.tsx` (served/draft/deprecated partition; deprecated shows retired badge; publish moves lane)
- Modify: `docs/service-api-surface-map.md` (serve/demote, consumption, tokens endpoints + the lifecycle pull-path gate), `docs/lessons-learned.md` (migration-runner count invariant; failed-auth-not-in-audit-table), `docs/codebase-summary.md` (lifecycle field, per-page audit cols)

## Implementation Steps
1. Backend unit tests (contract, rollup, audit, endpoints) via `tester` agent.
2. FE lane-split test.
3. Run full server + web suites; fix failures (no skips).
4. `docs-manager`: update API surface map + codebase summary; note lifecycle + per-page audit columns.

## Success Criteria
- [ ] All new + existing tests pass (server + web).
- [ ] Docs list the 4 new endpoints + the lifecycle/audit schema deltas.
- [ ] `code-reviewer` pass clean (no contract regressions to the shipped pull API).

## Risk Assessment
- Concurrent sessions edit this repo — verify pre-existing failures via `git show` before attributing to this work (no `git stash`).
- Guard the shipped paginated-pull contract (plan 260626-1750) — audit wiring must not change response bodies/headers.
