---
phase: 4
title: Activation data model + stub
status: completed
priority: P1
effort: 1d
dependencies:
  - 2
brainstormId: P2
---

# Phase 4 (P2): Activation data model + stub

## Context Links

- Brainstorm: `../reports/brainstorm-260520-2311-segments-first-class-redesign.md` §8.1 + §15
- Mockup: `../visuals/segments-first-class-mockup.html` — Library destination chips, Detail Activation tab

## Overview

Ship the **data shape** for activations before Phase 7 wires the real MM-01 push. Add `activations[]` to Segment record (embedded, no new table per brainstorm decision). Update API client. Update library `DestinationsCell` to render real chips. Provide an empty-state Activation tab placeholder on Detail (Phase 5 turns it into the real tab body).

## Key Insights

- Embedded `activations[]` keeps backend changes minimal: column extension on `segments`, JSON-serialized. No new table = no new endpoint owner = no new auth model.
- Phase 4 is pure scaffolding so other phases can render against a stable shape. Real push happens in Phase 7.
- Fixture rows for one or two segments help validate visuals during Phase 3 and Phase 5 dev.

## Requirements

**Functional**
- Migration `006-activations.sql`: `ALTER TABLE segments ADD COLUMN activations_json TEXT NOT NULL DEFAULT '[]';` + index? No (small JSON blobs, scanned per-row).
- Server: `GET /segments` + `GET /segments/:id` parse `activations_json` → `activations: Activation[]` in response payload.
- Server: `POST /segments/:id/activations` — append a new activation to the JSON array. Used by Phase 7 only; ship the route now as a stub.
- Server: `DELETE /segments/:id/activations/:activationId` — remove. Stub for Phase 7.
- `Activation` type:
  ```ts
  interface Activation {
    id: string;                                  // synthetic uuid
    destination: 'cdp';                          // future-extensible
    game_id: string;
    env: 'dev' | 'stag' | 'prod';
    metric_name: string;
    registered_at: string;                       // ISO8601
    last_pushed_at: string | null;
    status: 'active' | 'failed' | 'pending';
    last_error?: string;
  }
  ```
- Mirror on frontend: `Segment.activations: Activation[]`.
- API client: `segmentsClient.appendActivation(id, payload)` + `removeActivation(id, activationId)` stubs.
- Update `cells/destinations-cell.tsx` (Phase 3) to consume real `activations[]`. Chip rules:
  - `active` → success chip with arrow icon, label `→ CDP · {env}`
  - `failed` → destructive chip
  - `pending` → muted chip with spinning icon
  - max 2 chips visible, overflow → `+N more`
- Empty-state `ActivationTab` component (Phase 5 turns it into full tab). For now: card with description + disabled CTA `+ Activate to CDP` (Phase 7 enables).
- Fixture: add 2-3 example activations to seed data (e.g. fixture in `server/src/routes/fixtures.ts`) so dev environments visualize chips.

**Non-functional**
- Component LOC ≤ 200 each.
- No behavioral changes to refresh job, segments list pagination, or detail polling.

## Architecture

```
server/src/db/migrations/006-activations.sql NEW
server/src/types/segment.ts                  — extend Segment with activations
server/src/routes/segments.ts                — parse activations_json on read; new POST/DELETE stubs
server/src/db/snapshot-store.ts              — include activations_json in insert/select

src/types/segment-api.ts                     — mirror Activation type + Segment.activations
src/api/segments-client.ts                   — appendActivation, removeActivation methods
src/pages/Segments/library/cells/destinations-cell.tsx — wire to real data
src/pages/Segments/detail/tabs/activation-tab.tsx NEW — empty-state shell (~80 LOC)
```

## Related Code Files

**Create**
- `/Users/lap16299/Documents/code/cube-playground/server/src/db/migrations/006-activations.sql`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/detail/tabs/activation-tab.tsx`

**Modify**
- `/Users/lap16299/Documents/code/cube-playground/server/src/types/segment.ts`
- `/Users/lap16299/Documents/code/cube-playground/server/src/routes/segments.ts` (read parse, new POST + DELETE stubs)
- `/Users/lap16299/Documents/code/cube-playground/server/src/db/snapshot-store.ts`
- `/Users/lap16299/Documents/code/cube-playground/server/src/routes/fixtures.ts` (seed example activations)
- `/Users/lap16299/Documents/code/cube-playground/src/types/segment-api.ts`
- `/Users/lap16299/Documents/code/cube-playground/src/api/segments-client.ts`
- `/Users/lap16299/Documents/code/cube-playground/src/pages/Segments/library/cells/destinations-cell.tsx` (replace empty-state with chip rendering)

**Delete** — none.

## Implementation Steps

1. **Migration 006** — Add `activations_json TEXT NOT NULL DEFAULT '[]'` to `segments`. Existing rows backfill to empty array.
2. **Server type** — Add `Activation` interface + `activations: Activation[]` to `Segment` type in `server/src/types/segment.ts`.
3. **Snapshot store** — Insert/update writes `activations_json = JSON.stringify(activations ?? [])`. Select parses with `JSON.parse(row.activations_json)`.
4. **List/detail endpoints** — Parse and include `activations` in response payload (alongside existing `predicate_tree`, `uid_list`, etc.).
5. **POST stub** — `POST /segments/:id/activations` accepts `Activation` body (without `id`/`registered_at`), generates uuid + timestamp, appends to JSON array, persists. Returns updated `Segment`.
6. **DELETE stub** — `DELETE /segments/:id/activations/:activationId` removes by id, persists. Returns updated `Segment`.
7. **Frontend type** — Mirror in `src/types/segment-api.ts`.
8. **API client** — Add `appendActivation` + `removeActivation` methods to `segmentsClient`.
9. **DestinationsCell** — Replace empty-state with chip cluster from `segment.activations || []`. Render rules per Requirements. Use Lucide `arrow-right` icon, status-colored backgrounds.
10. **ActivationTab shell** — `activation-tab.tsx`: empty-state card + description + disabled `+ Activate to CDP` button. Component imported by Phase 5's detail-view.
11. **Fixtures** — Seed one segment with 2 active CDP activations + one with a failed activation so dev/demo screens look populated. Document in fixture file header.
12. **Manual QA** — Verify library row chips render across all 3 status states; activation tab empty-state visible on a freshly-created segment.

## Todo List

- [ ] Migration 006: `activations_json` column with default `[]`
- [ ] Server `Segment.activations` type
- [ ] `snapshot-store.ts` JSON serialize/parse
- [ ] List + detail endpoints include `activations` in payload
- [ ] POST `/segments/:id/activations` stub
- [ ] DELETE `/segments/:id/activations/:activationId` stub
- [ ] Frontend `Activation` + `Segment.activations` mirror
- [ ] `segmentsClient.appendActivation` + `removeActivation`
- [ ] `destinations-cell.tsx` real chip rendering
- [ ] `activation-tab.tsx` empty-state shell
- [ ] Fixture: 2-3 example activations for dev demo
- [ ] Manual QA: library chips, detail empty tab

## Success Criteria

- [ ] Migration applies cleanly; existing segments have `[]` activations.
- [ ] Library row destination chips render for segments with seeded activations.
- [ ] POST stub appends + persists + returns updated segment.
- [ ] Activation tab shell renders without errors on Detail page (Phase 5 wires it in).
- [ ] No regression in segment list / detail load times (JSON parse on ≤100 segments is negligible).

## Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| `activations_json` grows large per segment (many env/destination combos) | L | Realistic cap: 10 activations per segment; document in type comment; size cap not enforced unless abuse seen |
| Future migration to dedicated table is harder once consumers depend on embedded shape | L | API response shape stays identical even after refactor; only internal storage changes |
| Concurrent appendActivation races overwrite array | M | Read-modify-write inside SQLite transaction; in segments.ts use `BEGIN` + select + update + commit |
| Fixture rows leak into prod | M | Document fixtures as dev-only; gate with NODE_ENV check (already pattern in `fixtures.ts`?) |

## Security Considerations

- POST/DELETE stubs must enforce owner/admin auth (same as existing `PATCH /segments/:id`).
- Validate `env` against allow-list `['dev','stag','prod']` server-side.
- Validate `metric_name` regex `/^[a-z0-9_]{1,64}$/` server-side.
- `last_error` may contain sensitive info from upstream — redact PII before storing (defer rule to Phase 7 when real errors arrive).

## Next Steps

Unblocks Phase 5 (Detail Activation tab body uses this data), Phase 7 (Push-modal Activate-to-CDP submit calls POST stub then real MM-01 in follow-up).
