---
phase: 1
title: "Baseline profiling"
status: pending
priority: P1
effort: "4h"
dependencies: []
---

# Phase 1: Baseline profiling

## Overview

Capture concrete render-count + interaction-time baselines for the three pain interactions BEFORE any code change. Without numbers the "feel test" acceptance is unfalsifiable — Phase 1 makes the later phases auditable, and is the input to Phase 6's comprehensive before/after report.

## Requirements

- Functional:
  - Three Chrome Performance traces saved as `.cpuprofile`-paired screenshots.
  - One React DevTools Profiler ranked view per interaction.
  - One render-count table tying components to before counts.
- Non-functional: no production behavior change; profiling instrumentation is dev-only (gated on `import.meta.env.DEV`).

## TDD Discipline

This phase is measurement, not behavior change. "Test-first" here means: write the measurement harness BEFORE the codebase changes that follow. The harness IS the test fixture for Phases 2-5 and Phase 6.

1. Write `src/dev/perf-probe.tsx` — a `<Profiler>` wrapper that increments a counter in `window.__perfCounts` on each commit. Dev-only export, no-op in production.
2. Write `tests/perf-probe.test.ts` — unit-test the counter logic (mount/unmount, multiple instances, reset).
3. Only then wrap `QueryBuilderSidePanel`, `NewMetricPage`, `ExplorePage` with the probe.

## Architecture

```
src/dev/perf-probe.tsx          # new — dev-only Profiler wrapper
src/dev/perf-probe.test.tsx     # new — vitest
src/QueryBuilderV2/QueryBuilderSidePanel.tsx  # wrap render in probe (DEV only)
src/QueryBuilderV2/NewMetric/full-page/NewMetricPage.tsx  # wrap render in probe (DEV only)
src/pages/Explore/ExplorePage.tsx  # wrap render in probe (DEV only)
plans/.../reports/perf-baseline.md  # output artifact
```

The probe wrapper:

```tsx
// pseudocode
export function PerfProbe({ id, children }: { id: string; children: ReactNode }) {
  if (!import.meta.env.DEV) return <>{children}</>;
  return (
    <Profiler id={id} onRender={(id, phase, actualDuration) => {
      const w = window as any;
      w.__perfCounts ??= {};
      w.__perfCounts[id] ??= { mount: 0, update: 0, totalMs: 0 };
      w.__perfCounts[id][phase] += 1;
      w.__perfCounts[id].totalMs += actualDuration;
    }}>{children}</Profiler>
  );
}
```

## Related Code Files

- Create: `src/dev/perf-probe.tsx`, `src/dev/perf-probe.test.tsx`, `plans/260517-2330-perf-restructure-zustand-lazy-routes/reports/perf-baseline.md`
- Modify: `src/QueryBuilderV2/QueryBuilderSidePanel.tsx`, `src/QueryBuilderV2/NewMetric/full-page/NewMetricPage.tsx`, `src/pages/Explore/ExplorePage.tsx`

## Implementation Steps

1. Write `perf-probe.test.tsx` covering: counter increments on render, resets via `window.__perfCounts = {}`, no-op in production (`vi.stubEnv('PROD', 'true')`).
2. Implement `perf-probe.tsx` to make tests pass.
3. Wrap the three target components.
4. Run dev server. Execute interaction scripts in `reports/perf-baseline.md`:
   - **Cold start → first click**: hard-refresh → click "Playground" → click first dimension. Record DevTools Performance trace.
   - **QB dim toggle**: with meta loaded and ≥1 cube, click 5 dimensions sequentially. Record React DevTools Profiler.
   - **Tab switch**: Playground → Catalog → Playground. Record performance trace.
5. Snapshot `window.__perfCounts` after each interaction. Paste into report.
6. Commit baseline report so later phases (and Phase 6) can diff against it.

## Success Criteria

- [ ] `perf-probe.test.tsx` passes; coverage on counter logic.
- [ ] Probe wrappers added; dev server still renders correctly; no console errors.
- [ ] `reports/perf-baseline.md` committed with: 3 trace screenshots, 3 render-count snapshots, 1 ranked-render-time table.
- [ ] Production build does not include `<Profiler>` (verify via `vite build` + grep `dist/assets/*.js` for `__perfCounts`).

## Risk Assessment

| Risk | Mitigation |
|---|---|
| `<Profiler>` itself adds overhead skewing measurements | Run baseline twice; second run is the trusted number. Probe is dev-only so prod is untouched anyway. |
| Vitest doesn't render Profiler in jsdom | The unit test mocks `Profiler`; we test counter logic, not React internals. |
| Window globals leak across tests | `beforeEach` resets `window.__perfCounts = {}`. |
