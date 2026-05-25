# Phase 04 — Chat panel mode chip

## Context Links

- Panel header: `src/shell/chat-overlay/chat-panel-header.tsx`
- Panel container: `src/shell/chat-overlay/chat-panel.tsx`
- Mode store hook: `src/pages/Settings/use-chat-disambiguation-mode.ts` (phase-03)
- Chat session API: `src/shell/chat-overlay/use-active-chat-session.ts`
- Empty state: `src/shell/chat-overlay/chat-panel-empty-state.tsx`

## Overview

- Priority: P2 (blocks 06 — disambiguation tool needs the per-request mode).
- Status: pending.
- Add a compact "mode" chip to the chat panel header. Defaults to the user-pref mode; overridable for the current session.

## Key Insights

- Header is currently 119 LOC with inline styles using `T` tokens — keep additions minimal and extract chip into its own component to respect the 200-LOC cap and improve testability.
- Per-session override is **ephemeral** (chip-only), not persisted. New session resets to user default.
- The chat send pipeline must propagate `mode` to the chat-service request body — this phase only ships the UI + a small in-memory session-scoped store. Phase-06 reads it on send.

## Requirements

### Functional

- Chip appears between title and "New" button in `chat-panel-header.tsx`.
- Visual: pill with icon + short label. Targeted → `Wand2` icon / "Targeted"; Aggressive → `Zap` icon / "Aggressive". Label suppressed below 320px panel width.
- Click opens a small popover with two radio options + descriptions (identical copy to settings section).
- "Reset to default" link in popover, shown only when current session value diverges from user pref.
- Chip reflects effective value (session override if set, else user pref).
- A new session resets the override (cleared on `sessionId` change).

### Non-functional

- All files <200 LOC.
- Popover a11y: `aria-expanded`, focus-trap when open, Esc closes.
- No remote calls in this phase.

## Architecture

```
ChatPanelHeader
 └─ ChatModeChip
     ├─ uses useChatDisambiguationMode() (user default)
     └─ uses useSessionModeOverride(sessionId) (in-memory)
         └─ Map<sessionId, ChatDisambiguationMode> in a module-level store
```

The effective mode = `sessionOverride ?? userDefault`. Phase-06 reads the effective value via a tiny exported helper `getEffectiveChatMode(sessionId)` to pass into the chat-service request body.

## Related Code Files

### Modify

- `src/shell/chat-overlay/chat-panel-header.tsx` — render `<ChatModeChip sessionId={sessionId} />` between title and new-button.
- `src/shell/chat-overlay/chat-panel.tsx` — pass `sessionId` prop (already present).
- `src/i18n/locales/en.json`, `vi.json` — `chat.mode.chip.*`, `chat.mode.popover.*`.

### Create

- `src/shell/chat-overlay/chat-mode-chip.tsx` (<150 LOC) — chip button + popover trigger.
- `src/shell/chat-overlay/chat-mode-popover.tsx` (<150 LOC) — popover with radio options + reset link.
- `src/shell/chat-overlay/use-session-mode-override.ts` (<80 LOC) — module-level Map keyed by sessionId, with subscribe semantics; exports `getEffectiveChatMode(sessionId): ChatDisambiguationMode`.

### Delete

- None.

## Implementation Steps

1. Build `use-session-mode-override.ts`:
   ```ts
   const overrides = new Map<string, ChatDisambiguationMode>();
   const subs = new Set<() => void>();
   export function useSessionModeOverride(sessionId: string | null) {
     const [, force] = useState(0);
     useEffect(() => subs.add(() => force(n=>n+1)), [...]);
     return { override: sessionId ? overrides.get(sessionId) : undefined,
              setOverride: (m) => { ... }, clear: () => {...} };
   }
   export function getEffectiveChatMode(sessionId: string | null): ChatDisambiguationMode { ... }
   ```
   On new session (sessionId changes), do NOT auto-clear — chat-panel handles by calling `clear()` on new-session click.
2. Build `chat-mode-popover.tsx` — list with two radio options + reset link; emits onChange.
3. Build `chat-mode-chip.tsx` — anchored popover (use existing tooltip primitive if any, else minimal `position: absolute` below chip).
4. Edit `chat-panel-header.tsx` — render chip; ensure title still truncates correctly (reduce MAX_TITLE_CHARS from 32 to 24 when chip visible).
5. Edit `chat-panel.tsx` — on "New chat" handler, call `clearSessionOverride(prevSessionId)` from the override module.
6. i18n: chip labels both languages.
7. Manual smoke: chip reflects setting changes from Settings tab live; override persists during session, clears on new chat.

## Todo List

- [ ] use-session-mode-override module
- [ ] chat-mode-popover component
- [ ] chat-mode-chip component
- [ ] header wired
- [ ] panel new-chat handler clears override
- [ ] i18n strings (en + vi)
- [ ] cross-tab smoke: change in settings reflects in chip (subscribe path)

## Success Criteria

- Chip shows "Targeted" by default; switching default in Settings updates chip immediately.
- Clicking chip → popover → "Aggressive" → chip updates only for this session; new chat returns to default.
- `getEffectiveChatMode(sessionId)` returns the correct value (test from console in dev).

## Risk Assessment

- **R4.1**: Module-level Map leaks memory across long sessions if many sessionIds accumulate — bound size to 50 LRU entries. Implement in helper.
- **R4.2**: Default sessionId is null while a chat is being created — chip falls back to user default (effective value computed safely).
- **R4.3**: Popover positioning vs panel scroll — anchor relative to chip (`position: relative` wrapper); never inside scroll container.

## Security Considerations

- Mode is a non-sensitive enum; no risk surface. Phase-06 must still server-side-validate.

## Next Steps / Dependencies

- Phase 06 consumes `getEffectiveChatMode(sessionId)` to attach `mode` to the chat send request.
