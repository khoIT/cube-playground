# VIP Care Data Freshness Surface — Prefix Workspace Bug Caught in Review

**Date**: 2026-06-09 19:00
**Severity**: High
**Component**: Care Service, CS Monitor Dashboard, Cube data layer
**Status**: Resolved (commit c6e8473)

## What Happened

Shipped the final phase of VIP-care playbook coverage expansion: per-playbook "data as-of {date}" labels in the CS Monitor dashboard. The feature prevents a critical UX failure where a CS agent could misread a 5-week-stale gameplay cohort (last warehouse refresh: 2026-05-01) as "today's data" and make bad retention decisions.

Implementation: new read-only endpoint GET /api/care/data-freshness with server logic that probes MAX(log_date) across all backing Cube models in parallel, returns {cube → YYYY-MM-DD}, and caches the result ~10 min. FE hook renders async labels under the Data badge on each playbook row.

Live validation confirmed correct behavior: user_gameplay_daily = 2026-05-01 (stale), all others = 2026-06-09 (fresh).

## The Brutal Truth

A code review caught a **production-only bug** that would have inverted the entire feature into confident misinformation. The bug was invisible locally and caught exactly because we test both workspace types. The worst kind of failure: a silent fallback that masks a hard error and reports the wrong answer with confidence.

## Technical Details

**The Bug:**

The MAX probe was built from a logical member (game_id-prefixed) and handed directly to `loadWithCtx()`, which POSTs it verbatim to Cube. On a prefix workspace (prod), Cube instances only expose **physical** names. The logical member name would 404, `resolveDataAnchor` would silently fall back to `today`, and the gameplay mart (5 weeks stale on 2026-05-01) would be stamped "as of 2026-06-09."

The exact scenario the feature was built to prevent.

**Why It Was Invisible Locally:**

The local workspace is game_id (no prefix). Logical == physical. The no-op physicalization succeeded by accident, so all probes worked. The prefix-workspace code path was never exercised locally.

**The Fix:**

- Physicalize the probe member via `physicalMember(member, gamePrefix)` before the Cube call (no-op if gamePrefix is null).
- New unit test: assert the loader receives the correct **physical** member name on a prefix workspace.

**Error Log (Simulated):**

```
prefix workspace: member="cfm_vn_user_gameplay_daily" 
→ POST to Cube with physical name required
→ "cfm_vn_user_gameplay_daily" (not found)
→ 404 / resolve silence → fallback to Date.now()
→ FE renders "as of 2026-06-09" for May-1-stale data
```

## What We Tried

Not applicable — code review caught it before any merge or deploy.

## Root Cause Analysis

**Why This Happened:**

1. **Fail-safe default inverted into a confident lie.** The `resolveDataAnchor` fallback (→ today) was meant for network hiccups or missing cubes. Instead, it swallowed a workspace-specific logic error and returned "today" as if it were the truth.

2. **Local-only testing gave false confidence.** Green tests on a game_id workspace do not exercise the prefix path. The bug only surfaces on prod Cube instances where logical ≠ physical.

3. **No integration test for the failure path.** The test suite covered "happy path — all cubes found." No test asserted "what happens when Cube returns 404 on a workspace where it shouldn't?"

## Lessons Learned

1. **Fail-safe defaults are only safe if they're visibly default.** A silently falling back to "today" should have been caught during code review as "this path needs explicit logging or a visible warning state — silence is a lie."

2. **Workspace polymorphism requires dual testing.** Game_id workspaces (local) and prefix workspaces (prod) have different physical names. A feature that touches Cube must prove it works on both, not just pass locally.

3. **Member resolution needs a physicalization checkpoint.** This is now a pattern: any member passed to `loadWithCtx` must first pass through `physicalMember()`. Adding this to the style guide.

4. **Fall-back behavior should log and surface, not hide.** If `resolveDataAnchor` ever falls back to today, it should flag the caller with a warning in the response or explicitly return a "unknown" state, not pretend the fallback is real data.

## Next Steps

- Commit c6e8473 merges the fix + dual-workspace tests.
- Update `docs/code-standards.md` to document the member physicalization checkpoint (prevent similar bugs in future Cube-touching code).
- Consider adding an optional `warnOnFallback` flag to `resolveDataAnchor` so callers can distinguish "I actually measured MAX(log_date)" from "I gave up and guessed today."

**Tests:** 5 server (care-data-freshness) + 7 FE (data-freshness-format) added; full suite green (105 server care tests, 88 FE CS tests). Typechecks clean.

**Status:** RESOLVED. Committed to `main` (c6e8473), not yet deployed to prod (`second` remote push pending explicit approval). The physicalization fix is unit-tested for the prefix path but not yet exercised against a live prod Cube.
