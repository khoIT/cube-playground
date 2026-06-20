# Phase 03 — Query refinement in chat

## Context links

- Plan: [plan.md](plan.md)
- Mockup: feature 3 (refine chips + free-text refine + applied-diff line under a query card).
- Query card: `src/pages/Chat/components/query-artifact-card.tsx`
- emit_query_artifact tool: `chat-service/src/tools/emit-query-artifact.ts`
- Session memory: `chat-service/src/cache/disambig-memory-adapter.ts:70` (`lastQuery`)
- Follow-up chip plumbing: `src/pages/Chat/components/followup-chips.tsx`, `chat-thread-page.tsx:514`

## Overview

- **Priority:** P2.
- **Status:** done.
- **Description:** Under every `emit_query_artifact` card, show refine chips
  (+ break down by country / just payers / weekly / last 90 days / compare vs X)
  + a free-text refine input + an applied-diff line. Build order #4 (hardest to
  verify — agent behavior).

## Key insights (verified)

- **Lowest-risk mechanism (recommended): FE chips compose a templated follow-up
  user turn.** The agent already persists the last executed CubeQuery as
  `lastQuery` in session memory (`disambig-memory-adapter.ts:70`, written by
  `emit_query_artifact`). A refine chip just sends a natural-language turn
  ("break this down by country") via the EXISTING `onFollowupPick:(text)=>void`
  path (`chat-thread-page.tsx:514` → thread-view → message-list → message). The
  agent re-runs with `lastQuery` as merge context and re-emits a fresh artifact.
  No new tool, no new server endpoint — reuses proven plumbing. This is DRY/KISS.
- **Why not a dedicated refine tool:** a new tool means new agent-behavior surface
  (prompt + tool wiring + chat-service tests) and higher risk for marginal gain;
  the follow-up-turn path already produces the exact "agent diffs prior query and
  re-emits" behavior the mockup shows. Defer a dedicated tool unless the chip set
  proves unreliable through free-text.
- **Chip generation is FE-derivable** from the artifact's own query:
  `QueryArtifact.query` is present on the card (`chat-sse-client.ts:107`,
  rendered by `query-artifact-card.tsx`). Inspect it to generate context-aware
  chips: "add dimension" (only if not already grouped by it), "tighten filter"
  (just payers), "change grain" (weekly/daily), "change range" (last 90 days),
  "compare vs <other game>". The chip set adapts to what's actually changeable.
- **Applied-diff line**: after the refined turn returns a new artifact, the new
  artifact's query vs the prior query yields the diff text ("+ dimension country ·
  grain unchanged · range unchanged"). Compute FE-side by diffing the two
  CubeQuery shapes. This can be a follow-up enhancement; the chips + free-text are
  the core.
- Reuse the existing `FollowupChips` styling/pattern (`followup-chips.tsx`) for the
  refine chip row so it reads as one family; the mockup's chip styling matches.

## Requirements

Functional:
- Under a query artifact card: a "Refine this" chip row (context-aware chips) +
  a free-text refine input + Refine button.
- Clicking a chip sends a templated follow-up turn (verbatim, like existing
  follow-up chips); free-text sends the typed refinement.
- After the refined artifact arrives, show an applied-diff line summarizing what
  changed vs the prior query (+ dimension / grain / range).

Non-functional:
- Chips generated from the prior query shape — no chip for a dimension already
  present; no "weekly" if already weekly, etc.
- Refine input is disabled while a turn is streaming (mirror existing composer).

## Architecture

```
QueryArtifactCard (has artifact.query)
  → generate-refine-chips(artifact.query) → context-aware chips
  → RefineRow (chips + free-text)
      chip click  → onRefine(templatedText)  ── reuses onFollowupPick path ──▶ sendTurn
      free-text   → onRefine(typedText)        (agent re-emits using lastQuery)
  → on next artifact for this thread: diff(prevQuery, newQuery) → applied-diff line
```
Threading: add an `onRefine:(text)=>void` prop alongside the existing
`onFollowupPick` (or reuse `onFollowupPick` directly — same semantics: prefill +
send immediately). Prefer reusing `onFollowupPick` to avoid a parallel prop.

## Related code files

Create:
- `src/pages/Chat/components/query-refine-row.tsx` — chip row + free-text input +
  Refine button (tokens, mockup styling; reuse FollowupChips visual pattern).
- `src/pages/Chat/services/generate-refine-chips.ts` — pure: CubeQuery →
  context-aware refine chips (each chip = templated NL text + an id). Unit-tested.
- `src/pages/Chat/services/diff-cube-queries.ts` — pure: (prev, next) CubeQuery →
  applied-diff summary parts. Unit-tested. (Applied-diff line; can ship after chips.)

Modify:
- `src/pages/Chat/components/query-artifact-card.tsx` — render `QueryRefineRow`
  below the body, fed by `generate-refine-chips(artifact.query)`; route chip/
  free-text to the send callback.
- `src/pages/Chat/components/assistant-message.tsx` — thread the refine callback
  (reuse `onFollowupPick`) down to the query card if not already passed.
- (If needed) `chat-thread-page.tsx` — already exposes `handleFollowupPick`;
  ensure it reaches the query card via assistant-message.

No chat-service change for the recommended mechanism (agent already has
`lastQuery`). If verification shows the agent does NOT reliably merge from
`lastQuery` on a bare refine turn, fall back to enriching the prompt (a
chat-service prompt tweak), NOT a new tool — re-scope then.

Delete: none.

## Implementation steps

1. **Chip generator** — `generate-refine-chips.ts`: inspect `query.dimensions`,
   `query.filters`, `query.timeDimensions[].granularity`/`dateRange` to emit only
   applicable chips with templated NL text + stable ids.
2. **Refine row** — `query-refine-row.tsx`: render chips + free-text + button;
   disabled while streaming.
3. **Wire send** — route chip/free-text through the existing `onFollowupPick`
   path; verify the agent re-emits a refined artifact using `lastQuery`.
4. **Card integration** — render the row in `query-artifact-card.tsx`.
5. **Applied-diff** — `diff-cube-queries.ts` + render the diff line once the
   refined artifact returns (match the prior query for this card).
6. **Verify agent behavior** — manual + recorded check that a bare refine turn
   ("just payers") produces a correctly-merged re-emit (this is the risky bit).
7. **Verify** `npx tsc --noEmit` clean; run vitest (+ chat-service if prompt
   tweaked).

## Todo checklist

- [ ] `generate-refine-chips.ts` (context-aware, pure)
- [ ] `query-refine-row.tsx` (chips + free-text, streaming-disabled)
- [ ] Route refine through existing `onFollowupPick` send path
- [ ] Render row in `query-artifact-card.tsx`
- [ ] `diff-cube-queries.ts` + applied-diff line
- [ ] Verify agent merges from `lastQuery` on a bare refine turn
- [ ] Tests + `tsc --noEmit` clean

## Success criteria

- Each query card shows context-aware refine chips + a free-text refine input.
- Clicking "just payers" / "weekly" / "last 90 days" / "compare vs X" produces a
  correctly-refined new artifact (agent merges from prior query).
- Chips never offer a no-op (e.g. "weekly" when already weekly).
- The applied-diff line accurately summarizes prev→next query changes.

## Tests to write

- `generate-refine-chips`: a grouped-by-country query omits the "break down by
  country" chip; a weekly query omits "weekly"; payer-filtered omits "just payers".
- `diff-cube-queries`: added dimension / changed grain / changed range each
  produce the right summary parts; unchanged fields read "unchanged".
- `query-refine-row`: chip click calls the send callback with the templated text;
  free-text submit sends typed text; disabled while streaming.

## Risks + mitigation

| Risk | L×I | Mitigation |
|------|-----|-----------|
| Agent doesn't merge from `lastQuery` on bare refine turn | M×H | Verify early (step 6). Fallback = prompt tweak to lean on `lastQuery`, NOT a new tool. |
| Templated chip text ambiguous to the agent | M×M | Make chip text explicit ("break the current result down by country") rather than terse. |
| Applied-diff mismatches when agent reinterprets | M×L | Diff is informational; compute from the actually-returned new query, not the templated intent. |
| Refine row clutters non-query cards | L×L | Render only on `query_artifact` cards with a `query`. |

## Security / perf considerations

- No new endpoint/tool (recommended path) — refine = a normal chat turn under the
  user's existing auth/game scope.
- Free-text refine is user input sent as a chat turn — same handling as the
  composer; no new injection surface.

## Next steps

- Independent of Phases 01/02/04. Highest verification effort — schedule last.
