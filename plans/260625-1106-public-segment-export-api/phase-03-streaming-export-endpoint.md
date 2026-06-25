# Phase 03 — Streaming members export endpoint

## Context
- Depends on Phase 01 (api-key scope) + Phase 02 (streamQuery).
- Full-cohort SELECT builder: `buildSegmentMembershipSql()` in
  `server/src/lakehouse/segment-snapshot-writer.ts`.
- Lakehouse table: `SEGMENT_MEMBERSHIP_DAILY`, `lakehouseConnectorFromEnv()`,
  `LAKEHOUSE_CATALOG`/`LAKEHOUSE_SCHEMA` in `lakehouse-trino-connector.ts`.
- Streaming target: `reply.raw` (see chat.ts `reply.hijack()` pattern).

## Overview
- Priority: P0. `GET /api/public/v1/segments/:id/members` — streams the FULL
  cohort as NDJSON (default) or CSV, keyset-paginated from Trino.

## Requirements
- Query: `?format=ndjson|csv` (default ndjson), `?cursor=<last-uid>` (resume),
  optional `?limit=` (cap rows for testing; absent = full cohort).
- **`?fields=` forward-compat (build now, ship uid-only).** Accept `?fields=uid,...`
  with default `uid`. v1's first ship serves `uid` only, but MORE FIELDS COME LATER,
  so the SELECT projection + encoders MUST be column-driven (a `fields[]` list),
  never a hardcoded single column. Adding a field is then: extend the source
  SELECT + the allowlist — no encoder rewrite. NDJSON stays object-per-line so new
  keys are additive; CSV appends columns (uid stays first). Unknown/forbidden
  fields → 400 with the allowlist. Keyset cursor stays on `uid` regardless of
  `fields`. Document that consumers must tolerate unknown fields.
- **Base URL is real, not a placeholder:** prod is
  `https://playground.gds.vng.vn/api/public/v1` (behind VPN). Use it in examples,
  tests, and the OpenAPI `servers` block.
- Headers out: `Content-Type: application/x-ndjson` or `text/csv`; chunked.
  Emit `X-Total-Count` (segment size, sent before the body) + `X-Cursor-Next`
  trailer is unreliable, so for resumability the LAST emitted **data** line's uid
  IS the cursor (client re-requests with `?cursor=<that uid>`). Document this.
- NDJSON line: `{"uid":"..."}`. CSV: header `uid\n` then values.
- **Completion contract (REQUIRED — defends against silent truncation).** Once the
  status line + `200 OK` are on the wire we CANNOT downgrade to 5xx mid-stream
  (TCP has no undo), so a Trino failure on page 12/18 looks to a naive consumer
  like a clean short read. Two redundant signals close this gap; emit BOTH:
  1. `X-Total-Count: <segment size>` header, sent up-front. Consumer compares
     received row count against it.
  2. An explicit **trailing sentinel** emitted ONLY after the final page flushes
     cleanly:
     - NDJSON: a final object line `{"_complete":true,"count":<N>}` (note: a
       control line, distinguishable from data lines which have only `uid`).
     - CSV: a final comment line `# complete,<N>` after all values.
  If the stream errors mid-flight, the sentinel is NEVER written and the socket is
  closed abruptly → absence of sentinel = truncated = consumer MUST discard/retry.
  Sentinel is authoritative (survives proxies that strip HTTP trailers);
  `X-Total-Count` is the cheap up-front cross-check. Consumers resume the truncated
  pull with `?cursor=<last data uid received>` — no re-pull of rows already in hand.
- Source selection: if a `segment_membership_daily` partition exists for the
  segment (latest snapshot_date) → stream from the table (cheapest); else compile
  `buildSegmentMembershipSql` and stream the live predicate. Log which path.
- Page internally with `WHERE uid > :cursor ORDER BY uid LIMIT PAGE_SIZE`
  (PAGE_SIZE ~50k) looping until a short page; flush each page to `reply.raw`,
  awaiting drain on backpressure.
- Abort on client disconnect (`reply.raw.on('close')` → abort signal → Phase 02
  cancels Trino).

## Architecture
- New `server/src/routes/public-export.ts` registered under prefix
  `/api/public/v1` with the api-key preHandler (Phase 01) — NOT the app-JWT/
  workspace middleware (those are for the FE). Resolve workspace from the KEY's
  scope + the segment row, not a header.
- New `server/src/services/segment-export-stream.ts` (<200 LoC): given segment row
  + format + cursor + signal, returns an async iterator of encoded chunks
  (picks source, builds keyset SQL, calls streamQuery, encodes ndjson/csv).
- Route: api-key scope check (`canKeyAccessSegment`) → 403/404 → hijack reply →
  pipe encoded chunks → end. Errors mid-stream: if nothing written yet, send JSON
  error; if already streaming, terminate the connection (can't change status).

## Related code files
- Create: `routes/public-export.ts`, `services/segment-export-stream.ts`.
- Read: `segment-snapshot-writer.ts`, `lakehouse-trino-connector.ts`,
  `trino-profiler-config.ts` (schemaForGame), `chat.ts` (hijack pattern).
- Edit: `server/src/index.ts` (register route under prefix).

## Implementation steps
1. `segment-export-stream.ts`: source resolver (table vs live), keyset SQL wrapper,
   per-page streamQuery loop, ndjson/csv encoders, backpressure-aware emit.
2. `public-export.ts`: GET members; scope guard; hijack; pipe; close→abort.
3. Register under `/api/public/v1` with api-key preHandler.
4. Tests: scope deny (403), unknown segment (404), ndjson+csv shape, cursor
   resume continues past boundary, client-abort cancels Trino (spy on DELETE).

## Todo
- [ ] segment-export-stream.ts (source + keyset + encoders)
- [ ] public-export.ts members route + hijack + abort
- [ ] register prefix + api-key preHandler
- [ ] tests (shape, resume, abort, scope)

## Success criteria
- Streaming ~872k jus_vn cohort completes with flat memory; CSV/NDJSON valid;
  `?cursor=` resumes deterministically (uid-sorted); disconnect cancels Trino.

## Risks
- Mid-stream error after headers sent → cannot signal via status. RESOLVED by the
  completion contract above: emit `X-Total-Count` up-front AND a trailing
  `_complete` sentinel only on clean finish; absence of sentinel = truncated. This
  contract is mandatory and must be mirrored in the consumer docs (Phase 05) and
  the standalone consumer-integration doc.
- Dedup: table path is pre-deduped; live path identity may dup → keyset on a
  `SELECT DISTINCT uid` wrapper to keep cursor monotonic.

## Security
- Authorization is the api-key scope ONLY (no app-JWT here). Fail-closed on
  workspace/segment mismatch. First ship is uid-only; when fields are added via
  `?fields=`, every field must pass a server-side ALLOWLIST (no arbitrary column
  projection), and any PII-bearing field gates on an explicit key scope/grant —
  never exposed by default. The `fields` allowlist is the security boundary.
