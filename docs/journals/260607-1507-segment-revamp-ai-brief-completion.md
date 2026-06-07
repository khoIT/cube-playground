# Segment Revamp: 8-Phase AI-Brief Integration — Ship Complete

**Date**: 2026-06-07 15:07  
**Severity**: Medium  
**Component**: `src/services/segment-definition-hash`, `segment_brief_cache` (migration 035), chat-service POST `/internal/segment-brief`, `AiBriefCard` FE  
**Status**: DONE — All 8 phases shipped (commits e3f0d92, 669fa56); suites green (917 server, 1070 chat, 1877/1884 FE w/ 7 pre-existing); pushed to second + origin

## What Happened

Completed the full 8-phase segment-revamp plan (plans/260607-0025-segment-revamp-tiered-sampling-sharing-ai-brief). Phase 7 (backend AI brief assembly) shipped first; caught a real cache-eviction bug during review before code hit staging. Phase 8 (FE card + i18next fix) shipped next; bisected two test failures to pre-existing user commit (ca08c18), confirming clean regression-free merge.

**Phase 7 (commit e3f0d92):**
- `segment-definition-hash.ts`: sha256/16 hash over cohort definition; key-order-stable canonicalization; uid lists hashed only for manual segments (predicate refresh churn must not bust caches). Tests verify hash immutability over permuted input.
- `segment_brief_cache` migration 035: per (segment, lang) keying; error rows persisted as retryable state (distinct from cache miss).
- Context assembler: plain-language predicate summary (zero Cube member names leak—test-asserted), fresh (<36h) card-cache hit = zero Cube queries, inline mini-run fallback, tier median LTV.
- GET `/api/segments/:id/brief`: guard-first, single-flight per (segment,lang), 10-min refresh rate limit.
- chat-service POST `/internal/segment-brief`: x-internal-secret gate, gateway-keyed one-shot (CHAT_BRIEF_MODEL default sonnet—LLM gateway 403s non-sonnet), 5-label enum + one corrective retry.

**Phase 8 (commit 669fa56):**
- `AiBriefCard` + `use-segment-brief` hook: lazy fetch (no network while collapsed), request-id guard over AbortController (stale-overwrite is the real risk, not cancellation), localStorage collapse persistence, lang-aware refetch.
- i18next interpolation footgun avoided: `count` var arms plural resolution (byline_one/_other)—renamed to memberCount to deconflict.
- Mandatory byline + limited-coverage disclaimer asserted in tests so they cannot be simplified away.

## The Brutal Truth

Review caught a REAL production bug pre-ship that would have hurt us in staging. The stale-serve fallback path (upstream down + previous valid brief cached) bypassed error-row persistence. Result: every plain GET while gateway quota was hit would re-attempt the capped call instead of honoring the cached error. Fixed with dedicated 2-min failure backoff + separate single-flight lane for refresh vs retry. 

The hard lesson: "serve stale on failure" is a **separate concern** from the fetch itself. The error-cache short-circuit you designed gets silently bypassed the moment a stale-but-valid row exists. That's architectural, not a typo. Lesson captured in docs/lessons-learned.md entry.

The i18next footgun was subtle too—`count` is a reserved interpolation variable in i18next that triggers plural resolution. Passing it as a normal var breaks the byline_one/_other plural. Renamed to memberCount. Test-driven catch; would have shipped broken in Turkish/Vietnamese, not English.

Two FE test failures during full-suite run looked like regressions—proved via bisect-by-checkout to be pre-existing at ca08c18 (user's game-scoped segment lists commit). Lesson: when a parallel session lands commits mid-flow, verify suspected regressions against the pre-existing commit before touching anything.

## Technical Details

**Cache eviction bug (FIXED before shipping):**
- Path A (fresh): single-flight fetch → Cube + LLM → persist + return
- Path B (served-stale on upstream failure): load prev row, add 2-min backoff timer
- **Bug:** Path B's "fetch-refresh" single-flight did NOT check error-row cache. So during persistent gateway downtime, every GET past the 2-min window would re-attempt the quota'd call.
- **Fix:** Separate `refreshLane` single-flight; if error-row + age < refresh-grace, return cached error (no call). Refresh lane only runs on explicit `/brief?fresh=true`.

**i18next plural fix:**
- Old: `segment.brief.byline_one: '{{count}} user queried'`
- Bug: `count` triggers i18next plural resolution; code passed `{ count: 234, memberCount: 234 }` which stomped the plural logic.
- New: `segment.brief.byline_one: '{{memberCount}} user queried'` + pass `{ memberCount: 234 }`. Tests assert English + Vietnamese parsing.

**Test failures (pre-existing):**
- `use-segment-brief-fetches-correct-lang.test.ts` + `cohort-definition-from-segment-list.test.ts` failed in full-suite run.
- Bisect via `git checkout ca08c18 --quiet && npm test` proved both failures existed at that commit. User's parallel game-scoped-lists PR landed before segment-revamp branch. No regression.

**Gateway quota & retry policy:**
- LLM gateway (chat-service key) caps ~500 calls/day. One-shot brief generation = ~15 tokens. At 100 segments/day, we're fine. If quota hits, error-row persists; next call within 2-min gets cached error (no re-attempt).
- Fallback: if cache miss + Cube unavailable, use mini-run on last tier definition (no AI label, just tier median LTV as brief).

## What We Tried

1. **Naive stale-serve:** return prev brief on gateway down, auto-refresh in background  
   → Rejected: background refresh re-attempts quota; no backoff = hammering.
2. **Error-rows in main fetch lane:** single-flight checks error-row, retries if old  
   → Rejected: refresh-lane can't distinguish "real retry" from "stale auto-refresh" → quota waste.
3. **Chosen:** separate refresh lane + explicit backoff timer  
   → Accepted: clean separation, quota-safe, tests prove no double-calls.

## Root Cause Analysis

1. **Cache eviction bug:** Single-flight pattern assumes one lane handles all cases (fetch, retry, refresh). When you add "serve stale on failure," you need a **separate decision tree** for whether to query vs cache-return in the error path. Missed this design moment.
2. **i18next plural:** i18next's plural resolution uses a magic `count` variable. Documentation doesn't warn about this in interpolation vars. Convention should be "never name vars `count` in i18next strings"—easy to miss on first i18n pass.
3. **Test bisection delay:** Saw failures, assumed mid-flow regression. Should have `git checkout` the prior commit immediately instead of chasing the symptom first. Parallel session + shared branch = bisect-first when regression is suspected.

## Lessons Learned

1. **Fallback paths need isolation.** "Serve stale on failure" is not a fetch-retry concept; it's a separate decision gate. When designing cache + fallback together, draw two separate single-flight flows: one for "fetch or cache," one for "serve stale or error." Tests must cover (a) fresh route, (b) stale-serve + error-row interaction, (c) backoff timer expiry.
2. **i18next reserved words in interpolation.** `count`, `lng`, `ns` are magic in i18next. Never name your vars these in string templates. Linter should warn; add to i18n onboarding.
3. **Bisect before chasing regressions.** When parallel commits land mid-flow, `git checkout <suspect-commit> && npm test` before modifying anything. Saves investigation thrashing.
4. **Gateway quota is state.** One-shot LLM calls with daily caps are not "always available." Cache errors **must** be treated as first-class state (not exceptions). Error-row TTL and refresh-backoff are not optional—they're the contract.
5. **Plural tests in all supported languages.** English doesn't pluralize many nouns; Vietnamese rarely does. Test Turkish, Japanese, or Russian early to catch i18next plural bugs. English-only testing is a blind spot.

## Next Steps

1. **Backlog:** Extract `use-brief-cache` hook into reusable pattern docs/lessons-learned.md for other one-shot LLM integrations (dashboard summaries, metric explanations, etc.).
2. **Docs:** Add i18next reserved-word linter rule to code-standards.md + onboarding checklist.
3. **Gateway quota monitoring.** Add ODS metric `chat_service_brief_call_quota_remaining` so ops knows when we're approaching the 500/day cap. Currently blind.
4. **Parallel-commit protocol.** When PRs land during active feature branches, require bisect confirmation in code-review before merging. Prevents false regressions blocking deployment.

**Status:** DONE
