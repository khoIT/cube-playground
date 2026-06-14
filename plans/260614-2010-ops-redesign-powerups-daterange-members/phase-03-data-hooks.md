---
phase: 3
title: data-hooks
status: completed
effort: 1.5h
---

# Phase 3: Data hook — fetch + shape the new series

## Overview

**Priority:** P2 · **Status:** pending · **Depends on:** P2 (builders). **Coupled with P5**
(window signature — see below).

Extend `use-ops-overview.ts` to fetch the new queries via the existing `useMemberCubeQuery`
pattern, shape them into series, and expose the exact `Query` objects for OpenInPlayground
deeplinks. Cross-cube date joins (ARPPU/conversion) happen here, client-side.

## Window signature decision (resolves P3↔P5 coupling)

Today: `useOpsOverview(gameId, window: OpsWindow)` and internally
`opsWindowRanges(window, today)`. P5 changes `OpsWindow` to include `'custom'` and adds a
separate `OpsRange` for custom. **Contract:** the hook signature becomes
`useOpsOverview(gameId, window: OpsWindow, customRange?: OpsRange)`. Internally:
`const ranges = window === 'custom' ? { current: customRange!, prior: null } : opsWindowRanges(window, today)`.
Δ-vs-prior stays null for custom (like 30d/MTD). **P5 lands the `OpsWindow` type change +
this signature; P3 builds against the agreed signature.** If P3 runs first, it adds the
optional `customRange?` param defensively (ignored until P5 wires it).

## New data shape (extend `OpsOverviewData`)

```ts
// day-keyed series (aligned by date, client-joined):
spendDaily: { date: string; spend: number }[];
dauDaily:   { date: string; dau: number }[];
csDaily:    { date: string; tickets: number; negative: number }[];
// derived per-date (computed in the hook from existing daily + new series):
arppuConversionDaily: { date: string; arppu: number | null; conversionPct: number | null }[];
// snapshot:
payerTiers: { tier: string; count: number; ltv: number; ltvPct: number }[];
// heatmap grid (empty until P1 deploys):
heatmap: { hour: number; dow: number; cash: number }[];
// expose new queries for deeplinks:
queries: { daily; gatewayTrend; spend; dau; cs; heatmap; payerTiers };
```

## Derivations (client-side, KISS)

- **ARPPU** = `daily[date].cash / daily[date].payers` (both already in `daily`; null if payers=0).
  No new measure — per data contract.
- **Conversion %** = `daily[date].payers / dauDaily[date].dau` (join by date; null if dau=0 or
  date missing). dau comes from the separate `active_daily` query.
- **Spend-vs-cash dual** = `spendDaily` joined to existing `daily.cash` by date.
- **Payer-tier %** = each tier's `ltv / Σ ltv`. Tier labels whale/dolphin/minnow/non_payer
  come straight from the `payer_tier` dim (no client relabeling).
- **CS volume+sentiment** = `csDaily` (two series: tickets + negative).

Build a `Map<date, …>` for each series and join on the union of dates (use `daily`'s dates
as the spine for spend/arppu/conversion; cs has its own ~2d-lagged dates → keep its own
spine, tag lag in UI).

## Concurrency note

`useMemberCubeQuery` shares a bounded semaphore (verified — hook comment line 9). Adding ~5
more queries raises concurrent load; they queue, not stampede. Acceptable. Keep each query
behind its own `useMemberCubeQuery` call (consistent with existing 9).

## Related code files

- Modify: `src/pages/OpsConsole/use-ops-overview.ts` (currently 257 LOC — will cross 200;
  **modularize**: extract the new series fetching+shaping into a sibling hook
  `use-ops-trends.ts` that `useOpsOverview` composes, OR split shaping helpers into
  `ops-overview-shape.ts`. Decide at implementation; prefer the sibling-hook split so each
  file stays focused and <200 LOC).

## Implementation Steps

1. Import the 6 new builders from P2.
2. Add the new queries to the memoised `q` object; call `useMemberCubeQuery` for each.
3. Shape day-keyed series (slice date to 10 chars like existing `M.day` handling — note each
   cube's day key is `<cube>.<timeDim>.day`, e.g. `marketing_cost.log_date.day`,
   `active_daily.log_date.day`, `cs_ticket_detail.created_date.day`).
4. Compute `arppuConversionDaily`, `payerTiers` (with `ltvPct`), `heatmap` grid.
5. Extend `loading`/`error` booleans to OR-in the new queries.
6. Extend `queries: {...}` with the new Query objects for deeplinks.
7. Add new query keys to the `useMemo` dependency array (match existing pattern, lines 246–256).
8. If file > 200 LOC, modularize per Related Code Files.

## Todo

- [ ] new builders imported + 6 useMemberCubeQuery calls added
- [ ] spendDaily / dauDaily / csDaily / payerTiers / heatmap shaped
- [ ] arppu + conversion derived client-side (null-safe joins by date)
- [ ] loading/error OR-in new queries; queries{} exposes new deeplink queries
- [ ] useMemo deps updated; signature carries optional customRange (P5 contract)
- [ ] file modularized if >200 LOC

## Success Criteria

- Hook returns all new series correctly shaped; existing Overview data unchanged.
- ARPPU/conversion null-safe (no NaN/Infinity on zero payers/dau or missing dates).
- Heatmap array empty (not error) when P1 dims not yet deployed.
- tsc clean.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| date-key mismatch across cubes breaks join | MED | Empty ARPPU/conversion | Normalize all keys to YYYY-MM-DD slice; spine on `daily` dates; null when absent. |
| div-by-zero NaN in ARPPU/conversion | MED | Chart breaks | Guard: payers/dau === 0 → null; renderer skips nulls. |
| extra queries overload Cube | LOW | Slow load | Shared semaphore queues; acceptable. |
| signature drift vs P5 | MED | Build break | Agreed contract above; land P5 type first or add optional param defensively. |

## Next Steps

P4 reads this shaped data to build chart artifacts + the redesigned grid.
