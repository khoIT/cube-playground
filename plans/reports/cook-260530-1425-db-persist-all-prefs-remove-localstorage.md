# DB-persist all prefs / remove localStorage as source of truth

Follow-up to `260527-1539-cube-workspace-switching` (Phase 2/3/4 partial gaps). Goal: workspace switching fully working; everything off localStorage → DB, except session credential.

## Outcome
All user data + view-state now DB-authoritative (per owner, per workspace where relevant), with a synchronous localStorage **write-through mirror** so existing sync readers (header injection, first paint) are untouched. DB wins on boot; legacy local values one-time-imported.

## Architecture
- `server/src/routes/user-prefs.ts` — per-owner kv. Added DELETE; bumped value cap 2048→200k (draft blobs). `/api/cube-aliases` (per owner+workspace) already existed.
- `src/hooks/server-prefs-store.ts` (NEW) — `getPref/setPref/removePref/subscribe` (sync, cache→mirror + async PUT/DELETE), `hydrateServerPrefs()` (server-wins + import scan over `gds-cube:*` and `compass:prefs:*`), cross-tab `storage` sync, `__resetPrefsCacheForTests`.
- `src/hooks/use-server-pref.ts` (NEW) — `useServerPref` (drop-in for `useLocalStorage`) + `useServerPrefsBootstrap`. Mounted in `App.tsx` (`<ServerPrefsBootstrap/>`, keyed on auth user id).

## Migrated
- **Data:** cube aliases (workspace-scoped, one-time import + reload on switch), active workspace, active game, new-metric draft, wizard pending-commits, saved-views, subscriptions, glossary editor-name, chat-service settings.
- **View-state (14 files via subagent):** qb view-mode, filter-strip, chart-pane, sidebar-display-config, segment card-collapsed, hidden games/nav, chat-panel open/width, sidebar collapsed/section, recent-items, theme, view-mode-store, filter-bar-collapsed; + i18n lang (languageChanged→setPref), playground-store (zustand createJSONStorage adapter), new-metric right-rail width.
- **Legacy core:** both `useLocalStorage` impls (`src/hooks`, `src/QueryBuilderV2/hooks`) now delegate to the store → captures all remaining + future consumers.

## Kept on localStorage (intentional)
- Session credential: `gds-cube:app-jwt`, `gds-cube:token` (auth the prefs request — circular). Identity: `gds-cube:owner`.
- Per-tab id `gds-cube:new-metric-tab-id`; cross-tab event-bus `*-change`/`*-changed` keys (throwaway signals).
- Device-local infra: `playground_anonymous` (anon telemetry id), `lastLocationReload` (reload-loop guard).
- Workspace/game **mirror reads** in `use-new-metric-meta`, `query-builder`, `cube-api-factory` (read the mirror the store maintains — correct sync path).

## Verification
- Server: `tsc` 0 errors; **391 tests pass** (added `test/user-prefs-and-aliases-route.test.ts` — per-owner + per-workspace isolation, DELETE, large blob).
- Frontend: `tsc` 71 errors = unchanged pre-existing baseline, 0 in touched files; **1445 tests pass** (161 files).
- Test-isolation gotcha (cache outlives `localStorage.clear()`) fixed systemically via `src/test-setup.ts` global `beforeEach` cache reset; recorded in `docs/lessons-learned.md`.

## Plan status corrected
`260527-1539` plan.md: Phase 4 → ✅ Complete; Phase 2/3 → ✅ Complete (meta-client consolidation + GamePicker hard-disabled-state remain explicit cosmetic/DRY deferrals).

## Unresolved questions
1. Meta-client consolidation (3 independent loaders) still deferred to `260527-1306-glossary-resolver-consolidation` — functional (all send header), DRY-only. Confirm that's acceptable.
2. High-frequency view-state writes (panel drag) now fire async PUTs on commit (drag-end), not per pixel — fine today; if a future consumer writes per-frame, add per-key PUT debounce in the store.
3. Non-`gds-cube:`/`compass:prefs:` keys (`new-metric-page:right-rail-width`, `chat-service.settings`) persist going-forward but pre-existing local values aren't back-imported (not in import-scan prefixes). Acceptable; widen scan prefixes if back-import matters.
