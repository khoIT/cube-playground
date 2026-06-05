# Phase 05 — Manual-segment cache decision

**Item:** (3) Server scopes predicate-segment cards by predicate only. Manual segments are
**never precomputed** (refresh job bails at `row.type !== 'predicate'`), so their Insights
tiles always fall back to live FE fetch. Correct — but big manual cohorts get no cache benefit.
**Priority:** Low (decision-first). **Status:** ⬜ planned. **Layer:** decision (+ optional server).

## Context links
- server/src/jobs/refresh-segment.ts:70 (`if (row.type !== 'predicate' || !row.cube || !row.cube_query_json) return;`)
- src/pages/Segments/detail/use-segment-cube-query.ts (`scopeQueryToCohort` — manual branch → identity-IN over `uid_list`, L116)
- server/src/services/card-runner.ts (`scopeQuery` predicate-only; would need a uid-IN path for manual)

## Overview
This phase is primarily a **product/scope decision**, not code. Confirm whether manual segments
should ever get server-side card precompute, then either (a) document "live-fetch by design"
and make Phase 04 label it clearly, or (b) add a bounded uid-IN precompute path for manual
segments under a size cap.

## The decision

**Status quo (recommended default):** leave manual segments on live FE fetch.
- Manual segments are explicit uid pushes; the FE `scopeQueryToCohort` manual branch already
  scopes correctly via identity-IN over `uid_list`.
- For *small* manual cohorts, live fetch is fast; cache adds little.
- For *large* manual cohorts (uid_list up to MAX_UID_LIST = 100k), an identity-IN card query
  risks the same >1MB query-text rejection that predicate scoping was built to avoid — which is
  exactly why the server path is predicate-only. So precomputing large manual cohorts
  reintroduces the rejected pattern. **Do not** naively enable it.

**Alternative (only if users complain about manual Insights latency):** precompute manual cards
only when `uid_count <= SAFE_INLINE_CAP` (e.g. ≤ a few k uids, comfortably under the query-text
limit); above the cap, stay live. Requires: relax the `:70` bail for manual+bounded, add a
uid-IN scope branch in card-runner mirroring the FE manual branch, reuse Phase 01/03 plumbing.

## Requirements (status-quo path)
- No server change. Phase 04 explicitly renders "live" for cards with no cache entry so manual
  segments read as intentional, not broken.
- Document the rationale in docs/lessons-learned.md (predicate-only server scope + manual=live).

## Requirements (alternative path — gated on user opt-in)
- `SAFE_INLINE_CAP` constant; refresh-segment runs card-runner for manual segments with
  `uid_count <= cap`, passing a uid-IN scope instead of predicate filters.
- card-runner gains a manual/uid-IN scope mode (keep predicate path untouched).
- Tests: large manual cohort still skipped; small one precomputes; no >1MB query emitted.

## Implementation steps (status-quo)
1. Confirm decision with user (see open questions).
2. Ensure Phase 04 "live" labeling covers manual segments.
3. Add a one-line lessons-learned note (why manual = live by design).

## Todo
- [ ] Get explicit user decision (status-quo vs bounded precompute)
- [ ] If status-quo: Phase 04 "live" label + lessons-learned note
- [ ] If alternative: cap constant, manual scope branch, tests

## Success criteria
- Decision recorded; manual-segment Insights behavior is intentional and labeled, with no
  reintroduction of uid-IN query-text overflow.

## Risk assessment
- **Reintroducing >1MB query rejection** → the whole reason server scoping is predicate-only;
  any manual precompute MUST be size-capped. Verified constraint, do not regress.

## Open questions (BLOCKING for the alternative path)
1. Do users actually experience slow manual-segment Insights today, or is live fetch fine?
   (If fine → status-quo, close this phase as "documented, no code".)
2. If precompute is wanted, what's the acceptable `SAFE_INLINE_CAP` (uid count) given the
   ~1MB Cube query-text limit?
