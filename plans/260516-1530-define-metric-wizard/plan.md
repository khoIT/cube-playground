---
title: "Define-Metric Wizard POC"
description: "Approach A: top-bar CTA opens a 5-section wizard (Source / Operation / Of / Filter / Identity) that writes a new measure to a dev Cube's model YAML via a dev-only Vite middleware. Cross-cube only over existing 1-hop joins; no join authoring."
status: completed
priority: P2
branch: "main"
tags: [feature, wizard, write-back, yaml, dev-only]
blockedBy: []
blocks: []
created: "2026-05-16T08:32:30.433Z"
createdBy: "ck:plan"
source: skill
---

# Define-Metric Wizard POC

## Overview

Single POC flow lets non-engineers define a new Cube measure from existing members and save it to the dev Cube's `model/*.yml` via hot-reload, with a 5s `/meta` fitness check and rollback on failure. Source brainstorm: [`plans/reports/brainstorm-260516-1526-define-metric-wizard.md`](../reports/brainstorm-260516-1526-define-metric-wizard.md).

Approach **A** (Wizard + existing-joins discovery). v1 blocks save when no join path exists — no auto-join inference.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Backend Write Endpoint + Audit](./phase-01-backend-write-endpoint-audit.md) | Completed |
| 2 | [Wizard Scaffolding + State](./phase-02-wizard-scaffolding-state.md) | Completed |
| 3 | [Reachable-Members + Of-Picker](./phase-03-reachable-members-of-picker.md) | Completed |
| 4 | [YAML Generator + Validate/Save](./phase-04-yaml-generator-validate-save.md) | Completed |

Sequence: 1 → 2 → 3 → 4. Phase 1 unblocks Save; phases 2-3 can start once types are agreed; phase 4 closes the loop.

## Key Dependencies

- `js-yaml` (already in `package.json`) — round-trip YAML parse/write.
- `@cubejs-client/core` — `meta()`, `sql()`, `load()` already wired.
- Dev-only Vite middleware in `vite.config.ts` — new.
- `VITE_CUBE_MODEL_DIR` in `.env.local` — new env var resolving the cube model root (e.g. `../cube/model`).

## Out of Scope (v1)

Authoring joins, editing/deleting existing measures, cross-cube ratio, multi-hop join inference, prod write path, view authoring, measure-level pre-aggregations.

## Open Questions

1. The brainstorm references an "API Settings" button to the right of which the CTA should sit. The current `src/components/Header/Header.tsx` has no such button — only `BrandBlock + PillRow + Spacer`. **Default for plan:** place the **✱ New metric** CTA on the right side of the header (after `Spacer`); revisit when/if API Settings is added.
2. Snake_case vs cube's existing convention — **plan default:** infer from peer measures on the source cube, fall back to snake_case if no peers.
3. `CUBE_MODEL_DIR` location — **plan default:** `VITE_CUBE_MODEL_DIR` in `.env.local` consumed by the Vite middleware (server-side via `process.env`, not exposed to the client).

## Dependencies

No cross-plan blockers.

## Validation Log

### Session 1 — 2026-05-16

**Decisions confirmed:**

1. **Meta refetch wiring** — Lift `loadMeta` (or expose `refreshMeta()`) into `AppContext` so the wizard can trigger it from outside the QueryBuilder tree. Source: `src/QueryBuilderV2/hooks/query-builder.ts:1361`. **Propagated to:** Phase 2 (AppContext refactor scoped here), Phase 4 (success handler calls `appContext.refreshMeta()`).
2. **Cube runtime assumption** — POC requires a local, co-located cube workspace. `VITE_CUBE_MODEL_DIR` resolves to a local path (e.g. `../cube/model`); middleware refuses to start when the directory is missing. **Propagated to:** Phase 1 (startup check + refusal).
3. **YAML measure-type casing** — snake_case (`count_distinct`). Already the plan default; no edits required.
4. **Validate-before-Define gate** — Re-run dry-run only when the draft hash is stale. Already the plan default; no edits required.

### Verification Results

- Claims checked: 14
- Verified: 11 | Failed: 0 | Unverified: 0 | Architecture-gap: 3 (all resolved via interview)
- Tier: Standard (Fact Checker + Contract Verifier, 4-phase plan)
- Notable references confirmed:
  - `DialogTrigger type="fullscreen"` exemplar: `src/QueryBuilderV2/components/ChartSidePane.tsx:144`
  - Toast pattern: `antd` `notification` at `src/rollup-designer/RollupDesigner.tsx:323`
  - Meta loader: `src/QueryBuilderV2/hooks/query-builder.ts:1361`
  - Dependencies present: `js-yaml@^4.1.0`, `@cube-dev/ui-kit@0.52.3`, `lucide-react@^1.16.0`

### Whole-Plan Consistency Sweep

Re-read `plan.md` + all four phase files after propagation. No contradictions found.

- Phase 1 startup check added; matches dev-only enforcement already in §Security Considerations.
- Phase 2 `AppContext.refreshMeta` exposure added; Phase 4 references the same field.
- snake_case decision aligned with Phase 4 generator (already emits `count_distinct`).
- No duplicate embedded YAML drafts to reconcile.

Whole-plan consistency: **clean**.
