---
title: "Close the CS VIP-care demo loop"
description: "Make the CS console care loop real & reseedable — persist treatment, claim/dismiss, human-closed KPI outcome, export + activity, guarded reset."
status: pending
priority: P2
effort: ~13h
branch: main
tags: [cs, care, demo, tdd, frontend, fastify]
created: 2026-06-09
---

# Close the CS VIP-care demo loop

Turn the CS console (`/dashboards/cs`) from a convincing read-only artifact into a
true demo loop: *case surfaces → claim → open 360 → take action → leaves queue → see if it worked → reset.*
Backend for almost the whole loop already exists (`PATCH /api/care/cases/:id`, lifecycle
stamps, write-role gate on `/api/care`); the FE Member-360 is the main mock to replace.
Only the reset endpoint is net-new server code.

## Source of truth

`plans/reports/brainstorm-260609-1813-cs-demo-artifact-care-loop-report.md` — verified
touchpoints + locked decisions. Scope is fixed (Tier A + Tier B + Reseed, all in). KPI
outcome = **human-closed only**. No DB schema changes.

## Locked decisions (do not reverse)

- Scope = A1, A2, A3, B4, B5, B6, Reseed. All in.
- B4 = human-closed only — CS clicks "Close · KPI met/missed" → `patch{status:'resolved',outcome}`. No `runKpiEval`/Cube auto-eval this round.
- Reset = guarded `POST /api/care/cases/reset?game` (editor/admin via existing gate, confirm) → wipe game's cases + optional re-sweep.
- No DB schema changes — columns already exist.

## TDD discipline

Care engine/store/route have strong existing coverage (`server/test/care-*.test.ts`,
`src/pages/Dashboards/cs/__tests__/*`). Every phase: extend tests FIRST to lock current
behavior + assert new behavior, implement, verify green. **No regression** in existing suites.

## Phases

| # | Phase | Scope | Status | Depends |
|---|-------|-------|--------|---------|
| 01 | [Persist Mark-treated + real timeline](phase-01-persist-mark-treated-real-timeline.md) | A1 — FE only (biggest slice) | pending | — |
| 02 | [Claim/assign + dismiss-with-reason](phase-02-claim-assign-dismiss-with-reason.md) | A2 + A3 — FE only | pending | 01 |
| 03 | [Human-closed KPI outcome + badge](phase-03-human-closed-kpi-outcome-badge.md) | B4 — FE only | pending | 02 |
| 04 | [CSV export + 24h activity strip](phase-04-csv-export-activity-strip.md) | B5 FE + B6 server aggregate | pending | 01 |
| 05 | [Guarded reseed](phase-05-guarded-reseed.md) | clearCases + reset route + button | pending | 01 |

Phases 02–05 build on the A1 treat-form patterns. 04 & 05 can run in parallel after 01
(disjoint files: 04 = activity route + export util; 05 = reset route + store fn).

## Key dependencies / verified facts

- `PATCH /api/care/cases/:id` supports status/assignee/channel_used/action_taken/notes/outcome — `server/src/routes/care-cases.ts:265`, `patchSchema:40`.
- `patchCase()` stamps `treated_at`/`closed_at` — `server/src/care/care-case-store.ts:163`.
- FE helper `patchCareCase()` — `src/pages/Dashboards/cs/use-care-cases.ts:336`. Hook `useVipCaseHistory()` — `:291`.
- `/api/care` write prefix gates POST/PATCH/DELETE behind editor/admin — `server/src/middleware/enforce-write-roles.ts:40`. Reset route inherits this gate for free.
- `buildPortfolio` counts treated+resolved toward attainment regardless of `outcome` — `src/pages/Dashboards/cs/use-care-playbooks.ts:169` (B4 refines this).
- `deleteCases(ids)` exists — `care-case-store.ts:203`; no clear-all → reset needs new `clearCases(gameId, workspace)`.

## Resolved decisions (user-confirmed 2026-06-09)

1. **B4 attainment semantics** — KEEP existing `attainmentRate` (`treated+resolved / total`) untouched; ADD a **separate `kpiMetRate`** (`kpi_met / closed-with-outcome`) alongside it. No regression to the live metric. (Phase 03)
2. **B6 activity source** — new `GET /api/care/activity?game` bounded SQLite aggregate. No client-derive. (Phase 04)
3. **Reset re-sweep** — reset wipes only; re-sweep is an **optional checkbox, OFF by default** (re-sweep needs live Cube, may be slow/absent in a demo). (Phase 05)
