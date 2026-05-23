# Compass v2 Catalog Redesign — Complete (9 Phases, 790 Tests)

**Date**: 2026-05-23
**Severity**: Low
**Component**: Catalog (UI, search, composition wizard, anomaly detection, notifications, workspaces)
**Status**: Shipped

## What Happened

Two commits closed the final two deferrals from the morning, shipped the anomaly detector scheduler, and locked in the complete Compass v2 redesign across all 9 phases. Smart-search overlay (P7) now does metric + concept search with real signals. Composition wizard (P6) is a 4-step flow at `/catalog/metric/new` with proper chrome. Anomaly detector (P8/P9) runs scheduled z-score detection every 6h and surfaces state via hooks. Digest, notifications, saved views, workspaces, and user prefs all wired. No schema breaking changes. All 790 tests passing.

## Technical Details

**WizardShell extraction** (`src/shared/wizard-shell/wizard-shell.tsx`): Reusable Compass-styled chrome. NewMetricPage kept on bespoke Shell/LeftRail/RightRail/StepChrome — two different surfaces (consumer vs author) warrant two different aesthetics, with docstring in WizardShell clarifying the picker.

**Anomaly detector** (`server/src/jobs/anomaly-detector.ts`): Scheduled z-score calculation, self-throttled via `ANOMALY_DETECTOR_INTERVAL_MS` (6h default). Pure modules (`z-score.ts`, `metric-query-planner.ts`) testable without Cube. State written atomically to `server/data/anomaly-state.json`. Per-game Cube auth via `CUBE_TOKEN_<GAME>` env or minted from `CUBEJS_API_SECRET` (no blind `jsonwebtoken` dep); graceful fallback to YAML when neither configured.

**Hooks** (`useAnomalyState`, `useMergedAnomaly`, `useFreshness`): P8 first cut now complete with detector feeding real data.

**Bug fix**: Missing `useMergedAnomaly` import in `metric-card.tsx` caused runtime ReferenceError on Metrics tab. Hardened anomaly-state-route test against stale detector files.

## Lessons Learned

1. **Dual-surface aesthetics**: NewMetricPage and composition wizard both solve "create metric" but for different audiences. Resisting the urge to unify them onto WizardShell was correct — the bespoke rail layout serves author workflows better.

2. **Env config over hard deps**: Operator flexibility (pre-minted tokens OR minted in-process) + graceful fallback is better than forcing a dependency. The three-tier auth strategy (env token → minted from secret → YAML) keeps the operator in control without code changes.

3. **Pure math + planning modules**: Keeping z-score and query planning logic separate from Cube SDK integration made unit testing trivial. Future anomaly algorithms can plug in without touching the scheduler.

## Next Steps

All 9 phases of Compass v2 complete. The plan can close. Any future refinement is feature work, not redesign work.

**Test results**: 676 FE + 114 server = 790 passing, zero new typecheck errors.
