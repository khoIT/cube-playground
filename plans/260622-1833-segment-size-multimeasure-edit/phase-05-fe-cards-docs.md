# Phase 05 — FE cards (count display, edit card) + docs/lessons

## Overview
Priority: medium. Status: DONE. Depends on 02 + 04.
Render the new data the backend now produces.

> Resolution: the shared `SegmentProposalCard` (used by both /chat and the panel via `assistant-message.tsx` — parity automatic) now branches on `proposal.edit`: header "Segment edit", a struck-through "Previously" predicate summary above the "After edit" chips, an "Update segment" button that PATCHes via `segmentsClient.update` (regression-guarded by a render test), visibility + "Open in editor" hidden for edits, and a `mode='updated'` receipt. Pre-confirm `estCount` already rendered (Phase 02). Lessons-learned + service-api-surface-map updated.

## Requirements
- Segment proposal card: show the pre-confirm `estCount` ("~N users match") when present; fall back to current copy when 0/absent.
- New segment-edit card: show old→new predicate diff, the target segment name, a Confirm that PATCHes `/api/segments/:id`, and the "this re-refreshes the segment" note.
- Both surfaces (main `/chat` + right-side panel) — verify parity (renderer is shared; chips/refine row gating differs).
- Docs: update segment-related docs in `./docs`; add a lessons-learned entry for any new bug shape found during impl.

## Related code
- Modify: `src/pages/Chat/components/segment-proposal-card.tsx` (+ a new edit card), the SSE event handler mapping `segment_edit_proposal`, the shared chat renderer.
- Heed concurrent-session edits to `src/pages/Chat/*` — coordinate / rebase, do not clobber.

## Success criteria
- Count renders on a live proposal; edit card confirms and the segment updates.
- Both chat surfaces render the new cards identically.

## Tests
- component render tests for count display + edit card; SSE mapping test.

## Risks
`src/pages/Chat/*` has uncommitted changes from a concurrent session (chat-main-layout redesign) — stage only this phase's files; rebase the card onto their layout rather than overwriting.
