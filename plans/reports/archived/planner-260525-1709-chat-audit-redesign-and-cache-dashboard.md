# Planner Report — chat-audit redesign + cache effectiveness dashboard

**Plan:** `plans/260525-1709-chat-audit-redesign-and-cache-dashboard/`
**Date:** 2026-05-25
**Branch:** main

## Summary
6-phase plan to redesign `/dev/chat-audit` with top-tab IA (Sessions / Search / Leaderboard / Cache), unified mode-toggle search, leaderboard re-skin, and new cache-effectiveness dashboard backed by a new server-side data layer.

Design contract = `design/hifi-mockup.html` — single self-contained HTML, all 4 tabs in one scrollable page. Generated applying huashu-design methodology (Linear/Vercel/Stripe minimal evolved from existing T.* tokens; mono numerics; gradient accent ONLY on `$ saved` hero).

## Phases & Dependencies

```
Phase 01 (shell + routes) ─┬─► 02 (unified search) ─┐
                           ├─► 03 (leaderboard reskin) ─┼─► 06 (polish/cmd-K/a11y)
                           └─► 05 (cache UI) ◄──────────┘
Phase 04 (cache data layer) ──────────────────────────► 05
```

Parallelism: 01 and 04 can run concurrently (disjoint owners — FE shell vs backend store).

## LOC Estimate

| Phase | Files (new + modified)                                       | LOC est. |
|-------|--------------------------------------------------------------|----------|
| 01    | 2 new (`dev-audit-shell.tsx`, `audit-tabs.tsx`) + 2 modified | ~180     |
| 02    | 3 new (`unified-search-page.tsx`, `search-mode-chips.tsx`, `search-results-cached.tsx`) + 1 modified | ~260 |
| 03    | 1 new (`skill-trend-sparkline.tsx`) + 2 modified              | ~140     |
| 04    | 2 new (`cache-effectiveness-store.ts`, `debug-cache-effectiveness.ts`) + 4 modified | ~360 |
| 05    | 5 new (`cache-dashboard-page.tsx`, `cache-dashboard-hero.tsx`, `cache-dashboard-top-queries.tsx`, `use-cache-effectiveness.ts`, `cache-effectiveness-types.ts`) | ~330 |
| 06    | 4 new (`empty-state.tsx`, `loading-skeleton.tsx`, `use-keyboard-shortcuts.ts`, `stale-cache-banner.tsx`) + 5+ modified | ~140 |
| **Total** | ~17 new files, ~12 modified                              | **~1,410** |

All individual files target < 200 LOC. Constraint upheld.

## Risk Matrix

| # | Risk                                                                                           | Likelihood | Impact | Mitigation |
|---|------------------------------------------------------------------------------------------------|------------|--------|-----------|
| R1 | **`response_cache` lacks `cube_meta_hash` column** — only mixed into sha256 key. Spec's stale formula impossible as written. | Verified  | High   | Add column via idempotent ALTER (phase 04). NULL backfill = "legacy" bucket, not "stale". User must confirm deviation. |
| R2 | `$ saved` formula assumes hit cost ≈ miss cost. Real hit cost ≈ 0 → estimate slightly understates savings. | High       | Low (semantic) | Tooltip on hero stat documents the caveat. JSDoc on store function. |
| R3 | `currentMetaHash` derived from newest cache row, not from a live cube call (would require a cube token unavailable in the dashboard context). | Med        | Low    | Document as "latest observed". Acceptable proxy — staleness = drift within cache itself. |
| R4 | Owner-scoping bug — `response_cache` has no owner_id column. Easy to write a non-scoped query. | Med        | **HIGH (privacy)** | All store queries go through `cache-effectiveness-store.ts` which mandates `chat_sessions s ON s.id=t.session_id WHERE s.owner_id=?` join. Unit-test cross-owner isolation. |
| R5 | `q` LIKE parameter injection in cached-queries search.                                         | Low        | Med    | Parameterized binding only. Test with `'; DROP --` payload. |
| R6 | NULL handling in latency averages when `ended_at IS NULL` (in-flight or crashed turns).        | Med        | Low    | `WHERE ended_at IS NOT NULL` filter on latency sub-query. |
| R7 | Hit-rate denominator definition mismatch: spec = `role='assistant'`. If a turn is in-flight and `assistant_text` is null, it still counts in denominator → underrates hit rate. | Med        | Low    | Restrict denominator to `ended_at IS NOT NULL` AND `role='assistant'`. |
| R8 | RR5 `<Switch>` route ordering causes legacy `:sessionId` shim to shadow `/sessions/:sessionId?`. | Med        | High   | Phase 01 places `/sessions/...` before legacy `/:sessionId` in switch. Manual deep-link tests. |
| R9 | Sessions-mode search uses LIKE on title only — users expect content search.                    | High       | Med    | Inline hint under input + clear chip-mode label. Documented in phase 02. |
| R10 | `cmd-K` conflicts with Chrome's omnibox shortcut.                                              | Low        | Low    | `preventDefault()` inside app; widely-used pattern (Linear/Vercel/Notion). |
| R11 | Tab-state remount loses session-list scroll.                                                   | Low        | Med    | Switch on content area only; shell stays mounted. |
| R12 | `data-correctness`: `tokensSaved` = `(input_tokens+output_tokens)×(hits-1)`. If `input_tokens` was nullable when row was written, sum returns NULL not 0. | Med        | Low    | `COALESCE(input_tokens,0)+COALESCE(output_tokens,0)` in SQL. |
| R13 | Phase 04 ALTER TABLE on production DB during boot races a running query.                       | Low        | Low    | better-sqlite3 single-threaded per process; migrate runs before listener accepts. Idempotent (try/catch on duplicate column). |
| R14 | Stale-cache 25% banner threshold arbitrary — could spam users with normal schema churn.        | Med        | Low    | Configurable constant in code. **Open question to user.** |

## Backwards Compatibility

- Existing chat-service `/debug/*` endpoints unchanged (search, sessions, leaderboard, annotation, cache-clear).
- One additive column on `response_cache` (idempotent ALTER, NULL-safe). No schema break.
- Legacy URL `/dev/chat-audit/:sessionId?` → React Router `<Redirect>` to `/dev/chat-audit/sessions/:sessionId?`. Chat-thread-page link (`src/pages/Chat/chat-thread-page.tsx:267`) keeps working transparently.
- All existing chat-UI consumers unaffected — only the audit UI shape changes.

## Test Matrix

| Layer       | Unit | Integration | E2E manual |
|-------------|------|-------------|------------|
| Cache store | Yes — empty DB, NULL backfill, owner isolation, $/tokens/latency math | — | — |
| Cache plugin | Yes — 401/400/403/200 cases | — | — |
| Proxy route | — | smoke | — |
| Shell + tabs | — | — | deep-link to each route incl. legacy redirect |
| Unified search | — | — | switch modes, debounce, empty/loading states |
| Cache UI    | — | — | empty/loading/error states, sort, gradient render |
| cmd-K       | — | — | from each tab, focus assertion |

## Rollback Plan

Each phase rolls back independently:
- Phase 01: revert `src/index.tsx` + delete shell files → old single page restored.
- Phase 02: delete unified search files; phase 01 keeps a `legacy-search` empty tab OR temporarily route `/search` back to current banner.
- Phase 03: revert leaderboard files; API unaffected.
- Phase 04: drop new plugin registration; ALTER column persists harmlessly (no SQL touches it).
- Phase 05: delete dashboard files; tab shows EmptyState.
- Phase 06: feature-flag-free; revert files.

No phase touches schema destructively. No data loss possible.

## Open Questions (require user decision before phase 04 or 06 implementation)

1. **Stale-cache pressure formula deviation.** Spec says compute on demand without a new table; codebase reality requires adding a `cube_meta_hash` column to `response_cache` (one idempotent ALTER, NULL backfill safe). Plan proceeds with this addition. **Confirm OK?**
2. **`$ saved` cost-equivalence assumption.** Plan documents this as a tooltip on the hero stat. Want a more conservative formula (e.g. `cost_usd × 0.95 × (hits-1)`) or keep the simple Σ?
3. **Stale-cache banner threshold.** Phase 06 proposes 25% as the trigger. Some workloads with active schema churn run higher routinely. **What threshold reflects "alarming" for this team?** (Default = 25%, configurable in `stale-cache-banner.tsx`.)
4. **Cached-queries search → behavior on row click.** Mockup shows expand-inline; could also be: navigate to original turn (`/dev/chat-audit/sessions/<originalSessionId>#turn-<originalTurnId>`). **Which is preferred?** Phase 02 currently plans expand-inline; phase 05 top-queries table plans navigate.
5. **`cmd-K` vs `cmd-/`?** cmd-K is industry-standard but clashes with Chrome's omnibox-search shortcut on some platforms. **Acceptable to `preventDefault()` it within the app surface?**
6. **Sparkline data for leaderboard.** Phase 03 plan defers between (A) extending `leaderboard-store.ts` with `dailyCounts` array vs (B) ship without sparkline. Lean (A) since SQL cost is negligible. **Confirm (A)?**
7. **Game scoping default on Cache tab** — default to active game (matches leaderboard pattern) or default to "all games this owner has activity in"? Plan currently defaults to active game.

## Deliverables Checklist

- [x] `plan.md` (< 80 lines, phase index + dep graph + LOC + file ownership)
- [x] `design/hifi-mockup.html` (4 tabs in one scrollable page, anti-slop, T.* tokens 1:1)
- [x] `phase-01-route-refactor-and-top-tab-shell.md`
- [x] `phase-02-unified-search-with-mode-toggle.md`
- [x] `phase-03-leaderboard-reskin.md`
- [x] `phase-04-cache-effectiveness-data-layer.md`
- [x] `phase-05-cache-effectiveness-dashboard-ui.md`
- [x] `phase-06-polish-and-empty-states.md`
- [x] `plans/reports/planner-260525-1709-chat-audit-redesign-and-cache-dashboard.md`

**Status:** DONE_WITH_CONCERNS
**Summary:** 6-phase plan + hi-fi mockup delivered. 7 open questions; the most material is #1 (response_cache schema deviation — verified against migration files, no `cube_meta_hash` column exists, requires additive ALTER to deliver spec's stale-cache metric).
**Concerns/Blockers:** Open question #1 should be resolved before phase 04 starts; deviation is the cleanest path that preserves spec intent ("no new table") but does require user acknowledgement per review-audit-self-decision §3.
