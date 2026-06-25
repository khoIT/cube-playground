# Phase 02 — Trino streamQuery generator

## Context
- `server/src/services/trino-rest-client.ts:99` `runQuery` follows `nextUri` but
  ACCUMULATES all rows into one array → unusable for 800k (OOM + no backpressure).
- Streaming precedent: `server/src/routes/chat.ts` pipes to `reply.raw`.

## Overview
- Priority: P0. Add a non-buffering async generator that yields each Trino batch.

## Requirements
- `streamQuery(c, schema, sql, { timeoutMs, signal })` → `AsyncGenerator<{columns, rows}>`.
- Yields each `resp.data` batch as it arrives following `nextUri`; never holds the
  full result. Surfaces `columns` on first batch.
- Honors an external `AbortSignal` (client disconnect) AND an idle/statement
  timeout; on abort/throw, best-effort `DELETE nextUri` to cancel server-side
  (mirror runQuery's cleanup).

## Architecture
- Add alongside `runQuery` in `trino-rest-client.ts` (shared `trinoFetch`,
  `baseUrl`, `authHeader`, `redact`). Generator loop: POST statement → loop:
  yield batch → GET nextUri → break when absent.
- Keyset pagination is the CALLER's job (Phase 03 wraps the cohort SELECT as
  `SELECT uid FROM (<inner>) WHERE uid > ? ORDER BY uid LIMIT N`), so a single
  `streamQuery` call drains one page; the endpoint loops pages. This keeps each
  Trino statement bounded and resumable, and lets a slow client apply backpressure
  between pages.

## Related code files
- Edit: `server/src/services/trino-rest-client.ts` (add `streamQuery`, keep `runQuery`).
- Read: `chat.ts` (reply.raw + abort wiring) for the consumer contract.

## Implementation steps
1. Extract the POST→nextUri loop into a generator; `yield { columns, rows }` per hop.
2. Wire `signal` (compose with timeout controller) so client close aborts the fetch.
3. On error/abort: `DELETE` last `nextUri`; rethrow typed timeout error.
4. Unit test with a mocked Trino (2–3 `nextUri` hops) asserting batches stream in
   order and abort triggers DELETE.

## Todo
- [ ] streamQuery generator
- [ ] abort + timeout composition
- [ ] server-side cancel on abort
- [ ] unit test (mocked multi-hop)

## Success criteria
- Streams N batches without buffering all rows; abort mid-stream cancels the Trino
  query; memory stays flat across a large simulated result.

## Risks
- Trino `nextUri` long-poll can stall → idle timeout per hop, not just total.
- Forgetting DELETE leaks Trino queries → assert in test.

## Security / perf
- Reuses existing redaction (no creds in errors). Backpressure via generator
  prevents unbounded memory under slow consumers.
