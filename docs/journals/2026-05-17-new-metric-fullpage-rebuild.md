# New Metric Wizard v2 — Full-Page Rebuild Complete (6-Step Flow)

**Date**: 2026-05-17 14:30
**Severity**: Medium
**Component**: Query Builder → New Metric wizard (full-page route `/metrics/new`)
**Status**: Shipped (v2 flag-gated; v1 still resident)

## What Happened

Completed the full-page New Metric wizard rebuild as a parallel v2 flow. The wizard operates outside the QueryBuilder context and guides users through six steps: source cube selection, operation choice, column + stats, filters (recursive AND/OR groups), identity metadata (name/title/grain/visibility/tags), and success confirmation. Real schema writes work end-to-end with auto-rollback on warnings. Mid-session pivot: moved the v1 dialog into Settings dropdown and put the New Metric button next to Settings in the tab-bar.

## The Brutal Truth

This was a lot of moving parts stitched together in one session. The worst part: we're shipping with the v1 dialog still resident in the codebase (inside `QueryStatePillBar`), spawned via a cross-boundary `window` event listener because Settings dropdown lives outside QueryBuilder context. That's a band-aid, not a solution. The deletion sweep and full UI deduplication got cut for time, and future sessions will have to yank out the legacy code while the v2 route is still in `?v=2` experimental mode. The tech debt is intentional but it stings — we chose scope over cleanup.

On the positive side: the concurrency pattern (`runIdRef` + in-memory LRU cache) prevented column stats from race-condition hell, and the YAML preview without `dangerouslySetInnerHTML` (red-team finding #21) forced us into a clean token-coloring approach using React text nodes. That one turned out better than the original design.

## Technical Details

**Filter-tree layer** (`src/QueryBuilderV2/NewMetric/filter-tree/`): 29 tests, type-aware SQL quoting, control-byte reject, IN-list parenthesization. Zero `innerHTML`.

**YAML generation** (`yaml/generate-measure-yaml.ts`): New `generateV2()` emits filter-tree → single SQL fragment, relaxed `OPERATION_TYPE` to `Partial<Record<Operation, string>>` so v1 emitter still typechecks. Median/percentile use `PERCENTILE_CONT`.

**Draft persistence** (`hooks/use-new-metric-draft.ts`): Tab-scoped localStorage (`gds-cube:new-metric-draft-v2:<tabId>`), `BroadcastChannel` sync, beforeunload + visibilitychange flush, sanitiser on hydration. 7 new tests, 38 existing still pass.

**Bootstrap without context** (`hooks/use-new-metric-meta.ts`): The wizard route is mounted outside QueryBuilder. Uses its own `CubeApi` instance, fetches `/meta?extended=true` directly. Workaround for red-team finding #5.

**Concurrency guard**: `runIdRef` token (not AbortController — Cube SDK 1.6.46 `load()` doesn't accept AbortSignal). Matches existing pattern in `use-live-preview.ts:75-114`. In-memory LRU cache capped at 50 entries.

**Origin allowlist** (`vite-plugins/schema-write-handler.ts`): Added 403 gate for cross-origin writes, env-overridable via `SCHEMA_WRITE_ALLOWED_ORIGINS`.

**Schema write flow**: Real `postSchemaWrite` with `meta-not-acknowledged` warning → auto-rollback via `deleteSchemaWrite` + amber toast. On success → RR5 history push to success page. No 504 handling (server never returns 504).

**Button rearrangement**: `NewMetricButton.tsx` now pure RR5 link. Moved from `QueryStatePillBar.HeaderLeft` to `QueryBuilderContainer` tab-bar (next to Settings). Legacy dialog spawned via `window` event (`open-legacy-new-metric-dialog`) — ugly but isolated.

TypeScript errors: baseline 42 → 42 (zero new). Tests: 215 → 223 (+8 net). Build: 16.5–19.9 s clean.

## What We Tried

1. **Custom SQL operation** — dropped per red-team finding #24. Client-side deny-list was theater; no server-side parser exists and no reviewer flow was designed.
2. **Inline histogram + sparkline** — deferred. Right-rail shows KPI + DQ rows + samples instead.
3. **Cohort funnel hook** — deferred. Right-rail is a placeholder.
4. **Write-then-load-then-discard preview** — deferred. Real write happens on submit only.
5. **Legacy dialog deletion** — cut for scope. The `LegacyNewMetricDialogMount` window-event workaround keeps it alive for now.

## Root Cause Analysis

**Why Custom SQL was dropped:** The red-team correctly identified that without a server-side parser and a formal reviewer flow, a client-side deny-list gives false confidence. We chose to remove the footgun entirely rather than ship a lie. Good call.

**Why the wizard is outside QueryBuilder context:** The `/metrics/new` route lives in the top-level HashRouter, not nested inside `<QueryBuilderProvider>`. This means anything that calls `useQueryBuilderContext()` breaks. We built a parallel bootstrap path (`useNewMetricMeta`), but it's a one-off — future features will hit this same cliff.

**Why we kept the v1 dialog resident:** Deleting it required swapping out its mounted position (inside `QueryStatePillBar` which has context) and moving Settings entirely. That's a bigger refactor. We chose to unblock the PR instead and document the debt.

## Lessons Learned

1. **Concurrency guards over AbortSignal:** `runIdRef` works where AbortSignal doesn't. Document this pattern in code comments — future devs will assume AbortSignal is the default and get confused.

2. **React text nodes > dangerouslySetInnerHTML:** Token-coloured YAML previews are possible without HTML injection. The colored `<span>` approach is cleaner and passes security review. Use this as the canonical pattern.

3. **Context-less routes are expensive:** Bootstrapping hooks outside their provider (e.g., `useNewMetricMeta`) feels harmless until you realize it's a one-off. If we're adding more context-free routes, consider a global bootstrap API instead of repeating this pattern.

4. **Window events for cross-boundary communication are bad UX for code:** The `window.open-legacy-new-metric-dialog` event works but it's invisible to static analysis and hard to debug. Document the boundary clearly. Better: refactor Settings dropdown into its own context provider.

5. **Scope cuts must be documented in the code, not just the journal:** We deferred 4 features (histogram, sparkline, cohort funnel, preview cycle). Put TODOs in the right files so future PRs know what's missing.

## Next Steps

1. **Delete v1 dialog** (separate PR): Remove `LegacyNewMetricDialogMount`, delete the window event listener, clean up Settings menu item.
2. **Stabilize v2 route** (after stakeholder approval): Remove `?v=2` flag gate, set as default, deprecate v1 route.
3. **Resolve TS errors** (backlog): The baseline 42 errors predate this work — fix in a cleanup pass.
4. **Activate deferred features** (post-MVP): histogram, sparkline, cohort funnel, write-then-load preview.

**Owner**: khoi (this session); review chain: code-reviewer → docs-manager (if docs impact detected).
