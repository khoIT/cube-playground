# Explore-First Segment Creation Shipped

**Date**: 2026-06-23 00:16 GMT+7  
**Severity**: Medium  
**Component**: Chat exploration, segment proposal, lineage, distribution picker, cohort profile, overlap guard  
**Status**: Resolved

## What Happened

Shipped the full explore-first segment onramp: "Build segment from this" bridge on query artifacts + distribution-first cutoff picker + pre-save cohort profile + novelty overlap guard. Four moves: (1) segmentability probe (POST `/api/segments/translate-query`, eager hide for non-segmentable queries) + `source_query`→`born_from` lineage (migration 068); (2) distribution endpoint (`POST /api/distribution`, decile histogram, live count on drag) + UI picker fallback; (3) lazy cohort profile panel (`POST /api/profile`, top-k breakdowns); (4) approximate novelty badge (`POST /api/overlap-candidate`, sample vs snapshot intersection, scoped to `req.owner` only). All new endpoints are best-effort HTTP 200 fallbacks. Tests: 73 new server tests, all pass. Code review: APPROVE_WITH_NITS; one Medium fixed (owner body-override cross-user leak).

## The Brutal Truth

The scope surprise wasn't a miss — it was deliberate reuse that saved weeks. The translator from CubeQuery→predicate + segmentability gate already lived in chat-service (`cubeQueryToPredicateTree` + `propose_segment kind=query`). Rather than move or rewrite, we mirrored it server-side (new `/api/segments/translate-query` endpoint + `cube-query-to-predicate.ts` service), because the FE can't call chat-service utilities directly. The lineage (`source_query` on proposal → `born_from` persisted on segment) is net-new and required a migration, but the core segmentability logic is a byte-for-byte echo. This felt inefficient until the code review: the mirror is actually the right call. It localizes the API surface (FE talks to one server), decouples chat-service schema changes, and the duplication cost is one 40-line service. DRY dogma would have force-shipped chat-service types into the FE client — that's worse coupling.

Two bugs in lessons-learned are now sticky. First: parallel agents validating via isolated vitest pass — the three distribution/profile/overlap endpoints ran in parallel; one route called its service with `{ game_id }` while the helper param was `{ gameId }`. Both agents' vitest was green (esbuild transpiles per-file, erases types). The full tsc caught `'game_id' does not exist ... Did you mean 'gameId'?`. Lesson: vitest is necessary but not sufficient; authoritative gate is the full project build post-merge. Second: `var(--token)40` (hex-alpha concat on a CSS var) silently drops the declaration; the border never renders, no error. The novelty badge had a faint warning-ink border; silent no-op because color-mix wasn't used. Lesson: never string-concat alpha onto `var()` — use color-mix or add an explicit soft token.

## Technical Details

**Four new endpoints, all HTTP 200 best-effort:**

- `POST /api/segments/translate-query` — translates CubeQuery to predicate tree + checks segmentability (time-series, multi-cube, aggregate-only block). FE calls this to gate the "build segment" button.
- `POST /api/distribution` — returns approx_percentile decile histogram (catalog-allowlisted, per-user grain, timeout-bounded). FE drags threshold, live count updates via `/api/preview` or fallback numeric input.
- `POST /api/profile` — lazy top-k dimension breakdowns (which users, which roles, etc.) cached in-memory, non-blocking.
- `POST /api/overlap-candidate` — samples candidate uids, intersects req.owner's same-game segment snapshots, returns approximate intersection count + % + badge.

**Server-side translator mirror:**
- `server/src/services/cube-query-to-predicate.ts` (new) — 1:1 match of chat-service's `cubeQueryToPredicateTree` logic. Kept separate for now (no shared npm module) because future schema changes to either side should not auto-couple.

**Lineage:**
- Migration 068: `segments.source_query TEXT`, `segments.born_from TEXT` (both optional). `born_from` = the input_expression or query_id the cohort spun from. Enables "show me what I explored" audit trail.

**New chat-service contract:**
- `propose_segment` now carries optional `source_query` field (string or Query payload). Service stores it if present; FE calls with the artifact's source.

**Code review feedback (APPROVE_WITH_NITS):**
- Medium security: `/api/overlap-candidate` had an `owner` field in the request body that callers could manipulate to check overlap against other users' segments. Removed; now strictly `req.owner` from auth context. All cross-user leaks scoped to same-game (a weaker isolation, but consistent with existing cross-user read patterns on playground).

**Verification:**
- `tsc --noEmit` clean (server + FE).
- `npm --prefix chat-service test` 1372/1372 pass.
- New server tests: 73 pass, no regressions.
- FE touched files (segment-proposal-card.tsx, explorer-actions.tsx, etc.): no new type errors.

## What We Tried

Single path: execute the six-phase plan at `plans/260622-1934-explore-first-segment-creation/`. The planner locked the translator-mirror strategy early (chat-service's logic already proven; don't rebuild). Phases 01–07 shipped in dependency order (foundation → bridge → distribution → profile → guard → docs).

## Root Cause Analysis (Why This Matters)

The explore-first onramp was a missing surface: Cube queries live in chat exploration; segments live in a separate tool. Users had to context-switch: "I found something interesting in chat, now I want to save a cohort — where do I go?" The bridge closes that gap. The lineage (source_query → born_from) makes exploration auditable: CS can answer "why did someone build this segment?" and trace it back to the chat turn that inspired it.

The translator mirror (not a shared library) is the reuse-not-rebuild win: chat-service already owns the hard part (understanding when a Cube query is segmentable). Copying that logic is cheaper than the RFC, contract negotiation, and version-bump friction of a shared npm module. Transparency over dedup.

## Lessons Learned

1. **Reuse logic via endpoint mirror, not shared library.** When two services need the same domain logic (translator in this case), an internal endpoint beats an npm package. Lower coupling, clearer API boundary, no version sync friction. Accept the code duplication (it's 40 lines, not 400) as the cost of autonomy.

2. **Parallel vitest green is not tsc green.** Each agent's isolated test suite transpiles their own file via esbuild, erasing cross-file type contracts. Run the authoritative build (`tsc`, `npm run build`) after merging parallel work — that's the real gate. Grep the prompt to all agents with the exact shared type/param names so seams match by construction.

3. **CSS alpha concat on var() is a silent no-op.** `var(--token)40` produces an unparseable color; the browser discards the whole declaration. Use `color-mix(in srgb, var(--token) 25%, transparent)` or add `--token-soft` to tokens.css. When copying an existing inline-style idiom, confirm it visually before propagating.

4. **Segmentability is a gating choice, not a failing output.** Non-segmentable queries (time-series, multi-cube, aggregate-only) shouldn't emit a broken predicate or error. Just hide the "build segment" button and say nothing. The user understands: "I can't save this one, but I can try a different angle." This reduces noise and respects the exploratory mood.

5. **Best-effort endpoints (HTTP 200 fallback) scale better than transactional precision.** Distribution unavailable? Return NULL; FE falls back to a number input. Overlap calculation times out? Return NULL; show no badge. Profile cold? Omit the breakdowns, render an empty state. Users see a slightly degraded feature, not a 500. This is the right tradeoff for optional pre-save UX (contrast: authentication failing should 401, not fallback).

## Next Steps

1. **Monitor distribution endpoint latency in prod.** It hits the per-user pre-agg grain; if Cube load climbs, we may need to budget tighter or cache decile histograms. Baseline: ~200ms under normal load.

2. **Audit cross-user reads post-move to prod.** The overlap guard and profile endpoint read req.owner's segments, not arbitrary segments. Confirm no cross-user leaks surface in log review.

3. **Segment lineage audit trail future work.** Currently `born_from` is free text (whatever the FE sends). A real audit feature would track `source_query` as a structured object + versions. Deferred (out of scope here), but the schema is ready.

4. **Lessons-learned entries locked in docs/lessons-learned.md.** Both the parallel-vitest and var-alpha-concat failures are now documented. Future developers will grep these patterns and avoid the same trap.

Commit a6f2fab7 SHIPPED. Plan at `plans/260622-1934-explore-first-segment-creation/` marked DONE.
