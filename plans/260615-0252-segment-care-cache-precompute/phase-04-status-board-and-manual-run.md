# Phase 04 — Status board + manual run

## Overview
Priority: P1. Status: not started. Depends on Phase 03 (run log + manual trigger).

A board to track Care precompute runs and trigger one manually — same shape as
the pre-agg run board and the segment-refresh ops tab. Lives in the Admin/dev hub.

## Context (mirror these)
- Backend runs API: `preagg-run-store.ts` + its route (migration 049). Copy the
  list-runs endpoint shape.
- Admin hub board UI: `src/pages/Admin/hub/preagg-runs-data.ts` +
  `src/pages/Admin/hub/segment-refresh-ops-tab.tsx` /
  `segment-refresh-ops-data.ts` / `segment-refresh-row.tsx`.
- Manual trigger UX: member360 "compute now" (202 + cooldown) →
  `triggerCarePrecompute` from Phase 03.
- Hub registration: `src/pages/Admin/hub/index.tsx` + `dev-hub-panel.tsx`.

## Design
- Backend routes (admin-scoped, read-only + one action):
  - `GET /api/admin/care-precompute/runs?segmentId=&limit=` → recent
    `segment_care_run` rows + each segment's cache freshness (`computed_at`,
    `status`, `last_error`).
  - `POST /api/admin/care-precompute/runs` `{ segmentId }` → `triggerCarePrecompute`
    (202 accepted / 429 cooldown). Reuses the manual trigger.
- Frontend: `care-precompute-data.ts` (fetch/types) + `care-precompute-panel.tsx`
  in the hub:
  - Table: segment, game, last run (relative time, GMT+7), status pill
    (ok/stale/error), tickets/contacted, elapsed, last_error.
  - "Run now" button per row → POST, optimistic "running…", cooldown disable.
  - Window/next-run info line (reads `CARE_PRECOMPUTE_WINDOW`).
  - All styling via design tokens; copy the pre-agg/refresh board layout — no new
    header shapes or bespoke spacing (design-guidelines.md).

## Todo
- [ ] Runs list + manual-trigger routes (mirror preagg/member360).
- [ ] Hub data module + panel; register in hub index.
- [ ] Status pills + relative timestamps (GMT+7) + cooldown handling.
- [ ] i18n strings (en + vi) following existing hub keys.

## Success criteria
- Board lists recent cron + manual runs with status; freshness matches the cache.
- "Run now" triggers a pass, row reflects running→ok/error, cooldown enforced.
- Route test: list returns runs; trigger returns 202 then 429 within cooldown.

## Risks
- Don't let the board's "run now" bypass the serial-drain guard — the manual
  trigger must share the same running flag / queue as the cron pass (no parallel
  Trino hammering). Verify against member360's shared-state behavior.
