# Phase 02 — Focus Store (Context Layer B)

## Context Links

- Cross-turn-context gap analysis — "missing piece #2: turn-context store (last_skill, last_artifact_ref, last_metric, last_timeRange)"
- `chat-service/src/cache/disambig-memory-adapter.ts` — pattern to extend
- `chat-service/src/core/mode-prompts.ts:48–81` — where to inject the preamble
- `chat-service/src/db/chat-store.ts` — turn rows already carry `artifacts`, `skill`

## Overview

- **Priority:** P0 — deterministic carry-over layer; survives compaction; works even if Phase 01 SDK resume is unavailable
- **Status:** **Done** (adapter + compose injection + turn.ts write + compact port + 17 tests). UI surface lives in phase 03; anaphora eval lives in phase 09.
- **Flag:** `CHAT_CONTEXT_FOCUS_STORE`
- **Description:** Per-session focus bag — last skill, last query artifact ref, last metric, last dimension, last timeRange, last segment, last filters. Written at end of each assistant turn; injected by `compose()` into the system preamble next turn.

## Key Insights

- Phase 01 gives prose continuity; Phase 02 gives **structured** continuity the model cannot ignore.
- Same backing store as disambig memory (`kv_cache` table with `kind='session_focus'`); same TTL semantics, same per-session keying.
- Compaction must port focus across to the new session (unlike SDK resume id which is correctly cleared).
- Compose-time injection is the right entry point — system preamble is already the carrier for game context, field-chip guidance, etc.

## Relationship to existing disambig memory (authoritative)

Today `disambig_resolution` and the new `session_focus` would overlap on `metric / dimension / timeRange / filters` — that is a drift bug seed. Resolution:

- **`disambig_resolution`** keeps its existing role: the auto-routing input the disambig tool reads to *skip* re-asking for a slot it already has. Owned by the disambig step; read by the disambig tool only.
- **`session_focus`** is a *snapshot for prompt injection*. Written by the api/turn.ts post-turn hook (not by the disambig tool). Read by `compose()` only.
- **Source of truth.** For overlapping slots, disambig_resolution is canonical. The post-turn hook *copies* the resolution into focus alongside the non-overlapping fields (`skill`, `artifactRef`, `segment`). Writes go only one direction: disambig → focus. Never focus → disambig.
- **Forget semantics** (phase 03 matrix): clearing focus does NOT clear disambig memory (next turn would re-fill focus from disambig). Clearing disambig memory does NOT clear focus directly; focus drains naturally as the user pivots topics.

Add `SlotMemory<T>.confidence?: number` (0–1) so the phase-03 Settings UI can render `(95% — from "doanh thu")`. Populated by the disambig step when it copies into focus; absent for non-disambig slots (skill, artifactRef).

## Requirements

**Functional**
- New adapter `session-focus-adapter.ts` modelled on `disambig-memory-adapter.ts`:
  - `getFocus(db, sessionId): SessionFocus`
  - `mergeFocus(db, sessionId, ownerId, partial: Partial<SessionFocus>): void`
  - `clearFocus(db, sessionId): void`
- `SessionFocus` shape: `{ skill?, concept?, artifactRef?, metric?, dimension?, timeRange?, segment?, filters?, updatedAt? }` — values wrap in `SlotMemory<T>` for phrase capture, mirroring disambig adapter. **`concept`** (NEW from phase 02a) holds the resolved concept id (e.g. `'spender'`) when the turn went through the leaderboard / concept-resolution path; lets phase 03 chip render `● Spenders · this week · top 10` instead of bare metric refs.
- Write hook in `api/turn.ts` after `appendTurn(assistant)` — extracts focus from the turn (artifacts, intent.skill, resolved disambig slots).
- Read hook in `mode-prompts.compose()` — accepts optional `focus?: SessionFocus`; renders into a `## Conversation focus` block.
- `compactSession()` copies focus into new session before sealing the old.
- Flag-off → no read, no write; behaviour unchanged.

**Non-functional**
- Adds <500 tokens to system preamble (typical focus bag is tiny).
- Adds <10ms per turn (single kv read + write under SQLite single-writer).

## Architecture

```
Turn flow (assistant turn finalised)
  └─ api/turn.ts
     ├─ extract focus deltas:
     │    - skill       ← intent.skill (route result)
     │    - metric/dim/timeRange/filters ← disambig resolutions (already written separately)
     │    - artifactRef ← last collectedArtifacts[].id
     │    - segment     ← last cube query's segment filter, if any
     └─ sessionFocus.mergeFocus(db, sessionId, ownerId, delta)

Turn N+1 (compose system prompt)
  └─ mode-prompts.compose({ ...prev, focus: sessionFocus.getFocus(db, sessionId) })
     └─ renders ## Conversation focus block:
          - You were just talking about {{field:recharge.revenue_vnd}} (last metric)
          - For time range "last 7 days" (2026-05-19 → 2026-05-26)
          - Filtered to country = 'VN'
          - Last artifact: artifact:abc123 (revenue chart)
          - When user says "it" / "that" / "now break it down by …", assume they mean this context.

Compaction
  └─ compactSession() reads getFocus(oldSession) → mergeFocus(newSession) before sealing.
```

## Related Code Files

**Modify**
- `chat-service/src/api/turn.ts` (write deltas after assistant turn appended)
- `chat-service/src/core/mode-prompts.ts` (accept + render focus block)
- `chat-service/src/core/compact-service.ts` (port focus to new session)
- `chat-service/src/config.ts` (flag)

**Create**
- `chat-service/src/cache/session-focus-adapter.ts`
- `chat-service/src/cache/__tests__/session-focus-adapter.test.ts`
- `chat-service/src/__tests__/focus-injection-roundtrip.test.ts`

## Implementation Steps

1. Create `session-focus-adapter.ts` mirroring `disambig-memory-adapter.ts` shape (KV-backed, `kind='session_focus'`, 24h TTL). Tolerate legacy/missing fields the same way.
2. Define `SessionFocus` interface and `extractFocusDelta(turnInputs)` helper in the adapter file.
3. Extend `mode-prompts.compose()`:
   - Add `focus?: SessionFocus` to `ComposeParams`.
   - Render block conditionally (skip if empty).
   - Use `{{field:…}}` tokens where applicable so the UI shows clickable chips.
4. Plumb focus through `api/turn.ts`:
   - Read focus before `compose()`.
   - After `appendTurn(assistant)`, compute delta from `(intent, disambigResolutions, collectedArtifacts, lastQueryFilters)` → `mergeFocus`.
5. Update `compact-service.ts` to copy focus from old → new session as the final step before sealing.
6. Tests:
   - `session-focus-adapter.test.ts` — merge semantics, TTL, legacy tolerance.
   - `focus-injection-roundtrip.test.ts` — two-turn fixture: turn 1 talks about "revenue last week, filtered to VN"; turn 2 says "now by country"; assert system preamble of turn 2 includes the focus block, including resolved metric ref and country filter.
7. Eval: same anaphora set as Phase 01 — should pass even with SDK resume flag OFF.

## Todo List

- [x] `session-focus-adapter.ts` (CRUD + extractor + `renderFocusPreamble`)
- [x] `compose()` signature + render block (focus injected as `## Conversation focus`)
- [x] `turn.ts` write hook (snapshots intent.skill + collectedArtifacts[last] + disambig resolutions after appendTurn(assistant))
- [x] `compact-service.ts` port hook (focus copied old → new before sealing)
- [x] Flag plumbing (`CHAT_CONTEXT_FOCUS_STORE`)
- [x] Unit + integration tests (17 total: adapter CRUD, render, flag gates, compose roundtrip, compact port)
- [ ] Anaphora eval pass — deferred to phase 09 eval harness

## Success Criteria

- Flag-on: focus block appears in turn 2 system preamble for every session with a resolved metric/timeRange.
- Anaphora eval ≥80% pass with **only** focus store (SDK resume OFF) → proves layer B is self-sufficient.
- With both layers on, eval ≥90%.
- No regression in token usage for short sessions (focus block is ≤500 tokens).

## Risk Assessment

- **R1 Stale focus** — user pivots topics; old metric in focus block misleads model. Mitigation: focus delta extractor only writes slots present in *current* turn's resolutions; if the user clearly asks about a new metric (disambig produces a different `metric`), the new value overwrites. Add eval case: pivot mid-conversation.
- **R2 Token bloat** — focus block grows unbounded. Cap: at most 1 metric, 1 dimension, 1 timeRange, 1 segment, 5 filters. Truncate oldest.
- **R3 Privacy** — focus block could leak across users if scoping wrong. Mitigation: kv key already includes `session:<id>`, and session is owner-scoped at SQL layer.

## Security Considerations

- Same scoping discipline as disambig memory; reuse `ownerId` argument plumbing.
- Focus values are derived from the user's own data — no cross-tenant exposure risk.

## Next Steps

- Phase 03: settings UI surfaces the focus block + chat-header chip + "reset focus" button.
- Phase 07 (nl-to-query decomposition): if exposed glossary/date tools succeed, write their results to focus for next turn.
