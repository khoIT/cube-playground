# Phase 01 — Glossary schema + API

## Context Links

- Existing schema: `server/src/db/migrations/007-glossary.sql`
- Seed loader: `server/src/db/glossary-migrate.ts:46-94` (orphan-purge logic)
- Current routes: `server/src/routes/glossary.ts` (GET only)
- Seed JSON: `server/data/glossary.seed.json`
- Frontend client: `src/api/glossary-client.ts`
- App wiring: `server/src/index.ts`

## Overview

- Priority: P1 (blocks 02, 05, 07).
- Status: pending.
- Add VI columns, `status`, and `source` columns. Extend API with create/update/delete and status toggle. Make seed re-load coexist with user edits.

## Key Insights

- Existing rows use `id TEXT PRIMARY KEY` — keep that contract.
- `glossary-migrate.ts:84-91` deletes every row absent from the seed JSON. Without a discriminator this will wipe user-created Draft rows on every boot. Must restrict purge to `source='seed'`.
- Single-user dev environment (per CLAUDE notes); no auth header yet. Phase ships an `editor_name` body field but does not gate writes behind auth.
- Better-sqlite3 prepared statements already used everywhere — no SQL-injection surface as long as we keep using them.

## Requirements

### Functional

- New columns: `label_vi TEXT`, `description_vi TEXT`, `aliases_vi TEXT` (JSON-string array, nullable), `status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','official'))`, `source TEXT NOT NULL DEFAULT 'user' CHECK(source IN ('seed','user'))`, `editor_name TEXT`.
- `POST /api/glossary` create new row (auto-id from slug of label).
- `PUT /api/glossary/:id` full replace (label, label_vi, description, description_vi, aliases, aliases_vi, primary_catalog_id, secondary_catalog_ids, category, editor_name).
- `PATCH /api/glossary/:id/status` toggle `{status: 'draft'|'official'}`.
- `DELETE /api/glossary/:id` allowed only when `source='user'`; seed rows return 409 with hint to demote to draft.
- `GET /api/glossary` adds optional `?status=official|draft` filter; default = all.
- `GET /api/glossary` response gains an `ETag` header = `W/"<maxUpdatedAt>"` so chat-service can short-circuit.

### Non-functional

- All write endpoints: 400 on schema violation, 404 on missing id, 409 on constraint conflict, 200/201 on success with full row body.
- Prepared statements only; no string concatenation.
- File size: keep `routes/glossary.ts` <200 LOC by extracting `glossary-row-mapper.ts` and `glossary-validators.ts` siblings.

## Architecture

```
HTTP → routes/glossary.ts ──┬─→ glossary-validators.ts (zod)
                            ├─→ glossary-row-mapper.ts (row⇄wire)
                            └─→ better-sqlite3 prepared stmts
Boot →   glossary-migrate.ts (seed upsert, purge only source='seed')
```

Data flow on POST: zod-validate body → derive id (kebab(label)) → INSERT with `source='user', status='draft'` → return mapped row.

## Related Code Files

### Modify

- `server/src/routes/glossary.ts` (add 4 endpoints; extract helpers).
- `server/src/db/glossary-migrate.ts` (set `source='seed'` on upsert; scope purge `WHERE source='seed'`; preserve user edits to seed rows by upserting only when `status='draft'` AND no user touch — see Step 5 below).
- `server/data/glossary.seed.json` (add `label_vi`, `description_vi`, `aliases_vi` fields — phase-07 will fill them).
- `src/api/glossary-client.ts` (add `createGlossary`, `updateGlossary`, `setGlossaryStatus`, `deleteGlossary`; surface new fields on `GlossaryTerm`).

### Create

- `server/src/db/migrations/008-glossary-bilingual-and-status.sql`
- `server/src/routes/glossary-validators.ts`
- `server/src/routes/glossary-row-mapper.ts`

### Delete

- None.

## Implementation Steps

1. Write `008-glossary-bilingual-and-status.sql`: `ALTER TABLE glossary_terms ADD COLUMN ...` for each new column. CHECK constraints inline. Add index `idx_glossary_terms_status` on `(status, label)`.
2. Extract `glossary-row-mapper.ts`: pure functions `rowToTerm` / `termToRow`; move `safeArray` here. `glossary-validators.ts`: zod schemas `CreateTermSchema`, `UpdateTermSchema`, `StatusPatchSchema`. Both files <120 LOC.
3. Extend `routes/glossary.ts`: add four new handlers using helpers; keep file <200 LOC. ETag computed from `SELECT MAX(updated_at) FROM glossary_terms`.
4. Update `src/api/glossary-client.ts`: add 4 functions; preserve existing `listGlossary` signature; new fields on `GlossaryTerm` interface (`labelVi`, `descriptionVi`, `aliasesVi`, `status`, `source`, `editorName`).
5. Rework `glossary-migrate.ts`: (a) UPSERT sets `source='seed'`; (b) ON CONFLICT(id) — only overwrite **English** columns when the existing row has `source='seed'` AND `editor_name IS NULL` (i.e. untouched). User-touched seed rows preserve edits. (c) Purge: `DELETE FROM glossary_terms WHERE source='seed' AND id NOT IN (...)`. Document trade-off in module comment.
6. Boot-time: run `008-...sql` then `migrateGlossarySeed` (existing order in `server/src/index.ts` — verify migration runner picks up `008-*.sql` by ordinal sort).
7. Smoke-test with curl: GET filter, POST new draft, PATCH official, GET ETag stable.

## Todo List

- [ ] 008 migration SQL written + applied locally
- [ ] glossary-row-mapper.ts extracted
- [ ] glossary-validators.ts (zod) written
- [ ] 4 new endpoints implemented
- [ ] ETag header on list
- [ ] glossary-migrate.ts: source flag + scoped purge + user-edit preservation
- [ ] glossary-client.ts new functions
- [ ] curl smoke-tests pass
- [ ] All files <200 LOC verified

## Success Criteria

- `GET /api/glossary?status=official` returns only official rows.
- POST creates draft user row; subsequent boot does NOT purge it.
- Editing a seed-source row sets `editor_name` and survives next boot (seed re-upsert no-ops on touched rows).
- PATCH status returns updated `updatedAt`.
- ETag changes only when any row changes.

## Risk Assessment

- **R1.1**: Migration runs on existing DB with rows → `ALTER TABLE ADD COLUMN` is safe in SQLite (NULLable / default fills). Verified.
- **R1.2**: Existing seeded rows would have `source IS NULL` post-migration → migration sets `source='seed'` for all existing rows in a one-shot `UPDATE` (defensive, since prior boots had no `source` column).
- **R1.3**: Seed re-load logic now branches on `editor_name IS NULL` — if a user edits then later wants to revert, they must delete the row (seed re-upserts on next boot). Document in API.

## Security Considerations

- Single-user dev: no auth gate. When/if auth added later, mount these endpoints behind the same middleware as other writes.
- Input validation: zod rejects unknown fields, enforces string max-length (label ≤ 80, description ≤ 500, aliases array ≤ 20 entries × ≤ 40 chars).
- `editor_name` is freetext from client; treat as untrusted, escape on render.
- Prepared statements throughout — no SQLi.
- Body size cap: rely on Fastify default (1MB) — sufficient.

## Next Steps / Dependencies

- Unblocks Phase 02 (UI consumes new endpoints), Phase 05 (chat reads `?status=official`), Phase 07 (seed JSON shape).
