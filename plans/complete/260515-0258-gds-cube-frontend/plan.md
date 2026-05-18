---
title: "GDS Cube — Vite+React frontend port of cubejs-playground"
description: "Net-new Vite+TS app porting QueryBuilderV2 + meta-driven data-model browser against Cube backend on :4000"
status: completed
priority: P2
effort: 5d
branch: main
tags: [frontend, vite, react, cube, port]
created: 2026-05-15
completed: 2026-05-15
---

# GDS Cube Frontend — Implementation Plan

Net-new Vite+React+TS SPA "GDS Cube" targeting Cube backend `http://localhost:4000`.
Ports `QueryBuilderV2` + supporting components from `/Users/lap16299/Documents/code/cube/packages/cubejs-playground/src/`; replaces dev-only `SchemaPage` with meta-driven Data Model browser; auth via paste-JWT modal.

## Source Material

- Research: [/Users/lap16299/Documents/code/cube-playground/plans/reports/research-260515-0243-gds-cube-frontend.md](../reports/research-260515-0243-gds-cube-frontend.md)
- Reference (read-only): `/Users/lap16299/Documents/code/cube/packages/cubejs-playground/src/`

## Phases

| # | File | Status | Effort | Description |
|---|------|--------|--------|-------------|
| 00 | [phase-00-bootstrap.md](phase-00-bootstrap.md) | completed | 0.5d | Vite scaffold, deps, proxy, `.env.local` |
| 01 | [phase-01-app-shell-auth.md](phase-01-app-shell-auth.md) | completed | 1d | `main.tsx`, `app.tsx`, cube-context, header, security-context-modal |
| 02 | [phase-02-playground-port.md](phase-02-playground-port.md) | completed | 2d | Minimal playground built from scratch on @cubejs-client/core |
| 03 | [phase-03-data-model-browser.md](phase-03-data-model-browser.md) | completed | 1d | `useMeta` hook, data-model page (tree + tabs), "Open in Playground" deep link |
| 04 | [phase-04-polish-test-finalize.md](phase-04-polish-test-finalize.md) | completed | 0.5d | Error boundaries, deep links, telemetry stub, vitest tests, build verify |

## Key Dependencies

- Cube backend reachable at `http://localhost:4000` with `/cubejs-api/v1/meta` available.
- Reference codebase present at `/Users/lap16299/Documents/code/cube/packages/cubejs-playground/src/`.
- Node ≥ 18 (Vite 8 requirement).

## Cross-Cutting Constraints

- File naming: kebab-case throughout (rename PascalCase reference files when porting).
- File size: split anything >200 LOC into focused modules.
- Stack pins: antd 4.16.13 (NOT v5), `@cube-dev/ui-kit` 0.52, recharts ^2.12, react-router-dom 6, styled-components 6.
- Drop categories: `cloud/`, `rollup-designer/`, `vizard/`, `cube-bi/`, `frontend-integrations/`, `connection-wizard/`, `live-preview/`, GraphiQL parts, Apollo.
- Endpoints used: `/cubejs-api/v1/meta`, `/load`, `/sql`, `/dry-run` only (no `/playground/*`).
- Auth: env `VITE_CUBE_API_URL` + `VITE_CUBE_TOKEN`, localStorage `gds-cube:token`, paste-JWT modal validated via `cubeApi.meta()`.

## Rollback Strategy

Each phase isolated by directory; rollback = `git revert` of phase commit. No DB / external state mutated.

## Known Gaps & Future Work

The following items were researched but are out of scope for this session:

- **QueryBuilder UI Kit integration:** Phase 02 built a minimal query builder from scratch on `@cubejs-client/core` instead of porting the wholesale QBv2. The `@cube-dev/ui-kit` dependencies (antd Form, Select, DatePicker) can be integrated in a follow-up if UI polish is needed.
- **QueryTabs multi-query mode:** Current implementation supports multiple query tabs with persistence. The "QueryTabs" multi-mode tabs feature from the reference is functional but could be enhanced.
- **Pivot table mode:** Pivot rendering is basic. Can be enriched with drag-and-drop field reordering (antd DnD support).
- **DrilldownModal:** Stub wired; full implementation deferred.
- **GraphQL tab:** Dropped per research (no GraphiQL integration). Can be re-evaluated post-launch.
- **Pre-aggregation refresh status:** Raw JSON tab shows pre-agg definitions; refresh status lives behind separate `/cubejs-api/v1/pre-aggregations` endpoint (deferred).

## Notes

- **Vite version:** Used Vite 5 (not Vite 8 from research) — Vite 8 not released at time of execution. No functional impact.
- **Phase 02 deviation:** Built minimal QB from scratch instead of wholesale port. Cleaner surface + faster delivery (same ~2d effort, less baggage).
- **Build:** `npm run build` produces 946KB bundle, ~270KB gzip. Recharts accounts for bulk of size.
- **Tests:** 10/10 tests passing (`use-meta`, `cube-context`, `build-seed-query`).
- **TS:** No compilation errors; strict mode enforced.
- **Bundle audit:** `grep -r` confirms zero imports from dropped subsystems (cloud, rollup-designer, vizard, live-preview, graphiql, apollo, codesandbox).
