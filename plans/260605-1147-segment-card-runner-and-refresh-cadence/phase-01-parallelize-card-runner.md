# Phase 01 — Parallelize card-runner

**Item:** (1) Cards run sequentially — ~30 serial Cube round-trips per refresh.
**Priority:** High (biggest wall-clock win). **Status:** ⬜ planned. **Layer:** server.

## Context links
- server/src/services/card-runner.ts (`runPresetCards`, sequential `for` loop ~L148-164)
- src/pages/Segments/detail/use-segment-cube-query.ts (FE already bounds concurrency at `MAX_CONCURRENT = 3`, L24, with acquire/release pool L36-49 — mirror this)
- server/src/jobs/refresh-segment.ts (sole caller, L247)

## Overview
`runPresetCards` builds `allSpecs` (~30 entries) then loops `for … await loadWithContinueWait`
one card at a time. Each card is an independent Cube `/load`. Replace the serial loop with a
**bounded-concurrency pool** (limit 4) so ~30 cards finish in ~⌈30/4⌉ waves instead of 30.
Per-card `try/catch` already isolates failures, so a failed card never aborts siblings →
parallelizing is low-risk.

## Key insights
- Order of `results[]` does not matter — entries are keyed by `cardId` downstream
  (`upsertCardCache` writes per `card_id`; FE looks up by key). Safe to resolve out of order.
- Cube/Trino can handle a handful of concurrent loads; cap at 4 to avoid hammering a
  warming cluster (tune via constant). Don't go unbounded — 30 simultaneous heavy
  pre-agg loads could stampede a cold rollup.
- Keep the existing physicalize → load → logicalize per-card body verbatim inside the worker.

## Requirements
- Functional: all cards still computed; cache contents identical to today (order-independent).
- Non-functional: refresh wall-time for card phase drops ~3-5×; no unbounded fan-out.

## Architecture
Introduce a tiny bounded-map helper (or reuse a 6-line semaphore) local to card-runner:

```ts
const CARD_CONCURRENCY = 4;

async function mapWithConcurrency<I, O>(
  items: I[], limit: number, fn: (item: I) => Promise<O>,
): Promise<O[]> {
  const out: O[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
```

Then the loop body becomes the `fn`, returning `CardCacheEntry | null` (null on caught
failure), and `results = (await mapWithConcurrency(...)).filter(Boolean)`.

## Related code files
- Modify: `server/src/services/card-runner.ts`
- Test: `server/test/card-runner*.test.ts` (find/extend; assert all cards present + failures skipped under concurrency)

## Implementation steps
1. Add `CARD_CONCURRENCY = 4` constant + `mapWithConcurrency` helper (keep file < 200 LoC; extract helper to `server/src/services/bounded-concurrency.ts` if it pushes over).
2. Convert the `for (const { id, query } of allSpecs)` body into a worker fn returning
   `CardCacheEntry | null`; keep the existing `console.warn` on catch → return null.
3. `const results = (await mapWithConcurrency(allSpecs, CARD_CONCURRENCY, worker)).filter((e): e is CardCacheEntry => e !== null);`
4. Typecheck server; run card-runner + refresh-segment tests.

## Todo
- [ ] Add concurrency helper + constant
- [ ] Refactor loop to worker fn (null on failure)
- [ ] Filter nulls, preserve return type `CardCacheEntry[]`
- [ ] Unit test: N specs, 2 forced failures → N-2 entries, no throw
- [ ] Typecheck + existing suites green

## Success criteria
- All previously-cached cards still cached; a forced single-card failure leaves the rest intact.
- Observed card-phase time roughly `ceil(N/4)` waves (log start/end timestamps to confirm).

## Risk assessment
- **Cube stampede on cold rollup** → cap at 4; `loadWithContinueWait` still polls per card.
  Mitigated further by Phase 03 aggregate budget.
- **Hidden ordering assumption** → audited: downstream is keyed by cardId, none found.

## Security
- None — no new inputs, same token, same queries.

## Next steps
- Phase 03 wraps this pool in an aggregate deadline.
