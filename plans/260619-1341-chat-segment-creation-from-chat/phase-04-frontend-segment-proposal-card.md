# Phase 4 — Frontend: segment proposal confirm card

## Overview
- **Priority:** P1. **Depends:** Phase 3 (`segment_proposal` SSE event).
- **Status:** pending.
- Render the `segment_proposal` in the chat message stream as a confirm card; on confirm,
  POST `/api/segments` (reuse existing create endpoint); offer "Open in editor" escape hatch.
  This is the only write surface — chat proposes, FE writes.

## Key insights (verified)
- Existing pattern: chat emits artifact → FE renders + acts (deeplink to `#/build`).
  Mirror it: proposal → card → POST. Segment create endpoint + editor already exist
  (`src/pages/Segments/editor/`, `src/QueryBuilderV2/segments-save-bar/`).
- Segment create = `POST /api/segments` with `{name, type:'predicate', cube, game_id,
  predicate_tree, tags, visibility}` (verified create schema).
- `uid_count` is the true cohort size; `uid_list` is a 5k sample — card shows `estCount`
  from the proposal (true size), never the sample.

## Requirements
**Functional**
- Card shows: editable name, predicate as chips, **population scope**, est. size
  (`estCount`), resolved cutoff (for percentile/top-N), disclosures, visibility selector.
- Actions: **Create** (POST → success toast + link to the new segment), **Open in editor**
  (navigate to Segments editor prefilled with the draft tree), **Cancel**.
- Auto-tag created segments `['ai-generated']` (audit trail).
- After create → segment enters `status='refreshing'` (existing flow); card reflects it.

**Non-functional**
- Reuse design tokens + page patterns (`docs/design-guidelines.md`); match existing
  Segments surfaces. No bespoke fonts/spacing.

## Architecture
```
SSE segment_proposal → chat message renderer → <SegmentProposalCard>
  Create → POST /api/segments (existing client) → toast + deep link
  Open in editor → router push Segments editor with draft predicate_tree
```

## Related code files
**Create**
- `src/pages/.../chat/SegmentProposalCard.tsx` (locate the chat message renderer dir;
  co-locate with the existing query-artifact card). <200 LOC.
- `src/api/segment-proposal.ts` — types for the SSE payload (mirror chat-service shape).
**Modify**
- chat message component — branch on `type==='segment_proposal'` → render card.
- segment create API client (reuse existing POST helper; add `tags` default).
- Segments editor entry — accept a prefill predicate_tree param (likely already supported
  via save-bar; verify).
**Read for context**
- `src/types/segment-api.ts` (Segment + create shape), existing query-artifact card,
  `src/pages/Segments/editor/`.

## Implementation steps
1. Define FE proposal type matching Phase-3 SSE payload.
2. `SegmentProposalCard` — render fields + 3 actions; tokenized styling.
3. Wire SSE branch in the chat message renderer.
4. Create action → POST `/api/segments` (type predicate, tags `['ai-generated']`),
   handle 400 (e.g. population-required) with the server message.
5. "Open in editor" → navigate prefilled (reuse save-bar path).
6. Success → toast + link to `#/segments/:id`.

## Todo
- [ ] FE proposal type
- [ ] SegmentProposalCard (tokens, design-guidelines)
- [ ] SSE branch in chat renderer
- [ ] Create → POST + tags + error surfacing
- [ ] Open-in-editor prefill
- [ ] success toast + deep link

## Success criteria
- End-to-end: chat "top 25% paying spenders cfm_vn" → card (cutoff 744k₫, ~59,600) →
  Create → segment appears in Segments list, refreshes, `uid_count` ≈ 59,600.
- Card shows true `estCount`, not the 5k sample.
- "Open in editor" lands with the draft tree editable.

## Risk assessment
- estCount (proposal preview) vs actual uid_count after refresh may differ slightly
  (approx_percentile + timing). Disclose "≈" on the card.
- Card must not double-submit; disable Create after click until response.

## Security
- POST reuses existing auth/game-scope; no new write path.
- Render disclosures verbatim from server (don't recompute size on FE).

## Next steps
- Phase 5: e2e tests + docs + lessons entry.
