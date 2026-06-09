---
phase: 2
title: "Registry & Trust Model"
status: complete
priority: P1
effort: "4-6d"
dependencies: [1]
---

# Phase 2: Canonical Registry + Unified Trust Model

## Overview
The foundation. Formalize the glossary term as the typed hub (namespaced multi-refs), backfill ambiguous concepts, compute the reverse index, and migrate 3 trust vocabularies into one ladder. Everything downstream derives from this.

## Requirements
- Functional:
  - Namespaced typed refs reusing existing `secondaryCatalogIds[]` grammar, **validated on write against a namespace allowlist** (`^(business_metrics|data_model|segments)/[A-Za-z0-9._-]+$` — no `..`, no `/`-in-id): `business_metrics/<slug>`, `data_model/<cube.member>`, `segments/<id>`.
  - Backfill payer-tier concepts (whale/dolphin/minnow) **in `glossary.seed.json`** (NOT a DB data-migration): `default_filter_json` (already present in seed), `default_measure_ref`, optional `entity_cube`/`entity_pk` where obviously known, segment refs to existing "whale users"/"Q2 Whales". **`parent_term` is cut** — no consumer (`grep`=0) and whale→spender spans `mf_users`/`players`/`recharge`, so it cannot inherit across cubes.
  - Reverse index (read-only, computed): field→metrics (metric formula refs), metric→terms (refs), field→segments (segment predicate members).
  - Unified ladder: `visibility ∈ {personal, shared, org}` × `trust ∈ {draft, certified, deprecated}` on all 4 artifact types, with a back-compat mapping from the old vocabularies.
- Non-functional: zero-downtime migration; old `trust`/`status`/`trustTier` reads keep working through the mapping until consumers cut over.

## Architecture
- **Refs**: extend glossary write/validate to accept the 3 namespaces; ref grammar = `<namespace>/<id>` enforced by a Zod allowlist refinement (reject unknown namespaces, `/`-in-id, `..`). Validate-on-write resolves each ref against /meta, metric registry, segment store → reject/warn dangling; **also guard at delete time** (reverse-FK / coverage check) so a later metric/segment delete doesn't silently rot a term ref. `segments/<id>` refs are workspace+owner-scoped — **never dereference a segment ref without re-filtering through `workspace = req.workspace.id AND (owner = req.owner OR visibility != personal)`** (glossary is a global table; the ref alone crosses the tenant boundary).
- **Reverse index**: derived service, not stored. field→metrics from metric formula refs; metric→terms from glossary refs; field→segments from segment predicate members. Cache per workspace; invalidate on metric/segment/glossary write.
- **Trust model**: a single ` trust-mapping` module translating legacy → unified:
  - metrics: unified `trust` = output of `resolveTrustForGame` (the **resolved, per-game** value after drift downgrade), NOT the declared YAML trust; `visibility` defaults `org`. Unified trust stays per-game.
  - glossary `status(draft|official)` + `trustTier(certified|experimental)` → `trust` (official+certified→certified; draft→draft; experimental→draft); `visibility=org`.
  - segments (none) → `trust=certified` (they're user-built facts), `visibility` from owner/share state (Open Q2).
- Migrate **read-side first** (mapping layer surfaces unified fields without rewriting rows), then a data migration writes unified columns once all readers cut over. **All P2 schema changes are additive + nullable**; the unified-column **data** migration is **feature-flagged** so a code rollback restores behavior without a DB down-migration (the runner is forward-only, `user_version=files.length` — there is NO automated rollback; never delete an applied migration file).
- **Storage-substrate split (metric trust is NOT a DB column):** metric trust lives in 60 per-metric YAMLs — unify it via a YAML schema bump + bulk rewrite + loader cache reload; glossary via the SQL migration; segments via a column (P4). Decide where unified metric `visibility` persists (YAML key vs DB side-table) before coding.

## Related Code Files
- Modify: `src/api/glossary-client.ts` (refs + unified trust types), `server/src/routes/glossary.ts`, `server/src/routes/glossary-validators.ts` (namespace-allowlist refinement), `server/src/routes/glossary-row-mapper.ts`, `server/src/routes/glossary-measure-ref-resolver.ts`
- Modify: `server/src/types/business-metric.ts` (unified trust), `server/src/services/business-metrics-loader.ts` (loader cache reload after YAML trust bulk-rewrite), `server/src/services/metric-trust-resolver.ts` (unified trust reads its resolved output), `server/data/glossary.seed.json` (backfill — the durable mechanism), `server/src/db/glossary-migrate.ts` (extend `SeedTerm` + insert/refresh only if a new concept column is added)
- Modify (chat-service reader — C3): `chat-service/src/nl-to-query/glossary-client.ts` (Zod schema + `?status=official` query, in lockstep with the back-compat alias)
- Create: `server/src/services/concept-reverse-index.ts`, `server/src/services/trust-mapping.ts`, `server/src/db/migrations/0XX-glossary-typed-refs-and-trust.sql` (glossary columns only — additive/nullable)
- Read: `server/src/routes/glossary.ts` (`?status=official` filter + legacy `PATCH /:id/status` writer), `server/src/services/metric-coverage-resolver.ts` (reuse coverage for reverse index)

## Implementation Steps
1. ~~Resolve Open Q1~~ — dissolved (`parent_term` cut, `entity_cube` optional). Confirm `default_measure_ref` member names against live `/meta` only where authored.
2. Glossary schema migration: add unified `visibility`/`trust` columns (nullable, additive; populated by mapping); keep legacy columns. **No `parent_term` column.** Metric trust is NOT migrated here (YAML — see substrate split).
3. `trust-mapping.ts` + wire read-side so APIs emit unified fields derived from legacy. Metric unified trust = `resolveTrustForGame` output (C6). Add chat-service back-compat: keep `?status=official` as an alias for `trust=certified` one release; update `chat-service` Zod + query in lockstep (C3). Redirect/deprecate the legacy `PATCH /:id/status` writer so there's a single writer for unified trust.
4. Extend glossary refs to the 3 namespaces with a Zod **namespace-allowlist** refinement; validate-on-write (dangling guard) **and** a delete-time coverage guard (C10). Segment refs re-filtered by workspace+owner/visibility at dereference (C5).
5. `concept-reverse-index.ts` + expose `GET /api/concepts/:ref/relations`. Real write-path invalidation: metric/segment/glossary write routes call `invalidate(workspace)`; cache **keyed by workspace** (do NOT mirror `use-identity-map` — it's global + switch-only).
6. Backfill whale/dolphin/minnow (+ a handful of high-traffic ambiguous concepts) **by editing `glossary.seed.json`** — durable across deploys because re-seed only overwrites `source='seed' AND editor_name IS NULL` rows (user-added/edited rows untouched). Auto-suggest the rest from formulas/`/meta`, human-approve.
7. Feature-flagged data migration to persist unified glossary columns once readers cut over; leave legacy one release. Metric YAML trust bulk-rewrite + loader reload as a separate, flag-gated step.

## Success Criteria
- [x] Glossary term carries typed refs across all 4 layers (3 namespaces; no `parent_term`) — namespace allowlist in `glossary-validators.ts`; grammar in `trust-mapping.ts`
- [x] whale/dolphin/minnow resolve to field + segment + measure — seed backfill (`default_measure_ref=mf_users.user_count`, `entity_cube=mf_users`, `trust_tier=certified`); segment edge derived via reverse index over the shared `mf_users.payer_tier` field (no brittle UUID ref)
- [x] Reverse index returns field→metrics, metric→terms, field→segments; cache keyed by (workspace, game), invalidated on write — `concept-reverse-index.ts` + `GET /api/concepts/:namespace/:id/relations`
- [x] Unified `visibility`×`trust` readable on all 4 artifact types via mapping; legacy reads unbroken — derived on read in `glossary-row-mapper.ts`; metric trust stays resolved (`resolveTrustForGame` untouched); metric `visibility` = YAML key
- [x] `chat-service` still grounds — `?status=official` untouched + `?trust=certified` alias added; chat-service Zod gained optional trust/visibility (additive)
- [x] Dangling refs rejected on write; ref grammar rejects unknown namespaces/`..` — write-time guard in `glossary.ts` (business_metrics + segments existence; data_model grammar-only). **Delete-time guard deferred to P4** (lives with the segment/metric delete authz work; see drift note)
- [x] A term cannot resolve a segment outside the caller's workspace — reverse index scopes segments by `workspace` (see drift note)

## Implementation Outcome (2026-06-03)
- **Tests:** 30 P2-specific tests green (`trust-mapping`, `glossary-unified-refs`, `concept-reverse-index`); full server suite 602 pass / 6 pre-existing failures (`routes-crud`, `internal-access-route` — unrelated RBAC tests, untouched by P2). `tsc` clean (server + chat-service).
- **Drift — segment scoping (supersedes C5 wording):** C5 assumed segments are owner-private (`owner = req.owner OR visibility != personal`). Live code is **workspace-shared** — `owner` is provenance, the access boundary is `workspace` (verified `segments.ts:1-8,134`; corrected by commit `4de2bc5`). The reverse index therefore scopes segment edges by `workspace` (+ optional game), not owner. This fixed a real bug a code review caught (route passed `req.user.email`, but segments are written with `owner=req.owner`=Keycloak `sub` — `email≠sub` → owner scoping never matched / was null in dev). Verified by the cross-workspace isolation test.
- **Read-side-first:** migration `027` adds nullable `trust`/`visibility` columns but reads **derive** unified values from legacy `status`/`trust_tier`; the persisted-column populate (flagged data migration) is deferred — not needed since derive-on-read satisfies all criteria and keeps legacy the single source of truth.
- **Deferred to P4:** delete-time coverage guard (belongs with segment/metric delete authz).

## P2 Readiness (validated 2026-06-03, post-P1 sign-off)
- **Prototype consistency:** signed-off affordance vocabulary (`visuals/affordance-decisions.md`) is consistent with this plan. The prototype exercises chips/hover-card/promote — realized in P3/P4/P5 — while P2 is the data foundation. P2 already emits the exact `visibility ∈ {personal,shared,org} × trust ∈ {draft,certified,deprecated}` enums the prototype renders; no scope change.
- **Touchpoints confirmed:** all 12 cited files exist (verified by path check). No stale refs.
- **Migration number pinned:** latest applied is `026-dashboard-tile-chart-metadata.sql` → new glossary migration = **`027-glossary-typed-refs-and-trust.sql`** (additive + nullable only).
- **`deprecated` trust has no producer in P2** — it's a valid enum value but is only *reached* via the P4 certify/deprecate transition; P2 backfill yields only `draft`/`certified`. No deprecated rows created here.
- **✅ Decision (2026-06-03, user):** unified metric `visibility` persists as a **YAML key** alongside metric `trust` — keeps all metric governance in one substrate; reverse index already reads YAML. Glossary `visibility` stays the SQL column. No metric DB side-table.
- **Non-blocking:** Open Q1 (`entity_cube` = `mf_users` vs `players` for payer tiers) confirmed against live `/meta` during backfill (step 6), not a pre-req. Open Q2 (segment default = `personal`) and Q3 (chat-service consumes via HTTP) already resolved in `plan.md`.

## Risk Assessment
- **Biggest blast radius**: every `trust`/`status` consumer — including `chat-service` (C3) and the runtime `metric-trust-resolver` (C6). Mitigate: mapping layer + read-side-first + keep legacy columns one release; **grep all readers AND writers** (server + FE + chat-service) before the data migration; back-compat `?status=official` alias.
- **No automated rollback** (C4): migration runner is forward-only. Mitigate: additive+nullable schema, feature-flag the data migration, never delete an applied migration file.
- **Cross-workspace leak** (C5): glossary is global, segments are tenant-scoped. Mitigate: re-filter segment refs at dereference; never trust a stored ref.
- **Curation cost**: scope backfill to ambiguous + chat-referenced terms; auto-suggest rest.
- **Ref integrity**: namespace-allowlist validate-on-write + delete-time coverage guard + scheduled coverage check.
