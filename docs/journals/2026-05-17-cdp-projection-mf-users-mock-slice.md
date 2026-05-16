# CDP Projection + Verify on mf_users — mock slice landed

**Date:** 2026-05-17
**Branch:** `new_metric`
**Plan:** `plans/260517-1715-cdp-projection-verify-mf-users/plan.md`

## What shipped

End-to-end vertical from `/catalog` DetailPanel to a mocked `/cdp/v1/metrics/{game_id}/{metric_name}` round-trip, all behind a vite dev middleware. Per-measure expandable row inside `<DetailPanel>` reveals a `<CdpProjectionCard>` that previews the projected CDP `Metric` payload and runs verify on demand — green Available, amber Missing, red Mismatch w/ color-coded diff, red Error w/ Retry.

Mock-only this round — no real MM-01 proxy, no JWT, no POST from the wizard.

### Modules

- `src/pages/Catalog/cdp-projection/`
  - `types.ts` — `CdpMetricPayload`, `ProjectionResult`, `VerifyState`, `ProjectableCube/Measure`
  - `project-measure.ts` — pure mapper, branches: count / sum / count_distinct / count_distinct_approx / filtered / calculated→not-projectable / view→not-single-source / missing-meta
  - `cube-to-cdp-mapping.ts` — `mf_users → { bal_vn, iceberg.ballistar_vn.mf_users }`
  - `diff-equality.ts` — normalizes whitespace on `expression`, null filter, dimension sort; ignores `materialize/schedule/created_at/updated_at`
  - `api.ts` — `getMetric()` discriminated-union client, mirrors `NewMetric/api.ts`
  - `use-cdp-verify.ts` — `runIdRef` stale-token guard (pattern from `use-live-preview.ts`)
  - `cdp-projection-card.tsx` — payload preview + Verify button + badges + diff renderer
- `src/pages/Catalog/measure-row.tsx` + `detail-panel-measures.tsx` — DetailPanel split to keep parent ≤ 200 lines
- `src/pages/Catalog/use-catalog-meta.ts` — `CatalogCube.meta?` field added + client-side `mergeCdpMapping()`
- `vite-plugins/cdp-mock-middleware.ts` + `cdp-mock-handlers.ts` + `cdp-mock-seed.json` — MM-01-shaped envelope, 6 seed records (5 matches + 1 deliberate mismatch on `lifetime_recharge_amount_vnd`)

### Tests

295 across 27 files, all green. New coverage (≈ 60 cases):
- `project-measure.test.ts` (16) — every mapping branch
- `cdp-mock-middleware.test.ts` (18) — routes + envelope + drift guard
- `use-catalog-meta.test.ts` (3) — mapping merge precedence
- `measure-row.test.tsx` (11) — click + keyboard + aria
- `diff-equality.test.ts` (9), `use-cdp-verify.test.ts` (6), `cdp-projection-card.test.tsx` (8)
- `smoke.test.tsx` (1) — catalog → cube → row → verify → Available

`npx vite build` clean. Pre-existing `tsc` errors in `QueryBuilderV2/*` + `rollup-designer/utils.ts` were present on baseline (verified via stash swap) and were not introduced by this slice.

## Decisions worth remembering

- **No external Cube YAML edit** — `cube.meta.cdp_source` lives in a client-side map (`cube-to-cdp-mapping.ts`). Saved a cross-repo roundtrip and a Cube reload. Drift surfaces as a Mismatch badge, which is exactly the verify surface.
- **No 401 on the mock** — `Authorization` header is ignored. Real auth lands with the real proxy in a later plan.
- **Hide, don't disable** the Verify button on Not Projectable cards. `queryByRole('button', { name: /verify/i })` returns null — locked by test.
- **`assert { type: 'json' }` → `with { type: 'json' }`** for the seed import. esbuild warned and vite warns; the modern syntax keeps both happy and works in vitest 2.x + node 22.
- **detail-panel.tsx extraction** — the original file was 216 lines pre-slice. After adding the projection wiring it grew to 225. Extracted `<DetailPanelMeasures>` to land at 193. The 200-line ceiling is real and not negotiable on this codebase.

## Open / Deferred

- Real MM-01 proxy + JWT plumbing (replace the mock).
- POST from the wizard submit flow (slice 2).
- Extend `cube-to-cdp-mapping.ts` for `active_daily`, `user_recharge_daily`, `recharge`.
- Live-cube measure-name reconciliation: live `mf_users` cube wasn't reachable at implementation time; seed measure names (`user_count`, `total_revenue_vnd`, `distinct_country_count`, `approx_distinct_user_count`, `paying_user_count`, `lifetime_recharge_amount_vnd`) were chosen by the plan and the drift-guard round-trip test will fail loudly if real cube measures don't match — at which point swap seed names in one place.
- Pre-aggregation / materialization availability check on the CDP side — out of scope.
