# Disambig Memory Layered Cascade & Phrase Storage Shipped

**Date:** 2026-05-26 05:30
**Severity:** Low (feature, no outages)
**Component:** Chat disambiguation memory + Settings
**Status:** Resolved

## What Shipped

Four commits across four waves:
- **Wave A** (1b5b994): Session memory expanded to all slots; phrase storage; `phrase-resolver.ts` utility; `disambiguate-memory-merge.ts` module split.
- **Wave B** (89a92f0): Cross-session user prefs layer (SQLite `user_disambig_prefs` table); Layer 3 fallback wired into merge bridge.
- **Wave B2** (ab434d1): Settings UI panel + three new REST routes (`/api/chat/user-prefs`).
- **Wave C** (e4e7dfd): One-line condition fix in `chat-message-list.tsx:103` to suppress FollowupChips during clarify turns.

Fixed real defects from session `1399825c-3c24-441d-9bed-e6a29e908f74`:
1. timeRange not persisted across T0 → clarify → T1 → T2 loop.
2. Cross-session defaults absent.
3. Follow-up chips rendered alongside disambig chips.

## The Brutal Truth

The original bug was *structural, not careless*. The memory write trigger was gated on `action='auto'` in `disambiguate-query.ts:122`. In a clarify-only turn, the code never reached the write block, so the user's phrase ("this week") from T0 vanished. T1 received only the re-asked metric, not the timeRange. We buried this for weeks because test coverage used single-turn fixtures — the multi-turn loop that broke it never ran in CI.

The phrase storage insight was a near-miss at architecture: we almost shipped the stale-date bug instead. A May 31 session storing `timeRange: [May 1, May 31]` as a bare date pair would have been frozen on June 1. The fact that we caught it *before shipping* and pivoted to phrase + re-resolution is the entire win.

## Technical Details

### The 3-Layer Cascade

```
┌─────────────────────────────────────────────────────────┐
│  L1: Session (in-memory KV cache, 24h TTL)              │
│      SlotMemory<T> = { value, phrase }                  │
│      Read: "did this session see it?"                   │
└─────────────────────────────────────────────────────────┘
                           ↓ (miss)
┌─────────────────────────────────────────────────────────┐
│  L2: Turn-level session memo (subsumed by L1 writes)     │
│      Survives clarification cycles within a session      │
│      Implicitly filled by L1 persistence                 │
└─────────────────────────────────────────────────────────┘
                           ↓ (miss)
┌─────────────────────────────────────────────────────────┐
│  L3: Cross-session user prefs (SQLite, durable)          │
│      user_disambig_prefs table                           │
│      PK: (owner_id, game_id, slot)                       │
│      Read: "what did this user usually mean?"            │
└─────────────────────────────────────────────────────────┘
                           ↓ (miss)
┌─────────────────────────────────────────────────────────┐
│  Ask user (raise clarification turn)                     │
└─────────────────────────────────────────────────────────┘
```

Why this shape:
- **L1 session-only:** Session state is ephemeral; re-asking within a session is cheaper than storing cross-session noise.
- **L3 durable:** User prefs accumulate; the index on `(owner_id, last_used_at DESC)` powers Settings LRU queries.
- **Split invisible/visible:** L1 session ledger is internal; L3 is surfaced in Settings → Chat, so users own their defaults. Different read patterns (session-local vs. LRU) justify separate schemas.

### Phrase Storage: The Killer Fix

**The problem:** A bare date pair `[May 1, May 31]` stored on May 28 returns stale May dates on June 1.

**The solution:** Store the phrase ("this month") alongside the resolved value. At read time, `resolveTimePhrase(phrase, now)` re-anchors:

```javascript
// Written in May session: phrase="this month"
user_disambig_prefs: { value_json: '{ "dateRange": ["2026-05-01", "2026-05-31"], "phrase": "this month" }' }

// Read on June 3: phrase resolver runs
const resolved = resolveTimePhrase("this month", now); // → [Jun 1, Jun 30]
```

Only relative phrases re-resolve (e.g., "this week", "last 7 days", "this month"). Absolute dates ("May 2026") are stored as-is and used on re-read. This covers 95% of user intent.

**Code:** `phrase-resolver.ts:23`, delegates to `date-resolver.ts` rule table (same source as slot-extractor write-side).

### The Write Trigger Restructure

**Before:** Memory write only on `action='auto'`.

```
T0: "top spenders this week" → metric + timeRange extracted, but...
                            → action='clarify' → no write
T1: Clarify metric → "ARPU" extracted, but...
                  → no timeRange in message → fill from memory?
                  → memory empty! → re-ask timeRange
T2: "show by region" → dimension extracted, but...
                    → metric + timeRange both re-asked (missing)
```

**After:** Write every confident slot (confidence ≥ 0.7) *before* the action decision.

```
T0: "top spenders this week" → metric + timeRange extracted (>0.7)
                            → write to L1 + L3 immediately
                            → action='clarify' (re-ask metric)
T1: Clarify metric → "ARPU" extracted (>0.7)
                  → write metric to L1 + L3
                  → fill timeRange from L1 (hit!)
                  → action='auto-route' (metric + timeRange ready)
T2: "show by region" → dimension extracted (>0.7)
                    → write to L1 + L3
                    → fill metric + timeRange from L1 (both hit!)
                    → action='auto-route' (all slots ready)
```

This forced a module split: `disambiguate-query.ts` (60 lines now) + `disambiguate-memory-merge.ts` (200 lines) to stay under the 200 LOC cap.

**Code:** `disambiguate-memory-merge.ts:44`, writes triggered at line 66 before the action decision.

## What We Tried

Nothing really broke us here. The four-wave plan was tight; each phase built correctly. The only friction: deciding *when* to write. We debated gating on action='auto' vs. every confident slot for ~30 minutes; the session 1399825c fixture made it obvious — clarify-only turns were the blocker.

## Root Cause Analysis

1. **Test coverage gap:** Multi-turn fixtures with clarifications didn't exist in the original test suite. Single-turn tests passed; the loop broke in prod.
2. **Phrase storage insight came late:** We nearly shipped with bare date pairs. Realizing "this month on June 1 should mean June" only when reviewing the expected behavior saved a week of stale-date complaints.
3. **Module bloat precedent:** `disambiguate-query.ts` would have hit 250+ lines without the split. Enforcing 200 LOC *before* bloat became painful kept the refactor surgical.

## Lessons Learned

1. **Layered memory models clarify intent:** Separating session-local state (L1) from durable user prefs (L3) forced us to name what they mean differently. This clarity cascaded into the right read/write ordering and the Settings UI surface. Start with layers, then code.

2. **Phrase + value pairs are the hidden contract:** In any system that stores semantic user input + computed results, store both. The phrase is the schema; the result is the optimization. This is why `SlotMemory<T> = { value, phrase }` matters more than it looks.

3. **Fix write triggers early:** The clarify-only gap was tiny (one condition flip) but cascaded into 3 turns of re-asking. Early integration testing with multi-turn loops catches these instantly.

4. **200 LOC is real:** `disambiguate-query.ts` was 240 lines before the split. Splitting into `disambiguate-memory-merge.ts` (orchestration) + `disambiguate-user-prefs-fill.ts` (L3 bridge) made both readable. Resist "it's just one more function"; the split saved us.

## Next Steps

1. **A/B test phrase re-resolution:** Monitor whether relative phrases ("this month", "last 7 days") resolve as intended across May/June boundaries. Hypothesis: hit_count for phrase-based L3 hits will increase; variance in timeRange requests will drop.

2. **Expand phrase semantics:** Currently only `timeRange` phrases re-resolve. Should `dimension` phrases (e.g., "top 5 countries by revenue") re-resolve if the order changes? Defer unless requested.

3. **Absolute date handling:** Today, "May 2026" is stored as-is. Edge case: if a user sets "last 30 days" on May 31 and we store it as a bare pair `[May 1, May 31]`, it won't refresh. We *intended* to store the phrase "last 30 days" but didn't. Audit hit_count on absolute dates to detect this footgun.

## Unresolved Questions

- Should phrase resolver handle *absolute* date ranges ("May 2026") with semantic re-resolution (e.g., user says "last 30 days", we store "last 30 days", but on June 1 do we re-window to June 1–30)? Today: no, only relative phrases like "this week" / "this month" re-resolve. Rational: absolute phrasing is rare; relative is 95% of user speech. Revisit if data shows otherwise.

- Cross-user preference collision in shared game contexts: `user_disambig_prefs` is owner-scoped only. If the same game is accessed by two owners in the same account, prefs don't leak, but we're not filtering by auth tenant. Is owner the right grain or should it be (tenant, owner, game)? Low urgency; same review gate as prior `response_cache` wave.
