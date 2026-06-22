# Phase 04 — Segment-edit tool + edit proposal

## Overview
Priority: medium. Status: DONE.
Let the agent modify an existing segment (add/remove/replace a predicate leaf) instead of rebuilding.

> Resolution: `propose_segment_edit({ segment_id, ops })` with ops `add_filter`/`remove_filter`/`replace_tree` (pure apply in `segment-edit-ops.ts`). Loads the full segment, refuses early on `can_administer:false` (no dead 403 proposal) and on no-predicate/uid-list segments, guards against emptying the predicate, then emits a `segment_proposal` carrying an `edit: { segment_id, previous_predicate_tree }` block (NOT a new event — reuses the proposal envelope so persistence/replay ride along). Edit-intent routing added to `intent-router.ts`; tool added to segment skill `allowed_tools` + an "Editing an existing segment" section.

## Key insight
`PATCH /api/segments/:id` already accepts `predicate_tree` (owner/admin-only, auto-refresh). `get_segment` already returns the tree. Gap = a chat-service edit tool + an FE confirm card + routing.

## Requirements
- New tool `propose_segment_edit({ segment_id, ops })` where ops describe add-leaf / remove-leaf / replace-leaf (or replace whole tree). Loads current tree via the server, applies ops, validates with the same predicate rules, emits a `segment_edit_proposal` (segment_id, old tree summary, new tree, diff disclosures).
- FE confirms → calls `PATCH /api/segments/:id { predicate_tree }`.
- Respect `canAdministerSegment`: if the principal can't redefine the cohort, the tool returns an error explaining only owner/admin can edit; do not emit a proposal that will 403.
- Routing: add an edit-intent pattern ("edit/modify/change/add … to … segment/cohort/audience", "remove … from …") routing to segment skill; the skill branches edit vs create.
- Wire `propose_segment_edit` into segment skill allowed_tools.

## Related code
- Create: `chat-service/src/tools/propose-segment-edit.ts`; register in `tools/registry.ts`.
- Modify: `intent-router.ts` (edit pattern), `.claude/skills/segment/SKILL.md`, FE proposal-card components.

## Success criteria
- "add country=VN to my Whales segment" → edit proposal with the merged tree; confirm → PATCH succeeds + refresh triggers.
- Non-admin on a shared segment → clean "owner/admin only" message, no dead proposal.

## Tests
- edit ops apply correctly to a tree; admin-gate path; invalid op → error.

## Risks
PATCH auto-refresh is expensive — edit proposal must make clear the segment will re-refresh. Concurrent edits: last-write-wins (acceptable; note it).
