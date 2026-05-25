# Phase 04 — Wave C: Suppress follow-up chips during disambig

## Context Links

- Brainstorm: `plans/reports/brainstorm-260526-0436-chat-disambig-memory-and-settings-defaults.md`
- Target file + line: `src/pages/Chat/components/chat-message-list.tsx:103`
- Related: `src/pages/Chat/components/AssistantMessage` (where `disambigOptions` + `showFollowups` props are consumed). Grep `disambigOptions` to confirm consumer site.
- Existing chip suite (no changes here): `src/pages/Chat/components/disambig-chips`, `followup-chips`.

## Overview

- **Priority:** P3 (low effort, high UX clarity; standalone)
- **Status:** pending
- **Description:** One-line condition fix in `chat-message-list.tsx`: when an assistant message carries `disambigOptions`, do not render FollowupChips. Removes the duplicate "what next" UX on clarify turns.

## Key Insights

- `showFollowups` today: `!streaming && isLastAssistant && !!onFollowupPick`.
- Add: `&& !msg.disambigOptions` so a clarify turn surfaces only disambig chips.
- Trivial change but high signal — directly fixes user-reported confusion seen alongside the broader memory bug.
- Independent of phases 1–3; can land in any order. Tests live entirely in FE.

## Requirements

### Functional

- When an assistant message has `disambigOptions` set (array of chips), FollowupChips MUST NOT render under it.
- When an assistant message has no `disambigOptions`, FollowupChips behaviour unchanged.
- All other gating conditions (`!streaming`, `isLastAssistant`, `!!onFollowupPick`) preserved.

### Non-functional

- One-line code change. Zero new files in production source.
- New test file ≤ 80 LOC.
- TS strict; no `any`.

## Architecture

```
chat-message-list.tsx (render loop, per assistant message):

  isLastAssistant && !streaming && !!onFollowupPick && !msg.disambigOptions
  ───────────────────────────────────────────────────────────────────────
                          ↓
                showFollowups: boolean
                          ↓
            passed to <AssistantMessage showFollowups={...} />
```

No data-flow change. Just an extra boolean term.

## Related Code Files

**Modify:**
- `src/pages/Chat/components/chat-message-list.tsx` (line 103, single condition).

**Create:**
- `src/pages/Chat/components/__tests__/chat-message-list-disambig-followups.test.tsx` (one test fixture).

**Delete:** none.

## Implementation Steps

1. **Edit the condition.** In `chat-message-list.tsx` line 103, change:
   ```ts
   const showFollowups = !streaming && isLastAssistant && !!onFollowupPick;
   ```
   to:
   ```ts
   const showFollowups = !streaming && isLastAssistant && !!onFollowupPick && !msg.disambigOptions;
   ```
   Code comment beside the change explains the *why* (without referencing plan artifacts): "Disambig chips own the 'what next' affordance on clarify turns; suppress follow-up chips to avoid double-prompting."
2. **Add test.** RTL test renders `<ChatMessageList>` with a single assistant message carrying `disambigOptions` set + `showFollowups` derived true otherwise. Assert:
   - `[data-testid="disambig-chips"]` present.
   - `[data-testid="followup-chips"]` absent.
   - Second fixture: same message without `disambigOptions` → followup chips present.
3. **Grep `data-testid`** for both chip components to confirm the test ids exist. If they don't, add them as the smallest change inside the chip components (single `data-testid` prop on the outermost element of each chip group).
4. **Compile + run.** All FE tests still green.

## Todo List

- [ ] Edit `chat-message-list.tsx:103` condition
- [ ] Confirm `data-testid` exists on both chip groups (add if missing)
- [ ] RTL test: clarify turn with disambig — followups absent
- [ ] RTL test: regular turn — followups still render
- [ ] Commit: `fix(chat): hide follow-up chips on disambig clarify turns`

## Success Criteria

- Render an assistant message with `disambigOptions` set → only disambig chips visible.
- Render an assistant message without `disambigOptions` → follow-up chips visible (regression check).
- Test file ≤ 80 LOC.
- Pre-existing chat tests still green.

## Risk Assessment

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| 1 | `msg.disambigOptions` shape differs from expected (object vs array vs nullish) | Low | Low | Truthiness check (`!msg.disambigOptions`) handles all falsy variants. Test fixture exercises both null and undefined. |
| 2 | `data-testid` missing on chip groups breaks the test | Med | Low | Add the testid in same commit if missing — tiny change. |
| 3 | A separate code path also renders follow-ups (e.g. inside `AssistantMessage`) ignoring the boolean | Low | Med | Grep for `FollowupChips` and `showFollowups`; if a sibling path exists, audit & gate it the same way. Document any extra change in commit. |
| 4 | Visual regression in followup spacing when disambig present | Low | Low | RTL test covers presence/absence; visual check during local dev. |

## Security Considerations

- None. Pure render-condition change. No new data flow, no new API surface.

## Next Steps

- None. Lands independently; no follow-up phases gated on it.
