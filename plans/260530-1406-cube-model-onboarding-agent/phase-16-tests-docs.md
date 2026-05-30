# Phase 16 — Tests + docs sync

**Context:** [plan.md](./plan.md) · closes the v2 arc. Mirrors v1 Phase 08 (442/442 server tests).

## Overview
- **Priority:** P1.
- **Status:** Planned.
- Comprehensive tests for the v2 surface (no fake data, no mocks-to-pass) + docs sync.

## Requirements
**Unit**
- `connector-secret-vault`: encrypt→decrypt round-trip; wrong key fails; ciphertext ≠ plaintext;
  no secret in serialized form.
- `connector-store`: create/get/listPublic redaction (assert zero secret leakage), audit append,
  env-seed + DB merge dedup.
- `source-type-registry`: each introspectable type has valid fields + caps; non-introspectable
  flagged.
- `datasource-registry-writer`: atomic write, secret-free output, merge idempotency.
- Profiler dispatch: `getProfiler` returns correct impl; Trino output regression-identical to v1;
  `information_schema` profiler SQL templates per dialect (fixture schemas); caps enforced.
- `join-source-classifier`: same vs cross classification; advisory emit for cross.
- Builder→YAML: stepper decisions compile to the same YAML as the raw-YAML view (parity test).
- `existing-model-reader`: parses sample cube YAML; missing-dir tolerance.

**Integration**
- Provision (test→persist→registry-write) → introspect → build (stepper) → stage → approve, for a
  SQL source (Postgres fixture or stub warehouse). Assert no secret in any response.
- RBAC: viewer → 403 on `/connectors` POST + stage/approve; grant re-check on cross-game.
- SSRF: link-local/metadata host rejected by `/connectors/test`.

**Non-functional**
- Keep the suite green (v1 baseline 442) + new tests; `npm run typecheck` clean.

## Related Code Files
- **Create:** `server/test/*` for each new service; FE tests under `src/pages/Data/**/__tests__/`
  (builder parity, dynamic form).
- **Modify (docs):** `docs/system-architecture.md` (multi-source connect + dataSource registry +
  builder), `docs/codebase-summary.md` (new services/components), `docs/project-changelog.md`
  (v2 entry), `docs/lessons-learned.md` (if a non-trivial bug class emerges — e.g. cube.js
  code-vs-YAML gap, dialect quoting).

## Implementation Steps
1. Write unit tests per service as each phase lands (don't batch to the end).
2. Add the end-to-end integration test with a Postgres fixture/stub.
3. Run full server + FE suites + typecheck; fix to green (no skips, no fake passes).
4. Docs sync via `docs-manager`; record v2 decisions + the cube.js registry contract.

## Todo
- [ ] Vault + store + registry + writer unit tests
- [ ] Profiler dispatch + Trino regression + dialect template tests
- [ ] Builder→YAML parity + dynamic-form FE tests
- [ ] join-source-classifier + existing-model-reader tests
- [ ] Provision→introspect→build→stage→approve integration test
- [ ] RBAC + SSRF tests
- [ ] Docs sync (architecture, summary, changelog, lessons-learned)

## Success Criteria
- All server + FE tests pass (v1 baseline + v2 additions); typecheck clean.
- Zero secret material in any tested API response (explicit assertions).
- Docs reflect the multi-source architecture + the dataSource registry contract.

## Risks & Mitigation
- **Warehouse needed for integration:** use a Postgres test container/fixture or a stubbed driver at
  the `Profiler` interface seam — real code path, controlled data (not a mock-to-pass).

## Security
- Post-ship `/ck:security` review covering the v2 connect surface (SSRF, secret-at-rest, RBAC) —
  extends the v1 unresolved security question. Track to completion before prod enablement.

## Next
v2.5 follow-ups: rollupJoin/pre-agg execution for cross-source joins; secret-key rotation; embed
Coverage/Drift inline (carried from v1.5).
