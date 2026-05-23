# Redesign main flow, split new-metric vs new-data-model, end-to-end game picker

**Slug:** 260523-0955-redesign-flow-metric-split-game-picker
**Status:** Completed 2026-05-23 (all phases shipped, 683/683 tests green)

## Goals (from user)

1. Redesign user flow from main screen; remove header search bar.
2. Merge "new metric" into Catalog, wire to v2. The current `/metrics/new?v=2` becomes "New Data Model" (it actually edits cube YAML). A new lightweight "Add metric" flow lives in Catalog. v1 entry points unmounted (files kept).
3. End-to-end game picker across Playground, Catalog, Segments. Playground auto-injects `gameId` filter and invalidates on switch.

## Decisions confirmed

| Topic | Choice |
|---|---|
| Landing page | Playground (`/build`) — keep current redirect |
| Add-Metric integration | New `+ New metric` CTA on `/catalog` metrics tab routes to a lightweight wizard |
| `/metrics/new?v=2` | Repurposed as "New Data Model" (creates cube/measure/dim YAML) |
| v1 deprecation | Unmount header user-menu + Playground pill bar entry points; keep files for one release |
| Playground × game | Auto-inject `{gameId}` filter when active cube exposes a `gameId` dim; remount on switch |

## Phases

| # | File | Status | Summary |
|---|---|---|---|
| 1 | [phase-01-main-flow-remove-search.md](./phase-01-main-flow-remove-search.md) | ✅ done | Drop header search-box; tidy IndexPage; keep ⌘K via SmartSearchProvider |
| 2 | [phase-02-split-new-metric-vs-data-model.md](./phase-02-split-new-metric-vs-data-model.md) | ✅ done | Rename v2 wizard route to `/data-model/new`; build new lightweight `/catalog/metric/new`; wire CTA |
| 3 | [phase-03-v1-deprecation.md](./phase-03-v1-deprecation.md) | ✅ done | Remove `LegacyNewMetricDialogMount` from playground pill bar + user-menu link; deprecate marker in files |
| 4 | [phase-04-game-picker-end-to-end.md](./phase-04-game-picker-end-to-end.md) | ✅ done | Inject `gameId` filter in Playground; remount QueryBuilder on game change; verify Catalog/Segments already react |
| 5 | [phase-05-tests-and-docs.md](./phase-05-tests-and-docs.md) | ✅ done | Update unit tests for affected modules + docs sync |

## Key dependencies

- Phase 2 depends on Phase 1 (route layout stable).
- Phase 3 depends on Phase 2 (v1 unmount safe after CTA wired).
- Phase 4 independent — can run in parallel with 2/3.
- Phase 5 runs last.

## Out of scope (this PR)

- Backend changes to Cube YAML (handled by existing wizard).
- Server-side game-scoping (UI-side filter only).
- Full home dashboard / Compass V3.
