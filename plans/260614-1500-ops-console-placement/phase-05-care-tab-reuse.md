---
phase: 5
title: "Care tab — reuse playbook monitor"
status: completed
priority: P2
effort: "0.5d"
dependencies: [1]
---

# Phase 5: Care tab — reuse playbook monitor

## Overview
The Care tab embeds the existing VIP-care playbook monitor (the body of `Dashboards/cs/index.tsx`):
`CsActivityStrip` + `PortfolioStrip` + `PlaybookGrid`, fed by the same care hooks. No new data work.

## Requirements
- Functional: the Care tab shows the 24h activity strip, the portfolio stat bar, and the 4-group
  playbook grid for the current game — identical behavior to `/dashboards/cs`.
- Non-functional: reuse the components and hooks as-is; do not fork. Respect existing write-permission
  gating (`canWrite`).

## Architecture
**Extract, don't re-compose (red-team B3):** rendering the 3 components directly drops the CS page's
loading/error/empty/skeleton scaffolding (~100 lines, `index.tsx:64-239`) so "identical behavior" would
be false; re-composing also duplicates and drifts. Extract the CS page body (minus the `pageStyle`
wrapper + "New playbook" header button) into `care-monitor-body.tsx`, render from BOTH `/dashboards/cs`
and the Ops Care tab. Hooks are self-contained (`useCarePlaybooks(gameId)` use-care-playbooks.ts:227,
`useCareDataFreshness(gameId)` :27 — not provider-coupled). **Double-poll guard:** `CsActivityStrip`
auto-polls every 30s (use-care-cases.ts:390) — the Ops tab switcher must UNMOUNT the inactive Care tab
(not display:none) so the poll stops when away (also Phase 1 tab behavior).

## Related Code Files
- Create: `src/pages/Dashboards/cs/care-monitor-body.tsx` (extracted shared body),
  `src/pages/OpsConsole/care-tab.tsx` (thin wrapper rendering the body with gameId from context).
- Modify: `src/pages/Dashboards/cs/index.tsx` (render the extracted body instead of inline composition).
- Reference: `portfolio-strip.tsx`, `playbook-grid.tsx`, `cs-activity-strip.tsx`, `use-care-playbooks.ts`,
  `use-care-cases.ts:390` (poll interval).

## Implementation Steps
1. Extract `index.tsx:64-239` body into `care-monitor-body.tsx(props: {gameId})` — strip + portfolio +
   grid + loading/error/empty/skeleton branches; keep the "New playbook" button in the CS page only (or
   behind a prop) so the Ops tab doesn't expose authoring it shouldn't.
2. Re-point `/dashboards/cs` to render the body — verify NO regression on the live page first.
3. `care-tab.tsx`: render `<CareMonitorBody gameId={gameId} />`.
4. Ensure the Ops tab switcher unmounts the inactive Care tab (stops the 30s poll).
5. Verify parity vs `/dashboards/cs` for cfm; spot-check jus.

## Success Criteria
- [ ] Care tab == `/dashboards/cs` behavior for cfm/jus (portfolio + grid + activity + states).
- [ ] `/dashboards/cs` shows NO regression after the extraction.
- [ ] Write/authoring gating respected; Ops tab does not expose authoring it shouldn't.
- [ ] Leaving the Care tab unmounts it (no background 30s poll).
- [ ] No new tsc/lint/build errors.

## Risk Assessment
- Extraction touches the LIVE CS console — run it after the change before anything else; this is the
  whole reason to extract carefully rather than re-compose.
- Care hooks take gameId explicitly — pass from context, don't rely on route scope.
