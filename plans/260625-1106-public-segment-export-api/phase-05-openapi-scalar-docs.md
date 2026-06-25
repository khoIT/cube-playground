# Phase 05 — OpenAPI + Scalar /docs

## Context
- No swagger/openapi infra today (verified). Fastify v4.
- Routes registered in `server/src/index.ts`; CORS via `@fastify/cors`.
- Target UX: interactive docs like `https://cube.gds.vng.vn/docs#`.

## Overview
- Priority: P1. Auto-generate OpenAPI 3 from the public route JSON schemas and
  serve a polished interactive reference at `/docs`.

## Requirements
- Document ONLY `/api/public/v1/*` (tag them `public`); exclude all internal routes
  via a swagger transform/filter on the tag.
- Show the API-key security scheme (`Authorization: Bearer sk_live_…`).
- Document the streaming endpoint honestly: NDJSON/CSV media types, `?format`,
  `?cursor` resume semantics, `X-Total-Count`, the "last uid = cursor" rule.
- **Document the completion contract as a REQUIRED consumer step** (not a footnote):
  a `200 OK` on a hijacked stream cannot be downgraded mid-flight, so a partial
  pull is byte-indistinguishable from a complete one. Consumers MUST verify both
  `X-Total-Count` == rows received AND presence of the trailing `_complete`
  sentinel (`{"_complete":true,"count":N}` / `# complete,N`) before trusting the
  data; on mismatch, resume with `?cursor=`. Surface this prominently in the Scalar
  description block for the members endpoint, and link the standalone
  consumer-integration doc.
- `/docs` reachable without an API key (docs are public); the endpoints themselves
  still require a key (shown as "Authorize" in the UI).

## Architecture
- Add deps: `@fastify/swagger@^8`, `@scalar/fastify-api-reference` (Scalar = the
  cube-docs-like UI). Register `@fastify/swagger` early (before routes) with
  `openapi: { info, servers, components.securitySchemes.apiKey }`; register Scalar
  at `/docs` pointing to the generated `/openapi.json`.
- `servers` MUST be the real prod host: `https://playground.gds.vng.vn` (so "Try
  it" hits the right origin). Docs live at `https://playground.gds.vng.vn/docs`.
- Document `?fields=` (default `uid`) and `available_fields` from the metadata
  detail; state that the field set GROWS within v1 (additive, non-breaking) and
  consumers must tolerate unknown fields.
- Add Fastify route `schema` blocks (tags:['public'], security, params, querystring,
  response) to the Phase 03/04 handlers — these drive both validation AND the spec.
- A `transform`/filter so only `tags:['public']` operations appear.

## Related code files
- Edit: `server/src/index.ts` (register swagger + scalar before route registration),
  `routes/public-export.ts` (add `schema` to each route), `server/package.json`.
- Read: existing route registration order in `index.ts`.

## Implementation steps
1. Install deps; register `@fastify/swagger` with OpenAPI 3 doc + apiKey scheme.
2. Register Scalar reference at `/docs` (+ raw `/openapi.json`).
3. Annotate public routes with `schema` (tags/security/params/query/responses).
4. Filter spec to `public` tag only.
5. Verify: `/docs` renders, "Authorize" with a key, "Try it" hits a real segment;
   internal routes absent from `/openapi.json`.

## Todo
- [ ] add + register @fastify/swagger (OpenAPI 3 + apiKey scheme)
- [ ] register Scalar at /docs + /openapi.json
- [ ] schema blocks on public routes
- [ ] tag filter (public only)
- [ ] manual verify render + try-it + internal routes hidden

## Success criteria
- `/docs` is a working interactive reference; a key can be authorized and a live
  pull executed from the page; only public v1 routes are documented.

## Risks
- Streaming responses don't model cleanly in OpenAPI → describe as
  `text/csv`/`application/x-ndjson` string body + prose on chunking/resume.
- Swagger accidentally exposing internal routes → assert spec contains only
  `/api/public/v1/*` paths in a test.

## Security
- Spec must not leak internal endpoints or example secrets. `/docs` is public by
  design; auth is still enforced at call time.
