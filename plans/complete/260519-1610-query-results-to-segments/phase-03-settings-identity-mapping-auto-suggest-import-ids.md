---
phase: 3
title: "Settings identity mapping + auto-suggest + Import IDs"
status: pending
priority: P2
effort: "4d"
dependencies: [1, 2]
---

# Phase 3: Settings identity mapping + auto-suggest + Import IDs

## Overview

Add the Settings → **Cube identity mapping** section so every cube has a declared entity-id column. Server auto-suggests by scanning `/meta` for dimensions ending in `*.user_id` / `*_id`; user confirms or overrides. Also ship the `Import IDs` flow — CSV upload creates a static segment from a user-supplied uid list.

## Requirements

**Functional**
- Backend `GET /api/settings/identity-map` returns one row per cube, merging persisted overrides with auto-suggestions. Response shape: `{ cube_name, identity_dim, source: 'user'|'auto-suggest', is_suggested: bool }[]`.
- Backend `PUT /api/settings/identity-map/:cube` persists `{ identity_dim }`; rejects unknown dims (must exist in `/meta`).
- Backend `POST /api/segments/import-ids` accepts multipart upload (CSV) or JSON body with `uids: string[]`; validates size cap (5,000); creates a static segment owned by caller.
- Settings page section renders cube list with dropdown per row + a "Reset to auto-suggest" link if user-overridden.
- Library `Import IDs` button opens a modal with: file picker (CSV) + name field + cube picker (limited to cubes with identity-dim set) + confirm.
- Import errors surface inline (oversize, malformed CSV, non-UTF8, missing identity-dim mapping).

**Non-functional**
- Auto-suggest is deterministic for the same `/meta` input.
- CSV parser caps memory (streamed line-by-line with hard row limit).
- Settings save is optimistic with rollback on server error.

## Architecture

```
server/src/
  services/
    identity-suggester.ts        (scans /meta → suggestion map)
    csv-importer.ts              (streamed parse + validate)
  routes/
    identity-map.ts              (extends P1 stub: now serves merged GET)
    segments.ts                  (adds /import-ids)

<!-- Updated: Validation Session 1 - existing settings at src/components/Settings/Settings.tsx (not src/pages/Settings/) -->
src/
  components/
    Settings/
      Settings.tsx                 (MODIFY - existing; render new identity-map section)
      identity-map/
        identity-map-section.tsx   (NEW)
        identity-map-row.tsx       (NEW)
  pages/Segments/library/
    import-ids-modal.tsx
  api/
    segments-client.ts           (adds importIds, identityMap.get/put)
```

`identity-suggester.ts` walks all cubes in `/meta` and proposes the first dimension whose qualified name matches `/\.(user_id|uid|customer_id)$/i` or whose `shortName === 'user_id'`.

## Related Code Files

**Create**
- `server/src/services/{identity-suggester,csv-importer}.ts`
- `server/test/{identity-suggester,csv-importer}.test.ts`
- `src/components/Settings/identity-map/identity-map-section.tsx`
- `src/components/Settings/identity-map/identity-map-row.tsx`
- `src/pages/Segments/library/import-ids-modal.tsx`

**Modify**
- `server/src/routes/identity-map.ts` — switch to merged GET response
- `server/src/routes/segments.ts` — add `/import-ids` endpoint
- `src/components/Settings/Settings.tsx` — render the new identity-map section
- `src/api/segments-client.ts` — add `importIds`, `identityMap.list`, `identityMap.put`
- `src/pages/Segments/library/library-toolbar.tsx` — wire `Import IDs` button

## Implementation Steps

1. Implement `identity-suggester.ts`:
   - Read meta via `cube-client.fetchMeta()`.
   - For each `cubes[i]`, find first dimension matching `(/\.(user_id|uid|customer_id)$/i)`.
   - Return `{ cube_name, identity_dim, source: 'auto-suggest' }`.
2. Update `routes/identity-map.ts` GET:
   - Load persisted rows from `cube_identity_map` table.
   - Load suggestions from `identity-suggester`.
   - Merge: persisted overrides win; unmapped cubes get `source: 'auto-suggest'` + `is_suggested: true`.
3. Implement `csv-importer.ts`:
   - Stream parser (single header column expected to be `user_id`, or no header).
   - Strip whitespace, dedupe, reject non-printable / >256-char lines.
   - Cap at 5,000 rows; return `{ uids: string[], errors: ImportError[] }`.
4. Implement `routes/segments.ts` `POST /api/segments/import-ids`:
   - `multipart/form-data` for CSV upload + JSON metadata (`name`, `cube_name`, `tags`).
   - Falls back to JSON body for programmatic use.
   - Resolves `identity_dim` from `cube_identity_map`; rejects if missing (400).
   - Creates static segment with provided uids.
5. Add backend tests:
   - `identity-suggester.test.ts` — fixture meta yields expected mapping.
   - `csv-importer.test.ts` — happy path, oversize, malformed, dedupe.
6. Implement FE `identity-map-section.tsx` under `src/components/Settings/identity-map/`:
   - Calls `segmentsClient.identityMap.list()`.
   - Renders rows; each row uses `identity-map-row.tsx` with a dropdown of dims for that cube.
   - On change: `PUT`; optimistic update; rollback on error.
   - Shows "auto-suggested" badge when `is_suggested=true`.
   - Mounted from `src/components/Settings/Settings.tsx` as a new section block.
7. Implement `import-ids-modal.tsx`:
   - File picker accepts `.csv` / `.txt`.
   - Reads file client-side to estimate row count (preview first 5 rows).
   - Cube picker — filters to cubes with mapped identity dim.
   - Submits via `FormData` to `/api/segments/import-ids`.
   - Surfaces server-returned errors inline.
8. Wire the `Import IDs` button in `library-toolbar.tsx` to open the modal.
9. Update i18n strings for both surfaces.
10. Verify `src/components/Settings/Settings.tsx` renders the new identity-map section.

## Success Criteria

- [ ] Visiting Settings → Identity mapping shows every cube with either a saved or auto-suggested identity dim.
- [ ] Changing the dropdown persists across reload.
- [ ] Reset link removes the override; row reverts to auto-suggest.
- [ ] Library → Import IDs → upload CSV of 200 uids → static segment created with 200 uids.
- [ ] CSV with 5001 rows rejected with clear error.
- [ ] CSV with non-UTF8 bytes rejected.
- [ ] Importing into a cube without identity-dim mapping shows actionable error pointing at Settings.
- [ ] Backend unit tests pass.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Auto-suggest picks wrong dim (e.g. `events.user_id` instead of `mf_users.user_id` for hub) | Allow override; show "is_suggested" badge so user knows to verify. |
| Large CSV upload OOMs server | Stream parse + hard row cap (5,000); reject oversized requests at Fastify layer. |
| Identity-dim mapping changes break existing segments | On change, mark affected segments `status='broken'` so cron + UI catch the issue (cron logic in P6 / drift in P8). |
| Import IDs encoding edge cases (CRLF, BOM, quoted strings) | Normalize to `\n`, strip BOM, support unquoted single-column only in v1; document. |
