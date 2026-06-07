# Phase 01 — server `can_administer` flag + FE control gates

## Context links

- Parent: [plan.md](plan.md)
- Server predicates: `server/src/auth/can-access-segment.ts` (admin already passes `canAdministerSegment`)
- Related decision: bootstrap-admin identity work (commit `89e04c0`) — admin must see/control everything; this closes the last display-layer gap.

## Overview

- Priority: medium (display-only leak — server authz already correct)
- Status: complete (2026-06-07)
- Additive DTO flag, 3 FE gate swaps, tests. No migration. ~1h.

## Key insights

- `hydrateSegment(row, db, preloadedTags, includeUidList, viewerSub?)` at `segments.ts:195` only receives `sub`. Every call site has `req.principal` in scope, which carries both `.sub` and `.role` — extend the param rather than re-deriving.
- `is_owner` (line 257) MUST stay strict equality — `use-segment-ids.ts:110` depends on it for the "shared with you" rail.
- `guardSegment(req, reply, id, 'administer')` already admin-passes server-side; the new flag only mirrors that capability to the FE.

## Implementation steps

1. **Server — `server/src/routes/segments.ts`**
   - Change `viewerSub?: string` param to `viewer?: { sub: string; role?: string }` (or add a parallel `viewerRole?: string` param — pick whichever diffs smaller against the segment-revamp session's tree).
   - At line 257 emit alongside untouched `is_owner`:
     ```ts
     is_owner: viewer != null && rest.owner === viewer.sub,
     can_administer: viewer != null && (rest.owner === viewer.sub || viewer.role === 'admin'),
     ```
   - Update the 7 call sites (323, 414, 424, 594, 644, 941, 967) to pass `{ sub: req.principal.sub, role: req.principal.role }`.
   - Internal callers that omit viewer → both flags false (unchanged behavior).
2. **FE type — `src/types/segment-api.ts`**: add `can_administer: boolean` next to `is_owner` (line 111).
3. **FE gates** (swap `is_owner` → `can_administer`):
   - `detail-view.tsx:208` Edit-predicate `disabled={!segment.can_administer}` + title text (line 210; reword 'Owner-only' → 'Owner or admin only').
   - `detail-view.tsx:226` Delete button render guard.
   - `share-segment-control.tsx:27` early-return read-only pill.
   - Leave `use-segment-ids.ts:110` on `is_owner` with a guard comment: `// literal ownership — can_administer would misfile org segments for admins`.
4. **FE fixtures**: any Segment test fixtures missing the new field — add `can_administer` (grep `is_owner:` under `src/`).

## Todo

- [x] Server flag + call sites
- [x] FE type + 3 gate swaps + guard comment
- [x] Server tests
- [x] FE tests
- [x] `npx tsc --noEmit` + server/FE suites green

## Tests

- Server (`server/test/`): admin viewer on foreign segment → `is_owner: false, can_administer: true`; non-admin non-owner → both false; owner → both true. Cover list + detail routes.
- FE: detail-view renders Edit/Delete enabled for `{is_owner: false, can_administer: true}`; share control shows the editable selector for same; "shared with you" rail still keyed off `is_owner` (regression: org segment with `can_administer: true, is_owner: false` stays in the rail).

## Risk assessment

- **Concurrent-session conflict (main risk):** `segments.ts`, `detail-view.tsx`, `share-segment-control.tsx` actively edited by the segment-revamp session. Mitigate: implement only when its in-flight phase is committed; small additive diff rebases easily.
- Admin mutations were already possible via API; surfacing buttons adds no new server capability. Mutations remain guarded by `guardSegment` per mode.

## Security considerations

- Flag computed server-side from verified `req.principal` (JWT-derived) — not client-claimable.
- READ-vs-mutate boundary unchanged: every mutation still passes `guardSegment('mutate'|'administer')`.

## Next steps

- After landing: spot-check on :11000 (real-auth) with a second user's segment.
