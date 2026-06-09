---
phase: 7
title: "Observability Dashboard & Rollout"
status: complete
priority: P2
effort: "2-3d"
dependencies: [4, 6]
---

# Phase 7: Observability Dashboard & Rollout (Sub-project C, complete)

## Overview
Fill the Observability tab with the admin triage dashboard consuming the Phase 3/4 telemetry, fold per-user activity into the Phase 6 control panel, then close out: privacy doc, retention note, lessons-learned, docs sync.

## Requirements
- Functional:
  - Observability tab: org rollup cards (total users by status, active 7/30d, **inactive list >30d**), chat-conversation totals, top features used, recent-activity feed (from `access_audit` + `activity_events`).
  - Per-user activity snapshot inside the Phase-6 panel: last login, session/turn counts, recent features, recent query shapes, segment counts (`GET /api/admin/activity/users/:email`).
  - Audit-log viewer (Mixpanel pattern): filterable (`actor`/`action`/`target`/date), export CSV — over existing `access_audit` (+ optionally `activity_events`).
  - **CSV export hardening (red-team F8):** export re-validates admin at export time (not just page load), emits an `export` activity event (self-audit), and the CSV excludes any `uid_list`/filter-value content (only member names from `detail_json` — guaranteed by the Phase-3 whitelist).
  - **Release/changelog note (Phase 2 comms):** call out that legacy segments became owner-only so analysts know previously-visible segments didn't vanish — owners can re-share.
  - Empty states + inactive-user triage affordance (e.g., quick-disable from the inactive list).
- Non-functional: tokens + adjacency parity; chat-down degrades to null counts (Phase 4 contract); admin-gated.

## Architecture
- Observability tab calls `GET /api/admin/activity/summary`; per-user snapshot calls `…/users/:email` (both from Phase 4).
- Reuse charting components already used in dashboards where possible (DRY); cards mirror existing KPI/cohort styling.
- Audit viewer is a filtered table over `access_audit` (already populated) + `activity_events` feed.

## Related Code Files
- Modify: `src/pages/Admin/hub/` (Observability tab body), Phase-6 per-user panel (activity snapshot slot)
- Create: `src/pages/Admin/hub/observability-tab.tsx`, `audit-log-viewer.tsx` (+ tests), summary/per-user data hooks
- Modify (docs): `docs/system-architecture.md` (multi-user isolation + telemetry), `docs/deployment-guide.md` (retention/privacy env if any), `docs/lessons-learned.md` (sub↔email identity gotcha + visibility NULL→personal flip (legacy segments become owner-only)), `docs/project-changelog.md`
- Read: Phase 4 `admin-activity` route shapes, existing dashboard chart components

## TDD: Tests First
1. Data-hook tests: summary/per-user hooks map API → view models; inactive list derived at >30d; chat-null degradation renders "—" not crash.
2. `audit-log-viewer.test.tsx`: filter by actor/action/date; CSV export shape.
3. Run → red → implement → green.

## Implementation Steps
1. Write observability + audit-viewer tests (tests-first).
2. Build Observability tab (cards + feed) on Phase-4 endpoints.
3. Add per-user activity snapshot to the Phase-6 panel.
4. Build audit-log viewer (filters + CSV).
5. Add empty states + inactive-user quick-triage.
6. Docs sync (architecture, lessons-learned, changelog, deployment privacy/retention note).
7. Full FE suite green; design cross-check; end-to-end admin walkthrough.

## Success Criteria
- [x] Observability tab shows status rollups, active/inactive, chat totals, top features, recent-activity feed. — `observability-tab.tsx` (KPI cards + inactive list + top-features bars) + embedded `AuditLogViewer` as the recent-activity feed.
- [x] Per-user panel shows last login + chat + recent features/queries + segment counts. — shipped in Phase 5's `ActivitySnapshot`; extended with "last changed by/at" in Phase 6.
- [x] Audit-log viewer filters + exports; empty states present; inactive quick-triage works. — `audit-log-viewer.tsx` (actor/action/target filters, CSV export emits a self-audit `export` event); inactive list quick-disable via `patchAdminUser status=disabled`; empty states on both.
- [x] Privacy/retention documented; lessons-learned + architecture + changelog updated. — docs synced (architecture, lessons-learned [sub↔email + visibility flip], changelog [legacy-owner-only comms note], deployment-guide [90d prune + names-only telemetry + INTERNAL_SECRET]).
- [x] Tokens + adjacency parity; admin-gated; full suite green. — tokens.css only; routes admin-gated; server 718/718, FE 1618/1618, tsc 0 new.

## Completion Notes (2026-06-03)
- Net-new backend: `GET /api/admin/audit` over the `queryAccessAudit` read layer (built in the prior phase). Observability + per-user activity endpoints were already shipped (Phase 4) and are consumed here.
- `observability-data.ts` holds pure, unit-tested helpers (`auditEntriesToCsv` with RFC-4180 escaping, `auditQueryString`) + the `useActivitySummary`/`useAuditLog` hooks (both via `apiFetch` — admin routes 401 a bare fetch in prod).
- **CSV export hardening:** export is re-validated server-side (admin-gated route), emits a self-audit `export` activity event via `recordExport`, and the CSV detail column carries only grant-change payloads — no query-filter values or UIDs.
- **Recent-activity feed = the audit-log viewer** (newest-first over `access_audit`) — DRY, no second feed surface.
- Tests: observability-data 7, audit-log-viewer 4, observability-tab 6 (incl. chat-null degradation + summary-fetch-error banner).
- **Doc-sync correction:** the docs-manager agent hallucinated specifics (migration `030` → actually `028`; `INACTIVE_DAYS`/`ACTIVITY_RETENTION_DAYS` "env-tunable" → both are code constants; a fabricated "server 1098" test count; self-invented phase numbering). All verified against source and corrected before commit.

## Risk Assessment
- **Risk:** dashboard 500s when chat-service down. **Mitigation:** Phase-4 null degradation; tested in hooks.
- **Risk:** privacy concern over per-user query telemetry. **Mitigation:** internal monitored tool; document scope + 90d retention; no data beyond user-authored query shape.
- **Risk:** doc drift. **Mitigation:** docs-sync is an explicit step; lessons-learned captures both landmines (sub↔email, visibility backfill).
