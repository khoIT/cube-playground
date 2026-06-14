---
title: >-
  Ops Console enhancements: overview redesign, power-up charts, custom date
  range, members list
description: >-
  4 approved /ops enhancements — 2/row overview redesign + 5 new charts, custom
  date range (≤31d), top-payers members list, heatmap cube dims.
status: completed
priority: P2
effort: ~9h
branch: main
tags:
  - ops-console
  - frontend
  - cube-model
  - charts
blockedBy: []
blocks: []
created: '2026-06-14'
createdBy: ck-cli
source: cli
---

# Ops Console enhancements

## Overview

Four approved enhancements to the `/ops` console (cfm_vn / jus_vn). Scope, design, and
data contracts are PRE-VERIFIED (cube YAMLs read 2026-06-14) — this plan is execution-only.

- **F1** — Overview redesign: trend grid MAX 2/row + 5 NEW charts (ad-spend-vs-cash,
  ARPPU-&-conversion, support-volume-&-sentiment, purchase hour×DOW heatmap, payer-tier
  concentration). Keep existing 5 analysis panels.
- **F2** — Custom date range picker beside the 7d/30d/MTD toggle, capped ≤31 days.
- **F3** — Members tab top-N payers table above the kept uid search.
- **F4** — Cube-model change: add `hour_of_day` + `day_of_week` dims to billing_detail
  (cfm + jus) — the only backend change; gates the heatmap chart ONLY.

All charts keep `AssistantChartSection` (type-switch / table / CSV) + per-chart
`OpenInPlayground` deeplink. Pure functions stay unit-tested.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [cube-model-heatmap-dims](./phase-01-cube-model-heatmap-dims.md) | Completed |
| 2 | [query-builders](./phase-02-query-builders.md) | Completed |
| 3 | [data-hooks](./phase-03-data-hooks.md) | Completed |
| 4 | [chart-adapters-overview-layout](./phase-04-chart-adapters-overview-layout.md) | Completed |
| 5 | [custom-date-range](./phase-05-custom-date-range.md) | Completed |
| 6 | [members-list](./phase-06-members-list.md) | Completed |
| 7 | [tests-validation](./phase-07-tests-validation.md) | Completed |

## Dependency graph

```
P1 (cube dims) ──gates heatmap query/chart only──┐
                                                 ▼
P2 (query builders) ──> P3 (data hooks) ──> P4 (chart adapters + overview layout)
P5 (custom date range) ── independent of P1; touches ops-window.ts + index.tsx ──┐
P6 (members list)      ── independent of P1; reuses useMemberCubeQuery ───────────┤
                                                                                  ▼
                                                              P7 (tests + tsc + build + review)
```

- **P1 gates the heatmap ONLY.** P2–P6 (and all 4 other new charts) proceed in parallel
  with P1's deploy. The heatmap chart renders empty until P1's dims deploy to BOTH
  cube registries AND the serving instance restarts (DEV_MODE=false = no hot reload).
- **P2 → P3 → P4** are strictly sequential (queries feed hooks feed charts/layout).
- **P5** and **P6** are independent of the P2→P4 chain (separate files); can run in parallel.
- **P7** is last — validates everything.

## File ownership (no overlap between parallel phases)

| Phase | Owns (modify/create) |
|-------|----------------------|
| P1 | `cube-dev/cube/model/cubes/{cfm,jus}/billing_detail.yml` |
| P2 | `src/pages/OpsConsole/ops-overview-queries.ts` |
| P3 | `src/pages/OpsConsole/use-ops-overview.ts` |
| P4 | `src/pages/OpsConsole/ops-chart-artifact.ts`, `overview-tab.tsx` |
| P5 | `src/pages/OpsConsole/ops-window.ts`, `ops-date-range-picker.tsx` (new), `index.tsx`, `ops-window-toggle.tsx` (read) |
| P6 | `src/pages/OpsConsole/members-tab.tsx`, `members-top-payers.tsx` (new) |
| P7 | `src/__tests__/ops-*.test.ts` only |

**Conflict note:** P3 and P5 both ultimately touch the window contract. P5 changes the
`OpsWindow` type + `useOpsOverview` SIGNATURE (window → window+range); P3 changes the
hook BODY (new queries). Sequence P3 before P5's signature change, OR land P5's type
change first and have P3 build against it. **Decision: P5 lands the type/signature change;
P3 consumes the new signature.** See P3 + P5 "Architecture" for the exact contract.

## Top risks (full per-phase tables in phase files)

1. **HIGH — heatmap dims deploy/restart dependency.** New cube dims do NOT hot-reload on
   prod (DEV_MODE=false). Must deploy to dev + prod registries and restart the serving
   instance (cube_api, not just worker) before the heatmap resolves. Mitigation: ship the
   chart with an empty-state placeholder; gate ONLY the heatmap on P1; verify via compiled
   SQL / a manual `/load` probe post-deploy, not by assuming hot-reload.
2. **MED — jus mixed-currency.** Every jus money query (heatmap incl.) needs
   `currency='VND'` filter via existing `vndFilter()`. Forgetting it = USD rows pollute VND sums.
3. **MED — F3 introduces per-user rows (mild PII).** User-approved. Keep it isolated to the
   members list query; do NOT let a user_id dim leak into any Overview/aggregate query
   (P2/P7 assert no-PII on Overview builders).

## Repo rules baked in

- NO plan-artifact refs (phase numbers, finding codes) in code comments or filenames —
  explain the *why* (invariant / trade-off), per `review-audit-self-decision.md`.
- Design tokens only (`var(--…)`); one font `var(--font-sans)`; mirror existing OpsConsole pages.
- Times in GMT+7 where user-facing date logic surfaces.
- Commit/push ONLY when user asks. `second` remote auto-deploys.
