# Public Segment Export API + /docs

Expose a documented, versioned, service-to-service API so downstream apps can pull
full segment cohorts (~800k+ uids) directly from cube-playground, streamed from
Trino — without the caps/stress of the internal `/members` snapshot endpoint.

## Why
- `/api/segments/:id/members` is a capped sampler (≤1000 ranked / ≤5000 uid) and
  serves only the refresh-time snapshot — wrong tool for a full pull.
- The reliable full-cohort sources already exist: the lakehouse daily snapshot
  table (`segment_membership_daily`) and the live `membership-sql` SELECT.
- Need a real external surface: stable contract, API-key auth, rate limits,
  audit, and interactive docs like `https://playground.gds.vng.vn/docs#`.

## Deployment facts (confirmed)
- **Base URL:** `https://playground.gds.vng.vn/api/public/v1` (prod, behind VPN).
  Docs at `https://playground.gds.vng.vn/docs`. Use this host in all examples,
  OpenAPI `servers`, and consumer guides — not a placeholder.
- **Field set is forward-compatible.** v1 streams `uid` only, but MORE FIELDS WILL
  BE ADDED LATER. Design the contract so added fields are non-breaking: NDJSON
  stays object-per-line (`{"uid":...}` → `{"uid":...,"<new>":...}`), CSV columns are
  additive, and a `?fields=` query param selects columns (default = `uid` for
  back-compat). Consumers must tolerate unknown fields. This is a SemVer-minor
  evolution within v1, not a v2.

## Core design decision (locked)
The app is a **thin streaming proxy**: it streams keyset-paginated batches
straight from Trino to the client (`reply.raw`, chunked NDJSON/CSV), holding ~one
page in memory at a time. It NEVER buffers the cohort and NEVER serves it from
the capped SQLite snapshot. `runQuery` buffers — a new async-generator
`streamQuery` is required.

## Locked decisions
- Auth: **API keys** (hashed `sk_live_…`), workspace/segment-scoped, revocable, audited.
- Source: lakehouse `segment_membership_daily` when a partition exists; else live
  `membership-sql` → Trino. Never the SQLite snapshot.
- Surface: versioned `/api/public/v1/*`; only this surface is documented.
- Docs: `@fastify/swagger` (OpenAPI 3) + `@scalar/fastify-api-reference` at `/docs`.
- Formats: NDJSON (default) + CSV; keyset cursor for resumable restart.

## Phases
| # | Phase | Status | Depends |
|---|-------|--------|---------|
| 01 | [API-key auth + store](phase-01-api-key-auth.md) | pending | — |
| 02 | [Trino streamQuery generator](phase-02-trino-stream-query.md) | pending | — |
| 03 | [Streaming members export endpoint](phase-03-streaming-export-endpoint.md) | pending | 01,02 |
| 04 | [Public metadata endpoints](phase-04-public-metadata-endpoints.md) | pending | 01 |
| 05 | [OpenAPI + Scalar /docs](phase-05-openapi-scalar-docs.md) | pending | 03,04 |
| 06 | [Admin key mgmt + rate-limit + audit + tests](phase-06-admin-ratelimit-audit.md) | pending | 01,03 |

## Key dependencies
- Trino reachable from the server (CUBEJS_DB_* — already wired).
- `lakehouseConnectorFromEnv()` / `SEGMENT_MEMBERSHIP_DAILY` (exist).
- Fastify v4 → `@fastify/swagger` v8 + `@scalar/fastify-api-reference`.
- Next SQLite migration number: **074**.

## Out of scope (YAGNI for v1)
- Per-row column enrichment in the stream is uid-only **for the first ship**, but
  the contract is built for added fields (`?fields=`, additive columns) — see
  Deployment facts. Don't hardcode a uid-only assumption that blocks this.
- OAuth/client-credentials (API keys suffice).
- Push/webhooks (this is pull-only by design).
