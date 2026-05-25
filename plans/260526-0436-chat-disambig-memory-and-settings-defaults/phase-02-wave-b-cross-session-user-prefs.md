# Phase 02 — Wave B: Cross-session user_disambig_prefs

## Context Links

- Brainstorm: `plans/reports/brainstorm-260526-0436-chat-disambig-memory-and-settings-defaults.md`
- Depends on phase 01 (uses `SlotMemory<T>` + `phrase-resolver.ts`).
- Migration runner: `chat-service/src/db/migrate.ts`
- KV cache pattern reference: `chat-service/src/db/kv-cache-migrate.ts`, `chat-service/src/cache/kv-cache-store.ts`
- Disambig tool: `chat-service/src/tools/disambiguate-query.ts` (Layer 3 fallback inserted here)
- Memory merge module (from phase 01): `chat-service/src/tools/disambiguate-memory-merge.ts`

## Overview

- **Priority:** P2 (high — unblocks phase 3 UI)
- **Status:** pending
- **Description:** Add durable `user_disambig_prefs` SQLite table + adapter. Wire as Layer 3 fallback in disambig flow (read after session memory misses; write alongside session memory). Phrase preserved so timeRange re-resolves correctly across week/month boundaries.

## Key Insights

- Two-table architecture: kv_cache holds session (24h TTL) and is invisible state; `user_disambig_prefs` is durable + user-visible state. Different read patterns → keep separate.
- Writes piggyback on phase-01's write-back path: every session memory upsert also upserts the user pref (last-used wins).
- timeRange phrase is the killer feature here: May session sets "this month" → June read auto-rolls to [Jun 1, Jun 30] without a re-prompt.
- Filter slot key encoding: `filter:<cube.member>` (e.g., `filter:players.channel`). Composite primary key on (owner_id, game_id, slot).
- Per-owner-isolation is the only auth boundary (no multi-user yet). Same gate as `response_cache` wave-2 when multi-user lands.
- Adapter target ≤ 100 LOC.

## Requirements

### Functional

- New SQLite table `user_disambig_prefs` with composite PK `(owner_id, game_id, slot)`.
- Adapter functions: `getUserPrefs(db, ownerId, gameId)`, `upsertUserPref(db, ownerId, gameId, slot, value, phrase?)`, `deleteUserPref(db, ownerId, gameId, slot)`, `deleteAllUserPrefs(db, ownerId, gameId)`.
- Disambig tool Layer 3 fallback: when session memory misses for a slot, read user prefs; for timeRange, re-resolve `phrase` via `resolveTimePhrase` against `ctx.now`.
- Every confident write to session memory also upserts the user pref (same trigger, same confidence gate ≥ 0.7).
- Warning string when filling from user prefs: `'<slot> resolved from your saved defaults: <label>'`. Distinct from session-memory warning so FE/audit can tell apart.
- `last_used_at` bumped on every read that hits the row; `hit_count` incremented (single UPDATE).
- Migration idempotent (CREATE TABLE IF NOT EXISTS + index).

### Non-functional

- `user-prefs-adapter.ts` ≤ 100 LOC. Migration file ≤ 60 LOC.
- Read path adds ≤ 1 ms typical (single indexed lookup).
- TypeScript strict; no `any`.
- Migration safe on existing DB (table-not-exists path tested with `:memory:`).

## Architecture

```
disambiguate_query handler (with phase-01 merge module):
  fill order per slot:
   ┌─────────────┐    ┌──────────────────┐    ┌──────────────────────┐
   │ Layer 1     │ →  │ Layer 2 (session)│ →  │ Layer 3 (user_prefs) │ → ask
   │ extractor   │    │ kv_cache 24h     │    │ user_disambig_prefs  │
   └─────────────┘    └──────────────────┘    └──────────────────────┘

  write-back on confident slot (≥ 0.7):
    mergeResolution(db, sid, ownerId, {slot})           // Layer 2
    upsertUserPref(db, ownerId, gameId, slot, val, phr) // Layer 3
```

Schema:

```sql
CREATE TABLE IF NOT EXISTS user_disambig_prefs (
  owner_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  slot TEXT NOT NULL,            -- 'metric' | 'dimension' | 'timeRange' | 'filter:<member>'
  value_json TEXT NOT NULL,      -- JSON of { value, phrase? }
  hit_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, game_id, slot)
);
CREATE INDEX IF NOT EXISTS idx_udp_owner ON user_disambig_prefs(owner_id, last_used_at);
```

## Related Code Files

**Modify:**
- `chat-service/src/db/migrate.ts` (register new migrate fn).
- `chat-service/src/tools/disambiguate-query.ts` OR `chat-service/src/tools/disambiguate-memory-merge.ts` (add Layer 3 fallback + piggyback write).

**Create:**
- `chat-service/src/db/user-disambig-prefs-migrate.ts` (CREATE TABLE + index, idempotent).
- `chat-service/src/cache/user-prefs-adapter.ts` (CRUD).
- `chat-service/test/cache/user-prefs-adapter.test.ts` (round-trip, isolation, deletes).
- `chat-service/test/tools/disambiguate-query.user-prefs.test.ts` (cross-session, month rollover).

**Delete:** none.

## Implementation Steps

1. **Migration file.** Create `user-disambig-prefs-migrate.ts` exporting `migrateUserDisambigPrefs(db)`. Idempotent `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`.
2. **Wire migration.** Add import + call in `migrate.ts` after `migrateKvCache(db)`.
3. **Adapter.** Create `user-prefs-adapter.ts`:
   - `getUserPrefs(db, ownerId, gameId): Array<{ slot, value, phrase?, lastUsedAt, hitCount }>`.
   - `upsertUserPref(db, ownerId, gameId, slot, value, phrase?)`: INSERT ON CONFLICT DO UPDATE SET value_json=excluded.value_json, last_used_at=excluded.last_used_at, hit_count=hit_count+1.
   - `deleteUserPref(db, ownerId, gameId, slot)`.
   - `deleteAllUserPrefs(db, ownerId, gameId)`.
   - All return values typed; no `any`. Use prepared statements.
4. **Wire Layer 3 in merge module.** In `disambiguate-memory-merge.ts` (from phase 01):
   - After session-memory fill, for any slot still empty: read `getUserPrefs(db, ownerId, gameId)`; index by slot key.
   - For timeRange: if `phrase` present, call `resolveTimePhrase(phrase, ctx.now)`; else use stored dateRange.
   - Append warning `'<slot> resolved from your saved defaults: <label>'`.
   - On hit, `last_used_at` + `hit_count` updated by adapter (single UPDATE inside `getUserPrefs` if hit, OR explicit `touch` call — KISS: explicit `touchUserPref(db, ownerId, gameId, slot)`).
5. **Wire write piggyback.** Same site that calls `mergeResolution(...)` now also calls `upsertUserPref(...)` per slot. Confidence gate ≥ 0.7 applies to both.
6. **Tests.**
   - Adapter unit: round-trip per slot; per-owner isolation (owner A writes, owner B reads empty); delete-one + delete-all.
   - Tool integration: clear session memory, populate user pref metric=ARPU + timeRange phrase=`this month`; mock clock to next month; call disambig → result has both slots filled, timeRange dateRange reflects new month.
   - Cross-session boundary fixture: May 28 write phrase=`this month` → June 3 read → range `[2026-06-01, 2026-06-30]`.
7. **Compile + run.** All phase-01 tests still green.

## Todo List

- [ ] Migration file (CREATE TABLE + idx)
- [ ] Wire migration into `migrate.ts`
- [ ] Adapter CRUD (≤ 100 LOC)
- [ ] Layer 3 fill in `disambiguate-memory-merge.ts`
- [ ] Piggyback write `upsertUserPref` next to `mergeResolution`
- [ ] Adapter round-trip + isolation tests
- [ ] Cross-session timeRange month-rollover test
- [ ] Commit: `feat(chat-disambig): add cross-session user_disambig_prefs as layer-3 fallback`

## Success Criteria

- Migration runs cleanly on existing dev DB (`yarn migrate` or service boot).
- New table appears with no rows initially; `sqlite3 .schema` shows correct DDL.
- Adapter tests green: round-trip, isolation, delete-one, delete-all.
- Tool test green: cross-session phrase rolls over month boundary using mocked `ctx.now`.
- Phase-01 tests still green.
- `user-prefs-adapter.ts` ≤ 100 LOC.

## Risk Assessment

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| 1 | Schema diverges from kv_cache patterns (column naming, types) | Low | Low | Mirror `kv-cache-migrate.ts` style. INTEGER epoch ms throughout. |
| 2 | Filter slot key collision with cube member containing `:` | Low | Low | cube refs use `.` separator (e.g., `players.channel`). `filter:` prefix is unique. |
| 3 | Cross-owner leak via shared db process | Low | Med | All adapter functions take `ownerId` as required param. Test asserts per-owner isolation. |
| 4 | Layer 3 read latency on hot path | Low | Low | Single indexed lookup, prepared statement cached. < 1 ms typical. |
| 5 | Phase-01's merge module grows past 200 LOC after Layer 3 added | Med | Low | Allowed to introduce a second helper (`layer3-user-prefs-fill.ts`) if it crosses. Keep KISS: only split if needed. |
| 6 | Memory + prefs disagree (same slot, different values) | Low | Low | Read order is L1 → L2 → L3; L2 always wins when present, so divergence resolves itself on the next confident L2 write. |

## Security Considerations

- All reads / writes scoped by `(owner_id, game_id)`. Required params on every adapter call.
- `user_disambig_prefs` rows are owner-scoped — same review gate as `response_cache` wave-2 when multi-user lands. Document in `docs/system-architecture.md` row 4 of risk table when phase 03 ships.
- No PII; row content = which KPI/dim/time/filter a user looks at. Low sensitivity.
- No new network surface in this phase — HTTP endpoints land in phase 03.

## Next Steps

- Phase 3 (Settings UI) consumes the adapter via 3 new HTTP routes.
- Phase 4 unaffected.
- Future: evaluate Agent SDK v0.3.150 native memory store (researcher report `plans/reports/researcher-260526-0441-chat-service-agent-sdk-review.md` §3 item 4) as a backend swap for `user-prefs-adapter.ts`. Migration would be adapter-level; Settings UI and API unchanged. Blocked on SDK feature confirmation (researcher's open Q3).
