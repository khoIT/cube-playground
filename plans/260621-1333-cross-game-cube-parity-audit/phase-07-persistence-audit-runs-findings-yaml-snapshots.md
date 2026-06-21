# Phase 7 · Persistence: audit runs + findings + YAML snapshots

**Priority:** P1 (Track B foundation)
**Status:** pending
**Depends on:** Phase 0 harness (produces the findings the run persists)

## Overview
Turn the one-shot harness into a recorded service. Each audit run writes a run header, its findings, and a snapshot of every cube YAML it inspected (dev + matched prod) into segments.db. This is the durable record the UI reads for both current-state and trend-over-time, and the source for diffs when git is unavailable.

## Key insights
- Decision: persist findings AND YAML snapshots (self-contained). Storing YAML blobs per run is cheap (~171 dev files + matched prod, mostly unchanged run-to-run) — dedupe blobs by content hash so unchanged files aren't re-stored.
- Mirror the `advisor-agent-run-audit` pattern (migration 055) for the run/observability shape — proven, and the DevAudit UI already knows how to read that shape.

## Requirements
- Migration `server/src/db/migrations/067-cube-parity-audit-runs.sql` (next free number is 067) with tables:
  - `cube_parity_run` — id, started_at, finished_at, dev_git_sha, prod_clone_sha, prod_upstream_sha (nullable, from fetch), games[], counts by severity, status.
  - `cube_parity_finding` — id, run_id FK, game, cube, dimension (pk|join|measure|rollup|ratio|identity), severity, dev_value, oracle_value, file, line, verdict (nullable until triaged), root_cause_key.
  - `cube_yaml_snapshot` — content_hash (PK), bytes/text, first_seen_run_id; plus `cube_yaml_snapshot_ref` (run_id, side dev|prod, game, cube, path, content_hash) to map each run's files to a deduped blob.
- A service `server/src/services/cube-parity-recorder.ts` that invokes the harness (Phase 0 `audit:cube-parity`), parses its JSONL, and writes a run + findings + snapshot refs in one transaction.
- An npm/route trigger to run an audit on demand (and a path for CI/cron later).

## Architecture / approach
- Recorder shells out to `cube-dev` `node scripts/audit-cube-parity.mjs --json` (single source of audit logic — DRY; UI never re-implements the diff).
- Blob dedupe by sha256(content) so a 171-file run that changed 2 files stores 2 new blobs.
- Keep recorder-only/internal fields out of any public API response (follow the advisor-audit precedent where recorder fields are stripped at the edge).

## Related code files
- Create: `server/src/db/migrations/067-cube-parity-audit-runs.sql`
- Create: `server/src/services/cube-parity-recorder.ts`
- Read (pattern): `server/src/db/migrations/055-advisor-agent-run-audit.sql`, `056-advisor-agent-run-observability.sql`
- Read: Phase 0 `cube-dev/scripts/audit-cube-parity.mjs` output contract

## Implementation steps
1. Write migration 067 (3 tables + ref table + indexes on run_id, game, severity).
2. Build recorder: run harness → parse JSONL → upsert blobs (hash dedupe) → insert run+findings+refs in a txn.
3. Capture dev git sha (`git rev-parse HEAD` on cube-playground) + prod clone sha + (if fetched) upstream sha into the run header.
4. Expose a trigger (route in Phase 8/9 wiring; CLI for now).
5. Unit-test recorder against a fixture harness output (a run with 0 findings + a run with N findings + an unchanged-file second run proving blob dedupe).

## Todo
- [ ] migration 067 (run / finding / yaml_snapshot / snapshot_ref)
- [ ] cube-parity-recorder service (txn write + blob dedupe)
- [ ] capture dev/prod/upstream shas
- [ ] on-demand trigger
- [ ] recorder tests (incl. dedupe)

## Success criteria
- Running an audit persists exactly one run row, N finding rows, and only the changed YAML blobs (dedupe verified).
- A second identical run stores zero new blobs.
- Run header carries dev sha + prod clone sha.

## Risks
- YAML blob growth over many runs → dedupe + a retention/prune policy (keep last K runs' refs; blobs GC'd when unreferenced). Note as follow-up, not blocking.

## Next
Feeds Phase 8 (diff engine reads snapshots) and Phase 9 (UI reads runs/findings).
