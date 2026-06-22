# Phase 02 — Wire pre-confirm size into propose_segment

## Overview
Priority: high. Status: pending. Depends on Phase 01.
After the predicate is built, call the count endpoint and surface the real ~size on the proposal so users can iterate before saving.

## Requirements
- In `propose-segment-handlers.ts` (+ cutoff handlers), after the predicate tree is assembled, POST it to `/api/segments/preview-count` (best-effort, short timeout).
- Set `proposal.resolved.estCount` to the returned count; add a disclosure line ("~N users match — exact size on refresh").
- On count failure/timeout/unsupported_cube: keep estCount 0 + current "computed on refresh" disclosure. NEVER block the proposal on the count.
- Applies to all kinds (threshold, percentile, top_n, query). Percentile/top_n already resolve a cutoff; the count uses the final predicate incl. the cutoff leaf.

## Related code
- Modify: `chat-service/src/tools/propose-segment-handlers.ts`, `propose-segment-cutoff-handlers.ts`, `propose-segment-disclosures.ts`, `services/server-client.ts` (add the POST helper if absent).

## Success criteria
- A dimension proposal shows a non-zero estCount live when data exists.
- Count outage → proposal still emits with estCount 0 (no regression).

## Tests
- handler sets estCount from a mocked count response; mocked failure → estCount 0 + proposal still emitted.

## Risks
Extra round-trip latency per proposal — keep the count timeout tight (≤ a few s) and parallel with disclosure building where possible.
