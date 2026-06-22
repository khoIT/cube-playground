# Phase 02 — "Build segment from this" bridge on artifact/chart cards

**Move:** 1 · **Priority:** P0 · **Status:** pending · **Service:** src (FE) · **Depends:** Phase 01

## Context
`query-artifact-card.tsx` today offers only *Refine* + *Open in Playground* (footer ~line 204). No path from an explored result to a segment. Phase 01 gives the CubeQuery→predicate translation + segmentability gate + lineage field.

## Requirements
- Add a **Build segment from this** action to the query-artifact card footer (and chart artifacts where a runnable query exists).
- On click: translate the artifact's `query` via the Phase 01 path; if `segmentable`, open the existing `SegmentProposalCard` flow pre-filled with the predicate + `source_query` lineage (question/title + artifact id).
- If `segmentable: false`, **hide** the button (don't show-then-error). Tooltip on the disabled/absent state is optional.
- Reuse the existing prefill bridge (`stashEditorPrefill` / `advisorPrefill`) or emit an inline proposal — pick whichever keeps the user in chat (prefer inline proposal card over a route hop).

## Architecture
- The bridge calls a thin server/chat endpoint that runs the Phase 01 translator (FE shouldn't reimplement it). Returns `{ segmentable, predicate_tree?, cube, reason? }`.
- Render the result through `SegmentProposalCard` (already mounts in `assistant-message.tsx`), with lineage stamped so the created receipt + segment show "born from <question>".

## Related code
- Modify: `src/pages/Chat/components/query-artifact-card.tsx` (footer action), possibly `assistant-message.tsx` (inline proposal injection).
- Read: `src/pages/Chat/components/segment-proposal-card.tsx`, `src/pages/Segments/editor/editor-prefill-store.ts`.

## Implementation steps
1. Add the footer button (ghost style, sits beside "Open in Playground"); gate visibility on a segmentability probe.
2. Wire click → translate → render `SegmentProposalCard` inline with predicate + lineage.
3. Surface lineage in the proposal/created card (small "from: <question>" line).
4. Keep design-token compliant; cross-check against the existing card footer.

## Todo
- [ ] Footer action + visibility gate
- [ ] Click → translate → inline proposal
- [ ] Lineage line in proposal + created receipt
- [ ] Token/design parity check

## Success criteria
- From a segmentable explored result, one click lands a pre-filled proposal card in the same chat turn; created segment records its origin.
- Non-segmentable results show no bridge button.

## Risks
- Inline injection into the message stream must not duplicate on re-render — key by artifact id.

## Next
Move 1 shippable after this. Distribution (Phase 03/04) layers onto the same proposal card.
