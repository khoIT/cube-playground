# Phase 03 — Cache-hit ratio + token I/O ratio on turn header

## Context Links
- `chat-service/src/core/sse-stream.ts:124-137` (`result` event mapping; reads `usage.input_tokens` and `usage.output_tokens` only — does NOT pick up cache token fields yet)
- `chat-service/src/api/turn.ts:322-327` (collects result event fields into local vars before appendTurn)
- `chat-service/src/db/chat-store.ts:172-210` (appendTurn — needs new params for cache columns)
- `chat-service/src/db/schema.sql:22-39` (chat_turns columns — current set lacks cache_creation/read)
- `src/pages/DevAudit/turn-detail.tsx:151-161` (`formatTurnStats` — extension point)
- `src/pages/DevAudit/use-debug-api-types.ts:17-34` (DebugTurn — needs two new fields)

## Overview
- Priority: P2
- Status: completed
- Add cache_creation_tokens / cache_read_tokens to chat_turns (additive migration); populate from the SDK `result.usage` block; surface cache-hit % and I/O ratio on the audit turn header.

## Key Insights
- chat_turns currently stores aggregate input/output only. The SDK `result.usage` object on production Anthropic models includes `cache_creation_input_tokens` and `cache_read_input_tokens` — but our `SdkResultMessage` typing at sse-stream.ts:62 doesn't read them.
- llm_calls already has cache_creation_tokens / cache_read_tokens columns (created by phase-prior migration) but they remain null because emitLlmCall sends 0 (per the SDK investigation note in observer-types.ts).
- Cheapest path: capture the aggregate at chat_turns level alongside input/output, identical to existing population logic.

## Requirements

Functional:
- chat_turns rows for assistant turns persist cache_creation_tokens and cache_read_tokens whenever the SDK result message carries them.
- Audit turn header (formatTurnStats) shows two extra space-dot-separated parts when data is non-null:
  - `cache 78%` (cache_read / (cache_read + cache_creation), 0% floor, 100% ceil, percentage rounded to integer)
  - `io 3.5x` (output / input, 1 decimal)
- Both parts dropped silently if either operand is null (KISS — never display NaN/Infinity).
- Tooltip on the stats line explains the metrics.

Non-functional:
- Cache hit % is informational only; never used for cost recalculation here (cache pricing differs by model).
- Backward compatibility: legacy turns with null cache columns simply render the existing 5 parts.

## Architecture

```
sse-stream.ts mapSdkMessage (result branch):
   reads usage.cache_creation_input_tokens / usage.cache_read_input_tokens
   passes them through SseEvent.data

turn.ts result-event handler:
   captures cache_creation_tokens / cache_read_tokens local vars

chat-store.appendTurn:
   new optional params cacheCreationTokens / cacheReadTokens
   INSERT extended

debug.ts rowToDebugTurn:
   exposes cacheCreationTokens / cacheReadTokens on DebugTurn

turn-detail.tsx formatTurnStats:
   appends `cache N%` and `io X.Xx` parts when both operands present
```

## Related Code Files

Modify:
- `chat-service/src/types.ts` — extend `SseEventResultData` (or whatever is the result data interface) with optional `cache_creation_tokens`, `cache_read_tokens`
- `chat-service/src/core/sse-stream.ts` — read both cache fields from `rm.usage`
- `chat-service/src/api/turn.ts` — capture two new locals from the result event; pass to appendTurn
- `chat-service/src/db/migrate.ts` — `addColumnIfMissing(db, 'ALTER TABLE chat_turns ADD COLUMN cache_creation_tokens INTEGER;')` + read variant
- `chat-service/src/db/chat-store.ts` — extend `AppendTurnParams` + INSERT statement
- `chat-service/src/api/debug.ts` — extend `DebugTurnDto` + `rowToDebugTurn`
- `src/pages/DevAudit/use-debug-api-types.ts` — extend `DebugTurn` with `cacheCreationTokens`, `cacheReadTokens`
- `src/pages/DevAudit/turn-detail.tsx` — extend `formatTurnStats` (kept under 200 LOC; if it grows, extract `format-turn-stats.ts`)

Create:
- `chat-service/src/__tests__/sse-stream-cache-tokens.test.ts` — mapSdkMessage extraction
- `src/pages/DevAudit/__tests__/turn-detail-stats.test.tsx` — formatTurnStats output cases

## Implementation Steps

1. **Migrations**: ALTER chat_turns ADD COLUMN cache_creation_tokens INTEGER + cache_read_tokens INTEGER via `addColumnIfMissing`.
2. **SDK result extraction**: update `SdkResultMessage` typing to include `cache_creation_input_tokens` and `cache_read_input_tokens` on usage. In `mapSdkMessage` result branch, populate the result SseEvent data with `cache_creation_tokens: rm.usage?.cache_creation_input_tokens` and the read counterpart.
3. **Turn handler**: in `turn.ts`, alongside `costUsd`, capture `cacheCreationTokens` and `cacheReadTokens` from the result event. Pass to appendTurn.
4. **chat-store**: AppendTurnParams gains `cacheCreationTokens?`, `cacheReadTokens?`. Extend INSERT statement values.
5. **Debug API**: `rowToDebugTurn` returns `cacheCreationTokens`, `cacheReadTokens` (camelCase to match DTO convention).
6. **FE formatter**: extend `formatTurnStats`:
   ```ts
   const cr = turn.cacheReadTokens;
   const cc = turn.cacheCreationTokens;
   if (cr != null && cc != null && (cr + cc) > 0) {
     parts.push(`cache ${Math.round((cr / (cr + cc)) * 100)}%`);
   }
   const ti = turn.inputTokens, to = turn.outputTokens;
   if (ti != null && to != null && ti > 0) {
     parts.push(`io ${(to / ti).toFixed(1)}x`);
   }
   ```
   Add `title` tooltip on the stats span.
7. **Tests**: SDK shape happy path, divide-by-zero guard, null safety.

## Todo List

- [x] Migration for two cache columns
- [x] SDK shape extension in sse-stream
- [x] turn.ts captures + passes through
- [x] chat-store appendTurn extended
- [x] Debug DTO extension
- [x] FE formatter + tooltip
- [x] Unit tests for formatter edge cases
- [x] Manual verify: live turn shows cache % and I/O after a tool-heavy interaction

## Success Criteria

- A real tool-using turn shows `cache 4%` (or similar) and `io 0.3x` on the audit header
- Legacy turns (null cache columns) show no cache part but still show I/O if input/output present
- formatter never emits NaN, Infinity, or negative values

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| SDK key names differ (`cache_creation_input_tokens` vs `cache_creation_tokens`) | M | L | Verify via raw sdk_events JSON before merging; both names handled defensively |
| Per-turn aggregate misleading when multiple llm_calls have different cache mixes | L | L | Document — this is intentional, header is an aggregate view; per-call detail still in llm_calls |
| FE formatter exceeds 200 LOC limit | L | L | Extract `format-turn-stats.ts` if needed |

## Security Considerations
- Pure numeric data — no PII risk.

## Next Steps
- Phase 06 reuses cache_creation/read population to compute `cache_meta_hash` doesn't depend on these, but the I/O ratio is a useful signal for which turns are worth caching.

## Unresolved Questions
- Confirm exact SDK key naming via a live raw sdk_events sample before implementation (step 2).
