---
phase: 1
title: cube-model-heatmap-dims
status: completed
effort: 1h work + deploy/restart latency
---

# Phase 1: Cube model — billing_detail heatmap dimensions

## Overview

**Priority:** P2 · **Status:** pending · **Gates:** heatmap chart ONLY (P4).

`billing_detail` has NO hour-of-day / day-of-week dimension. Add two number dims to
BOTH per-game YAMLs so the purchase hour×DOW heatmap can group cash by them. This is the
only backend change. **It does not block any other chart** — let the FE chain (P2–P6) run
in parallel; only the heatmap query/chart waits on this landing + deploy.

## Requirements

- Add `hour_of_day` and `day_of_week` number dims, derived from the order timestamp.
- Identical in cfm + jus (the heatmap query is game-agnostic except the VND filter).
- Do NOT alter existing dims/measures/joins.

## Data contract (verified 2026-06-14)

- Order timestamp source col: `order_created_datetime` (cfm `billing_detail.yml:36`,
  jus `billing_detail.yml:29`). The cube `sql` already does
  `CAST(b.order_created_datetime AS DATE) AS order_date` — but the heatmap needs the
  intra-day HOUR, so the new dims must derive from `order_created_datetime` (the full
  timestamp), NOT from `order_date` (date-only, hour always 0).
- **Implication:** the cube's inner `sql` SELECT currently projects only `order_date`
  (date-cast). To expose hour/DOW, the inner SELECT must ALSO project the raw
  `order_created_datetime` (or compute the extracts inline). Read the full `sql:` block
  in each YAML first and decide: (a) add `b.order_created_datetime AS order_ts` to the
  inner SELECT and have the dims `EXTRACT(... FROM {CUBE}.order_ts)`, or (b) compute
  `EXTRACT(HOUR FROM b.order_created_datetime) AS hour_of_day` directly in the inner
  SELECT and expose it as a passthrough number dim. Prefer (b) — keeps EXTRACT in Trino,
  dim sql is a bare column ref (matches the existing passthrough-dim style, e.g.
  `payment_gateway`). Confirm Trino `DOW` semantics: `EXTRACT(DOW FROM ts)` → 1=Mon..7=Sun
  (ISO). Label the heatmap axis accordingly in P4 (do not assume 0=Sun).

## Architecture / data flow

```
billing pipeline row (order_created_datetime)
  └─ inner SQL SELECT: EXTRACT(HOUR FROM order_created_datetime) AS hour_of_day,
                       EXTRACT(DOW  FROM order_created_datetime) AS day_of_week
       └─ dimension hour_of_day (number)  ─┐
       └─ dimension day_of_week (number)  ─┴─> heatmap query groups cash by [hour, dow]
```

No new measure — heatmap reuses `cash_charged_gross`. No join change.

## Related code files

- Modify: `cube-dev/cube/model/cubes/cfm/billing_detail.yml`
- Modify: `cube-dev/cube/model/cubes/jus/billing_detail.yml`
- (Read for ref only: `src/pages/OpsConsole/ops-overview-queries.ts` `vndFilter`)

## Implementation Steps

1. Read the full `sql:` block of cfm `billing_detail.yml` (around lines 33–45). Add to the
   inner SELECT: `EXTRACT(HOUR FROM b.order_created_datetime) AS hour_of_day,` and
   `EXTRACT(DOW FROM b.order_created_datetime) AS day_of_week,`.
2. Add two `dimensions:` entries (place near `order_date`/`currency`, before measures):
   ```yaml
   - name: hour_of_day
     sql: hour_of_day
     type: number
     description: Hour the order was created (0–23), for the purchase-timing heatmap.
   - name: day_of_week
     sql: day_of_week
     type: number
     description: ISO day-of-week of the order (1=Mon … 7=Sun), for the purchase-timing heatmap.
   ```
   Comment explains the *why* (heatmap timing) — NO phase/finding refs.
3. Repeat verbatim in jus `billing_detail.yml` (note its `sql:` block is around lines
   26–40; jus is mixed-currency — the dims themselves are currency-agnostic, the VND
   filter is applied at query time in P2).
4. Validate YAML syntax (no tabs, correct indent) — eyeball against neighbouring dims.
5. Do NOT deploy as part of this phase unless user asks. Document the deploy steps in
   Success Criteria for when the user ships.

## Todo

- [ ] cfm inner SQL projects hour_of_day + day_of_week from order_created_datetime
- [ ] cfm dims `hour_of_day`, `day_of_week` added (number, why-comment, no plan refs)
- [ ] jus inner SQL + dims added identically
- [ ] YAML lints/parses; existing dims/measures/joins untouched
- [ ] Deploy + restart steps documented for ship-time

## Success Criteria

- Both YAMLs parse; cube model compiles with the two new dims on `billing_detail`.
- **Post-deploy (ship-time, user-initiated):** dims deploy to BOTH dev AND prod cube
  registries, then the serving instance restarts (cube_api too, not only the worker —
  DEV_MODE=false = no hot reload). Verified by a `/load` probe with
  `dimensions:[billing_detail.hour_of_day, billing_detail.day_of_week]` returning rows
  (cfm), or by inspecting compiled SQL — NOT by assuming hot-reload.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Dims don't resolve at runtime (no hot reload) | HIGH | Heatmap empty | Deploy to both registries + restart cube_api; probe before declaring done. THIS IS THE PLAN'S TOP RISK. |
| `order_date` (date-only) used instead of `order_created_datetime` → hour always 0 | MED | Useless heatmap | Derive from the full timestamp col; verify a probe shows hour spread 0–23. |
| Trino DOW semantics assumed wrong (0=Sun vs 1=Mon) | MED | Mislabeled axis | EXTRACT(DOW) is ISO 1=Mon..7=Sun; P4 labels accordingly. |
| jus rollup/partition rebuild needed | LOW | Stale heatmap | billing_detail heatmap query is plain (no granularity); cold Trino scan acceptable. |

## Next Steps

Unblocks the heatmap path in P2 (query) and P4 (chart). All other phases proceed regardless.
