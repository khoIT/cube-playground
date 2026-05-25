---
title: "/dev/chat-audit redesign + cache-effectiveness dashboard"
description: "Top-tab IA, unified mode-toggle search, leaderboard re-skin, new cache-effectiveness data layer + UI"
status: completed
priority: P2
effort: ~16h
branch: main
tags: [dev-audit, ui-redesign, cache, observability, dashboards]
created: 2026-05-25
updated: 2026-05-25
---

# Chat Audit Redesign + Cache Dashboard

## Goal
Replace the current two-pane + sidebar IA at `/dev/chat-audit` with a 4-tab shell (Sessions / Search / Leaderboard / Cache), introduce a unified mode-toggle search, and add a cache-effectiveness dashboard. Re-skin existing leaderboard. Visual style: Linear/Vercel/Stripe minimal — evolved from existing T.* tokens (no new design language).

## Design Contract
`design/hifi-mockup.html` — single self-contained HTML covering all 4 tabs. Implementation must match this artifact pixel-for-spec (tokens, density, type scale). Produced via huashu-design methodology from existing visual vocabulary in `src/shell/theme.tsx` + `src/pages/DevAudit/*.tsx`.

## Phases

| #  | Phase                                            | Status    | Deps      | LOC est. |
|----|--------------------------------------------------|-----------|-----------|----------|
| 01 | Route refactor + top-tab shell                   | completed | —         | ~180     |
| 02 | Unified search with mode toggle                  | completed | 01        | ~260     |
| 03 | Leaderboard re-skin + trend sparkline            | completed | 01        | ~140     |
| 04 | Cache effectiveness data layer (store + plugin + proxy) | completed | —     | ~360     |
| 05 | Cache effectiveness dashboard UI                 | completed | 01, 04    | ~330     |
| 06 | Polish + empty states + a11y + cmd-K             | completed | 02, 03, 05 | ~140    |

Total est: ~1,400 LOC across ~12 files (every file < 200 LOC). See each phase for breakdown.

## Dependency Graph
```
01 ─┬─► 02 ─┐
    ├─► 03 ─┼─► 06
    └─► 05◄┘
04 ─────────► 05
```
Phase 04 (data layer) runs in parallel with 01/02/03 (UI files) — disjoint owners.

## Files Touched (no two phases own the same file)

| Phase | Files                                                                                          |
|-------|------------------------------------------------------------------------------------------------|
| 01    | `src/index.tsx` (route table), `src/pages/DevAudit/dev-audit-page.tsx` (shell rewrite), NEW `src/pages/DevAudit/audit-tabs.tsx`, NEW `src/pages/DevAudit/dev-audit-shell.tsx` |
| 02    | NEW `src/pages/DevAudit/unified-search-page.tsx`, NEW `src/pages/DevAudit/search-mode-chips.tsx`, NEW `src/pages/DevAudit/search-results-cached.tsx`, `src/pages/DevAudit/search-result-list.tsx` (re-skin) |
| 03    | `src/pages/DevAudit/skill-leaderboard-page.tsx`, NEW `src/pages/DevAudit/skill-trend-sparkline.tsx` |
| 04    | NEW `chat-service/src/db/cache-effectiveness-store.ts`, NEW `chat-service/src/api/debug-cache-effectiveness.ts`, `chat-service/src/db/response-cache-migrate.ts` (add column), `chat-service/src/cache/response-cache-write.ts` (write column), `chat-service/src/index.ts` (register plugin), `server/src/routes/chat.ts` (proxy) |
| 05    | NEW `src/pages/DevAudit/cache-dashboard-page.tsx`, NEW `src/pages/DevAudit/cache-dashboard-hero.tsx`, NEW `src/pages/DevAudit/cache-dashboard-top-queries.tsx`, NEW `src/pages/DevAudit/use-cache-effectiveness.ts`, NEW `src/api/cache-effectiveness-types.ts` |
| 06    | empty-state + skeleton files (kebab-case), `src/pages/DevAudit/dev-audit-shell.tsx` (cmd-K wiring), a11y pass across new files |

## Out of Scope (YAGNI)
- New auth surface (reuse X-Owner-Id)
- Cross-owner aggregates
- Cache invalidation strategy changes
- Schema-level redesign of `response_cache`
- Mobile responsive layout (dev tool, desktop only)

## Backwards Compatibility
- `/dev/chat-audit/:sessionId?` (legacy) → redirect to `/dev/chat-audit/sessions/:sessionId?`
- `/dev/chat-audit/leaderboard` (legacy) → redirect to `/dev/chat-audit/leaderboard` (kept, falls under new shell)
- All existing chat-service `/debug/*` routes untouched except `response_cache` schema gets one ALTER (idempotent, NULL backfill safe)
- Existing chat-UI consumers unaffected (only audit UI shape changes)

## Completion Summary

**All 6 phases shipped.** Implementation via cook (01–06 sequential), verified by test suite:
- **Tests added**: ~250 net new (chat-service 478, FE 1265); 2 pre-existing baseline failures unrelated
- **Code review**: 2 critical + 6 notable items; C1/C2/N1/N3/N5/N6 fixed post-review; N2 (cross-game `currentMetaHash` pick) + N4 (deleted sessions in aggregates) deferred
- **Key decisions**: Per-game cache scope, simple `$ saved` formula (hit cost ≈ miss cost), `cube_meta_hash` additive column (NULL-safe backfill)
- **Proxy gap fix**: Server routes for annotation + search added in commit 85291bb

Deferred items documented for Q3 refinement.

## Risk Summary
- **HIGH**: `response_cache` lacks a `cube_meta_hash` column (only mixed into key). Phase 04 adds this column via idempotent ALTER. Backfill leaves legacy rows NULL → stale ratio computes over non-NULL subset, with explicit caveat in UI. (See phase-04 deviation note.)
- **MED**: `$ saved` formula assumes hit cost ≈ miss cost. Document caveat as tooltip on hero stat.
- **MED**: cmd-K opening unified search may conflict with macOS Spotlight if focused outside window; use `meta+k` *with focus inside app*.
- **LOW**: tab-state sync (URL ↔ active tab) regressions on deep links.

See `plans/reports/planner-260525-1709-chat-audit-redesign-and-cache-dashboard.md` for full risk + open-question matrix.
