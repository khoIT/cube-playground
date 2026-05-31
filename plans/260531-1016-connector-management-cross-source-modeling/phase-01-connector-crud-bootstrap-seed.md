---
phase: A
title: "Connector CRUD + bootstrap-seed"
status: planned
priority: P1
effort: "8h"
dependencies: []
---

# Phase A: Connector CRUD + bootstrap-seed

## Overview
Make data connections **editable from the product UI**, persisted in the DB instead of
`.env`. The DB substrate already exists (vault, audit, upsert); this phase adds the **edit /
disable surface** and **bootstrap-seeds** the env-only Trino connection into an editable DB
row so ballistar's connection can be edited without re-typing creds.

## Key insight
- `.env` is **already** just a bootstrap fallback: `trino-profiler-config.ts` merges env/file
  seed with DB rows, and **DB wins** (`listConnectors`/`getConnector`). So "move to DB" =
  insert a row + add edit endpoints, NOT a rearchitecture.
- `createConnector` is already an upsert (`ON CONFLICT(id) DO UPDATE`). The missing piece is a
  route + a secret-preserving update (don't overwrite the sealed secret with a blank on edit).

## Requirements
**Functional**
- Edit a connector's non-secret config (host/port/user/catalog/ssl/source-specific) and
  optionally its secret; blank secret ⇒ keep the existing sealed secret.
- Disable (soft-delete) a connector; it drops out of `listConnectors` but keeps audit history.
- Bootstrap: on boot, if `CONNECTOR_SECRET_KEY` is set and the env-seeded connector
  (`game_integration`) has no DB row, insert it as an editable row (seeded from
  `TRINO_PROFILER_*`). If no vault key, leave the read-only env seed as-is (degrade, no crash).
- The read-only worked-example connector (`existing-model`) is **never** editable/disable-able.

**Non-functional**
- Secrets never returned to browser, never logged, never in `datasources.config.json`.
- Every edit/disable fires a `connector_audit` row (`update` / `disable`) with actor.
- All mutations write-role gated + workspace/game grant re-checked.

## Architecture
- **Store** (`connector-store.ts`): add
  `updateConnector(id, { label?, config, secret? }, actor, ts?)` — loads the row, reseals
  only when `secret` is a non-empty string (else preserves `secret_ciphertext/iv/tag`),
  updates `config_json` + `label`, fires `'update'` audit. Reject id `existing-model`.
- **Provisioning** (`connector-provisioning.ts`): add `updateConnectorProfile(input)` mirroring
  `provisionConnector` (validate via registry → SSRF host guard → `updateConnector` → re-emit
  `upsertDataSource`). Validation must allow a **blank secret field on edit** (registry's
  SECRET_FIELD is already `required:false`).
- **Bootstrap** (`server/src/index.ts` or a small `connector-bootstrap.ts`): call
  `seedEnvConnectorIntoDb()` once at startup — guarded by `CONNECTOR_SECRET_KEY` present +
  `getConnectorMeta('game_integration') == null` + env host present.
- **Routes** (`routes/onboarding.ts`):
  - `PATCH /api/onboarding/connectors/:id` — body = `{ label?, fields }`; 404 if unknown,
    403 if `existing-model` or grant fails, 400 on validation/host.
  - `POST /api/onboarding/connectors/:id/disable` — 200/404; refuse `existing-model`.
  - `GET /api/onboarding/connectors/:id/audit` — surface lifecycle history (reuse
    `listConnectorAudit`).
- **FE**:
  - `connector-connect-form.tsx`: accept an optional `initial` (edit mode) — prefill
    non-secret fields; secret field empty with placeholder "•••••• (unchanged)".
  - `connector-detail.tsx`: add "Edit connection" (opens form in edit mode) + "Disable"
    (confirm) for non-readOnly connectors; on success refetch.
  - `onboarding-client.ts`: `updateConnector(id, body)`, `disableConnector(id)`,
    `connectorAudit(id)`.

## Related code files
- Modify: `server/src/services/connector-store.ts`, `connector-provisioning.ts`,
  `server/src/routes/onboarding.ts`, `server/src/index.ts` (bootstrap call),
  `src/api/onboarding-client.ts`, `src/pages/Data/connector-connect-form.tsx`,
  `src/pages/Data/connector-detail.tsx`.
- Create: `server/src/services/connector-bootstrap.ts` (small, env→DB seed).
- Read for context: `server/src/services/trino-profiler-config.ts` (merge/redaction),
  `server/src/db/migrations/024-connectors.sql`, `enforce-write-roles.ts`.

## Implementation steps
1. `updateConnector` in store (secret-preserving) + `'update'` audit; refuse `existing-model`.
2. `updateConnectorProfile` in provisioning (validate → guard → update → re-emit dataSource).
3. `connector-bootstrap.ts` `seedEnvConnectorIntoDb()`; wire into startup.
4. `PATCH` + `/disable` + `/:id/audit` routes (RBAC + grant re-check).
5. FE: edit-mode form, detail actions, client methods.
6. Tests (Phase covers its own unit/route tests; see success criteria).

## Todo
- [ ] `updateConnector` secret-preserving + audit
- [ ] `updateConnectorProfile` provisioning path
- [ ] bootstrap seed env→DB (vault-key guarded)
- [ ] PATCH / disable / audit routes
- [ ] FE edit form + detail actions + client
- [ ] tests green (server suite + typecheck)

## Success criteria
- [ ] Editing a connector with a blank secret keeps the old secret (decrypt still works).
- [ ] Editing with a new secret reseals; old ciphertext gone.
- [ ] Disable removes it from `listConnectors`; audit row present.
- [ ] On boot with `CONNECTOR_SECRET_KEY` set, `game_integration` appears as an editable DB
      row; ballistar's Trino editable end-to-end.
- [ ] `existing-model` rejects edit/disable (403).
- [ ] Viewer role → 403 on all mutations.
- [ ] Server suite + `tsc` clean.

## Risks
- **Blank-secret overwrite** → explicit "non-empty string ⇒ reseal" guard + test.
- **Double-seed on restart** → guard on `getConnectorMeta(id) == null`.
- **No vault key in dev** → degrade to read-only env seed; surface "set CONNECTOR_SECRET_KEY
  to edit" hint in UI, don't crash.

## Security
- Secret-free projection invariant preserved; SSRF host guard on every edit; grant re-check;
  audit trail on all transitions.
