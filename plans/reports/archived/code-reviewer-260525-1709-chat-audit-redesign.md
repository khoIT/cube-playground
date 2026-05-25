# Code Review — chat-audit redesign (6 phases)

**Date:** 2026-05-25
**Reviewer:** code-reviewer
**Scope:** Phase 01–06 of /dev/chat-audit redesign + cache-effectiveness dashboard
**Plan:** plans/260525-1709-chat-audit-redesign-and-cache-dashboard/plan.md
**Confidence:** 6.5/10 — owner-isolation verified safe, but **two critical FE/BE contract mismatches will break the cache dashboard in production**.

## Critical Issues (must fix — blocks ship)

### C1. FE/BE shape mismatch on `staleRatio` — dashboard will render "133%" stale
- **Files:** src/api/cache-effectiveness-types.ts:39 + cache-dashboard-hero.tsx:158 + cache-stale-banner.tsx:104
- **Problem:** BE returns `staleRatio: { stale: number; typed: number; legacy: number }` (raw COUNTS — see chat-service/src/db/cache-effectiveness-queries.ts:229 and cache-effectiveness-store.ts:53-57). FE type declares `staleRatio: number | Record<string, number>` and `resolveStaleRatio()` averages `Object.values(raw)` over `vals.length` → for a typical row `{stale:1, typed:2, legacy:1}` it computes `(1+2+1)/3 ≈ 1.33`. Hero renders "133%"; cache-stale-banner (threshold 0.25) is permanently triggered.
- **Why tests miss it:** Both `__tests__/cache-dashboard-hero.test.tsx:32` and `__tests__/cache-stale-banner.test.tsx:18` mock `staleRatio` as a *number* matching the FE type, never the actual BE payload shape. No integration test exercises the real BE → FE wire.
- **Fix:** In `useCacheEffectiveness` (or a transform layer), convert BE shape:
  ```ts
  const { stale, typed, legacy } = payload.staleRatio;
  const denom = typed + legacy;
  staleRatio = denom > 0 ? stale / denom : 0;
  legacyRatio = denom > 0 ? legacy / denom : 0;
  ```
  Then update FE type to `staleRatio: number` only, drop the `Record<string, number>` branch and `resolveStaleRatio` (YAGNI: BE never returns a Record). Add one end-to-end fetch-shape test.

### C2. `legacyRatio` referenced but never sent — renders "NaN%"
- **File:** src/pages/DevAudit/cache-dashboard-hero.tsx:160
- **Problem:** `const legacyCount = Math.round(data.legacyRatio * 100);` — BE never emits `legacyRatio` (verified by `chat-service/test/api/debug-cache-effectiveness.test.ts:160-162` shape assertion which only checks `staleRatio`, `currentMetaHash`, `computedAt`). `data.legacyRatio` is `undefined` → `Math.round(NaN)` = `NaN` → "NaN%" in production UI.
- **Fix:** Derive `legacyRatio` from `staleRatio.legacy / (typed + legacy)` in the FE transform from C1, or have BE compute and return it as the spec implied (phase-04.md line 60 only defined `legacy: number` count). Add the field to type contract on both sides.

## Notable Issues (should fix but not blocking)

### N1. Cross-owner cache visibility in `/debug/search/cached` (phase 02)
- **File:** chat-service/src/db/response-cache-store.ts:189-194 (`searchCachedQueries`)
- **Concern:** Uses `EXISTS (SELECT 1 FROM chat_sessions WHERE owner_id=? AND game_id=rc.game_id)` — i.e. "if owner A has any session in game G, they can see ALL cache rows for game G, including rows whose `original_turn_id` was authored by owner B."
- **Status:** Matches existing `debug-cache-clear.ts:42-56` (shared-per-game cache by design) and consistent with the cache-key derivation (no owner in key). Cache-effectiveness queries use the *stricter* `JOIN original_turn_id → owner_id` — so the same `user_text_normalized` snippet is visible via search but invisible via cache-effectiveness top-N. **Inconsistent contract.**
- **Fix (consider):** Document the divergence in a JSDoc note, or tighten `searchCachedQueries` to the same JOIN-via-turn pattern. Note that hard-tightening could break the multi-owner-game expectation embedded elsewhere — requires user confirmation per rule §3 (don't silently reverse design decisions).

### N2. `cube_meta_hash` newest-per-game cross-game pick is arbitrary
- **File:** chat-service/src/db/cache-effectiveness-queries.ts:204-206
- **Detail:** When no `gameId` is passed, `currentMetaHash = hashRows[0]?.cube_meta_hash` — first row of the GROUP BY result. SQLite has no defined ordering across groups; whichever game's hash gets returned is implementation-dependent. The UI uses this for the "current hash" pill in the dashboard hero.
- **Fix:** When `gameId` is absent, return `null` (or pick the globally newest by `MAX(created_at)` rather than the first group).

### N3. Hash fragment lost on legacy session redirect
- **File:** src/pages/DevAudit/dev-audit-shell.tsx:78-82 (`LegacySessionRedirect`)
- **Detail:** `<Redirect to={"/dev/chat-audit/sessions/${match.params.sessionId}"}>` drops `location.hash`. Any old bookmark like `/dev/chat-audit/abc-123#turn-xyz` loses the `#turn-xyz` anchor on the redirect hop.
- **Fix:** Use a location object: `<Redirect to={{ pathname: ..., hash: location.hash }} />` via `useLocation()`.

### N4. Cache rows from soft-deleted sessions still counted
- **Files:** chat-service/src/db/cache-effectiveness-queries.ts — no JOIN filter on `cs.deleted_at IS NULL`
- **Detail:** Defense-in-depth check at debug-cache-effectiveness.ts:68 includes `deleted_at IS NULL`, but the store-layer queries do not. Owner's deleted-session cache rows still appear in their own stats. Probably semantically OK (still their data), but inconsistent with the membership guard.
- **Fix:** Add `AND s.deleted_at IS NULL` to the four store queries OR document why included.

### N5. Cmd-K intercepts while user is typing in another input
- **File:** src/pages/DevAudit/use-dev-audit-shortcuts.ts:35
- **Detail:** No check for `e.target` being input/textarea/contenteditable. Pressing cmd-K mid-annotation in session-detail yanks user to /search.
- **Status:** Matches Linear/Notion behavior (global quicksearch trumps text input). Listed as polish-only.

### N6. Single-point sparkline renders nothing
- **File:** src/pages/DevAudit/skill-trend-sparkline.tsx:54
- **Detail:** With `data.length === 1`, polyline gets one point "x,y" — SVG polyline requires ≥2 points to render anything visible. Title tooltip shows the count, but the visual is empty.
- **Fix:** Render a tiny `<circle cx={width/2} cy={toY(data[0])} r={1.5}/>` for single-point case.

## Verified Safe Items
- **Owner-isolation in 5 cache-effectiveness queries (cache-effectiveness-queries.ts):** all 5 SELECTs JOIN `chat_turns → chat_sessions WHERE owner_id = ?`. Owner B cannot see owner A's cache stats even in shared game. Covered by `cache-effectiveness-store.test.ts:373-413`. ✓
- **`$ saved` formula (querySavingsTotals:71-82):** `Σ cost_usd × (hit_count - 1)` with `WHERE rc.hit_count > 0` and inner guard `saves > 0`. Excludes `hit_count=0`, gives 0 for `hit_count=1`. Verified by `cache-effectiveness-store.test.ts:183-220`. ✓
- **stale-ratio bare-column SQLite extension (queryStaleRatio:193-201):** `GROUP BY game_id HAVING created_at = MAX(created_at)` — empirically verified that SQLite's bare-column rule extends to `HAVING + MAX`, picking the matching row. With 4 rows per game with different timestamps, returns the row with max created_at. ✓
- **`cubeMetaHash` threading through cache write path (turn.ts:276-280, 472-499):** `resolvedCubeMetaHash` is set inside the same try block as `cacheKey`; on `getMetaVersion` throw, the catch at line 330-334 sets `cacheKey=null`, gating the write. No undefined hash leaks. ✓
- **Cmd-K route scoping (use-dev-audit-shortcuts.ts:28):** `if (!location.pathname.startsWith('/dev/chat-audit')) return` early-exits — shortcut does NOT steal cmd-K on other routes. ✓
- **q LIKE injection (queryTopQueriesByHit:138-142, searchCachedQueries:202-205):** `replace(/[\\%_]/g, c => "\\"+c)` escapes LIKE wildcards; parameterized binding for value. Tested. ✓
- **Empty-data sparkline (cache-sparkline.tsx:22-35):** returns a flat baseline SVG, no NaN viewport. ✓
- **Defense-in-depth game-membership (debug-cache-effectiveness.ts:64-76):** when game is passed, owner must have at least one non-deleted session in that game (403 otherwise). ✓

## Recommended Actions (prioritized)
1. **Fix C1 + C2 before ship.** Add a FE transform layer that maps BE `{stale,typed,legacy}` → FE `{staleRatio: number, legacyRatio: number}`. Drop `Record<string,number>` from the FE type. Add at least one integration-shape test that uses the literal BE payload.
2. Fix N3 (hash preservation) — one-liner, prevents loss of anchored bookmarks.
3. Fix N2 (cross-game currentMetaHash) — return null or use MAX(created_at) globally.
4. Document or tighten N1 (search-cached cross-owner visibility) — escalate to user per rule §3 if intentionally shared.
5. Add N4 `deleted_at` filter for consistency.
6. Improve N6 single-point sparkline visual.

## Metrics
- Files reviewed: 12 core (4 BE, 8 FE) + 3 tests
- Critical: 2 | Notable: 6 | Verified safe: 8
- Test coverage: BE = strong (owner isolation, $ saved math, stale ratio buckets); FE = weak on BE-contract integration (mocks use FE-shape, not BE-shape)

## Unresolved Questions
1. Is the cross-owner cache visibility in `searchCachedQueries` (N1) intentional design (matching `debug-cache-clear`) or an oversight? If intentional, document in JSDoc. If oversight, tighten to JOIN-via-turn.
2. Should `legacyRatio` be a separate top-level field returned by BE, or derived FE-side from `staleRatio.legacy / (typed + legacy)`? Spec phase-04.md line 60 only specified the count, not a ratio.
3. When no gameId is passed and multiple games exist with different hashes, what should `currentMetaHash` represent? null, the globally-newest, or per-game keyed object? UI behavior is undefined for cross-game case.

---

**Status:** DONE_WITH_CONCERNS
**Summary:** Owner-isolation (the highest-risk area) is verified safe across all 5 cache-effectiveness queries and the cubeMetaHash threading. However, two critical FE/BE shape mismatches (`staleRatio` as object vs number, missing `legacyRatio`) will produce "133% stale" and "NaN%" in the dashboard hero — masked by FE tests that mock the FE-shape rather than the BE-shape. Block ship until C1/C2 are fixed and an end-to-end shape test is added.
