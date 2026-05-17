# Perf Baseline — Phase 1

**Captured:** 2026-05-17 (probe infrastructure landed; manual trace capture pending)
**Commit:** pre-restructure HEAD on `segment_dimension`
**Probe:** `src/dev/perf-probe.tsx` — dev-only React `<Profiler>` wrapper writing into `window.__perfCounts`.

## Instrumented Components

| Probe id | Wrapped at |
|---|---|
| `QueryBuilderSidePanel` | `src/QueryBuilderV2/QueryBuilderSidePanel.tsx` return |
| `NewMetricPage`         | `src/QueryBuilderV2/NewMetric/full-page/NewMetricPage.tsx` return |
| `ExplorePage`           | `src/pages/Explore/ExplorePage.tsx` return |

## How To Reproduce Each Interaction

```js
// In DevTools console
window.__perfCounts = {};
// then perform the interaction
copy(JSON.stringify(window.__perfCounts, null, 2));
```

### Interaction 1 — Cold start → first click
1. Hard-refresh (Cmd+Shift+R / Ctrl+Shift+F5).
2. Navigate to Playground (`/build`).
3. Click first dimension in the side panel.
4. Record Chrome Performance trace + snapshot `__perfCounts`.

### Interaction 2 — QB dim toggle (the headline pain)
1. Meta loaded, ≥1 cube selected.
2. Reset counters: `window.__perfCounts = {}`.
3. Click 5 distinct dimensions sequentially.
4. Snapshot `__perfCounts.QueryBuilderSidePanel`.

### Interaction 3 — Tab switch
1. Playground → Catalog → Playground.
2. Snapshot `__perfCounts` for both `ExplorePage` and `QueryBuilderSidePanel` (KeepAlive keeps SidePanel mounted; expect updates not mounts).

## Baseline Numbers

> Manual trace capture is required to fill the tables below. The probe
> infrastructure (this commit) lands the harness; the numbers will be
> populated by running each interaction script above in Chrome DevTools.
> Numbers are recorded post-Phase-1 commit, so they reflect the codebase
> BEFORE Phases 2–5 alterations.

| Interaction | `__perfCounts` (before) |
|---|---|
| 1. Cold start → first click | _to capture_ |
| 2. 5× dim toggle             | _to capture_ |
| 3. Tab switch round-trip     | _to capture_ |

## Notes / Caveats

- Probe overhead: `<Profiler>` itself adds some commit cost. Two-run protocol —
  second run is the trusted number (matches Phase 6 protocol).
- Probe is no-op in production builds (gated on `import.meta.env.DEV`). Verified
  by inspecting the wrapper's `isDev()` short-circuit.
- The probe writes to `window.__perfCounts` only in DEV — never in prod, so the
  `dist/*.js` grep gate from the plan's success criteria passes by construction.

## Unresolved Questions

- Manual Chrome DevTools capture has not been done in this commit — the probe
  is the prerequisite for it. Phase 6's before-vs-after report will diff
  captured baseline values against captured post-restructure values.
