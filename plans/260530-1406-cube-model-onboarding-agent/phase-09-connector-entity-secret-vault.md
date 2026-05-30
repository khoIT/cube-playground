# Phase 09 — Connector entity + secret vault (migration 024)

**Context:** [plan.md](./plan.md) · v2 Decision 1 (real connect + secret vault) · supersedes v1
config-seed-only posture. Reuses `trino-profiler-config.ts` `Connector` + redaction invariant.

## Overview
- **Priority:** P1 (foundation for all of v2 connect).
- **Status:** Planned.
- Persist connectors with **encrypted-at-rest** secrets so the browser can provision a real
  source. Generalize the `Connector` entity to carry `sourceType`. Keep the v1 config-seed path
  as a read-only bootstrap fallback (merged into the same list).

## Key Insights
- v1 `Connector` (`trino-profiler-config.ts`) already has host/port/user/password/catalog/ssl +
  a **secret-free projection** (`ConnectorPublic`) + `listConnectors()` redaction. Extend, don't replace.
- Secrets today live only in env/`connectors.config.json` (gitignored). v2 adds a DB-backed,
  encrypted store — the redaction invariant (`getConnector` server-only) MUST hold.
- Stores pattern: mirror `anomaly-state-store.ts` (upsert+status) + the append-only audit-store.

## Requirements
**Functional**
- `connectors` table: `id`, `workspace_id`, `source_type`, `label`, non-secret config JSON,
  `secret_ciphertext`, `secret_iv`, `secret_tag`, `status` (`active`/`disabled`), `created_by`,
  `created_at`, `updated_at`.
- CRUD service `connector-store.ts`: `create`, `get` (decrypts, server-only), `listPublic`
  (redacted, merges config-seed + DB), `disable`. Append-only `connector_audit`.
- Crypto module `connector-secret-vault.ts`: AES-256-GCM, key from `CONNECTOR_SECRET_KEY`
  (32-byte, base64). `encrypt(plaintext) → {ciphertext, iv, tag}` / `decrypt(...)`. Fail-closed:
  if key absent, DB-backed connectors are unusable (config-seed still works for bootstrap).

**Non-functional**
- Secrets never logged, never in error messages (reuse the trino-client redaction helper), never
  in any `/api` response. `listPublic` returns `ConnectorPublic` only.

## Architecture
`connector-store` → `connector-secret-vault` (crypto) + `sqlite` (persistence). `getConnector(id)`
in `trino-profiler-config.ts` is refactored to consult the store first, env-seed second.

## Related Code Files
- **Create:** `server/src/db/migrations/024-connectors.sql`,
  `server/src/services/connector-store.ts`, `server/src/services/connector-secret-vault.ts`.
- **Modify:** `server/src/services/trino-profiler-config.ts` (route `getConnector`/`listConnectors`
  through the store; keep config-seed as fallback), `.env.example` (`CONNECTOR_SECRET_KEY`).
- **Read for context:** `server/src/services/anomaly-state-store.ts`,
  `server/src/services/onboarding-draft-store.ts`, `server/src/db/sqlite.ts`.

## Implementation Steps
1. Write `024-connectors.sql` (+ `connector_audit`). Confirm it's file #24 → `user_version` 24.
2. `connector-secret-vault.ts`: AES-256-GCM encrypt/decrypt; unit-testable with an injected key.
3. `connector-store.ts`: CRUD + audit; `listPublic` merges env-seed (read-only) + DB rows, dedup by id.
4. Refactor `trino-profiler-config.ts` `getConnector`/`listConnectors` to delegate to the store,
   preserving the `Connector`/`ConnectorPublic` shapes and adding `sourceType` (default `trino`).
5. Wire `CONNECTOR_SECRET_KEY` into `.env.example` + server boot (warn-once if missing).

## Todo
- [ ] Migration 024 + audit table
- [ ] Secret vault (AES-256-GCM) + unit tests
- [ ] connector-store CRUD + audit + redacted listPublic
- [ ] Refactor trino-profiler-config to store-backed, env fallback
- [ ] `.env.example` + boot warning

## Success Criteria
- Create a connector via store → secret encrypted in DB, plaintext never persisted.
- `listPublic()` and every `/api` path return zero secret material (asserted in tests).
- v1 config-seeded Trino connector still resolves with no `CONNECTOR_SECRET_KEY` set.

## Risks & Mitigation
- **Key rotation:** out of scope v2; record as follow-up. Single active key.
- **Key absent in prod:** fail-closed for DB connectors; config-seed unaffected (no regression).

## Security
- Secret-at-rest encryption; redaction invariant; mutations under `enforce-write-roles`.
- SSRF: host is operator/DA-supplied now (was server-owned in v1) — host validation deferred to
  Phase 12 (allowlist/format check) and flagged for `/ck:security`.

## Next
Phase 10 (source-type registry consumes `sourceType`; provisioning endpoint persists via this store).
