---
phase: 6
title: "Tests + validation + deploy"
status: in-progress
priority: P2
effort: "0.5d"
dependencies: [3, 5]
---

# Phase 6: Tests + validation + deploy

## Overview
Lock the console: unit-test the pure window/delta logic + aggregate-query contracts, assert rollup
routing, smoke the page in playwright, prove the Overview leaks no PII, and document deploy/rollback.

## Requirements
- Functional: `ops-window.ts` produces correct current/prior ranges for 7d/30d/MTD; Δ math correct;
  Overview aggregate queries carry NO user_id filter / PII dim; gateway/store queries route to the rollup.
- Non-functional: all tests pass; no fabricated data; honest empty-states verified.

## Architecture
- **Export Overview query objects** from the `use-ops-*` hooks (or a `ops-queries.ts`) so tests inspect
  them statically (red-team B6 — otherwise the contract tests can't see the queries).
- vitest:
  - `ops-window` ranges + 7d-Δ math (MTD edge at month start; 30d has no Δ).
  - **Aggregate/PII contract (A10):** every Overview query has NO `user_id`/`member_user_id`/`ingame_name`/
    `vip_id` in filters OR dimensions.
  - **A1 distinct guard:** the `paying_users` headline query carries no `granularity`/day dimension.
  - **Raw==rollup equality (the REAL double-count guard):** run a billing measure both rollup-routed and
    raw for the same ≤31d window, assert equal (proves no fan-out — supersedes a window-math-only test).
- playwright: `addInitScript` seeding `localStorage` `gds-cube:active-game=cfm` + workspace (pattern from
  the existing e2e-probe spec) so the page boots on cfm, not the `'ballistar'` default; switch tabs +
  window; assert no console errors and key tiles render.

## Related Code Files
- Create: `src/__tests__/ops-window.test.ts`, `src/__tests__/ops-overview-aggregate-contract.test.ts`,
  playwright spec for `/ops`.
- Reference: `src/__tests__/cube-behavior-bounds-guard.test.ts` (test style), parent plan phase-08
  (preagg routing assertion), `docs/lessons-learned.md`.

## Implementation Steps
1. `ops-window` unit tests (ranges, 7d-Δ, MTD edge; assert 30d yields no prior range).
2. Aggregate/PII contract test over exported query objects (A10 — filters AND dimensions).
3. A1 distinct-guard test (payers headline has no day granularity).
4. Raw==rollup equality test for a billing measure (no fan-out).
5. playwright smoke for `/ops` cfm (localStorage game seed): tabs unmount on switch, window toggle, zero
   console errors. **Verify cfm AND jus** numbers (jus money is `currency='VND'`-filtered — A2/A7).
6. Run full suite; fix failures (do not skip).
7. Deploy/rollback: page and rollup are **independently deployable** — ship the page (Overview on bounded
   raw) first; reseal the rollup (Phase 2, if taken) as a SEPARATE push. Push to `second` AUTO-DEPLOYS →
   requires explicit user go-ahead. Restart `cube-playground-cube-api-dev` only for a rollup YAML change.

## Success Criteria
- [ ] All unit + contract + routing tests pass.
- [ ] playwright smoke green; no console errors.
- [ ] Verified: zero Overview queries with user_id filter or PII dim.
- [ ] Deploy/rollback steps written; nothing pushed without explicit user authorization.

## Risk Assessment
- `second` remote auto-deploys on push — NEVER push without explicit user go-ahead (parent plan + standing
  constraint).
- Concurrent sessions edit this repo — no `git stash`; commit only this plan's files; verify any pre-
  existing test failure via `git show` before attributing it to this work.

## Security Considerations
- Overview is aggregate-only by design → no PII. Members tab inherits member360 redaction. Care tab
  inherits CS-console gating. No new tokenless endpoint is introduced; if any Overview tile ever needs a
  per-user drill-down, route it through the already-auth-gated member path, never a new open endpoint
  (parent plan red-team #11).
