# Open in Playground: auto-run + reliable re-open

Status: in progress. Single-phase (small surface, ~4 files + tests).

## Requirements (user-confirmed)

1. **Auto-run**: a query arriving in `#/build` via ANY deeplink (`?query=`, `?from-chat-artifact=`, `?from-segment=`) runs automatically once meta loads — no manual Run press. (User chose: all deeplinks, not chat-only.)
2. **Re-open**: clicking "Open in Playground" again on the same chat artifact must always land on that query:
   - original tab still open with exact query → focus it **and re-run** (user chose focus+re-run)
   - tab closed / query edited → open a fresh tab with the artifact's query
   - NEVER delete or overwrite an existing tab; never land on the wrong query.

## Root causes found (scout)

- `QueryTabsRenderer` (`QueryBuilderContainer.tsx`) consumes `?from-chat-artifact=` once per artifact id (`processedArtifactRef`); second click with same id is ignored.
- `QueryTabs.tsx` applies a URL query once per query-JSON (`lastAppliedQueryKey`); same query arriving again is ignored even if its tab was closed.
- `QueryBuilderV2` already has `shouldRunDefaultQuery` (boolean, unused) — but a boolean can't express "run again on repeat click"; need a changing trigger value.
- App uses `createHashHistory` → `location.key` unusable as navigation identity → use explicit `n=<nonce>` URL param.

## Changes

1. `src/pages/Chat/components/query-artifact-card.tsx`
   - `handleOpen`: always (re)write the sessionStorage payload for session-storage artifacts (already does); append `&n=<Date.now().toString(36)>` to the pushed path so every click is a distinct navigation.
2. `src/components/PlaygroundQueryBuilder/QueryBuilderContainer.tsx` (QueryTabsRenderer)
   - Read `n` param → `navNonce` (may be null).
   - Key the consume guards on `<id>:<navNonce>` for chat-artifact / from-segment / edit-segment blocks, so a fresh nonce re-consumes (card re-wrote the payload before pushing). No nonce → behaves exactly as today (no regression for anchor-based callers).
   - Track which query was deeplink-applied this navigation (`autoRunRef = {trigger, queryJson}`; `trigger = navNonce ?? queryJson`).
   - Track active tab id via existing `onTabChange`.
   - In the tab children render: if the tab is active and its query deep-equals the deeplink query → pass `autoRunTrigger={trigger}` to `QueryBuilder`.
   - Preserve `n` in the normalize `history.replace` (or drop it — replace happens only for `?query=` paths; dropping `n` there is fine since the query was already applied; keep code simple: drop).
3. `src/components/QueryTabs/QueryTabs.tsx`
   - New optional prop `applyNonce?: string | null`; fold into `lastAppliedQueryKey` (`${nonce}|${json}`) so a repeat click re-enters the apply branch. Existing branch already: exact-match tab → re-activate, else append new tab. No delete paths touched.
4. `src/QueryBuilderV2/types.ts` + `QueryBuilder.tsx`
   - New optional prop `autoRunTrigger?: string | null`. Effect: when `(autoRunTrigger, meta)` both present → `void runQuery()`. Distinct trigger values re-fire (repeat click re-runs); editing the tab query breaks the deep-equal match upstream so no spurious runs.

## Acceptance criteria

- Click chat "Open in Playground" → lands in /build, query executes without pressing Run (results or loading state visible).
- Same for segment "Open in Playground" and any `#/build?query=` deeplink.
- Close the tab in /build, click "Open in Playground" again (panel or main chat) → query opens in a tab and runs.
- Keep the tab open, click again → existing tab focused, query re-runs; no duplicate tab.
- Edit the tab's query, click again → NEW tab with the artifact query; edited tab untouched.
- No tab is ever auto-closed/overwritten; plain `/build` visits (no deeplink) auto-run nothing.

## Out of scope

- chat-service (sibling app) deeplink emission — unchanged.
- `?cube=`/Try-It hash param path (no full query to run).
- Raw `<a href>` callers gaining repeat-click support (no nonce → status quo).

## Risks

- Auto-run on heavy segment member queries (limit 100) — accepted by user decision "all deeplinks".
- Strict-mode double render double-run: guard via effect deps (trigger,meta) — same values, fires once.
- Multiple tabs with identical query (legacy duplicates): only the ACTIVE matching tab receives the trigger.

## Test plan

- `query-artifact-card.test.tsx`: pushed URL carries `n=`; payload rewritten each click.
- New `QueryTabs` apply-nonce tests: closed-tab reopen, open-tab reactivate, no-nonce regression.
- Type-check FE; run existing FE test suite (vitest) for touched areas.
