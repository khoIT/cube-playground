---
title: "VIP Care: sweep snapshots, 6h cron, queue pagination, diff/trend"
description: "Paginate the Case Ledger queue, snapshot every sweep (per-run/per-playbook/per-uid), auto-sweep eligible games every 6h, and surface trend + two-run diff."
status: complete
priority: P2
effort: ~5d (P1 1d, P2 1.5d, P3 0.5d, P4 2d)
branch: main
tags: [care, vip, cron, snapshots, pagination, cube]
created: 2026-06-09
---

# VIP Care — Sweep Snapshots, Auto-Sweep Cron, Queue Pagination, Diff/Trend

Four locked user decisions (DO NOT reverse): (1) 6h auto-sweep cron per eligible game; (2) snapshot grain = per-run + per-playbook counts AND per-uid membership; (3) diff UX = both trend-over-time AND two-run comparison picker w/ drill-to-VIPs; (4) pagination 50/page on Case Ledger (both lenses, ~7,793 rows cfm_vn). Hard add: retention/prune for per-uid membership.

## Verified anchors (this session, re-grep before editing)
- Cron: in-process 60s/interval tick, single-instance; siblings `prune-activity-events.ts` (template), wired in `server/src/index.ts:228-234`.
- Run-record precedent: `server/src/db/metric-drift-run-store.ts` + migration `022-...`; record+compare runs.
- Sweep core: `runCaseSweep(game, workspaceId, members, deps, calibration)` → `PlaybookSweepSummary[]` at `server/src/care/care-case-sweep.ts:56`. Summary fields: `playbookId, cohortSize, opened, lapsed, alreadyOpen, skipped?` (verified :49-102). Sweep already fail-soft per-game (try/catch → 502).
- Sweep + read routes: `server/src/routes/care-cases.ts`. by-vip/cases **sort + enrich in-route (in-memory)**, not SQL — pagination slices the post-sort array (priority preserved). `listCases` SQL = `ORDER BY opened_at DESC` only (`care-case-store.ts:124`).
- Client: `src/pages/Dashboards/cs/use-care-cases.ts` (useCareCases/useVipQueue/runCareSweep), UI `src/pages/Dashboards/cs/case-ledger.tsx`.
- Migrations forward-only, `PRAGMA user_version`=file count. Count = **40** → next `041`, `042`, `043`. Naming = `NNN-kebab-name.sql`.
- Test harness `makeMemDb()` (in-memory better-sqlite3, exec all migrations sorted) — copy from `server/test/resolve-identity-field-workspace.test.ts:17`.

## Phases

| # | Phase | Status | Depends on | Effort |
|---|-------|--------|-----------|--------|
| 1 | [Queue pagination (BE + FE)](phase-01-queue-pagination.md) | complete | — | 1d |
| 2 | [Sweep-run snapshot store + recording + prune](phase-02-sweep-snapshot-store.md) | complete | — | 1.5d |
| 3 | [6h auto-sweep cron (fail-soft per game)](phase-03-auto-sweep-cron.md) | complete | 2 | 0.5d |
| 4 | [Diff/trend API + FE comparison surface](phase-04-diff-trend-surface.md) | complete | 2 | 2d |

**Delivered (260609):** opt-in pagination (no-param = full list, preserving CS Monitor aggregates); store in `care/` not `db/` (cohesion w/ sibling care stores); shared `executeSweep` (route + cron, in-flight mutex); 6h cron w/ request-free ctx; Sweeps lens (trend sparklines + two-run diff + drill). 33 server care tests + 50 client CS tests green.

Phase 1 ships independently (unblocks slow load now). Phases 2→3 and 2→4 are the snapshot chain. Phase 1 and Phase 2 touch disjoint files and may run in parallel.

## File ownership (no overlap between parallel phases)
- **P1**: `server/src/routes/care-cases.ts` (GET handlers only), `src/pages/Dashboards/cs/use-care-cases.ts`, `case-ledger.tsx`.
- **P2**: 3 new migrations, new `server/src/db/care-sweep-run-store.ts`, new `server/src/jobs/prune-care-sweep-membership.ts`, `care-cases.ts` (POST sweep handler — distinct from P1's GET edits; if P1+P2 parallel, lead merges the single shared file).
- **P3**: new `server/src/jobs/care-auto-sweep.ts`, `server/src/index.ts` (1 wiring line).
- **P4**: `care-cases.ts` (new GET diff/trend routes), `care-sweep-run-store.ts` (read fns), new FE view + new hook file.

Note: `care-cases.ts` is touched by P1/P2/P4 — sequence them or lead owns the file. Avoid true parallel edits to it.

## Cross-cutting constraints (every phase)
- `/api/care` mutations editor/admin-gated; reads viewer-ok. Cron runs server-side (no request role) — must not call role-gated request paths.
- Fail-soft per game; reuse fail-soft `runCaseSweep` + best-effort profile enrichment.
- Never drop `cao` (urgent) cases via pagination — default sort stays priority-ranked; page 1 = highest priority.
- UI: `docs/design-guidelines.md` — tokens only, Inter, page-header pattern, semantic status tokens, spacing scale; mirror `case-ledger.tsx`.
- Code comments / filenames / migration names: domain slugs only, NO phase/finding refs.
- Files >200 LOC → modularize. Conventional commits, no AI refs.

## Open questions (defaults proposed — implementation not blocked)
1. **Retention thresholds.** Per-uid membership grows ~23k rows/run/game × 4/day. Default: keep per-uid membership **30 days** (~120 runs/game), keep run + per-playbook counts **365 days**. Prune daily. Constants `CARE_MEMBERSHIP_RETENTION_DAYS=30`, `CARE_RUN_RETENTION_DAYS=365`.
2. **Trend scope — per-game or cross-game?** Default: **per-game** (matches Case Ledger's game-scoped model + `requireGame`). Cross-game deferred.
3. **Diff view route.** Default: **new tab inside `/dashboards/cs`** (LensToggle gains a "Sweeps" lens) rather than a new route — reuses existing game-context + nav, minimal routing churn. Alternative `/dashboards/cs/sweeps` if a deep-link is wanted later.
4. **Cron eligibility source.** Use `availability.ts` (`getGameMembers` + `resolveAvailability`) per configured game; "eligible" = ≥1 membership playbook resolving `available`. Default: iterate games from games-config; skip unavailable, log skip reason.
5. **Sweep concurrency vs cron.** Single-instance assumption (no advisory lock). A manual sweep + cron tick could overlap on one game. Default: in-process per-game mutex (Set of in-flight gameIds) in the sweep entrypoint; cron skips a game already in-flight. Cheap, honors single-instance reality.
