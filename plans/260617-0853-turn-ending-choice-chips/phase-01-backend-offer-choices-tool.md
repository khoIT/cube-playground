# Phase 01 — Backend `offer_choices` tool + SSE

## Overview
- Priority: P0 (foundation)
- Status: pending
- Add an agent-callable tool that emits pre-crafted turn-ending choices over the
  existing `disambig_options` SSE event.

## Key insight
`disambiguate_query` already emits `disambig_options` via `ctx.sseEmitter.emit`
(disambiguate-query.ts:347-360). The FE renders any `disambig_options` payload —
it does not care which tool emitted it. So a new tool can reuse the same event
with zero new FE event-plumbing, given the `slot` field is widened (Phase 03).

## Requirements
- New tool `offer_choices`, presentational only (NO memory/kv_cache writes — it
  carries no resolved Cube refs; the next turn's `disambiguate_query` on the
  clicked pinText handles memory as usual).
- Input schema (zod):
  - `prompt: string` (the question shown above chips; 1–200 chars)
  - `options: array` of `{ label: string (1–60), pinText: string (1–300) }`,
    length 2–6 (reject <2 or >6 — a single option isn't a choice; >6 is noise).
- Handler:
  - If `ctx.sseEmitter` present, emit `disambig_options` with
    `{ slot: 'choice', prompt, options: options.map((o,i)=>({label:o.label, pinText:o.pinText, confidence: 1 - i*0.05})) }`.
  - Return a small ack `{ emitted: true, count }` so the agent sees it landed.
  - No-op-safe when sseEmitter absent (cache replays) — return `{ emitted:false }`.

## Files
- Create: `chat-service/src/tools/offer-choices.ts`
- Modify: `chat-service/src/tools/registry.ts` (register tool)
- Reference: `chat-service/src/tools/disambiguate-query.ts:347-360` (emit shape)
- Reference: `chat-service/src/types.ts` (ToolContext, sseEmitter type)

## Steps
1. Read `types.ts` for `ToolContext.sseEmitter` signature + how a tool module
   exports `name` / `description` / `inputSchema` / `handler`.
2. Write `offer-choices.ts` mirroring the disambiguate-query module shape.
3. Register in `registry.ts`.
4. `tsc` the chat-service package clean.

## Success criteria
- Tool registered; `tsc` clean.
- Emitting with a valid payload produces a `disambig_options` SSE frame whose
  `slot==='choice'` and options carry agent-provided pinText.
- <2 or >6 options → zod validation error surfaced to the agent (it retries).

## Security / safety
- Cap option count (6) and string lengths to bound payload size.
- pinText is treated as ordinary next-turn user text (no eval/templating).

## Next
Phase 02 (agent must actually call it), Phase 03 (FE slot widen + precedence).
