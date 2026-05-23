# Phase 04 — Suggested Follow-ups (F4)

## Context Links
- Brainstorm: §M1 Track A, F4.
- Builds on phase-01 starter taxonomy.

## Overview
- **Priority:** P2 (M1)
- **Status:** pending
- **Description:** Every assistant answer ends with 3 "next-question" chips. Reduces re-prompt friction; keeps user in agent loop.

## Key Insights
- Cheap UX win — chips drive deeper sessions.
- Source of suggestions: deterministic rules (cube context + recent intent) preferred over a second LLM call to control cost.
- Shares persona-aware taxonomy with starter library (phase-01).

## Requirements

### Functional
- After any assistant turn that emitted a query artifact or segment, show 3 chips.
- Chip click prefills composer with chip text + auto-submits (or asks confirm — design choice).
- Suggestions reflect: (a) cubes touched in current turn, (b) common next-step questions from starter taxonomy, (c) drill-downs (e.g. "Compare by country", "Show D7 retention").
- Fallback when no rule fires: show generic 3 from current persona's starter set.

### Non-functional
- Suggestion generation client-side first (no extra LLM call) — pluggable to LLM later.
- Suggestion render <50ms after turn `done`.

## Architecture
- **Module:** `src/pages/Chat/services/followup-suggester.ts` (new).
- **Input:** last assistant turn (cubes referenced, intent classification from tool calls).
- **Output:** `Array<{ id, text, derivedFrom }>`.
- **UI:** `src/pages/Chat/components/followup-chips.tsx` rendered in `assistant-message.tsx`.
- **Telemetry:** `chat_audit.kind='followup_clicked'`, `detail_json={chipId, derivedFrom}`.

### Data flow
```
assistant turn done ─► extract cubes + tools used ─► followup-suggester(rules) ─► 3 chips
chip click ─► composer setValue + submit ─► audit
```

## Related Code Files

### Existing infra
| Capability | Path | Use |
|---|---|---|
| Assistant message | `src/pages/Chat/components/assistant-message.tsx` | Render chips below content |
| Tool registry | `chat-service/src/tools/registry.ts` | Source of which tools fired |
| Starter taxonomy | (phase-01) `src/pages/Chat/library/starter-questions.ts` | Fallback pool |

### Create
- `src/pages/Chat/services/followup-suggester.ts`
- `src/pages/Chat/services/followup-rules.ts` (per-cube / per-intent rules)
- `src/pages/Chat/components/followup-chips.tsx`
- `src/pages/Chat/__tests__/followup-suggester.test.ts`

### Modify
- `src/pages/Chat/components/assistant-message.tsx` (render chips after content).

### Delete
- None.

## Implementation Steps
1. Define rules format: `{ trigger: { cubes?: string[], tools?: string[] }, suggestions: string[] }`.
2. Seed `followup-rules.ts` with 8–12 rules covering common intents (segment created → "Save segment? / Show samples / Compare cohort").
3. Build suggester: pure function `(turnContext) => 3 chips`.
4. Build `followup-chips.tsx` — pill row, accessible (kbd nav).
5. Hook into `assistant-message.tsx` lifecycle (render only on `done`).
6. Wire audit on click.
7. Tests: each rule fires correctly; fallback yields 3 from current persona.

## Todo List
- [ ] Rules format + seed
- [ ] `followup-suggester.ts`
- [ ] `followup-chips.tsx`
- [ ] assistant-message integration
- [ ] Audit logging
- [ ] Unit tests for rules + suggester

## Success Criteria
- ≥25% of turns produce a follow-up click (M1 telemetry; not in brainstorm targets but proposed gate).
- Suggestions diversity check: ≥5 distinct chip ids fire across a 100-turn QA session.

## Risk Assessment
| Risk | L | I | Mitigation |
|---|---|---|---|
| Suggestions feel repetitive | Med | Med | Track recent chip ids per session; suppress duplicates. |
| Rules drift out of sync with catalog | Med | Low | Same CI gate as phase-01 — validate any catalog ids referenced. |

## Security Considerations
- No PII. Chip text generated from static rules + cube ids.

## Next Steps
- Blocks: none.
- Independent of phase-02, 05.
- Light dep on phase-01 (shares starter pool for fallback).

## Rollback
Remove `<FollowupChips/>` from `assistant-message.tsx`. No data writes beyond audit.
