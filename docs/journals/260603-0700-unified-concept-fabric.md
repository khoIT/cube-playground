# 260603-0700 — Unified Concept Fabric (P1–P5 shipped)

## Context

Plan: `plans/260603-0324-unified-concept-fabric/` — 5-phase feature to unify metric/segment/catalog term governance under a single transparent concept-referencing system. P0 (design + trust model research) shipped earlier; this session executed P1–P5 via autonomous `/cook --auto` run: server foundation, FE model + components, RBAC + safety checks, and cross-layer explorer. **56 files, ~4.5k insertions, committed b9114ac (not yet pushed).**

## What shipped

### P1 — Server foundation
- **Unified visibility ladder** derived on read (not stored) from legacy `status` / `trustTier` fields. Migrations 027/028 add nullable `visibility` + `visibility_reason` columns; values stay derived until a future backfill (reduces risky data mutability). Root lesson: read-side-first visibility beats eager materialization.
- **Metric `visibility` persisted as YAML key** per user decision—metric governance stays in one substrate. `Metric.visibility` in the YAML, `namespaced_concept` table holds reference metadata.
- **Typed namespaced-ref registry** (`/server/services/concept-registry.ts`) + reverse-index service (`/server/services/concept-reverse-index.ts`) + `/api/concepts/:ns/:id/relations` endpoint. Reverse index scoped by **workspace**, not user email (caught in P3 review: original plan said segments owner-private; live code makes them workspace-shared with owner as provenance).
- **26/26 vitest pass.** Routes, concept-ref normalization, reverse-index scoping all tested.

### P2 (indistinct from P1 execution)
- Migrations 027/028 deploy cleanly; nullable columns strategy avoids backfill risk.

### P3 — Frontend layer
- **Model-driven `resolveConcept()`** hook; shared `ConceptChip` + `ConceptHoverCard` primitives.
- **P3 H3 bug (module-cache abort poison):** a hover-card subscriber's `AbortController` was passed to the shared cached fetch. On unmount, aborting the subscriber poisoned the cache for all other subscribers of that ref. **Fix:** don't tie subscriber AbortControllers to a shared cached fetch; subscribers detach listeners, fetch lives for other callers. Lesson: per-subscriber abort + shared cache are fundamentally incompatible.
- **P3 H1/H2 (ref-shape normalization):** payer-tier terms have null `primaryCatalogId`, bare-member terms (e.g., `mf_users.country`) aren't namespaced. Both broke the relations fetch until `toConceptRef()` normalizer derived `data_model/<member>` namespace. Ref-shape must be canonical before round-tripping.
- **12/12 vitest pass** (chip rendering, hover fetch logic, normalizers).

### P4 — RBAC + safety
- **Write-RBAC prefix scoping** (`CONCEPT_WRITE_CERTIFY_`, `CONCEPT_DELETE_`).
- **Admin-gated certify endpoint** + segment→concept promotion (IDOR-safe: checks `workspace + user in promotion_context`).
- **Delete-time ref guard:** preventing deletion of a concept with live inbound refs (reverse index blocks deletes).
- **6 pre-existing test failures confirmed unrelated** (routes-crud owner-403, internal-access-route; env-secret test). Did not chase.

### P5 — Explorer
- **KISS detail-panel approach** (~250 LOC). Deliberately **NOT** the plan's full ConceptNode index rewrite (would be 5–8 days). Trade-off documented: non-`data_model` `?focus` refs don't highlight a tree node in the explorer. `ConceptChip` navigation covers the gap for the common path. Acceptable for MVP; reserved as future micro-optimization if in-map metric/segment focus is later wanted.
- **8/8 vitest pass.** Detail panel state, ref resolution in explorer.

## Key decisions + lessons

1. **Verified code beats stale plan.** Plan's C5 claimed segments are owner-private; live code (segments.ts header, commit 4de2bc5) made them workspace-shared with owner as provenance. Plan doesn't reflect the actual model. Caught at P4 review: reverse-index scoping by `req.user.email` while segments key on `owner=sub` (email ≠ sub), making the scoping stricter than the real model. **Fixed by scoping the reverse index by workspace.** Hard lesson: re-verify access-model assumptions against *live code*, not plan docs. Plans drift.

2. **Module-cache + per-subscriber abort don't mix.** The shared hover-card fetch cache was tied to the first subscriber's AbortController. When that subscriber unmounted, the abort poisoned the cache for all others. Fixed by structurally separating: shared fetches live at module level with their own lifecycle; subscribers just attach/detach listeners. Lesson: if a resource is shared, its cancellation must be shared too, or shared cache becomes shared poison.

3. **Ref-shape normalization is load-bearing.** `payer_tier` terms have null catalogId; bare members (e.g., `mf_users.country`) aren't namespace-qualified. Relations query breaks until a `toConceptRef()` normalizer derives the canonical shape (`data_model/<member>`). Lesson: normalize early, trust it later. Spot-checking ref shapes in isolation will find bugs.

4. **Session-token exhaustion recovery.** P4 agent hit token limit mid-run; on resume, state was reconstructed from git status + test suite (no agent summary report). Everything compiled; the agent's inlined-scaffolder choice (no separate `promote-to-metric.ts`) was sound. Also caught: agent corrupted `en.json` with curly/smart quotes (invalid JSON, would fail i18n build). Found via pre-commit JSON.parse validation. **Lesson:** build-time validation catches automation mistakes that humans miss.

5. **Partial-apply honesty.** Plan said 5 discrete phases; executing P1–P5 in one `/cook --auto` session means trade-offs to stay in one session-token budget. The explorer isn't the full data-model-indexed node rewrite; that's documented as a future micro-optimization, not a bug. Shipping MVP + documenting the cut beats claiming full spec done.

## Unresolved / follow-ups

- **Glossary audit store.** Term promotion is logged to structured log only (no glossary-scoped audit table yet). Is this acceptable for compliance? Documented as a follow-up task.
- **ConceptNode index for in-map focus.** Currently, non-`data_model` `?focus` refs don't highlight in the explorer tree. If usage data shows metric/segment focus is a common path, consider a secondary reverse index for data_model focus. Low priority unless UX telemetry asks for it.
- **Push to prod.** Branch not yet pushed. Requires vault/deploy coordination (see memory: `cube-playground-prod-vault-deploy.md`).
