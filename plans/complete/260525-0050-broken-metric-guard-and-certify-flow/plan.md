---
title: "Broken-metric guard + certify flow"
description: "Stop business metrics with unresolved Cube refs from hitting cube_api, and add a human-driven flow for promoting metrics back to certified."
status: complete
priority: P1
effort: "~6.5-10h (1 day)"
branch: "main"
tags: [catalog, metrics, trust, cube-api, certify]
blockedBy: []
blocks: []
related: [260525-0012-metrics-trust-tier-cleanup]
created: "2026-05-25T00:50:00.000Z"
updated: "2026-05-25T01:34:00.000Z"
createdBy: "ck:plan"
source: skill
slug: broken-metric-guard-and-certify-flow
---

# Broken-metric guard + certify flow

## Why

Investigation on 2026-05-25 found cube_api's recent log window was ~67% UserError 4xx (`'<measure>' not found for path 'mf_users.<measure>'`), not crashes. Root cause: 45/57 preset YAMLs reference Cube members that don't exist in the live ballistar `/meta`.

Commit `244e19f` (plan `260525-0012`) shipped the resolver and wires it into `GET /api/business-metrics[/:id]?game=…` with auto-draft mutation. **But:** neither FE (`use-business-metrics.ts`) nor chat (`list-business-metrics.ts`, `get-business-metric.ts`) pass `?game=`, so the resolver is a no-op in practice. Even when it does fire, `trust:'draft'` is only a visual signal — there is **no execution guard**, so Preview/Run/chat-explore still calls `cubeApi.load()` on broken metrics and the UserError flood continues.

This plan closes both gaps and adds the missing human side: a way to **promote a metric back to certified** once its refs are healthy.

## Non-Goals

- Mutating preset YAMLs to fix the underlying ref breakage (separate effort).
- Multi-tenant role/permission system (single-user playground; trust_history actor is best-effort).
- Reworking the chat preview/explain pipeline's prompt construction.
- A distinct `certified-stale` visual state — considered, dropped as YAGNI for single-user scale. See "Future enhancements" below.

## Phases

| Phase | Name | Priority | Status |
|-------|------|----------|--------|
| 1 | [Pass `?game=` through FE + chat](./phase-01-pass-game-id-through-callers.md) | P0 | Complete |
| 2 | [Execution-time ref guard (warn + override)](./phase-02-execution-time-ref-guard.md) | P0 | Complete |
| 3 | [Certify flow API + UI](./phase-03-certify-flow-api-and-ui.md) | P1 | Complete |
| 4 | [Chat certify tool + drift summary](./phase-04-chat-certify-tool-and-drift-summary.md) | P2 | Complete |

## Success Criteria

- S1. cube_api UserError rate for `'<measure>' not found for path …` drops to <5% of recent log window after FE rollout (`docker logs --since 10m ballistar_cube_api | grep -c "not found for path"`).
- S2. Resolver actually runs: `/api/business-metrics?game=ballistar` returns a different `trust` field for at least one metric than `/api/business-metrics` does.
- S3. Clicking Run on a broken metric in metric-detail or NewMetricPage shows an inline warning naming the missing refs; no network call to `/cubejs-api/v1/load` is fired until the user clicks "Run anyway".
- S4. `PATCH /api/business-metrics/:id/trust` flips trust in YAML, appends to `meta.trust_history[]`, and 400s when promoting to `certified` while refs are unresolved against the metric's primary game `/meta`.
- S5. Catalog header shows "X of Y metrics resolvable for {game}" and the count matches `tsx server/src/scripts/check-metric-drift.ts` output.
- S6. Chat tool `update_business_metric_trust` round-trips the same PATCH; replay test confirms idempotency.
- S7. `npm run test` green; types compile across server + FE + chat-service.

## Dependencies

- Uses resolver + validator shipped in `244e19f` (no schema changes to the resolver itself).
- Touches `business-metric.ts` Zod schema (additive: `meta.trust_history[]`, no breaking changes).
- FE relies on `useGameContext()` (already exists).

## Future enhancements (out of scope)

- **`certified-stale` visual state.** Distinguishes "never reviewed" (draft) from "reviewed-but-currently-unrunnable" (was certified, Cube schema regressed). Useful when a data team has review SLAs and triages broken-but-vouched-for separately from unreviewed. Skipped for now — single-user playground gets enough value from auto-draft + phase-03's manual recertify path. Revisit if the registry grows to multiple human reviewers.
