# Phase 12 — Connect & Profile form → real provisioning

**Context:** [plan.md](./plan.md) · v2 Decision 1. Turns the disabled-preview form
(`connector-connect-form.tsx`) into a real provisioning flow. Depends on Phase 09 (store),
Phase 10 (field schemas + dataSource writer), Phase 11 (introspect).

## Overview
- **Priority:** P1.
- **Status:** Planned.
- Replace the hard-coded `disabled` "Connect & profile" + "Test connection" buttons. Render fields
  **dynamically from the source-type registry**, test the connection, provision (persist + write
  dataSource registry entry), then introspect → land in the Datasets/triage flow.

## Key Insights
- Current form (`connector-connect-form.tsx`) hard-codes 5 Trino-ish fields + `disabled` buttons
  with "coming soon" tooltips (lines 164–170). v1 banner says secrets are server-seeded — that
  copy changes here.
- Field set is now per-source-type (BigQuery = service-account JSON file; Postgres = host/port/db/
  user/pass; Trino = catalog/schema). Drive entirely from `SourceType.fields` (Phase 10).
- Provisioning endpoint persists via `connector-store` (Phase 09) + writes `datasources.config.json`
  (Phase 10). Approval gate: same generator≠approver posture as v1 (self-approve only in dev) —
  but for *connector* creation, gate is write-role + game/workspace grant (provisioning ≠ model write).

## Requirements
**Functional**
- `POST /api/onboarding/connectors/test` — validate fields, attempt a bounded connect, return
  `{ ok, latencyMs }` or a redacted error. Dispatch by `driverType`.
- `POST /api/onboarding/connectors` — validate (registry), encrypt+persist (Phase 09), write
  dataSource registry entry (Phase 10), return `ConnectorPublic`. RBAC + grant re-check.
- FE: dynamic field renderer from `SourceType.fields`; client validation mirrors server; live
  "Test connection" state; on success → provision → route to connector detail → introspect.
- Honest degraded state: if the cube.js generalization isn't wired, show the "manual step required"
  banner (Phase 10) and mark connector `degraded` (still introspectable for modeling).

**Non-functional**
- Secrets POSTed over the existing transport; never echoed back; password fields `type=password`;
  service-account files parsed server-side, never stored in plaintext.

## Architecture
`connector-connect-form.tsx` (dynamic fields) → `onboarding-client.ts` (test/provision) →
`onboarding.ts` routes → `connector-store` + `datasource-registry-writer` + `getProfiler`.

## Related Code Files
- **Modify:** `src/pages/Data/connector-connect-form.tsx` (dynamic fields, real buttons),
  `src/api/onboarding-client.ts` (test/provision methods), `server/src/routes/onboarding.ts`
  (two new routes), `src/pages/Data/index.tsx` (post-provision routing).
- **Read for context:** `source-type-registry.ts`, `connector-store.ts`, `add-connector.tsx`.

## Implementation Steps
1. BE `POST /connectors/test`: registry-validate → bounded connect via driverType → redacted result.
2. BE `POST /connectors`: validate → vault-encrypt + persist → registry-write → introspect-ready.
   Enforce write-role + grant; SSRF host allowlist/format check using `Field` metadata.
3. FE dynamic field renderer keyed by selected `sourceType`; remove static `disabled`.
4. Wire Test → Provision → route to `ConnectorDetail` (Datasets tab) → kick off introspect.
5. Degraded-mode banner when dataSource registry isn't consumed by cube.js yet.

## Todo
- [ ] `POST /connectors/test` (per-type, redacted)
- [ ] `POST /connectors` (validate→encrypt→persist→registry-write) + RBAC + SSRF check
- [ ] FE dynamic fields from registry; enable real buttons
- [ ] Post-provision routing → detail → introspect
- [ ] Degraded-mode banner

## Success Criteria
- Fill Postgres fields → Test passes → Connect provisions a real connector → Datasets tab lists
  its tables (live introspection), with NO secret in any response.
- Viewer role → buttons hidden / 403 on POST.

## Risks & Mitigation
- **SSRF (host now user-supplied):** allowlist/CIDR or format validation + block link-local/metadata
  IPs; document for `/ck:security`. Hard gate before any connect attempt.
- **Bad creds UX:** redacted, actionable error copy; never leak host internals.

## Security
- Primary new attack surface of v2. SSRF guard, secret redaction, RBAC + grant, no secret echo.
  MUST be included in the post-ship `/ck:security` review (extends the v1 unresolved-question).

## Next
Phase 13 (worked example for visual baseline); Phase 14 (builder over introspected profiles).
