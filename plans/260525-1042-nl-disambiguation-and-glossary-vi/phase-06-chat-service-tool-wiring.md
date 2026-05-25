# Phase 06 — chat-service tool wiring + intent router

## Context Links

- Tool registry: `chat-service/src/tools/registry.ts`
- Pre-flight pattern: `chat-service/src/tools/preview-cube-query.ts:78-94`
- Intent router: `chat-service/src/core/intent-router.ts`
- Mode prompts: `chat-service/src/core/mode-prompts.ts`
- Skills loader: `chat-service/src/core/skill-loader.ts`
- nl-to-query engine: `chat-service/src/nl-to-query/` (phase-05)
- Frontend send path: `src/shell/chat-overlay/use-active-chat-session.ts` (resolves to the API call site)

## Overview

- Priority: P1.
- Status: pending.
- Add tool `disambiguate_query` that wraps the nl-to-query engine. Update `explore` SKILL.md to call it BEFORE `preview_cube_query` / `emit_query_artifact`. Enrich intent router with more VI analytical keywords. Propagate `mode` from FE to chat-service per-request.

## Key Insights

- The tool must return BOTH the resolved query and clarifications — the LLM decides next step based on `mode` (passed through system prompt context).
- `mode` belongs in request body / `ToolContext`, NOT in the user message text. Avoid prompt-injection of mode.
- Skill prompt edits must be additive — do not regress existing behaviour (`preview_cube_query` still required when refs are unfamiliar).

## Requirements

### Functional

#### Tool `disambiguate_query`

- Input: `{ message: string, mode?: 'targeted'|'aggressive' }`. `mode` defaults from `ctx.disambiguationMode` if absent.
- Output:
  ```ts
  {
    action: 'auto' | 'clarify';
    query: Partial<CubeQuery>;
    overallConfidence: number;
    slots: DisambiguationResult['slots'];
    clarifications: DisambiguationResult['clarifications'];   // empty when action='auto'
    unresolved: string[];
    language: 'vi'|'en'|'mixed';
    warnings: string[];
  }
  ```
- Handler invokes `disambiguate(message, { now, glossaryUrl, mode })` and applies `mode-gate`.
- Validates `query` refs against `/meta` (reuse `extractMemberNames`); refs missing → forces `action='clarify'` and adds entry to `clarifications` regardless of confidence.

#### Intent router enrichment (`intent-router.ts`)

- Add VI analytical keywords to `explore`: `doanh thu, người dùng, paying user, trả phí, theo ngày, theo tuần, theo tháng, trong q, quý, biểu đồ, tăng trưởng`. Keep tie-break rule unchanged.
- Add VI keywords to `compare`: `so sánh, đối chiếu, chênh lệch`.
- Add VI keywords to `diagnose`: `nguyên nhân, vì sao, vì lý do gì, sụt giảm, tăng vọt`.
- No threshold change; existing `CONFIDENCE_DENOM=10` retained.

#### Skill prompt change (`explore` SKILL.md)

- Add a "Pre-flight disambiguation" section: instruct the model to FIRST call `disambiguate_query` with the user's exact message. Then:
  - If `action='auto'` → proceed to `preview_cube_query` with `result.query`.
  - If `action='clarify'` → respond with the single clarification question in the user's detected language; do NOT emit artifacts.
- Keep existing post-disambiguation flow (preview → emit_query_artifact) intact.

#### Mode propagation (FE → BE)

- FE chat send: include `mode: getEffectiveChatMode(sessionId)` in request body.
- BE: receive on session/request entry, plumb into `ToolContext.disambiguationMode`. Validate enum server-side (default to 'targeted' on invalid).

### Non-functional

- New tool file <180 LOC.
- No new SDK dependencies.
- Update `TOOL_NAMES` automatically via existing `REGISTRY.map`.

## Architecture

```
FE send body { message, mode } ──▶ chat session start ──▶ ToolContext { ..., disambiguationMode }
                                                                │
                                       explore SKILL.md prompt ─▶ LLM
                                                                │
LLM tool call ──▶ disambiguate_query ──▶ nl-to-query engine ──▶ result
                                                                │
                       action=auto ──▶ preview_cube_query ──▶ emit_query_artifact
                       action=clarify ──▶ LLM asks user (bilingual)
```

## Related Code Files

### Modify

- `chat-service/src/tools/registry.ts` — register new tool entry.
- `chat-service/src/types.ts` — add `disambiguationMode?: 'targeted'|'aggressive'` to `ToolContext`.
- `chat-service/src/core/intent-router.ts` — extend keyword lists.
- `chat-service/src/core/mode-prompts.ts` — inject disambiguation system-prompt fragment.
- `chat-service/src/skills/explore/SKILL.md` (or equivalent path under skills folder — locate via `skill-loader.ts`) — add Pre-flight section.
- Chat session entry route in `chat-service/src/api/` — accept `mode`, validate, place into context.
- `src/shell/chat-overlay/use-active-chat-session.ts` (or the actual send-pipeline file) — include `mode` in outgoing request.

### Create

- `chat-service/src/tools/disambiguate-query.ts` (≤180 LOC)
- `chat-service/src/tools/disambiguate-query.test.ts` *(unit smoke; full eval lives in phase-08)*

### Delete

- None.

## Implementation Steps

1. Locate chat-service request entry path (`grep -R "disambiguationMode\|sessionId" chat-service/src/api` then read the routes). Extract zod schema for the body and add an optional `mode: z.enum(['targeted','aggressive']).default('targeted')`.
2. Add `disambiguationMode` to `ToolContext` type and ensure it is populated in the existing context builder.
3. Build `disambiguate-query.ts` — Zod schema, handler calls engine, applies mode-gate, runs ref-validation, returns the structured payload above.
4. Register in `registry.ts` — insert after `getCubeMeta`.
5. Update `intent-router.ts` — extend the existing keyword arrays. Add fixture tests in `chat-service/test/intent-router-keywords.test.ts` (existing file).
6. Update `mode-prompts.ts` — when assembling the system prompt for `explore`, prepend a short instruction block: "Before any cube call, you MUST call `disambiguate_query` with the user message. Follow its `action` field." Source the language from the engine's response, not from the user message directly.
7. Edit `explore/SKILL.md` — append Pre-flight section + decision rules above.
8. FE: add `mode` to the chat send request body (one-line change in the send pipeline).
9. Verify end-to-end: chat send → server logs show context.disambiguationMode → tool fires → preview/emit follows.

## Todo List

- [ ] Body schema accepts `mode`
- [ ] ToolContext extended
- [ ] disambiguate-query tool implemented
- [ ] Registry entry
- [ ] Intent router VI keywords added
- [ ] mode-prompts: pre-flight instruction injected
- [ ] explore SKILL.md updated
- [ ] FE send includes mode
- [ ] Smoke: end-to-end works in both modes

## Success Criteria

- In `targeted` mode + ambiguous message: LLM emits one clarification question, no artifact.
- In `aggressive` mode + clear message: LLM auto-resolves, calls preview, emits query artifact.
- In `aggressive` mode + ambiguous message (overall < 0.75): LLM still clarifies (mode-gate fallback).
- Existing tests for `intent-router`, `mode-prompts`, `preview-cube-query` continue to pass.

## Risk Assessment

- **R6.1**: System prompt change could regress existing user flows. Mitigate by snapshot-testing `mode-prompts.snapshot.test.ts` and updating snapshots intentionally.
- **R6.2**: Mode field absent on legacy clients during deploy → default to 'targeted'. Documented.
- **R6.3**: Tool may be called twice per turn by an over-eager LLM — handler is idempotent + cached-glossary makes it cheap. Acceptable.
- **R6.4**: Skill prompt grows — keep diff additive and small (<25 lines).

## Security Considerations

- Validate `mode` enum server-side; reject unknown values (don't trust FE).
- Engine inputs are user text; ensure no SSRF (we only hit our own `/api/glossary`).
- `disambiguate_query` MUST NOT echo system prompt content; output schema is strict.

## Next Steps / Dependencies

- Phase 07 enriches glossary with VI aliases that this engine relies on.
- Phase 08 runs eval suite against this tool.
