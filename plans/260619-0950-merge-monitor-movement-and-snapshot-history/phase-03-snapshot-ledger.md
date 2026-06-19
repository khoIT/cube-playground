---
phase: 3
title: "Per-segment snapshot ledger"
status: done
priority: P2
effort: "0.5d"
dependencies: [2]
---

# Phase 3: Per-segment snapshot ledger

## Overview
The collapsible "Snapshot history" table under the coverage strip: every captured snapshot
for this segment — time (GMT+7), grain, member count, KPIs captured — newest first, grouped
by day. The per-segment answer to "all historic snapshots + which grain available".

## Requirements
- Functional: `GET /api/segments/:id/snapshot-ledger?from&to&days` returns rows
  `{ ts, grain, memberCount, kpiCount }` per captured `snapshot_ts`, descending. Grain =
  per-ts observed cadence (reuse the era classifier's per-day logic, but per-ts within day).
  UI: collapsible card, grain chips, day grouping, row hover → "view snapshot" stub.
- Non-functional: same bounded/serve-stale/tokenless posture as movement reads; redaction
  N/A (counts only, no sensitive dims).

## Architecture
- Reader `readSnapshotLedger` in `segment-movement-reader.ts`: one query over
  `SEGMENT_KPI_DAILY` — `GROUP BY snapshot_ts` → `MAX(member_count)` +
  `COUNT(DISTINCT metric_id)`; ts list also feeds grain. Grain per row derived client- or
  reader-side from the full ts set via the era timeline (a row's grain = its era's cadence,
  so the ledger and the strip agree). Prefer computing grain in the route (reuse
  `computeCaptureEras`, map each ts → containing era cadence).
- Route in `routes/segment-movement.ts` (same cache/stale pattern). Client method on
  `segmentMovementClient`. UI `tabs/monitor/snapshot-ledger-section.tsx` (collapsed by default).

## Related Code Files
- Modify: `server/src/lakehouse/segment-movement-reader.ts` (+`readSnapshotLedger`),
  `server/src/routes/segment-movement.ts` (+route), `src/api/segment-movement-client.ts` (+method/types)
- Create: `src/pages/Segments/detail/tabs/monitor/snapshot-ledger-section.tsx`,
  `server/test/...` ledger reader/route test
- Reuse: `computeCaptureEras` (ts→era→grain mapping), grain chip styling from strip

## Implementation Steps
1. `readSnapshotLedger` query (member_count + distinct metric count per ts).
2. Route: fetch ledger + captureEras, map each ts to its era cadence for `grain`, sort desc.
3. Client method + types; ledger section component (collapsible, day-grouped, grain chips).
4. Wire into MonitorTab below the strip (predicate+game only). Row → stub link-out.
5. Tests: reader SQL shape + route payload + grain-mapping; build green.

## Todo List
- [x] readSnapshotLedger reader + test
- [x] route + client method + types
- [x] snapshot-ledger-section.tsx (collapsible, grouped, chips)
- [x] grain mapping matches the strip eras — both derive from `computeCaptureEras`
      via the new pure `dayGrainMap`/`eraGrains` helpers (unit-tested for parity).
      Caveat: ledger reads its own daily-cap window, so era *boundaries* at the
      window edges may differ from the strip's downsample window — the per-day
      grain classification is identical (comments scoped accordingly).
- [x] suites + tsc green (106 server tests incl. ledger helpers + HTTP guards)

## Success Criteria
- [ ] Ledger lists captured snapshots desc with correct grain chips that AGREE with the strip
- [ ] member/KPI counts match the snapshot tables
- [ ] Collapsed by default; expands without layout jump

## Risk Assessment
- Ledger grain must match strip (single source: derive both from `computeCaptureEras`),
  else the two disagree and erode trust.
- Large windows → cap rows (reuse MAX_*_DAYS) + show "showing last N".

## Security Considerations
- Counts only; tokenless-safe. No member identities in the ledger.
