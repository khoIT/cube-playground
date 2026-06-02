---
title: "Unified Concept Fabric"
description: "Glossary-as-hub linking data-model fields ↔ metrics ↔ glossary ↔ segments, with a unified trust ladder, cross-product term resolution, governed self-serve authoring, and one cross-layer explorer."
status: pending
priority: P2
branch: "main"
tags: [glossary, metrics, semantic-layer, catalog, governance, chat-grounding]
blockedBy: []
blocks: []
created: "2026-06-02T20:31:32.119Z"
createdBy: "ck:plan"
source: skill
---

# Unified Concept Fabric

## Overview

Connect 4 siloed concept layers (data-model fields, metrics, glossary, segments) into one navigable, governed fabric. The **glossary term is the hub/router**: it resolves to a metric, a field, a segment, and/or a parameterised build-query, and grounds the chat agent in certified definitions. A **single unified trust/visibility ladder** replaces 3 divergent per-layer vocabularies so self-serve creation is safe. One cross-layer explorer (extended Schema Cartographer) lets users browse + create + promote in any direction.

Authoritative spec: `plans/reports/brainstorm-260603-0324-unified-concept-fabric.md`.

Most infra already exists (concept-tier fields, `secondaryCatalogIds[]`, metric trust tiers, segment save-bar, composition wizard, glossary edit forms, Cartographer). This plan **formalizes + populates + wires + unifies**, it does not greenfield.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 0 | [Whale Resolver Quick-Fix](./phase-00-whale-resolver-quickfix.md) | Complete (commit/PR pending) |
| 1 | [Prototype (huashu)](./phase-01-prototype.md) | Pending |
| 2 | [Registry & Trust Model](./phase-02-registry-trust-model.md) | Pending |
| 3 | [Linking & Affordance](./phase-03-linking-affordance.md) | Pending |
| 4 | [Authoring & Governance](./phase-04-authoring-governance.md) | Pending |
| 5 | [Unified Map](./phase-05-unified-map.md) | Pending |

## Sequencing & Dependencies

- **P0 (Whale Resolver Quick-Fix)** — independent ~1-day ship; no deps, blocks nothing. Fixes the term→index dead-end immediately (resolver honors `default_filter_json`/`defaultMeasureRef` + glossary `#term` anchor) so the headline pain ships ahead of the registry work. The whale/dolphin/minnow filters already exist in the seed; only the resolver + anchor are missing.
- **P1 (Prototype)** — no code deps; validates UX before build.
- **P2 (Registry & Trust Model)** — foundation; depends on P1 sign-off. Unblocks P3, P4, P5.
- **P3 (Linking)** & **P4 (Authoring)** — both depend on P2; **sequenced P3→P4** (P4 badge-on-chip needs P3's chip; both edit `glossary.ts`), or split by explicit file-ownership globs (C11).
- **P5 (Unified Map)** — depends on P2; surfaces P3 + P4; runs **last**.

Cross-plan: builds on completed plans — `260527-1306-glossary-resolver-consolidation` (resolver baseline), `260527-1257-metric-cube-coverage-sync` (field↔metric coverage feeds reverse index), `260530-1406-cube-model-onboarding-agent` (owns L1 field authoring — this plan keeps fields read-only for end users), `260530-1204-metric-drift-center` (metric governance). No active blockers (all complete).

## Open Questions (carried from brainstorm)

1. ~~`entity_cube` for payer tiers (`mf_users` vs `players`)~~ — **dissolved as a blocker** (red-team S2). `parent_term` IS-A is cut (no consumer, and the whale→spender chain spans `mf_users`/`players`/`recharge` so it cannot inherit across cubes); `entity_cube`/`entity_pk` are now optional/non-blocking (the row-picker already infers cube+identity from the query). Backfill needs only `default_filter_json` (already in seed) + `default_measure_ref`; author `entity_cube` only where obviously known.
2. ✅ **RESOLVED (2026-06-03)** — existing segments default to **`personal`** on migration. Segments are owner-only today (403 if not owner; no sharing mechanism exists — `segments.ts:257,344`), so `personal` exactly preserves current access; any other default newly exposes private segments. Sharing is explicit opt-in in P4.
3. ✅ **RESOLVED (2026-06-03)** — the **server owns the registry**; `chat-service` consumes it via the **existing HTTP glossary/concepts API** (it already fetches `GET /api/glossary?status=official` with ETag — `chat-service/src/nl-to-query/glossary-client.ts:7,40,77`). Extend that contract to carry resolved trust + typed refs; do NOT duplicate registry logic in chat-service (single source of truth). The agent's grounding tool stays a thin HTTP client.

## Red Team Review

### Session — 2026-06-03
4 hostile reviewers (Security Adversary · Failure-Mode Analyst · Assumption Destroyer · Scope & Complexity Critic), Full verification tier. 33 raw findings → 14 adjudicated, all evidence-backed (`file:line`).
**Findings:** 14 (12 correctness/structural accepted, 1 scope hybrid, 1 new phase added; 2 scope-cuts declined by user). **Severity:** 6 Critical, 7 High, 1 Medium.

| # | Finding | Sev | Disposition | Applied To |
|---|---------|-----|-------------|------------|
| C1 | Seed re-seed clobbers DB backfill — backfill via `glossary.seed.json` edit, not DB data-migration (re-seed guard `source='seed' AND editor_name IS NULL` protects user rows) | Critical | Accept | Phase 2 |
| C2 | Metric trust is in YAML not DB — split trust unification by storage substrate (YAML bulk-rewrite + loader reload / SQL migration / segment column) | Critical | Accept | Phase 2 |
| C3 | `chat-service` is an unenumerated reader of `?status=official` (ETag) — add to reader list, back-compat alias one release, resolve Q3 before cutover | Critical | Accept | Phase 2 |
| C4 | Migration runner forward-only (`user_version=files.length`) — additive+nullable schema, feature-flag the data migration, document no auto-rollback | Critical | Accept | Phase 2 |
| C5 | Glossary is a global table — re-filter every `segments/<id>` ref through workspace+owner/visibility at dereference; cross-workspace success criterion | Critical | Accept | Phase 2 |
| C6 | `metric-trust-resolver` downgrades trust at runtime — unified trust = `resolveTrustForGame` output (resolved, per-game), not declared YAML | High | Accept | Phase 2 |
| C7 | Segments have a colliding `status` column + owner-only access — visibility is net-new schema + owner-403 relaxation, not a flag; distinct column name; Q2 pre-req | High | Accept | Phase 4 |
| C8 | Write-RBAC is a prefix allowlist; `/api/glossary` + `/api/concepts` absent, certify ungated — add prefixes + `requireRole('admin')` on certify; fix file pointer; viewer-403 test | High | Accept | Phase 4 |
| C9 | `resolveConcept` can't keep a sync signature — split sync `resolveConceptHref` + async `useConceptResolution`; migrate the 2 JSX callers | High | Accept | Phase 3 |
| C10 | Promote IDOR + unvalidated ref grammar + write-time-only dangling check — authorized accessor on promote; Zod namespace allowlist; delete-time coverage guard | High | Accept | Phase 2/4 |
| C11 | P3∥P4 not truly parallel (share `glossary.ts`, chip→badge ordering) — sequence P3→P4 or split by file-ownership globs | High | Accept | Phase 3/4 |
| C12 | Phase 5 "extend Cartographer index" is a rewrite (cube-FQN-bound) — re-scope as new `ConceptNode` index alongside; fix cube-segment vs app-segment naming; bump effort | High | Accept | Phase 5 |
| S1 | Whale dead-end is ~90% data-resolved — ship a standalone resolver quick-fix first | Critical | Accept (new Phase 0) | Phase 0 |
| S2 | `entity_cube`/`pk`/`parent_term` backfill — **hybrid**: keep `default_filter_json`+`default_measure_ref`, drop `parent_term`, `entity_cube`/`pk` optional | Medium | Accept (modified) | Phase 2 |

**Declined (user kept confirmed brainstorm scope):**
- **S3** — full `visibility × trust` ladder kept in P2 (user: build the personal/shared/org axis now; it's the substrate for P4 authoring).
- **S4** — reverse-index cache + auto-suggest pipeline kept (with C-fix to invalidation: real write-path invalidation keyed by workspace; stop citing `use-identity-map` as the model).

### Whole-Plan Consistency Sweep
- Files reread: plan.md, phase-00..05.
- Decision deltas checked: 14 (new Phase 0; seed-not-DB backfill; substrate-split trust; chat-service reader; feature-flagged migration; workspace re-filter; resolved-trust; segment-schema authz; prefix-allowlist + admin certify; sync/async resolver split; promote authz + ref grammar; P3→P4 sequencing; Cartographer re-scope; parent_term cut).
- Reconciled stale references: Open Q1 downgraded (parent_term cut); "parallel" claim qualified; "extend Cartographer" → "new index alongside"; backfill mechanism corrected seed-wide.
- Unresolved contradictions: 0.
