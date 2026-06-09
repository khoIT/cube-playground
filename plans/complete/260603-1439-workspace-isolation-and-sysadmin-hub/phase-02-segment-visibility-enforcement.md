---
phase: 2
title: "Segment Visibility Enforcement"
status: complete
priority: P1
effort: "2-3d"
dependencies: [1]
---

# Phase 2: Segment Visibility Enforcement (Sub-project A)

## Overview
Close the actual data-spill gap: enforce the existing `segments.visibility` ladder on the LIST **and ALL by-id** access paths, add a visibility setter. Reuse the unified `visibility ∈ {personal, shared, org}` vocabulary. **NULL→`personal`** (honor migration 028) — NO backfill migration.

## Key Insight (verified + red-team corrected)
- `segments.visibility` column already exists (migration 028, nullable TEXT); NULL→`personal` via `SEGMENT_DEFAULT_VISIBILITY` in `trust-mapping.ts:43`, documented as "owner-private until owner opts to share."
- **Create does NOT currently accept visibility** (red-team F1): `segmentInputSchema` (`segments.ts:25-36`) has no `visibility` field and the INSERT (`segments.ts:215-237`) omits the column → every row is `NULL`. This phase adds the create/setter wiring.
- **Gap:** LIST `SELECT * FROM segments WHERE 1=1` (`segments.ts:137`) AND by-id routes never filter by visibility.
- **Decision (user-confirmed): NULL→`personal`, NO backfill.** Honors the 028 contract. **⚠ Intentional behavior change:** legacy segments become owner-only — teammates LOSE the cross-user visibility they have today (today's LIST shows all only because it never filters). Use `COALESCE(visibility,'personal')` in the predicate so correctness never depends on a migration or deploy order.
- **Contract-flip test:** `server/test/segment-multi-user-scoping.test.ts:89` asserts cross-owner delete → 204 (old workspace-shared contract). This phase OWNS updating it to the new owner-private contract; "full suite green" requires that update.
- Owner key = **sub** (Phase 1 `principal.sub`), not email.

## Requirements
- Functional:
  - LIST returns segments where `COALESCE(visibility,'personal') IN ('shared','org') OR owner = :sub`. Admin role bypasses (sees all).
  - **ALL by-id read/mutate routes** apply the same access check (red-team F3 — these are currently UNGUARDED): `GET /:id` (`:256`), `GET /:id/sql-filter` (`:544`), `GET /:id/refresh-log` (`:488`), `POST /:id/append` (`:379`), `POST /:id/refresh` (`:563`), PATCH, DELETE, uid-list. A `personal` segment is readable/mutable only by `owner==sub` or admin.
  - **Glossary segment-ref dereference** path (reverse index) must re-filter by the same predicate — a term resolving `segments/<id>` must not surface another user's personal segment.
  - Visibility setter: `personal`/`shared` by owner; `org` admin-only (Q2). Wire `visibility` into create schema + INSERT (currently absent).
  - New segments default `personal`.
- Non-functional: workspace + game filters still compose; no change to chat/dashboard isolation; **no migration** (NULL handled by COALESCE).

## Architecture
- Add visibility predicate to the LIST SQL builder via `COALESCE(visibility,'personal')` (parameterized; compose with owner/game/workspace).
- Centralize `canAccessSegment(principal, row)` + `canMutateSegment(principal, row)` helpers (owner-or-admin for personal; workspace rules for shared/org) and apply to **every** by-id route + the glossary deref path. One helper, no per-route divergence.
- **No backfill migration.** NULL = personal by COALESCE; correctness independent of deploy order (resolves the red-team migration-skip / hide-window cluster).
- FE: visibility selector on the segment save-bar/editor (personal/shared, + org if admin), design tokens. Reuse unified-concept-fabric P4 affordance (chips).
- **Comms:** legacy segments going owner-only is intentional but user-visible — note in changelog/release (Phase 7) so analysts aren't surprised that previously-visible segments "disappeared"; they remain accessible to their owner, who can set `shared`.

## Related Code Files
- Modify: `server/src/routes/segments.ts` (LIST predicate, mutation guards, setter), `server/src/services/trust-mapping.ts` (reuse enums)
- Create: `server/src/auth/can-access-segment.ts` (`canAccessSegment` + `canMutateSegment`) + test. **No migration** (NULL handled by COALESCE).
- Modify (FE): segment save-bar / editor component (visibility selector) — locate under `src/pages` segments surface
- Read: `plans/260603-0324-unified-concept-fabric/phase-04-authoring-governance.md` (visibility-set affordance already designed there)

## TDD: Tests First
1. Assert the NEW intended behavior + **close every route**:
   - LIST: A's `personal` (incl. NULL) NOT in B's list; A's `shared` IS; admin sees all.
   - **Each by-id route** (`GET /:id`, `/sql-filter`, `/refresh-log`, `POST /:id/append`, `/refresh`, PATCH, DELETE, uid-list): B gets 403/404 on A's personal segment; owner + admin succeed. One parametrized test over the route list so none is missed.
   - Glossary `segments/<id>` deref does not return A's personal segment to B.
   - `org` set rejected for non-admin (403); accepted for admin.
   - NULL-visibility row behaves as personal (COALESCE) — owner sees it, others don't.
2. **Update `segment-multi-user-scoping.test.ts`** to the new owner-private contract (cross-owner delete on personal → 403, not 204).
3. Run → red → implement predicate + guards + create/setter wiring → green.

## Implementation Steps
1. Write route-coverage + visibility tests (tests-first); update `segment-multi-user-scoping.test.ts`.
2. Add `canAccessSegment`/`canMutateSegment` helpers (Phase 1 `principal.sub`).
3. Add LIST predicate `COALESCE(visibility,'personal') IN ('shared','org') OR owner=:sub`.
4. Wire helpers into ALL by-id routes + the glossary reverse-index deref path.
5. Add `visibility` to create schema + INSERT; add setter with owner/admin gating for `org`.
6. FE visibility selector (tokens; reuse unified-fabric chips).
7. Full suite green; manual two-user check.

## Success Criteria
- [ ] LIST + every by-id route + glossary deref enforce `COALESCE(visibility,'personal')`; B cannot read/mutate A's personal segment via ANY route.
- [ ] `org` set is admin-only; create/setter accept visibility.
- [ ] No migration added; NULL behaves as personal.
- [ ] `segment-multi-user-scoping.test.ts` updated to owner-private contract; full suite green.
- [ ] FE exposes visibility with correct affordance + tokens; unified vocabulary reused.
- [ ] Chat/dashboard isolation unchanged.

## Risk Assessment
- **Risk:** missed by-id route leaks personal segments. **Mitigation:** single helper + parametrized route-coverage test over the full route list (F3).
- **Risk:** legacy segments vanish for teammates (intentional). **Mitigation:** user-confirmed; owners can re-share; changelog/release note in Phase 7.
- **Risk:** owner key mismatch (sub vs email) reintroduces dev null bug. **Mitigation:** Phase 1 `principal.sub` exclusively; tested.
- **Risk:** divergence from unified ladder. **Mitigation:** import enums from `trust-mapping.ts`; reuse P4 affordance.
