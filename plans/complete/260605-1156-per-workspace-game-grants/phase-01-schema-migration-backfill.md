# Phase 01 — Schema Migration + Backfill

## Context Links
- Migration runner: `server/src/db/sqlite.ts:52-67` (`runMigrations`)
- Current schema: `server/src/db/migrations/019-auth-grants.sql:36-43` (`user_game_access`)
- Migrations dir tail: latest is `030-card-cache-status.sql`

## Overview
- **Priority:** P1 (blocks all)
- **Status:** pending
- **Description:** New migration `031-per-workspace-game-grants.sql` that rebuilds `user_game_access`
  with a `workspace_id` column, backfills existing global rows, and preserves PK semantics.

## Key Insights
- Migration runner is **count-keyed**: `PRAGMA user_version` stores the COUNT of `.sql` files;
  `pending = files.slice(currentVersion)` (`sqlite.ts:57-59`). A new migration MUST be appended
  with a higher-sorted filename (`031-…`). NEVER renumber or insert between existing files —
  doing so re-runs the wrong slice and corrupts version tracking.
- `foreign_keys = ON` (`sqlite.ts:42`). No FK on `user_game_access` today; keep it FK-free (game
  ids live in `gds.config.json`, workspace ids in the registry JSON — neither is a DB table).
- SQLite cannot `ALTER TABLE ADD COLUMN` into a composite PK. Must recreate the table.
- `setGames` does DELETE-all + INSERT (`access-store-mutators.ts:147-157`); the new PK must support
  per-(email,workspace) replace without clobbering other workspaces. PK = `(email, workspace_id, game_id)`.

## Requirements
- Functional: existing granted users keep their current game visibility after deploy (no lockout).
- Functional: schema supports `(email, workspace_id, game_id)` uniqueness; index on `(email, workspace_id)`.
- Non-functional: idempotent (re-runnable via `CREATE TABLE IF NOT EXISTS` semantics on fresh DB),
  transactional within the single `db.exec()` call.

## Architecture
Data flow on migrate:
```
old user_game_access(email, game_id)        user_workspace_access(email, workspace_id)
                       │                                    │
                       └───────── CROSS JOIN per email ─────┘
                                         ▼
        new user_game_access(email, workspace_id, game_id)   ← backfill
```
Backfill rule (PROPOSED — see Open Questions): for each existing `(email, game_id)`, insert one row
per workspace the user holds in `user_workspace_access`. Users with games but NO workspace grants
produce ZERO backfilled rows → those games vanish under fail-closed. That is correct per Locked
Decision 2, BUT may surprise users relying on workspace role-fallback. Mitigation: AUTHZ_GRANT_FALLBACK
still covers the "no grants anywhere" case (see phase-03); flag the partial-grant case to user.

Migration SQL shape (recreate + copy):
1. `CREATE TABLE user_game_access_new (email TEXT NOT NULL, workspace_id TEXT NOT NULL, game_id TEXT NOT NULL, PRIMARY KEY (email, workspace_id, game_id));`
2. `INSERT INTO user_game_access_new (email, workspace_id, game_id) SELECT g.email, w.workspace_id, g.game_id FROM user_game_access g JOIN user_workspace_access w ON w.email = g.email;`
3. `DROP TABLE user_game_access;`
4. `ALTER TABLE user_game_access_new RENAME TO user_game_access;`
5. `CREATE INDEX IF NOT EXISTS idx_uga_email_ws ON user_game_access(email, workspace_id);`

Comment in SQL: explain the WHY (per-workspace grant model, cross-join preserves current access).
NO phase/finding references in the comment or filename.

## Related Code Files
- CREATE: `server/src/db/migrations/031-per-workspace-game-grants.sql`
- READ-ONLY: `server/src/db/sqlite.ts` (confirm runner semantics; no change)

## Implementation Steps
1. Write `031-per-workspace-game-grants.sql` with the recreate+backfill SQL above.
2. Add a leading SQL comment explaining the model change and backfill intent (no plan refs).
3. Verify `idx_uga_email` (old single-col index from 019) is dropped with the table; recreate the
   compound index. The old index name `idx_uga_email` is gone after DROP TABLE — fine, new index name differs.
4. Manual sanity: run server boot against a copy of a populated dev DB; confirm `user_version` bumps
   to 31 and counts match expectation (rows = Σ per user |games|×|workspaces|).

## Todo
- [ ] Write migration file (recreate table, compound PK, backfill cross-join, compound index)
- [ ] SQL comment explains model + backfill (no plan refs)
- [ ] Boot against populated dev DB copy; verify version bump + row counts
- [ ] Confirm fresh `:memory:` test DB (rbac-enforcement pattern) applies cleanly

## Success Criteria
- Fresh DB: `user_game_access` has `(email, workspace_id, game_id)` PK; boot applies migration once.
- Populated DB: every pre-existing `(email, game_id)` with ≥1 workspace grant survives as
  `(email, ws, game_id)` for each of that user's workspaces.
- `npm test` (server) migration-applying suites (e.g. `rbac-enforcement.test.ts`) still boot.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Users with games but no workspace grant lose games | Med | Med | Documented; AUTHZ_GRANT_FALLBACK covers no-grants case; flag to user |
| Renumber/insert breaks user_version slice | Low | High | Append `031-` only; never edit prior files |
| Backfill row explosion (many users × games × ws) | Low | Low | Small org; one-time |

## Security Considerations
- Default-deny preserved: no row = no access. Backfill only ADDS rows the user already effectively had.
- No FK/PII change.

## Next Steps
- Unblocks Phase 02 (read path must SELECT workspace_id; mutators must scope by workspace).
