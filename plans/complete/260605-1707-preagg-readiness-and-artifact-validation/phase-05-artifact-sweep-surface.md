# Phase 05 — Artifact sweep surface (Settings FE)

## Context Links
- `src/pages/Settings/workspace-readiness-section.tsx` (host tab, styled primitives, Refresh btn)
- `src/pages/Settings/use-workspace-readiness.ts` (apiFetch pattern)
- `src/api/api-client` (`apiFetch`)
- `docs/design-guidelines.md` (tokens)
- Blocked by: Phase 03 (shares the Workspace tab) + Phase 04 (sweep endpoint)

## Overview
- **Priority:** P3
- **Status:** complete
- **Description:** Add an on-demand "Validate saved artifacts" control + results
  summary to the Workspace readiness tab. Calls `POST /api/workspaces/:id/artifact-sweep`.
  Default static-only; a checkbox enables the live (`live:true`) probe tier.

## Key Insights
- On-demand, NOT auto-run on mount — the sweep touches the cube and the user must opt
  into the heavier `live` tier explicitly (a checkbox). This matches the server's
  POST-only, fail-open design and the lessons-learned no-fan-out rule.
- Reuse the section's `StatRow` for the summary counts and `Cell` (`bad` tone) for
  failing artifacts. Show failures grouped by status with the offending refs.
- New hook `use-artifact-sweep.ts` mirrors `useWorkspaceReadiness` (loading/error/run),
  but `run` is triggered by a button, not `useEffect`.

## Requirements
**Functional**
- Button "Validate artifacts" + a "Run live probes (chat artifacts)" checkbox — live
  probes apply only to chat artifacts; dashboard/segment verdicts come from their
  refresh jobs' persisted statuses. On click → POST with `{ live }`. Render summary
  (`total / ok / unverified / missing member / missing pre-agg / runtime error`) and a
  collapsible list of failing artifacts (kind, title, status, refs/detail).
  `unverified` = no persisted execution yet (tile not cached / segment never refreshed /
  chat artifact without live probe) — muted styling, not a failure.
- For non-game_id workspace: disable the control + show the n/a hint (server returns note).
**Non-functional**
- No auto-fetch on mount/workspace switch. Explicit run only. Disable while in flight.

## Related Code Files
**Create**
- `src/pages/Settings/use-artifact-sweep.ts`: `{ result, running, error, run(live) }`.
- `src/pages/Settings/artifact-sweep-panel.tsx` (<200): the panel UI.
**Modify**
- `src/pages/Settings/workspace-readiness-section.tsx` — mount `<ArtifactSweepPanel />`
  after the artifacts card (pass `workspaceId`, `gameModel`).

## Implementation Steps
1. `use-artifact-sweep.ts`: state + `run(live:boolean)` doing
   `apiFetch(POST /api/workspaces/:id/artifact-sweep, { body:{ live } })`. No useEffect.
2. `artifact-sweep-panel.tsx`: SectionCard with the button + checkbox; `StatRow` summary;
   below it, if failures, a list of `Cell tone="bad"` rows (one per failing artifact:
   `kind · title — status`, `.sub` = refs.join(', ') or detail). Disable button when
   running or `gameModel !== 'game_id'`; show muted n/a hint for prefix.
3. Tokens only (success/warning/destructive soft+ink, bg-muted). Cross-check with the
   pre-agg panel from P03 for visual parity.
4. Test (`src/pages/Settings/__tests__/artifact-sweep-panel.test.tsx`): mock apiFetch;
   click runs the sweep, renders summary + failing rows; checkbox toggles `live` in
   the request body; prefix workspace disables the control.

## Todo List
- [x] `use-artifact-sweep` hook (button-triggered, no auto-run)
- [x] `artifact-sweep-panel` (button + live checkbox + summary + failures list)
- [x] mount in workspace-readiness-section
- [x] vitest: run → summary/failures, live toggle in body, prefix disabled
- [x] tokens-only cross-check

## Success Criteria
- Clicking "Validate artifacts" issues exactly one POST and renders the summary.
- Checkbox toggles `live` in the request body (asserted in test).
- Failing artifacts list shows kind/title/status/refs.
- No fetch fires on mount or workspace switch.
- Prefix workspace: control disabled, n/a hint shown.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| User spams the button → cube load | L×M | disable while running; live tier opt-in + server-bounded |
| Large failure list bloats the tab | L×L | cap rendered rows (e.g. first 50) + count overflow |

## Rollback
Remove the panel + hook + mount line; tab reverts to readiness + pre-agg panels.

## Security
Read-only POST (no mutation server-side); owner-scoped via existing headers.

## Next Steps
Final phase. After merge: deploy P01 worker, then re-run the sweep with `live:true`
to confirm artifacts flip from `missing-preagg` to `ok`.
