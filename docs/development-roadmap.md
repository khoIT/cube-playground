# Development roadmap

A living view of shipped + upcoming work, kept in sync with the wizard rollout.

## Shipped

- ✅ **Legacy modal New Metric dialog** — single-cube, six-section form.
  Still mounted from the header button.
- ✅ **Full-page New Metric wizard (`?v=2`)** — six-step flow with shell,
  left rail / right rail, compact operation pills, live auto-name.
- ✅ **CDP projection + verify** — per-measure gating on the catalog page.
- ✅ **New Metric multi-source + N-slot inputs (2026-05-17)** — multi-cube
  Step 1, source-count gating on Step 2, N-slot rendering on Step 3,
  cross-cube ratio emission.

## In flight

_Nothing currently in flight. Add items here when work begins._

## Upcoming

- ⏳ **Retire the legacy `NewMetricDialog` flow** once the full-page wizard
  is GA. Removes the parallel-sync compat shim in `useNewMetricDraft`.
- ⏳ **Source-shrink undo** — when a source deselect auto-resets the active
  operation, surface an "undo" affordance instead of just a notice.
- ⏳ **Weighted average / formula operations** — exercise the InputSlot
  schema with a third multi-input op to validate the contract beyond Ratio.
- ⏳ **Step 4 cohort funnel preview** — surfaces filter impact on row count.
