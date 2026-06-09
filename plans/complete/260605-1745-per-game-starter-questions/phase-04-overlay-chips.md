# Phase 04 — Sidebar Overlay Suggestion Chips

## Context Links
- Plan: [plan.md](plan.md)
- Depends on: [phase-03](phase-03-proxy-fe-hook-empty-hero.md) (FE hook `use-generated-starters`)
- Target: `src/shell/chat-overlay/chat-panel-empty-state.tsx` — currently a hardcoded `SUGGESTIONS` array of 3 strings (`:9-13`), renders chips that call `onSuggest(text)`
- Hook: `src/pages/Chat/library/use-generated-starters.ts` (created phase-03)

## Overview
- **Priority:** P3 (small, isolated)
- **Status:** pending
- **Description:** Replace the 3 hardcoded suggestion strings in the sidebar chat-overlay empty state with the top-3 of the generated set. Static-fallback path yields the existing static questions' top-3, so no regression when generation is absent.

## Key Insights
- The overlay only needs `text` per chip — it calls `onSuggest(text)`. So map `starters.slice(0,3).map(s => s.text)`.
- Reuse `useGeneratedStarters` (already does fetch + static fallback). No second fetch implementation.
- The overlay lives in `src/shell/`, a different module tree than `src/pages/Chat/`, but the hook is importable across the app (it's a plain hook). Confirm no import cycle (`src/shell` → `src/pages/Chat/library` is a leaf import, no back-edge).
- Keep the existing visual exactly (tokens `T.*` from `../theme`); only the data source changes. Per design-guidelines, no visual drift.

## Requirements
### Functional
- `chat-panel-empty-state.tsx`: replace the const `SUGGESTIONS` with `const { starters } = useGeneratedStarters(); const suggestions = starters.slice(0, 3).map(s => s.text);`
- If `starters` is empty for any reason, fall back to the existing 3 literals (defensive — but `useGeneratedStarters` already guarantees ≥ static, so this is belt-and-suspenders).
- No change to `onSuggest` contract or chip markup/styling.

## Architecture — data flow
```
overlay empty state mount
  → useGeneratedStarters()  → starters (generated top-3 | static top-3)
  → chips = starters.slice(0,3).map(text)
  → onSuggest(text) on click  (unchanged)
```

## Related Code Files
**Modify:**
- `src/shell/chat-overlay/chat-panel-empty-state.tsx`

## Implementation Steps
1. Import `useGeneratedStarters`.
2. Derive `suggestions` from `starters.slice(0,3)`; keep a literal-array fallback if `starters.length === 0`.
3. Render the same chip markup over `suggestions`.
4. FE typecheck clean.

## Todo List
- [ ] Overlay pulls top-3 from `useGeneratedStarters`
- [ ] Static fallback preserved (3 chips always render)
- [ ] No visual/markup change (tokens untouched)
- [ ] No import cycle introduced

## Success Criteria
- Generated set present → overlay chips show the top-3 generated question texts for the active game.
- Switching game changes the chips (hook re-fetches).
- Backend down → chips show the existing static suggestions; never blank.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|------------|
| Import cycle `src/shell` → `src/pages/Chat` | L×M | Hook is a leaf (no back-import to shell); typecheck + dev boot verifies |
| Generated question text too long for the narrow chip | M×L | Existing chip CSS wraps/ellipsizes; texts are short questions — acceptable |
| Extra fetch from overlay duplicates hero fetch | L×L | Both hit the cheap cached route; acceptable. Could share later, YAGNI now |

## Security Considerations
- None new — same hook, same proxy, same scoping as phase-03.

## Next Steps
- Phase 5: tests + docs across all phases.
