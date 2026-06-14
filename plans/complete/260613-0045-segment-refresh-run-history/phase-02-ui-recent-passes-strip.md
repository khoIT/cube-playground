# Phase 02 — UI: Recent passes strip

Status: ✅ done (2026-06-13) · Priority: high · Depends: phase-01

## Files

**Create**
- `src/pages/Admin/hub/segment-refresh-recent-runs.tsx` — `RecentRunsStrip` (presentational) +
  per-run line: `{age} · {source} · {ok}/{total} ok · {failed} failed`, failing-card details
  (card id + error) collapsible per run; design tokens only, mirrors existing row styling

**Modify**
- `src/types/segment-refresh-ops.ts` — `SegmentCardRun` wire type; `ErroringCard.lastAttemptAt`
- `src/pages/Admin/hub/segment-refresh-ops-data.ts` — `useRecentRuns(id, enabled)` hook
  (fetch on expand, refetch when a live pass completes), `fetchRecentRuns` via apiFetch
- `src/pages/Admin/hub/segment-refresh-row.tsx` — render strip in expanded section below
  LiveChecklist; erroring-card lines gain `· attempted {fmtAge} ago` when lastAttemptAt present
- Tests: extend `__tests__/segment-refresh-ops-tab.test.tsx` or data test for the hook/strip

## Constraints

- Design system: tokens only (`var(--…)`), spacing scale, no new font stacks (CLAUDE.md rules).
- `segment-refresh-row.tsx` already 383 lines — strip lives in its own file, row only composes.
- Expand-gated fetch: no extra request unless the row is opened.

## Success

- Expanded row shows last ≤5 passes with age/source/tally; FE tests + tsc green.
