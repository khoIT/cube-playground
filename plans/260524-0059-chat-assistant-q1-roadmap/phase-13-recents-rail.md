# Phase 13 — Recents Rail (F11)

## Context Links
- Brainstorm: §M3 F11.
- Consumes phase-10 (history) + phase-12 (saved monitored segments).

## Overview
- **Priority:** P2 (M3)
- **Status:** pending
- **Description:** On chat landing page, show "Recents" rail: last 5 user questions + all saved monitored segments. One-click resume.

## Key Insights
- Pure UI consumer of existing infra — no new persistence.
- Sits alongside starter library (phase-01); design avoid clutter (toggle / collapse).

## Requirements

### Functional
- Recents section on chat landing under starter library.
- Two groups:
  - **Recent questions:** last 5 user prompts across all sessions of current `(user, game)`. Click → resume session.
  - **Saved segments:** all `monitored=1` segments. Click → open segment-history modal OR jump to chat thread that pinned it.
- Empty-state copy when neither group has entries.
- Persistent collapse state per user (localStorage).

### Non-functional
- Initial render uses existing sessions-list endpoint + monitored-segments endpoint (no new APIs).
- <100ms render after data loaded.

## Architecture
- **UI:** `src/pages/Chat/components/recents-rail.tsx` (new component on landing).
- **Hook:** `src/pages/Chat/hooks/use-recents.ts` — combines sessions + monitored segments fetches.
- **Mount:** `chat-landing-page.tsx` between starter library and composer.

### Data flow
```
landing ─► use-recents()
        ├─► GET /api/chat/sessions?ownerId=&gameId=&limit=5 (phase-10)
        └─► GET /api/segments?monitored=1&ownerId=&gameId= (phase-12)
recents-rail renders two columns; click → resume / open history
```

## Related Code Files

### Existing infra
| Capability | Path | Use |
|---|---|---|
| Chat landing | `src/pages/Chat/chat-landing-page.tsx` | Mount point |
| Sessions list (phase-10) | `/api/chat/sessions` | Recent questions |
| Monitored segments (phase-12) | `/api/segments?monitored=1` | Saved segments |
| History rail | `src/pages/Chat/components/chat-history-rail.tsx` | Style reference |

### Create
- `src/pages/Chat/components/recents-rail.tsx`
- `src/pages/Chat/components/recents-question-card.tsx`
- `src/pages/Chat/components/recents-segment-card.tsx`
- `src/pages/Chat/hooks/use-recents.ts`
- `src/pages/Chat/__tests__/recents-rail.test.tsx`

### Modify
- `src/pages/Chat/chat-landing-page.tsx` (mount rail).

### Delete
- None.

## Implementation Steps
1. Build `use-recents.ts` — parallel fetch + merge.
2. Card components (question + segment).
3. Rail layout (two columns desktop, stacked mobile).
4. Mount on landing; persist collapse via localStorage.
5. Tests: empty state, populated, click handlers fire resume / history modal.

## Todo List
- [ ] `use-recents.ts`
- [ ] Card components
- [ ] Rail layout
- [ ] Landing integration
- [ ] Tests

## Success Criteria
- ≥25% of landing visits in M3 result in a recents click (telemetry).
- 0 latency-impacting renders on landing (LCP unchanged).

## Risk Assessment
| Risk | L | I | Mitigation |
|---|---|---|---|
| Slow fetch blocks landing render | Med | Med | Render rail in suspense fallback; landing renders without. |
| Duplicate of history rail in chat-thread layout confuses users | Med | Low | Distinct visual treatment + section title "Recents". |

## Security Considerations
- Both endpoints already enforce `(owner_id, game_id)`; rail relies on that.
- No new data exposed.

## Next Steps
- Blocked by: phase-10 (sessions list with gameId param), phase-12 (monitored endpoint).
- Independent of others.

## Rollback
Remove rail mount from `chat-landing-page.tsx`. No DB writes to clean.
