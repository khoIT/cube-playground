---
type: brainstorm
date: 2026-05-26
slug: chat-disambig-memory-and-settings-defaults
status: agreed
---

# Brainstorm — Chat disambiguation memory expansion + Settings defaults UI

## Problem statement

Three layered issues observed in chat session `1399825c-3c24-441d-9bed-e6a29e908f74`:

1. **Date-range memory leak across turns.** T0 "top spenders this week" → clarify metric. T2 reply "ARPU" → re-asked timeRange (had "this week" in T0). T4 new query → re-asked metric (had ARPU in memory). Agent keeps looping.
2. **Three unresolved items** from prior disambig ship: cross-session prefs (deferred YAGNI), filter slot in mergeResolution (todo), chip dismissal affordance (todo).
3. **Follow-up chips render alongside disambig chips** on clarify turns. Two competing "what next" UX patterns at once → user confusion.

Plus user-raised:
- Cross-session prefs need a UI surface (Settings → Chat → "Remembered defaults") so users can see + clear what the assistant has learned.
- Storing the user's natural-language phrase alongside resolved cube refs improves accuracy (re-resolution across time) and UX (readable Settings + chat disclosures).

## Root cause analysis

| # | Observed | Root cause | Fix layer |
|---|----------|-----------|-----------|
| 1a | timeRange not memorised | `disambig-memory-adapter.ts` bag has only metric+dimension | session-memory expansion |
| 1b | T2 reply "ARPU" not memorised because T1 was clarify-only | `disambiguate-query.ts:122` writes only when `action === 'auto'` | write-on-resolve, every turn |
| 1c | T4 "Show me daily revenue" stays bound to memory's metric=ARPU | Today's "explicit wins" already handles this; verify slot-extractor catches "revenue" → recharge.revenue_vnd | extractor quality (verify, not new code) |
| 2a | Cross-session prefs absent | YAGNI'd in last ship | new table + UI surface |
| 2b | filters never persisted | tool ignores filters in mergeResolution call | small fix in tool |
| 2c | No chip dismissal | YAGNI — composer covers this | defer |
| 3 | FollowupChips render during clarify | `chat-message-list.tsx:103` condition missing `!disambigOptions` | 1-line fix |
| 4 | Time-range pref becomes stale on week/month boundaries (May→Jun) | We store resolved range, not user phrase | add phrase storage |

## Locked decisions (from user)

1. Write to memory **every turn that resolves a slot** (running ledger, not auto-route gated).
2. Intent shift: **explicit slot in current turn wins**, memory fills gaps only (today's behavior, no change).
3. Cross-session prefs: **implement now** with backing table + Settings UI.
4. Chip dismissal: **defer** (composer suffices).
5. Phrase storage: **all slots** (metric, dimension, timeRange, filters), not just time.
6. Settings layout: **two stacked SectionCards** in existing Chat tab.

## Mental model: 3-layer slot memory

```
Per slot resolution per turn:

  explicit-in-message  →  session memory  →  user prefs  →  ask user
        (Layer 1)          (Layer 2 / kv)    (Layer 3 / new)   (clarify chip)
```

| Layer | Storage | Scope | TTL | Write trigger |
|-------|---------|-------|-----|---------------|
| 1 | RAM | this turn | n/a | slot-extractor output |
| 2 | `kv_cache` kind=`disambig_resolution` | session | 24h | confident slot resolution |
| 3 | `user_disambig_prefs` (NEW) | owner+game | none (LRU) | same as Layer 2 |

Phrase + resolved-value stored together at every layer.

## Approaches evaluated

### Approach A — Minimal (rejected)

Just fix the timeRange omission + write-on-resolve. ~80 LOC. Leaves the cross-session and Settings UI gaps open.

**Rejected:** User explicitly wanted cross-session + UI surface.

### Approach B — Two-table architecture (chosen)

Session memory stays in `kv_cache`. New `user_disambig_prefs` table for cross-session. Phrase column on both. Settings → Chat gets a "Remembered defaults" section card with CRUD on user prefs.

**Pros:**
- Layered: session memory is invisible state (24h ledger); user prefs are visible state (Settings).
- Phrase storage handles week/month rollover for time prefs.
- Separates ephemeral (kv_cache) from durable (prefs table); easy to clear one without the other.

**Cons:**
- Larger surface (~720 LOC across BE+FE).
- One extra util (phrase resolver) shared between extractor + reader.

### Approach C — Unified table only (rejected)

Use only `user_disambig_prefs` with `expires_at` distinguishing session vs durable rows. ~600 LOC, fewer concepts.

**Rejected:** Mixes concerns — sessions are short-lived ledgers, prefs are user-visible state. Different read patterns (session = sync, every turn; prefs = on Settings open). Different surface implications. Cleaner to keep separate.

## Final design

### Wave A — Session memory expansion + phrase

**Files:**
- `chat-service/src/cache/disambig-memory-adapter.ts` — extend `DisambigResolutions`:
  ```ts
  interface SlotMemory<T> { value: T; phrase?: string }
  interface DisambigResolutions {
    metric?: SlotMemory<string>;
    dimension?: SlotMemory<string>;
    timeRange?: SlotMemory<{ dateRange: [string,string]; granularity?: 'day'|'week'|'month' }> & { phrase?: string };
    filters?: Record<string, SlotMemory<string>>;
    updatedAt: number;
  }
  ```
- `chat-service/src/nl-to-query/phrase-resolver.ts` — NEW pure util. Exposes `resolveTimePhrase(phrase: string, now: Date) → { dateRange, granularity }`. Used by both extractor (write) and memory reader (re-resolve on every read for timeRange).
- `chat-service/src/tools/disambiguate-query.ts` — restructure:
  1. Run extractor.
  2. Read session memory; for timeRange, re-resolve phrase if present.
  3. Fill empty slots from memory.
  4. **Write-back every confidently-resolved slot to memory before action check** (this is the fix).
  5. Re-evaluate clarifications; possibly upgrade clarify→auto.
  6. Emit `disambig_options` if still clarify.

**Tests:**
- timeRange phrase survives week boundary in same session (Sun→Mon).
- T0→T2 replay: ambiguous metric → reply "ARPU" → next turn auto-routes with both metric AND timeRange from memory.
- filters deep-merge by cube member key.
- Phrase re-resolve util: "this week" / "last 7 days" / "this month" / "yesterday" — verifiable cases against frozen now.

### Wave B — Cross-session user_disambig_prefs

**Files:**
- `chat-service/src/db/user-disambig-prefs-migrate.ts` — NEW migration:
  ```sql
  CREATE TABLE user_disambig_prefs (
    owner_id TEXT NOT NULL,
    game_id TEXT NOT NULL,
    slot TEXT NOT NULL,       -- 'metric' | 'dimension' | 'timeRange' | 'filter:<member>'
    value_json TEXT NOT NULL, -- { value, phrase? }
    hit_count INTEGER NOT NULL DEFAULT 0,
    last_used_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (owner_id, game_id, slot)
  );
  CREATE INDEX idx_udp_owner ON user_disambig_prefs(owner_id, last_used_at);
  ```
- `chat-service/src/cache/user-prefs-adapter.ts` — NEW. `getUserPrefs(db, ownerId, gameId)`, `upsertUserPref(db, ownerId, gameId, slot, value, phrase?)`, `deleteUserPref(db, ownerId, gameId, slot)`, `deleteAllUserPrefs(db, ownerId, gameId)`.
- `chat-service/src/db/migrate.ts` — wire new migration.
- `chat-service/src/tools/disambiguate-query.ts` — Layer 3 fallback: when session memory empty for a slot, read user prefs; same trigger writes user prefs alongside session memory.

**Behavior:**
- Writes piggyback: every time we write session memory, we also upsert user prefs (last-used wins).
- timeRange re-resolves phrase on every read (so May→Jun rollover is automatic).
- Disclosure: when resolving a slot from user prefs, append `'metric resolved from your saved defaults: ARPDAU'` to `warnings` (FE can surface; no UI yet).

**Tests:**
- Pref roundtrip per owner+game.
- Per-owner isolation.
- timeRange phrase re-resolves across month boundary.
- Session memory miss → user pref hit → slot filled.

### Wave B2 — Settings → Chat "Remembered defaults" UI

**API (new in `chat-service/src/server/`):**
- `GET    /api/chat/user-prefs?gameId=...` → `[{ slot, value, phrase?, label, lastUsedAt, hitCount }]`
- `DELETE /api/chat/user-prefs/:slot?gameId=...` → 204
- `DELETE /api/chat/user-prefs?gameId=...` → 204

The route resolves `label` server-side: metric `arpdau` → "ARPDAU (Average Revenue Per Daily Active User)" via cube /meta. Avoids FE meta fetch.

**FE (`src/pages/Settings/`):**
- Extend `chat-preferences-section.tsx` with a second `SectionCard` "Remembered defaults" below existing.
- NEW `src/pages/Settings/use-chat-remembered-defaults.ts` — fetch + delete hook.
- NEW `src/pages/Settings/chat-remembered-defaults-list.tsx` — renders rows + clear buttons. Uses tokens per `docs/design-guidelines.md`.

**Render:**

```
Remembered defaults
Slots the chat assistant has learned from your past sessions.

  Metric          ARPDAU                last used 2 days ago    [×]
  Time range      last 7 days           last used 2 days ago    [×]
  Dimension       country               last used 5 days ago    [×]
  Filter (channel) web                  last used 1 day ago     [×]

  [Clear all remembered defaults]
```

- Empty state: "No remembered defaults yet. The chat assistant will learn as you confirm choices in chat."
- Phrase preferred over value for timeRange. Value preferred for metric/dimension/filter (canonical labels are more useful than the user's phrase like "revenue").
- × button triggers DELETE then refetches.

**Tests:**
- Vitest+RTL: mock API → renders rows → click × → DELETE fires → row removed.
- Empty state.
- Backend route: per-owner isolation; cube /meta label resolution.

### Wave C — Suppress follow-up chips during disambig

**File:** `src/pages/Chat/components/chat-message-list.tsx:103`

```ts
// before
const showFollowups = !streaming && isLastAssistant && !!onFollowupPick;
// after
const showFollowups = !streaming && isLastAssistant && !!onFollowupPick && !msg.disambigOptions;
```

**Test:** render `AssistantMessage` with `disambigOptions` set + `showFollowups` derived → assert `[data-testid="disambig-chips"]` present, `[data-testid="followup-chips"]` absent.

## Implementation considerations

### Phrase storage rationale (per slot)

| Slot | Phrase stored | Re-resolved on read? | Why |
|------|---------------|---------------------|-----|
| timeRange | yes | YES | "this week" / "this month" rollover semantics. Critical for cross-session prefs. |
| metric | yes | no | Phrase is audit/debug data; cube ref is canonical. |
| dimension | yes | no | Same as metric. |
| filters | yes | no | Same. |

### PII / multi-user note

`user_disambig_prefs` is owner-scoped. Data sensitivity = low (which KPI a user looks at). When multi-user lands, this table is in the same review gate as `response_cache` wave-2. No additional gate added now; document in row 4 of risk table.

### Modularization

- `disambiguate-query.ts` will likely grow past 200 LOC. Plan to split out:
  - `disambiguate-memory-merge.ts` (read session + prefs, fill gaps, write back)
  - keep main file focused on extractor + clarification emission
- `user-prefs-adapter.ts` stays under 100 LOC.

### Test isolation

- Use frozen `now` in adapter tests so phrase re-resolution is deterministic.
- API route tests use `:memory:` better-sqlite3.
- FE tests mock the prefs endpoint, no live BE.

## Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| 1 | Phrase re-resolver disagrees with extractor on same phrase | Medium | Medium — wrong dates returned | Single util (`phrase-resolver.ts`) used by both. Test fixture coverage. |
| 2 | user_disambig_prefs leaks across users when multi-user lands | Low | Low (KPI prefs, not PII) | Owner-scoped reads. Same review gate as cache wave-2. |
| 3 | Wave A breaks existing 8 disambig-memory tests | Low | Low | Additive shape change; bump `DisambigResolutions` interface carefully + run tests after each commit. |
| 4 | Memory writes on low-confidence slots pollute for 24h | Medium | Medium — bad pin sticks | Confidence ≥ 0.7 gate (same threshold extractor uses for auto-route gating). |
| 5 | Settings UI label resolution adds cube /meta round-trip per defaults render | Low | Low | Backend caches meta already (cube-meta-cache.ts). 1 request, cached. |

## Success metrics

- **Replay test:** `T0 "top spenders this week" → T1 clarify metric → T2 "ARPU" → T3 auto-routes with timeRange=this week, no clarify.` Passing vitest.
- **Cross-session boundary test:** May session sets phrase=`this month`; mock clock to June 3; new session same owner, no time phrase → auto-routed range = `[Jun 1, Jun 30]`.
- **Settings UI:** click × on a row → DELETE 204 → row gone → next chat session re-asks that slot.
- **Visual:** disambig clarify turn renders only disambig chips, no FollowupChips.
- **kv_cache:** after T0, row has timeRange populated with phrase + dateRange.
- **user_disambig_prefs:** after Wave B in same session, row exists for owner+game+slot=metric.

## Next steps

1. `/ck:plan` to materialise 4 phase files: `phase-01-wave-a-session-memory.md`, `phase-02-wave-b-cross-session.md`, `phase-03-wave-b2-settings-ui.md`, `phase-04-wave-c-suppress-followups.md`.
2. Implement waves in order — each is independently testable.
3. One PR, 4 commits (one per wave).
4. Journal entry post-ship.

## Unresolved questions

- **Wave B2 i18n keys:** `settings.chat.rememberedDefaults.*` keys to be added to translations during plan phase. Confirm en+vi coverage needed (matches existing pattern in `chat-preferences-section.tsx`).
- **Filter label rendering in Settings:** filter slot key is `filter:<cube.member>`. Render as "Filter (channel)" — does the label come from cube /meta `shortTitle` or from a frontend mapping? Defer to plan phase.
- **hit_count visibility in Settings UI:** "used 3 times" useful or noise? Default to hiding; add if user asks.
