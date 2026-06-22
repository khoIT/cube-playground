# Phase 01 — Query→predicate translation + proposal lineage

**Move:** 1 (foundation) · **Priority:** P0 (unblocks 02) · **Status:** pending · **Service:** server + chat-service + shared types

## Context
- `QueryArtifact.query` is a runnable CubeQuery (`src/api/chat-sse-client.ts:101`) carrying measures/dimensions/filters/timeDimensions + `game` + `cube`-ish `source`.
- `server/src/services/predicate-to-sql.ts` consumes a predicate_tree; `SegmentProposalPayload` (`src/api/segment-proposal.ts`) is the wire shape FE renders.
- Goal: deterministically convert a *segmentable* CubeQuery into a `predicate_tree`, and stamp a lineage reference so the resulting segment remembers the exploration it came from.

## Requirements
- **Translation:** CubeQuery `filters` → predicate leaves (member, operator, values). Measure threshold filters (per-user-grain column compares) → predicate leaves. AND-group by default; preserve OR where the CubeQuery expresses it.
- **Segmentability gate:** return `segmentable: false` (+ reason) when the query is aggregate-only, multi-cube, time-series-shaped, or references a non-per-user-grain measure. Never emit a partial/lossy predicate silently.
- **Lineage:** add optional `source_query?: { artifact_id?: string; question?: string; cube_query?: unknown }` to `SegmentProposalPayload` and a `born_from` column/JSON on the segment create path.
- Pure + unit-testable; no Trino round-trip in the translator itself.

## Architecture
- New `server/src/services/cube-query-to-predicate.ts` (translator + gate). Mirror predicate-to-sql's member/operator vocabulary so a round-trip is lossless for the supported subset.
- chat-service: extend `propose_segment` path to accept/forward `source_query`; thread through to the proposal event.
- Persist `born_from` on `POST /api/segments` (nullable; migration adds the column).

## Related code
- Read: `src/api/chat-sse-client.ts`, `src/api/segment-proposal.ts`, `server/src/services/predicate-to-sql.ts`, `server/src/routes/segments.ts` (create), chat-service `propose-segment-*` tools.
- Create: `server/src/services/cube-query-to-predicate.ts` (+ test), migration for `born_from`.
- Modify: segment-proposal types (shared), segment create route, chat-service proposal emitter.

## Implementation steps
1. Define the supported CubeQuery subset + `segmentable` gate; enumerate reject reasons.
2. Write the translator (filters/measure-thresholds → predicate_tree); unit tests over real explored-query fixtures.
3. Add `source_query` to the proposal type (FE + chat-service) and `born_from` to the segment create body + migration.
4. Wire chat-service `propose_segment` to carry lineage; persist `born_from` on create.

## Todo
- [ ] Segmentability gate + reasons
- [ ] Translator + unit tests (lossless round-trip for supported subset)
- [ ] `source_query` proposal field (shared type)
- [ ] `born_from` column + migration + create-path persistence
- [ ] chat-service forwards lineage

## Success criteria
- Given a segmentable explored CubeQuery, translator yields a predicate_tree whose `predicate-to-sql` output matches the query's filter semantics (test-verified).
- Non-segmentable queries return `{ segmentable: false, reason }` — no partial predicate.
- A segment created from a proposal stores its `born_from`.

## Risks
- Operator/vocabulary drift between CubeQuery filters and predicate leaves → cover with round-trip tests, not by eyeballing.
- Migration on a live table — `born_from` must be nullable with no backfill.

## Next
Unblocks Phase 02 (the FE bridge consumes the translator + lineage).
