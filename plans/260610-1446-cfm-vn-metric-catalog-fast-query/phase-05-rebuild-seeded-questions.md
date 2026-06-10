---
phase: 5
title: "Rebuild seeded questions from the final catalog"
status: pending
priority: P2
effort: "2h"
dependencies: [2, 4]
---

# Phase 5: Rebuild seeded questions from the final catalog

## Overview
Regenerate the seeded/starter questions so they reflect the curated cfm_vn catalog and only
surface metrics proven fast in Phase 4 — no seed should lead a user into a cold-Trino query.

## Requirements
- Functional:
  1. Rebuild `src/pages/Chat/library/starter-questions.ts` from the final metric list.
  2. **Reconcile ALL seed sources, incl. chat-service's own starter subsystem** (red-team
     omission): `chat-service/src/core/starter-question-{service,templates,refiner}.ts` is what
     the agent actually uses — regenerate via the existing refiner pipeline, don't hand-fork.
     Plus server `golden-query-seeder.ts`, `dashboard-starter-pack-seeder.ts`.
  3. **Synonym preservation** (red-team): when a metric is pruned/merged in Phase 2, fold its
     synonyms+aliases into the survivor so the agent's phrase-matching surface never shrinks.
     New metrics ship with synonyms + description. Dedup exact-duplicate ids (e.g.
     `revenue` vs `gross_bookings`, both `recharge.revenue_vnd`) — keep one, alias the other.
  4. Each seed maps to a real catalog metric id and a slice that hits a rollup (<2s warm).
  5. Coverage spread: seeds span the catalog domains (revenue, engagement, payments,
     acquisition, marketing, retention) + the new event-cube exploration metrics.
- Non-functional: phrasing natural/human; cfm_vn-appropriate (no other-game-only metrics).

## Architecture
Seeds are static lists keyed by metric id / cube. Drive them from the Phase-2 final list so
adding a metric later auto-suggests a seed shape. Keep the existing file structure/format.

## Related Code Files
- Modify: `src/pages/Chat/library/starter-questions.ts`
- Modify: `chat-service/src/core/starter-question-{service,templates,refiner}.ts` (the agent's
  actual starter surface)
- Modify: `chat-service/src/nl-to-query/synonym-resolver.ts` (fold pruned synonyms; add new)
- Modify: `server/src/services/golden-query-seeder.ts`,
  `server/src/services/dashboard-starter-pack-seeder.ts` (reconcile to final list)
- Read/Update: `src/pages/Chat/__tests__/starter-output-hint.test.ts` (keep green)
- Create: `plans/.../reports/cfm-vn-seed-rebuild-report.md`

## Implementation Steps
1. Derive seed candidates from the final list (one headline question per domain + event adds).
2. Drop seeds whose metric is pruned/unbacked/slow; replace with a fast equivalent.
3. Update the three seed sources; run the starter-question tests + FE suite.

## Success Criteria
- [ ] Every seed → an available + <2s cfm_vn metric.
- [ ] Domains + new exploration areas represented; no stale/pruned-metric seeds remain.
- [ ] All 3 seed surfaces reconciled (FE starter-questions, chat-service starters, server seeders).
- [ ] Synonym surface preserved/grown (no pruned matchable synonym lost); duplicates aliased.
- [ ] Phase-0 harness (extended with the new seeds) re-run = no resolution regression vs baseline.
- [ ] starter-question tests + FE/server suites green.

## Risk Assessment
- Seeds drifting from catalog over time → derive from the registry where feasible, not hardcode twice.

## Next steps
cfm_vn shippable after this. Phase 6 generalizes.
