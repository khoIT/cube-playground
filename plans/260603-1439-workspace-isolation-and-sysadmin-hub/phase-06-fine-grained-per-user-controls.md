---
phase: 6
title: "Fine-Grained Per-User Controls"
status: pending
priority: P2
effort: "2d"
dependencies: [5]
---

# Phase 6: Fine-Grained Per-User Controls (Sub-project C, control surface)

## Overview
Enhance the per-user panel's affordance. **Red-team reframe (C1/H2):** `AccessEditor` + `use-admin-access` ALREADY ship role/status PATCH, workspaces/games/features PUT from one panel, last-admin 409 inline, and last-login display. This phase is NOT a rebuild — it adds the genuinely net-new affordance: game-count label, switch-ability selector, bulk select, effective-default display, "last changed by/at" (from `access_audit`). Right-sized: a `GrantMatrix` enhancement + a pure selector, not a greenfield control surface.

## Reality Check (verified)
- Shipped: `access-editor.tsx:25-114` (role/status/PUT-grants/409-inline/last-login), `use-admin-access.ts:92-121` (mutators w/ correct URL/method/body).
- **No cache layer exists** (red-team H2): `use-admin-access` is plain async + `useState`+`refetch`, no react-query/SWR. "Cache invalidation + optimistic rollback" must be **hand-rolled** — that's the real work here, not endpoint wiring.
- `GrantMatrix` (`grant-matrix.tsx:13-22`) is a dumb controlled checkbox list: no count, no bulk, no effective-default, no grouping — all net-new.

## Requirements
- Functional:
  - Save role/status (`PATCH /api/admin/users/:email`), workspaces (`PUT …/workspaces`), games (`PUT …/games`), features (`PUT …/features`) from the panel.
  - **Workspace switching control:** granting ≥2 workspaces enables switching for that user; UI states this explicitly (0/1 = locked to default/none; ≥2 = can switch). No new backend — derived from workspace grants.
  - **Game access:** multi-select with live count ("4 of 12 games"); bulk select-all/clear within the matrix.
  - **Feature visibility:** toggles grouped by area (chats, playground, data-model, metrics-catalog, liveops, dashboards, segments, admin) using existing `feature_flags` user-scope; show effective default vs override.
  - Last-admin guard surfaced (409 → clear inline message, not a crash).
  - Every mutation already writes `access_audit`; surface "last changed by/at" in the panel.
- Non-functional: optimistic UI with rollback on error; all tokens; matches the signed-off prototype.

## Architecture
- Reuse existing `use-admin-access` mutators (`PATCH /:email`, `PUT …/workspaces|games|features`); add hand-rolled optimistic-update + rollback + refetch (no react-query in repo — do not introduce one for this).
- Derive switch-ability + game-count in a pure selector (unit-testable) from grant state.
- Feature toggles render effective state = `featureDefaultEnabled(key)` overlaid by user-scope override; toggling writes a user-scope flag (existing `PUT …/features`).
- Inline error mapping: 400 (validation) / 403 (guard) / 409 (last-admin) → human messages.

## Related Code Files
- Modify: `src/pages/Admin/access/use-admin-access.ts` (mutations + invalidation), `src/pages/Admin/access/access-editor.tsx`, `grant-matrix.tsx` (counts, bulk, effective-default display), per-user panel from Phase 5
- Create: `src/pages/Admin/hub/derive-user-experience.ts` (pure selector: switch-ability, game count, effective features) + test
- Read: `server/src/routes/admin-access.ts` (endpoint shapes), `server/src/auth/feature-keys.ts` (defaults), `access-audit` shape

## TDD: Tests First
1. `derive-user-experience.test.ts`: 0/1/≥2 workspaces → correct switch-ability; game count; effective feature state (default vs override) for each key.
2. Hook/component tests: each save calls the correct endpoint with the exact payload; 409 last-admin renders inline message; optimistic update rolls back on error.
3. Run → red → implement → green.

## Implementation Steps
1. Write selector + mutation/error tests (tests-first).
2. Implement `derive-user-experience` selector.
3. Wire role/status/workspaces/games/features mutations with invalidation + optimistic UI.
4. Add game-count + bulk actions + effective-default display to `GrantMatrix`.
5. Add switch-ability affordance + "last changed by/at" (from audit) to the panel.
6. Inline error mapping (400/403/409); FE suite green; manual admin walkthrough.

## Success Criteria
- [ ] Admin sets role/status/workspaces/games/features from one panel; all persist + audit.
- [ ] Switch-ability + game count derived correctly (unit-tested); features show effective vs override.
- [ ] Last-admin (409) + validation/permission errors surface inline, no crash.
- [ ] Optimistic UI with rollback; tokens + prototype parity; FE tests green.

## Risk Assessment
- **Risk:** UI lets admin self-lockout. **Mitigation:** backend last-admin guard already enforces; surface the 409 clearly.
- **Risk:** feature default vs override confusion. **Mitigation:** show both; selector unit-tested.
- **Risk:** payload mismatch with existing PUT endpoints. **Mitigation:** endpoint-shape tests assert exact payloads.
