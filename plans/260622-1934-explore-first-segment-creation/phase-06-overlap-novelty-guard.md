# Phase 06 — Overlap / novelty guard

**Move:** 4 · **Priority:** P2 (last; most approximate) · **Status:** pending · **Service:** server + src

## Context
Segment sprawl — near-duplicate cohorts nobody trusts — is a real publishing-ops problem. `segment-overlap-counts.ts` set-maths **two saved segments** off the nightly membership snapshot (`SEGMENT_MEMBERSHIP_DAILY`). A *candidate* proposal has no snapshot row, so this needs a candidate-vs-saved path.

## Requirements
- `POST /api/overlap-candidate` body `{ primary_cube, predicate, game_id }` → `{ overlaps: [{ segment_id, name, candidate_size, both_count, pct_of_candidate }], approx: true }`, top few only.
- Candidate has no snapshot → sample the candidate uid_list (preview already returns a ~5k sample) and intersect against snapshot membership of the user's segments in the **same game**. Result is approximate — always label "~".
- Scope: user's own segments by default (open question: include workspace-shared). Bound cost to same game/cube.
- FE: a quiet novelty badge in the proposal card — "≈80% overlaps 'Lapsing Whales'" with a link; absent when no meaningful overlap.

## Architecture
- New `server/src/routes/overlap-candidate.ts`: get candidate sample via preview/predicate-to-sql, build an intersection query against `SEGMENT_MEMBERSHIP_DAILY` (reuse `overlapCtePrefix` patterns), return top-k by `both_count/candidate_size`.
- FE badge in `SegmentProposalCard`, lazy (fetch after the proposal settles, non-blocking).

## Related code
- Read: `server/src/lakehouse/segment-overlap-counts.ts` (`overlapCtePrefix`, `buildOverlapCountsSql`), `/api/preview` (candidate sample), segments list (scope to user/game).
- Create: overlap-candidate route + SQL + test; novelty badge in proposal card.

## Implementation steps
1. Candidate-sample acquisition (reuse preview uid_list sample).
2. Intersection SQL: sample vs latest snapshot membership of same-game segments; top-k.
3. Endpoint + timeout + `approx` labeling.
4. Lazy, non-blocking badge in the proposal card.
5. Tests: known-overlap fixture; no-overlap → empty; same-game scoping.

## Todo
- [ ] Candidate sample acquisition
- [ ] Sample-vs-snapshot intersection SQL (top-k)
- [ ] Endpoint + timeout + approx label
- [ ] Non-blocking novelty badge
- [ ] Tests (overlap, empty, scoping)

## Success criteria
- A candidate that closely matches an existing segment surfaces a "~N% overlaps <name>" badge; a novel candidate shows none.
- Never blocks or delays the confirm action (fully async/lazy).

## Risks
- Sample-vs-full is approximate — must be labeled "~" and never presented as exact.
- Cost: scope to same game + top-k + timeout; skip silently on timeout (log the skip).

## Open question
Materialize the candidate first for exact overlap, or accept approximate (decided per brainstorm Q4).

## Next
Move 4 shippable. Phase 07 documents the lot.
