---
phase: 3
title: "Frontend + OpenAPI docs"
status: pending
priority: P2
effort: "0.5d"
dependencies: [2]
---

# Phase 3: Frontend + OpenAPI docs

## Overview
Make the paginated pull discoverable: document the `format=json`/`page_id` flow in the OpenAPI/Scalar spec, and update the Activation → Pull API tab to show the page-through-the-cohort flow with copy-paste examples.

## Requirements
- Functional: OpenAPI spec covers `format=json` + `page_id` on the members endpoint incl. 400/404/409 error bodies. Pull API tab documents the paginated flow alongside the existing stream recipe.
- Non-functional: follow `docs/design-guidelines.md` (tokens, page-header pattern, semantic status colors); reuse existing card components; no bespoke styling; keep files < 200 LOC (extract a subcomponent if the tab grows).

## Architecture
- **OpenAPI:** add/extend inline `schema` on the members route (`tags:['public']`, `security:[{apiKey:[]}]`, querystring `format:'json'`+`page_id`, response shape with `page_id`/`has_more`/`total_count`, and 400/404/409 responses) — same mechanism as the existing stream route (`docs/register-openapi-docs.ts` renders `/docs` + `/openapi.json`).
- **Frontend** (`pull-api-tab.tsx`): in the existing "Public API" integration card, add a **paginated pull** recipe:
  curl page-1 (`?format=json&limit=1000`) → response shows `page_id` → curl next (`&page_id=...`) → "repeat until `has_more=false`". Copy buttons consistent with existing recipes; wire to the real segment id + base URL already on the tab.
- Frame the two read modes: **stream** (NDJSON/CSV, everything at once) vs **paginated JSON** (`page_id`, pull at your own pace + resume). Note the 409 "refresh the segment first" case so integrators handle it.
- Keep the existing stream + Trino SQL + authenticated-credentials cards untouched.

## Related Code Files
- Modify: `server/src/routes/public-export.ts` (finalize inline `schema` on the members route — may be partly done in P2)
- Modify: `src/pages/Segments/detail/tabs/pull-api-tab.tsx` (add the paginated-pull recipe; extract `paginated-pull-card.tsx` if needed to stay < 200 LOC)
- Create (test): `server/test/openapi-spec-paginated-members.test.ts`

## Implementation Steps
1. Finalize inline `schema` for `format=json`/`page_id` + 400/404/409 responses.
2. Spec test: fetch `/openapi.json` via `app.inject()`, assert the `format`/`page_id` params + error responses are present and tagged `public`.
3. Update `pull-api-tab.tsx`: add the paginated-pull recipe card with working copy-paste curl; document the 409 refresh case.
4. Cross-check the tab against an adjacent page (Dashboards / Cohort) for token/spacing/typography parity per design guidelines.
5. Verify live: open `/docs` (Scalar) + the Pull API tab on FE :3000 against API :3004; run one real page-1→page-2 end-to-end.

## Success Criteria
- [ ] `/openapi.json` + `/docs` show `format=json`/`page_id` params and 400/404/409 responses with correct schemas.
- [ ] Pull API tab documents the paginated flow with working copy-paste examples + the 409 case.
- [ ] Tab passes a design-guidelines cross-check (tokens, header pattern, semantic colors).
- [ ] Spec test green; tester + code-reviewer gate pass.

## Risk Assessment
- **Docs drift** from handler shapes — the spec test guards param/response presence; keep examples in sync with P2 contracts.
- **Tab file size** — `pull-api-tab.tsx` is already large; extract a subcomponent rather than appending to honor the < 200 LOC rule.
