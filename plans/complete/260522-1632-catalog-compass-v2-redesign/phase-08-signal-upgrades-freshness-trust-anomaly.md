---
phase: 8
title: "Signal upgrades (freshness + trust + anomaly)"
status: done
priority: P3
effort: "3d"
dependencies: [3, 5]
---

# Phase 8: Signal upgrades (freshness + trust + anomaly)

## Overview

Upgrade signals from mocked-v1 (P3/P5) to real wiring:
- **Freshness:** per-concept compute from cube `refresh_key` timestamp diff. **Per-game** — PTG runs ~3 weeks behind ballistar per introspection report; FreshnessChip must surface this honestly.
- **Trust:** seeding pass on existing measures/dims/segments (default `beta`, mark known-deprecated)
- **AnomalyBadge:** wire to a real detector job (z-score / EWMA over Cube queries, no ML). **Per-game** — runs the cartesian product `games × business_metrics` filtered by `game_compatibility`.

Drift detection still deferred (out of v1 scope, per brainstorm).

## Requirements

**Functional:**
- FreshnessChip on cards + detail headers shows real bucket: ok (<1h) / warn (1-24h) / stale (>24h)
- Bucket derived from cube `/meta` `refresh_key` timestamp; per-metric = min of upstream cube freshnesses
- Trust state for existing concepts seeded via overlay file or YAML field in `cube-dev/cube/model/` metadata
- AnomalyBadge wired to detector service: badge state + deltaPct + period sourced from detector output
- ChangeAnalysisModal (from P4) shows real breakdowns from detector if available; falls back to mock otherwise

**Non-functional:**
- Freshness compute cached per render (no per-card refetch)
- Detector job runs scheduled (cron-like, 1h cadence v1)
- Detector failure doesn't break UI — graceful fallback to "no data" state

## Architecture

**Freshness compute:**

```ts
// src/shared/concept-shell/use-freshness.ts
function useFreshness(cubeName: string): FreshnessBucket {
  const meta = useCatalogMeta();
  const cube = meta.cubes.find(c => c.name === cubeName);
  const lastRefresh = cube?.refresh_key?.lastTimestamp; // requires /meta surface
  return bucketByAge(Date.now() - lastRefresh);
}
```

Requires `/meta` to surface `refresh_key.lastTimestamp` — may need cube-dev backend extension. Risk: depends on Cube version.

**Trust seeding:** add `meta.trust:` field in cube YAML at `cube-dev/cube/model/cubes/*.yml` per measure/dim/segment. Manual seed pass for known-deprecated members. Default missing = `beta`. Backend exposes `meta` field unchanged.

**Anomaly detector:** lives in cube-playground's existing Fastify sidecar (resolved 2026-05-22 18:52 — same runtime as the existing refresh-log retention cron). No new service; no cube-dev change.

```
server/src/jobs/anomaly-detector.ts   # NEW — scheduled job (~1h cadence)
server/src/routes/anomaly-state.ts    # NEW — GET endpoint
server/data/anomaly-state.json        # NEW — output (or SQLite table)
```

Pseudo-code (TS, not Python — matches existing server stack):

```ts
for (const game of SUPPORTED_GAMES) {                       // ballistar/cfm/jus/ptg/muaw/pubg
  for (const metric of businessMetricsLoader.getAll()) {
    if (!isCompatible(metric, game)) continue;              // skip per game_compatibility
    const series = await queryCube(metric, game, last14d);  // JWT carries game key
    const delta = (series.at(-1) - mean(series.slice(0, -1))) / std(series.slice(0, -1));
    if (Math.abs(delta) > 3) {
      state[`${game}:${metric.id}`] = { state: delta > 0 ? 'high' : 'low', deltaPct: ... };
    }
  }
}
// persist to SQLite (preferred — db already in use), keyed by (game, metric_id)
```

Frontend reads via `GET /api/anomaly-state?game=<active>` (filtered by active Game-Context). Route lives in same Fastify app.

## Related Code Files

**Create:**
- `src/shared/concept-shell/use-freshness.ts`
- `src/shared/concept-shell/use-anomaly-state.ts`
- `server/src/jobs/anomaly-detector.ts` — scheduled job (mirror existing refresh-log retention cron pattern)
- `server/src/routes/anomaly-state.ts` — GET endpoint
- `server/src/services/cube-query-client.ts` — thin wrapper around Cube REST for the detector (if not already present)

**Modify:**
- `src/shared/concept-shell/freshness-chip.tsx` — read from `useFreshness`
- `src/shared/concept-shell/anomaly-badge.tsx` — read from `useAnomalyState`
- `src/pages/Catalog/metric-detail/change-analysis-modal.tsx` — fallback to mock if detector empty
- `cube-dev/cube/model/cubes/*.yml` — add `trust:` field to dimensions/measures/segments needing non-default state
- cube-dev backend `/meta` — expose `refresh_key.lastTimestamp` if not already

## Implementation Steps

1. **Audit `/meta` for refresh_key.** Check whether `lastTimestamp` is already surfaced. If not, add to backend serialisation.
2. **Build `useFreshness` hook.** Pure derivation from meta. Memoise per cubeName.
3. **Wire FreshnessChip** to hook. Replace P3 mocked value.
4. **Trust seeding pass.** For each cube YAML in `cube-dev/cube/model/cubes/`: review measures/dims/segments; tag known-deprecated `trust: deprecated`; rest default missing (`= beta`). Single PR.
5. ~~Decide anomaly detector hosting~~ — RESOLVED: cube-playground server (`server/src/jobs/anomaly-detector.ts`). Mirror the existing refresh-log retention cron pattern.
6. **Build detector v1** in `server/src/jobs/anomaly-detector.ts`. z-score over 14d series. Output to SQLite (preferred — db already in use) or `data/anomaly-state.json`. Schedule hourly.
7. **Build endpoint** `server/src/routes/anomaly-state.ts` → `GET /api/anomaly-state` reads the persisted state.
8. **Build `useAnomalyState`** hook. Returns `{ state, deltaPct }` for a metric id.
9. **Wire AnomalyBadge** to hook. P3 mocked YAML field still respected as override.
10. **Update ChangeAnalysisModal** to render real breakdowns from detector when available; fall back to P4 mock otherwise.
11. **Test:**
    - Freshness: mock different lastTimestamps, assert correct bucket
    - Anomaly: detector outputs known state for fixture metric, badge renders correct variant
    - Fallback: detector empty → modal shows mock data + "demo" banner

## Success Criteria

- [ ] FreshnessChip shows real bucket on cards (no longer hard-coded)
- [ ] Trust state seeded for all measures/dims/segments in cube-dev
- [ ] Detector job runs hourly, writes state.json
- [ ] AnomalyBadge appears on metrics flagged anomalous by detector
- [ ] ChangeAnalysisModal shows detector breakdowns when present
- [ ] Detector failure doesn't break UI (graceful fallback to mock)
- [ ] No bundle size increase > 3%

## Risk Assessment

- **`refresh_key.lastTimestamp` not surfaced by Cube** — depends on Cube version. **Mitigation:** patch `/meta` middleware to compute and inject if missing.
- **Trust seeding is manual + tedious** — many concepts. **Mitigation:** start with deprecated-only pass; default-`beta` covers the rest.
- **~~Open Q6: anomaly detector hosting~~** — RESOLVED: cube-playground server, mirroring existing cron job pattern.
- **Detector false positives** could spam badges. **Mitigation:** tune z-score threshold (start at 3); add hysteresis (state stays for 2 windows before flipping).
- **Backend dependency on Cube `/sql`** for ChangeAnalysisModal breakdowns — risk if not available. **Mitigation:** use Cube `/load` for slice queries instead.
