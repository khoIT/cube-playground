# Phase 01 — SDK Session Resume + Compaction (Primary Memory)

## Context Links

- Cross-turn-context gap analysis (2026-05-26 chat) — "missing piece #1: persist + pass SDK conversation id"
- `plans/reports/researcher-260526-0705-glossary-resolution-failures-session-analysis.md` — concrete prod failure caused partly by missing thread visibility
- `chat-service/src/core/claude-runner.ts:130–133` — TODO note: "Until we persist the SDK's id and pass it back on subsequent turns, every turn opens a fresh SDK conversation."
- `chat-service/src/core/compact-service.ts` — existing 80% threshold compaction; needs interaction spec for resume
- SDK review §3.#4 (cross-turn memory) — overlapping concern
- `chat-service/src/db/chat-store.ts` (sessions schema)

## Overview

- **Priority:** P0 — **primary memory mechanism** for the revamp. Aligns chat-service with how Claude Code / claude.ai / the SDK ecosystem handle session memory (thread visibility, not slot extraction).
- **Status:** Pending
- **Flag:** `CHAT_CONTEXT_SDK_RESUME` (default false until 50% ramp)
- **Description:** Two coupled deliveries:
  1. **SDK resume**: capture the SDK's `conversation_id` on the first turn, persist on `chat_sessions`, pass back on each subsequent turn so the model sees its full prior thread (every prior user message, assistant message, tool call, tool result).
  2. **Compaction strategy for thread-as-memory**: lower auto-compact threshold to 60%, expand summary preamble to preserve goal + artifacts + resolved slots, clear resume id on compact so the new session opens with summary-only context.

The two are inseparable — resume without compaction grows tokens unboundedly; compaction without resume gives up thread visibility. Ship together.

## Key Insights

- Cheapest layer: Anthropic already maintains conversational state server-side; we just lose it by opening a fresh thread each turn.
- Spike first — confirm exact SDK field names and round-trip semantics before schema changes.
- Resume + auto-compact interact: compaction creates a *new* session (`compact-service.ts:79`). New session gets a fresh SDK thread by design; layer B (focus store) covers the gap.

## Requirements

**Functional — SDK resume**
- Capture SDK conversation id from `result` event (or equivalent SDK surface) on first turn.
- Persist on `chat_sessions.sdk_conversation_id` (nullable text).
- On subsequent turn for same session, pass back via SDK `resume` / `continue` option.
- When flag off → existing behaviour (no capture, no resume).
- On `compact` event → clear `sdk_conversation_id` for the old session; the new session starts fresh.
- New SSE event: `context_resumed` (data: `{ sdkConversationId, priorTurnCount }`) emitted before `turn_started` when resume is used.

**Functional — Compaction strategy**
- Compact threshold: **60%** of model context budget (was 80%). Reason: SDK resume replays the full prior thread; we want to compact before token cost balloons.
- Summary preamble structure (new):
  ```
  ## Session goal
  <one-paragraph extraction of the user's original ask>

  ## Resolved context (carried forward)
  - Concept: <id> (from "<phrase>")
  - Metric: <ref> (from "<phrase>")
  - Time range: <range>
  - Active filters: <list>

  ## Emitted artifacts (titles + refs)
  - <artifact-1 title> (ref: <id>)
  - …

  ## Conversation summary (last N turns)
  <model-generated prose summary>
  ```
- "Session goal" extracted by the summariser by re-reading the first non-system turn (so it survives even N=10 turns of clarification).
- Artifact refs preserved verbatim so follow-up "show me that chart again" works post-compact.
- Resolved slots port via existing `disambig-memory` + new focus store (phase 02). The summary just *cites* them so the model knows they're there.
- New SSE event: `context_compacted` (data: `{ oldSessionId, newSessionId, tokensSaved, artifactCount, summaryLength }`).
- **Disambig memory port across compaction (X1).** `compactSession()` final step: for each confident slot in the old session's `kind='disambig_resolution'` row, write the same slot into the new session via `mergeResolution(db, newSessionId, ownerId, slot)`. Same one-way write as the focus-store port (phase 02). Without this, intent/concept/metric resolutions from sub-deliverable D of 02a evaporate at compact time.
- **Tool-result stripping on resume payload (X4).** Before passing the prior thread to the SDK on resume, walk the message array and replace any `tool_result` content > 2 KB with a placeholder of shape `[tool_result: <tool_name>, <approx_rows> rows, <bytes>B, ref: <artifact_ref or sha8>]`. Conversation structure is preserved; the model can still cite the tool ran without paying tokens to re-read 200-row previews. Small results (< 2 KB) pass through verbatim. Artifact refs are always preserved (cheap; lets the model say "see the chart I emitted").
- Per-session telemetry: compaction count, % of token budget saved, post-compact "did the model forget X" eval signal.

**Non-functional**
- No measurable latency regression on first turn (capture is free).
- Subsequent-turn latency may improve (Anthropic skips re-sending prior messages, but our compact threshold caps the resume payload).
- Token cost telemetry: compare input-token delta with vs without resume; ramp gated on cost/coherence tradeoff.
- p95 input tokens per turn ≤ today's value × 1.5 (slack room for thread payload until compaction kicks in).

## Architecture

```
Turn N (first)
  └─ claude-runner.run()
     ├─ query({...})                            # no resume
     ├─ on result event → extract sdk_conv_id
     └─ chatStore.setSdkConversationId(sessionId, id)

Turn N+1
  ├─ chatStore.getSession() → sdk_conv_id
  ├─ buildQueryOptions('standard', { resumeId: sdk_conv_id })
  └─ query({...resume: sdk_conv_id})
       └─ model sees prior thread

Compact
  └─ compactSession() ALSO clears sdk_conv_id from old session row
```

## Related Code Files

**Modify**
- `chat-service/src/core/claude-runner.ts` (capture + accept resume id; delete the `void sessionId` comment)
- `chat-service/src/core/query-options-presets.ts` (Phase 00 module — add `resumeId` override path)
- `chat-service/src/db/chat-store.ts` (`getSession`, `appendTurn` paths; new `setSdkConversationId`, `clearSdkConversationId`)
- `chat-service/src/db/schema.sql` (column add)
- `chat-service/src/db/migrate.ts` (migration step)
- `chat-service/src/api/turn.ts` (read session → pass `resumeId` into runner; emit `context_resumed`)
- `chat-service/src/core/compact-service.ts` (clear id on compact)
- `chat-service/src/core/sse-stream.ts` (new event type)
- `chat-service/src/config.ts` (`chatContextSdkResumeEnabled` flag)

**Create**
- `chat-service/src/__tests__/sdk-resume-roundtrip.test.ts`
- `chat-service/src/__tests__/compaction-preamble-shape.test.ts`
- `chat-service/test/eval/thread-continuity-eval.ts` + fixtures (see "End-to-end thread-continuity tests" below)

## End-to-end thread-continuity tests (acceptance gate)

These are the contract for "the agent has access to everything said during the session". Live in `chat-service/test/eval/thread-continuity-eval.ts` and run against a real chat-service instance with mocked SDK iterator (fixture replays the SDK's message stream).

| # | Scenario | Pass criteria |
|---|---|---|
| 1 | **Clarification merge** — turn 0 "top spenders this week", turn 1 (assistant clarifies "by which metric?"), turn 2 "Revenue". | Turn 2 emits a query artifact ranking spenders by revenue in ≤1 model step. Assertion: artifact query contains `orderBy=recharge.revenue_vnd DESC` AND `timeRange=this week`. |
| 2 | **Anaphora** — turn 0 emits a revenue-by-day chart, turn 1 user says "now break that down by country". | Turn 1 artifact contains the same metric + adds `dimension=country`. No re-clarification. |
| 3 | **Multi-step backtrack** — turn 0 "show revenue", turn 1 "actually paying users", turn 2 "for last 30 days". | Turn 2 artifact = paying_users for last 30 days; the discarded "revenue" doesn't leak in. |
| 4 | **Cross-artifact reference** — turn 0 emits chart A, turn 2 emits chart B, turn 4 "compare A and B". | Turn 4 references both artifacts by ref; doesn't ask "which charts?". |
| 5 | **Long-session compaction** — fixture forces 25 turns of varied queries; assertion fires after compaction triggers. | Post-compact turn answering "what did we look at first?" correctly cites the turn-0 question + emits/references the turn-0 artifact. Information-loss score ≤5% on a 20-question post-compact quiz (see "Quiz design" below). |
| 5a | **VI / code-switched compaction (X8)** — ≥3 fixture cases where the original thread is Vietnamese or VI/EN mixed. | Same quiz format as #5; tolerance ≤7% (slightly looser to absorb translation noise in the summariser). |
| 6 | **Compaction preserves slot context** — long session with metric=Revenue + timeRange=last 7d pinned in disambig memory; compaction fires. | Post-compact turn "now by country" still resolves to revenue × last 7d × country. (Tests focus-store port from phase 02 + summary preamble.) |
| 7 | **Resume id cleared on compact** — same as #5. | Post-compact session row has fresh `sdk_conversation_id` (different from pre-compact). Next turn captures a new id. |
| 8 | **Cancel mid-resume** — start turn N with resume id, user cancels mid-stream. | `sdk_conversation_id` is preserved (not cleared); next turn resumes successfully. (Tests phase 04 interaction.) |
| 9 | **Failure recovery** — turn N's SDK call fails with "thread not found" (resume id stale). | Retry without resume id; clear `sdk_conversation_id`; succeed on second attempt. |
| 10 | **A/B 4-cell** — repeat scenarios 1–4 with `{resume, focus} × {on, off}`. | 4-cell pass-rate dashboard; both-on must beat either-alone on scenarios 1, 3, 4 without ≥2× token cost regression. Both-on must not regress vs either-alone on scenarios 2, 5. |

Suite runs nightly (cost-capped) AND on every PR touching `claude-runner.ts`, `compact-service.ts`, `chat-store.ts`, `mode-prompts.ts`, `disambig-memory-adapter.ts`. PR gate: scenarios 1–4 must pass; scenarios 5–10 are advisory but failure blocks merge to `main`.

### Information-loss quiz design (X3)

Scenario 5 (and 5a) score "did the model lose information across compaction" by asking 20 questions of the post-compact session. Hybrid scoring:

- **Exact-match (12 questions)** — facts the summary preamble must preserve verbatim: original question text, emitted artifact titles, every confidently-resolved slot value (metric, timeRange, segment, filters). Pass = string equality after light normalisation. Fast, cheap, deterministic.
- **LLM-as-judge (8 questions)** — recall of prose context: "what was the user trying to achieve?", "what did they iterate on?", "what conclusion did the assistant draw?". A judge model (`config.evalJudgeModel`) compares the response against an expected answer set; scores 0/0.5/1 per question. Per-question cost ≤ $0.02 (matters for the daily budget — see X2).

Overall information-loss = `1 − (exact_pass_count + judge_score_total) / 20`. Target ≤5% (≤7% for VI cases).

Fixtures: `chat-service/test/eval/fixtures/compaction-quiz.json` with N pre-compact threads, each tagged with the 20 expected Q/A pairs. Maintained alongside the eval suite; PR review required when adding new questions.

## Implementation Steps

1. **Spike (1d, throwaway code).** Run a 3-turn fixture against staging Anthropic; log the full SDK message stream; identify the field carrying the conversation/session id and the option name accepting it on subsequent calls. Document findings in this file under "Spike result" before continuing.
2. Schema migration: add `chat_sessions.sdk_conversation_id TEXT NULL`. Idempotent migration.
3. Add `setSdkConversationId(db, sessionId, id)` and `clearSdkConversationId(db, sessionId)` in `chat-store.ts`.
4. Extend `claude-runner.RunParams` with optional `resumeId`. Pass to `buildQueryOptions()` override.
5. In `run()` generator, intercept the `result` / system-init event (whichever exposes the id) and write to a `capturedSdkConversationId` slot. After the generator drains, the API layer reads it via a callback or returned value (extend the generator to yield a `sdk_session_captured` SseEvent → handler persists).
6. `api/turn.ts`: before invoking runner, read `getSession().sdk_conversation_id` (when flag on) and pass as `resumeId`. After runner completes, persist any captured id.
7. `compact-service.ts`: clear `sdk_conversation_id` on the old session before marking it compacted.
8. Wire `CHAT_CONTEXT_SDK_RESUME` env → `config.chatContextSdkResumeEnabled`.
9. Emit `context_resumed` SSE event when resume id was used; FE Phase 03 will render an indicator.
10. Tests (`sdk-resume-roundtrip.test.ts`): mock SDK iterator; verify capture on turn 1, resume on turn 2, clear on compact.
11. Manual eval: 10-turn fixture asking follow-up questions ("now break that down by country", "why?", "compare to last week"). Score coherence vs flag-off baseline.

## Todo List

- [ ] Spike: confirm SDK surface for capture + resume in v0.3.150
- [ ] Schema migration + chat-store CRUD (sdk_conversation_id column)
- [ ] RunParams + claude-runner extension
- [ ] turn.ts wiring + flag plumbing
- [ ] compact-service: threshold to 60%, expanded summary preamble (goal + slots + artifacts + prose), context_compacted SSE
- [ ] compact-service clears sdk_conversation_id; new session starts fresh
- [ ] context_resumed SSE event
- [ ] Stale-resume-id failure recovery (clear + retry)
- [ ] Unit tests
- [ ] **End-to-end thread-continuity eval (10 scenarios above)**
- [ ] Telemetry: input-token delta dashboard + compaction-frequency histogram
- [ ] 4-cell A/B comparison (`{resume × focus} on/off`) gating ramp

## Success Criteria

- Flag-on: `chat_sessions.sdk_conversation_id` populated after turn 1 for ≥99% of sessions.
- Flag-on: ≥90% pass rate on the 10-scenario thread-continuity eval (scenarios 1–4 must be 100%).
- Long-session compaction information-loss ≤5% on the 20-question post-compact quiz (scenario 5).
- No turn failures attributable to malformed resume payload or stale resume id (graceful recovery in scenario 9).
- Compaction clears resume id; next post-compact turn opens a fresh thread cleanly (scenarios 6, 7).
- Compaction frequency stays under 1 compact per 30 user turns at p95 (means our threshold + summary are right-sized).
- 4-cell A/B (scenario 10) confirms both-on > either-alone for clarification + multi-step scenarios, no >2× cost regression.

## Risk Assessment

- **R1 SDK surface unknown** — spike step gates everything. If v0.3.150 does not expose this, fall back to Layer B (Phase 02) for all carry-over.
- **R2 Token cost growth** — long sessions resume the full thread; mitigation = auto-compact threshold already exists. Monitor input-tokens histogram by session length.
- **R3 Resume id leakage** — id is server-internal; never expose to FE. Filter from SSE payload except the gated `context_resumed` event which exposes only `{ sdkConversationId: <truncated>, priorTurnCount }` for debug builds.
- **R4 Stale id after long inactivity** — Anthropic may GC threads. Handle resume-not-found error by retrying without `resumeId` + clearing the column.

## Security Considerations

- `sdk_conversation_id` is sensitive (server-side artefact). Do not log full id in app logs; tag-truncate to first 8 chars.
- Resume id is per-session — no cross-session leak path.

## Next Steps

- Phase 02 (focus store) provides slot-level deterministic carry-over that survives compaction.
- Phase 03 surfaces "context resumed" indicator in chat header.
- Phase 04 cancellation must NOT clear the resume id (cancellation ≠ session end).

## Spike Result

_(to be filled by implementer)_
