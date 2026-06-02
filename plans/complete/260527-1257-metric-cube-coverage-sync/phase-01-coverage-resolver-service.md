# Phase 01 — Backend coverage resolver service

## Context
- Reuse: `src/services/metric-ref-validator.ts` (`snapshotFromMeta`, `validateRefs`, `parseFqn`, `extractRefs`), `src/services/metric-trust-resolver.ts` (`getDrift`), `src/services/cube-client.ts` (`getMeta`), `src/services/resolve-cube-token.ts` (`resolveCubeTokenForGameDetailed`), `src/services/games-config-loader.ts` (`loadGamesConfig`).
- Validator already returns `UnresolvedRef{metricId, ref, reason}`. Snapshot exposes `members:Set, cubes:Set`.

## Overview
Priority: high. Status: not started.
New pure-ish service `src/services/metric-coverage-resolver.ts` that, given the registry + a per-game `/meta` snapshot, computes the three gap types. Keep file < 200 LOC.

## Requirements
- **Broken refs:** delegate to `validateRefs(metrics, snapshot)` (DRY — do not re-derive).
- **Uncovered measures:** `metaMeasures − referencedMeasures`. `metaMeasures` = measure members in snapshot (need measure-vs-dimension distinction — extend `snapshotFromMeta` to also return `measures:Set`, since current snapshot merges measures+dimensions into `members`). `referencedMeasures` = every `formula.ref` measure across registry (`extractRefs` → `parseFqn`).
- **Matrix cell:** for one metric + one game → `resolves | broken(reason) | cube-missing`.
- Fail-open: token/`/meta` failure for a game → mark game `status:'error'`, never throw.

## Architecture / shapes
```ts
interface MeasureCoverage { game: string; status: 'ok'|'drift'|'error';
  cubesInMeta: number; measuresInMeta: number;
  brokenRefs: UnresolvedRef[];               // from validateRefs
  uncoveredMeasures: string[];               // cube.member with no metric
}
interface MatrixCell { metricId: string; game: string; state: 'resolves'|'broken'|'cube-missing'; }
async function resolveCoverageForGame(metrics, gameId): Promise<MeasureCoverage>
async function resolveCoverageAllGames(metrics): Promise<{ games: MeasureCoverage[]; matrix: MatrixCell[] }>
```
- Per-game `/meta` fetched via minted token; cache snapshot within a single all-games call (Map<game, snapshot>).

## Related files
- Create: `src/services/metric-coverage-resolver.ts`.
- Modify: `src/services/metric-ref-validator.ts` — add `measures:Set` to `MetaSnapshot` + populate in `snapshotFromMeta` (keep `members` for back-comF compat). Touch consumers only additively.

## Steps
1. Extend `MetaSnapshot` with `measures:Set<string>`; fill from `cube.measures[].name`. Keep `members` unchanged.
2. Implement `referencedMeasures(metrics)` — collect measure-type refs (ratio numerator/denominator are measures; expression inputs may be members — only count parseable measure refs present in any snapshot's `measures`).
3. Implement `resolveCoverageForGame` (mint token → getMeta → snapshot → compute 3 outputs; fail-open).
4. Implement `resolveCoverageAllGames` over `loadGamesConfig().games`, building games[] + flattened matrix.

## Success criteria
- Unit test: synthetic /meta with `active_daily.wau` present but no metric → appears in `uncoveredMeasures`.
- Broken-ref output equals `validateRefs` output (parity test).
- Game with bad token → `status:'error'`, others still computed.

## Risks
- measure vs dimension: a metric ref could point at a dimension (rare). Treat "uncovered" as measures-only to avoid noise.
- All-games = N× `/meta` fetches (≤6) — acceptable; cache per call.
