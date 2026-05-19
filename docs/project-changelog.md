# Changelog

Significant changes to the cube-playground app, newest first.

## 2026-05-19 (later)

### Added — Segments workspace P2–P8 (FE shell, identity-map, presets, editor, cron, round-trip, drift)

- **P2 — FE shell + push modal + library + sample users**
  - `/segments` route (Library list / Detail / `/segments/new` / `/segments/:id/edit` / `/segments/identity-map`).
  - `Segments` NavPill in `Header.tsx` (desktop + mobile menu); i18n strings in `en.json` / `vi.json`.
  - `SegmentsSaveBar` in `QueryBuilderResults` footer: when the executed query contains a mapped identity dim, surface "Save N user_ids as segment" → opens `PushModal` (create new / append to existing).
  - Library: KPI tiles (live / static / total uids / in-use), search + type filter + sort, segment row with `LiveBadge` / status pill / owner. Pure helper `filterAndSortSegments` covered by 7 unit tests.
  - Detail shell: breadcrumb + headline KPI strip + tab strip (Overview / Engagement / Monetization / Retention / Sample users / Saved analyses / Predicate). `SampleUsersTab` does deterministic seeded reshuffle + page + Export-all CSV.
  - Shared FE plumbing: `src/api/api-client.ts` (X-Owner header + typed errors), `src/api/segments-client.ts`, `src/hooks/use-identity-map.ts`, `src/hooks/use-segment-selection.ts`, `src/types/segment-api.ts`.

- **P3 — Settings identity mapping + auto-suggest + Import IDs**
  - `server/services/identity-suggester.ts` — auto-suggests `*.user_id / .uid / .customer_id / .player_id / .account_id` from `/meta`; confidence ranked.
  - Extended `routes/identity-map.ts` GET to merge persisted overrides with auto-suggestions (`source: 'manual' | 'auto-suggest'`, `is_suggested`). DELETE reverts to auto-suggest.
  - `server/services/csv-importer.ts` — streamed parse, BOM strip, CRLF normalise, dedupe, hard `MAX_ROWS=5000` cap, rejects non-printable + null-bytes.
  - `POST /api/segments/import-ids` — JSON body `{ name, cube, csv, tags? }` → static segment. Identity-dim mapping is enforced (400 with `IDENTITY_DIM_MISSING` code if absent).
  - FE: `/segments/identity-map` route (list every cube, set/reset identity field); `ImportIdsModal` wired to Library `Import IDs` button with client-side file preview.
  - 14 new server tests (`identity-suggester.test.ts`, `csv-importer.test.ts`).

- **P4 — Preset infrastructure + `mf_users-hub` preset tabs**
  - Schema-agnostic preset format under `src/pages/Segments/presets/`: `types.ts`, `registry.ts`, `mf-users-hub.ts`. Each preset declares `hubCube`, `identityDim`, `headlineKpis: KpiSpec[]`, `tabs: TabDef[]` with `kind: 'line' | 'bar' | 'donut' | 'composition'`.
  - Card primitives in `src/pages/Segments/detail/cards/`: `kpi-card.tsx`, `line-chart-card.tsx`, `bar-list-card.tsx`, `donut-card.tsx`, `composition-card-component.tsx`, plus a shared `card-shell.tsx` and `format-value.ts`. All chart cards reuse the P0 visual primitives.
  - `use-segment-cube-query.ts` injects `{ member: identityDim, operator: 'equals', values: uids }` into the request, caches results for 10 min, throttles to 3 concurrent calls. Empty-state when no cubejsApi token.
  - `usePreset(segment)` resolves `preset_id` (or falls back to `hubCube` match). Headline KPI strip + 4 analytics tabs in `detail-view.tsx` now render from the preset when available.

- **P5 — Visual predicate editor + live preview + SQL preview**
  - Backend: `services/preview-service.ts` translates a predicate tree to a Cube query (`{ measures: ['<cube>.count'], filters, limit: 1 }`), fires `/load` + `/sql` in parallel via `Promise.allSettled`, returns `{ estimated_count, cube_query, sql_preview, took_ms, cached }`. Cache TTL 60s keyed by `sha256(tree + cube)`. New route `POST /api/preview`.
  - FE: `src/pages/Segments/editor/` — `editor-view.tsx`, `identity-card.tsx`, `refresh-behaviour-card.tsx`, `predicate-builder/{predicate-group, predicate-leaf, value-input, operators}.tsx`, `right-rail/{resolved-cohort-card, sql-preview-card}.tsx`, hooks `use-predicate-state.ts` (immutable tree ops + `isTreeValid`) and `use-preview.ts` (500 ms debounce + AbortController + 14-entry ring buffer for sparkline).
  - `Edit predicate` button in detail header now routes to `/segments/:id/edit`. `New segment` button in Library toolbar routes to `/segments/new`. 11 new state-hook tests + 3 preview-service tests.

- **P6 — Cron worker + live mode + FE polling + status transitions**
  - `server/services/segment-status.ts` — single helper for atomic `(status, broken_reason, updated_at)` writes plus `setSegmentUids` that also flips status to `fresh` and clears `broken_reason`.
  - `server/jobs/refresh-segment.ts` — drift-aware refresh: looks up identity field, calls `cube-client.load` with a per-segment 60 s timeout, dedupes uids by identity column, writes via `setSegmentUids`. Cube failures or missing identity mapping → `broken` with a descriptive reason.
  - `server/jobs/refresh-queue.ts` — FIFO single-drain queue (`processing` flag prevents overlapping ticks).
  - `server/jobs/cron-runner.ts` — `setInterval` every 60 s (immediate first tick); `listDueSegments` selects predicate segments whose `last_refreshed_at` aged past `refresh_cadence_min * 60_000`; gated on `NODE_ENV !== 'test'` at boot.
  - `POST /api/segments/:id/refresh` now enqueues + returns 202 with `{ status: 'refreshing' }`; rejects manual refresh on static segments with `NOT_LIVE`.
  - FE: `use-segment-live-polling.ts` (30 s, pauses while `document.hidden`); shared `StatusPill` component (fresh / refreshing / stale / broken w/ tooltip); `RefreshNowButton` (optimistic spin → next poll reveals end state); `BrokenSegmentBanner` with "Edit predicate to fix" CTA.
  - Library row renders the status pill next to the type badge; Detail header renders it next to the cube badge + LiveBadge.

- **P7 — Saved analyses tab + Copy as filter**
  - `src/utils/playground-deeplink.ts` — builds `#/build?query=…` URL. Falls back to `sessionStorage('gds-cube:pending-deeplink:<id>')` + `?from-segment=<id>` when encoded query > 8 000 chars. 5 unit tests.
  - `SavedAnalysesTab` lists per-segment analyses from the existing `/api/segments/:id/analyses` route, with `Open in Playground` (deeplink + uid filter applied on top of the saved query) and per-card delete via Popconfirm.
  - `Copy as filter` button in Detail header opens Playground with the segment's uid IN-filter pre-applied (uses `defaultBaseQuery(segment.cube)` when no base query is in flight).

- **P8 — Drift detection, schema, docs**
  - New migration `002-drift-tracking.sql` adds `segments.predicate_meta_version` + `segment_analyses.query_meta_version` columns.
  - `server/services/drift-resolver.ts` compares the segment's stored meta-version against the live `/meta` hash; re-translates the predicate tree against current `/meta` if drift detected; surfaces missing members so the cron path can mark the segment `broken` with `Schema drift — missing members: …`.
  - `refresh-segment.ts` now calls `resolveDrift` before `/load`; on successful rehydrate it persists the new `cube_query_json` + `predicate_meta_version` atomically before the load runs.
  - 3 drift-resolver tests cover no-drift / rehydrate / broken-member paths.

### Totals
- **Server tests:** 23 → 50 (added: identity-suggester ×4, csv-importer ×11, preview-service ×3, refresh-segment ×3, drift-resolver ×3, mergeIdentityRows ×3).
- **FE tests:** 32 → ~70 (added: library-filter-sort ×7, selection-summary ×4, preset registry ×6, segment-scope helper ×3, predicate-state ×11, playground-deeplink ×5).
- **Routes added:** `/api/preview`, `/api/segments/import-ids`, `/api/identity-map (merged GET + DELETE)`, `/api/settings/identity-map` alias.
- See `plans/260519-1610-query-results-to-segments/` for full plan and per-phase notes.

### Changed — Segments server port moved from `:3001` → `:3002`

- `:3001` collided with a local hermes catalog-api dev process. `server/src/index.ts` PORT default + `vite.config.ts` `/api` proxy target both moved to `:3002`. Override with the `PORT` env var if needed.

## 2026-05-19

### Added — Segments workspace foundation (P0 partial + P1 done)

- **New backend** under `server/` — Fastify + better-sqlite3 process listening on `:3001` with CRUD for `segments`, `segment_analyses`, `cube_identity_map`, `presets`; tree↔CubeQuery translator (all ops); `X-Owner` pretend-auth middleware; meta-version cache; dev-only `__fixtures__` seed endpoint. 23/23 unit tests green. Wired via Vite proxy `/api → :3001`; combined dev via `npm run dev:all`.
- **Design-system port (partial)** — 26 mock tokens added to `src/theme/tokens.css`; `--radius-pill` corrected from `8px` to `9999px`; 14 segment visual primitives + 4 chart wrappers (LineChart / BarList / Donut / Sparkline) landed under `src/pages/Segments/visuals/` with 32 Vitest tests.
- **Visual regression scaffold** — mock vendored to `tests/visual/mock-fork/`; Playwright config + `screens.spec.ts` + `playground-polish.spec.ts` + `capture-baselines.ts` scaffolded; `test:visual` / `visual:capture-baselines` scripts wired. Baseline PNG capture, CI gate, and existing-screen polish pass remain to be done.
- See `plans/260519-1610-query-results-to-segments/` for full plan; phase-00 status now Partial, phase-01 Done.

## 2026-05-17

### Added — New Metric: multi-source selection + N-slot inputs (Ratio cross-cube)

- `NewMetricDraft` migrated from `(sourceCube, ofMember, ofMemberB)` to the
  canonical multi-source / N-slot shape `(sourceCubes[], inputs{})`. Legacy
  fields kept in lock-step by the reducer so the dialog flow keeps working.
- `OperationDef.inputs: InputSlot[]` + `OperationDef.minSources: number`
  replace the old single `OperationAccepts` field. Ratio declares two numeric
  slots (`numerator`, `denominator`) and `minSources: 2`.
- **Step 1** now supports multi-select with a "Primary" badge and a
  "Make primary" affordance on selected non-primary cards.
- **Step 2** gates each operation card on `minSources` vs the current source
  count. Clicking a locked card snaps back to Step 1 with a brief pulse on
  the source toolbar.
- **Step 3** renders one slot-picker grid per `op.inputs[]` entry. Cross-cube
  measures are eligible when their cube is in `sourceCubes` and joinable.
- **YAML emitter** now produces `{cubeA}.x / NULLIF({cubeB}.y, 0)` for
  cross-cube ratio; same-cube ratio output is byte-identical to before.
- Validator drops the cross-cube ratio ban; new error keyed by `inputs.<slotId>`
  when a required slot is empty.

## 2026-05-16 and earlier

See `git log` for full history. Highlights:
- Full-page New Metric wizard rebuild (`/metrics/new?v=2`), 6-step flow.
- CDP projection + Catalog UI iterations.
- New Metric polish: shell layout, compact operation pills, live auto-name.
