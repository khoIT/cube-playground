# chat_sessions Soft-Delete Semantics — Aggregate Filter Verification

**Date:** 2026-05-25
**Scope:** N4 follow-up — cache dashboard aggregates currently count rows whose originating session has been soft-deleted.

## Soft-Delete Column

Verified at `chat-service/src/db/migrate.ts:38`:
```sql
ALTER TABLE chat_sessions ADD COLUMN deleted_at INTEGER;
```
- `NULL` → live session
- non-NULL (epoch ms) → soft-deleted, pending hard-purge after 7d

Schema source at `chat-service/src/db/schema.sql:59` (the bare table — column added via migration).

## Hard-Delete Path

`chat-service/src/db/chat-store.ts:92–115` (`hardDeletePendingSessions`):
- Selects sessions with `deleted_at IS NOT NULL AND deleted_at < cutoffMs`
- DELETEs the row + writes a tombstone in `chat_tombstones`
- Runs via retention sweep (verify schedule in `retention-sweep.test.ts`)

After hard-delete, the session row vanishes — so cache rows whose `original_session_id` references a hard-deleted session JOIN to nothing.

## Current Aggregate Behavior (the N4 bug)

`chat-service/src/db/cache-effectiveness-queries.ts`:

| Function | Line | Filter on `deleted_at`? |
|----------|------|------------------------|
| `queryHitRateAndLatency` | 26–31 | NO — JOIN `chat_sessions cs` without `cs.deleted_at IS NULL` |
| `querySavingsTotals` | 66–72 | NO |
| `querySparklineByDay` | 98–105 | NO |
| `queryTopQueriesByHit` | 150–160 | NO |
| `queryStaleRatio` (current hash) | 193–201 | NO |
| `queryStaleRatio` (counts) | 210–217 | NO |

Every aggregate currently joins through `chat_sessions s` WITHOUT a `s.deleted_at IS NULL` clause. Result: a session the user soft-deleted yesterday still inflates `$ saved`, hit-rate, sparkline, and topQueries until the 7d hard-purge cron clears the chat_sessions row.

## Defense-in-Depth Reference

`chat-service/src/api/debug-cache-effectiveness.ts:66–71` DOES filter `deleted_at IS NULL` for the **403 game-existence guard** — proof the team already considers soft-deletes as "no longer mine" for this endpoint. Aggregates just got missed.

## Fix Strategy (Phase 06)

Add `AND s.deleted_at IS NULL` (or `cs.deleted_at IS NULL` where the alias differs) to all six query functions. Single-line change each.

| Function | Diff |
|----------|------|
| `queryHitRateAndLatency` | WHERE `cs.deleted_at IS NULL AND` ... |
| `querySavingsTotals` | WHERE `s.deleted_at IS NULL AND` ... |
| `querySparklineByDay` | WHERE `cs.deleted_at IS NULL AND` ... |
| `queryTopQueriesByHit` | WHERE `s.deleted_at IS NULL AND` ... |
| `queryStaleRatio` (hash) | WHERE `s.deleted_at IS NULL AND` ... |
| `queryStaleRatio` (counts) | WHERE `s.deleted_at IS NULL AND` ... |

`debug-cache-effectiveness.ts:65–75` defense-in-depth check already uses `deleted_at IS NULL` — keep it.

## N2 (Current Meta Hash) Cross-Reference

`cache-effectiveness-queries.ts:200–206`:
```ts
const currentHashByGame = new Map(hashRows.map((r) => [r.game_id, r.cube_meta_hash]));
const currentMetaHash = gameId
  ? (currentHashByGame.get(gameId) ?? null)
  : (hashRows[0]?.cube_meta_hash ?? null);  // ← arbitrary first row when no gameId filter
```

The N2 bug: when `gameId` is undefined (all-games view), `hashRows[0]?.cube_meta_hash` picks whichever game happened to come first in the GROUP BY. The hero card then shows ONE game's hash but counts stale rows ACROSS all games — counted "stale" if their hash differs from the arbitrary pick, which is wrong.

**N2 fix (Phase 06):** When `gameId` is undefined, `currentMetaHash` should be `null` (no single hash is meaningful at all-games scope), AND the staleness counting must compare each row against `currentHashByGame.get(row.game_id)` rather than a single global hash. The counts loop at lines 220–227 already does this correctly per-game — only the top-level `currentMetaHash` value is wrong. Fix:

```ts
const currentMetaHash = gameId
  ? (currentHashByGame.get(gameId) ?? null)
  : null;  // No global "current" hash makes sense across games
```

Then the FE (`CacheDashboardHero` line 222) needs to handle `currentMetaHash === null` at all-games scope — current copy `' · cube meta drifted'` is the only place it appears in the hero, and that's gated on `isStaleWarn` not on `currentMetaHash`, so the FE is already safe.

## Test Plan

- New test in `chat-service/test/db/cache-effectiveness-soft-delete.test.ts` — seed 2 sessions, soft-delete one, assert aggregates exclude the deleted one.
- New test in same file — seed cache rows for game A (hash X) and game B (hash Y), call `computeCacheEffectiveness({gameId: undefined})`, assert `currentMetaHash === null` AND `staleRatio === 0` (neither game has stale rows against its own current hash).
- Update existing tests if they rely on `hashRows[0]` deterministic ordering.

## Open Questions

None. Soft-delete column verified; all aggregate join sites enumerated; fix is mechanical.
