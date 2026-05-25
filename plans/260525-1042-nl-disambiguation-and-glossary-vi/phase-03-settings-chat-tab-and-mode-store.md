# Phase 03 — Settings 'Chat' tab + mode pref store

## Context Links

- Settings shell: `src/pages/Settings/settings-page.tsx` (`TabId` union at line 75)
- Tab list: `src/pages/Settings/settings-tabs.tsx` (uses lucide icons)
- Existing sections: `nav-visibility-section.tsx`, `game-visibility-section.tsx`, `identity-map-section.tsx`
- Prefs store: `src/shared/user-prefs/user-prefs-store.ts`
- i18n: `src/i18n/locales/{en,vi}.json`

## Overview

- Priority: P2 (blocks 04 — chip needs store).
- Status: pending.
- Add 4th tab `'chat'` to Settings. Section exposes a single control: default disambiguation **mode** = `targeted` | `aggressive`. Persists via `createUserPrefsStore`.

## Key Insights

- `TabId` union on `settings-page.tsx:75` must be widened: `'sidebar' | 'games' | 'identity' | 'chat'`. `readHashTab` also gates by literal — update both.
- Tab descriptors built via `useMemo` (`settings-page.tsx:107-126`) — add the 4th entry with a `MessageCircle` (or similar) lucide icon.
- Prefs key pattern: existing namespace is `compass:prefs:` — pick key `chat:disambiguation-mode`.
- Default mode = `targeted` (safer: asks when ambiguous; matches conservative product default).

## Requirements

### Functional

- New tab labelled "Chat" (en) / "Trò chuyện" (vi).
- Section card with title, subtitle, and a radio group (or segmented pill) — two options:
  - **Targeted** — Always ask one focused clarification when ambiguous.
  - **Aggressive** — Auto-resolve when confidence ≥ 0.75; otherwise ask.
- Selection writes immediately to the pref store; no Save button.
- Hash route `#chat` activates this tab.

### Non-functional

- Section component <150 LOC.
- Hook exporting `{mode, setMode}` reused by the panel chip (phase-04).
- Reads via `read()` first paint; subscribes for cross-component sync.

## Architecture

```
SettingsPage ──tab──▶ ChatPreferencesSection
                       └─ useChatDisambiguationMode()
                            └─ createUserPrefsStore('chat:disambiguation-mode', 'targeted')
```

## Related Code Files

### Modify

- `src/pages/Settings/settings-page.tsx` — widen `TabId`, extend `readHashTab`, add tab descriptor, add case in `renderActive`.
- `src/pages/Settings/settings-tabs.tsx` — no change (generic).
- `src/i18n/locales/en.json`, `src/i18n/locales/vi.json` — `settings.tabs.chat`, `settings.chat.title`, `settings.chat.subtitle`, `settings.chat.mode.targeted.{title,desc}`, `settings.chat.mode.aggressive.{title,desc}`.

### Create

- `src/pages/Settings/chat-preferences-section.tsx` (<150 LOC)
- `src/pages/Settings/use-chat-disambiguation-mode.ts` (<60 LOC) — exports `useChatDisambiguationMode(): { mode, setMode }` and a literal type `ChatDisambiguationMode = 'targeted' | 'aggressive'`.
- `src/pages/Settings/chat-mode-radio-group.tsx` (<120 LOC) — controlled segmented radio.

### Delete

- None.

## Implementation Steps

1. Add i18n keys to both locale files.
2. Build `use-chat-disambiguation-mode.ts`:
   ```ts
   const store = createUserPrefsStore<ChatDisambiguationMode>(
     'chat:disambiguation-mode', 'targeted'
   );
   export function useChatDisambiguationMode() {
     const [mode, setMode] = useState(store.read());
     useEffect(() => store.subscribe(() => setMode(store.read())), []);
     return { mode, setMode: (m: ChatDisambiguationMode) => store.write(m) };
   }
   ```
3. Build `chat-mode-radio-group.tsx` — accessible radio group (role="radiogroup", arrow keys move selection); two options with title + description.
4. Build `chat-preferences-section.tsx` — wraps `SectionCard` (existing) + radio group; subscribes to hook.
5. Edit `settings-page.tsx`:
   - Widen `TabId` union to include `'chat'`.
   - Update `readHashTab` literal check.
   - Append `{ id: 'chat', label: t('settings.tabs.chat'), icon: MessageCircle }` to memoized tabs.
   - Add `case 'chat': return <ChatPreferencesSection />;` to `renderActive`.
6. Verify hash routing: visit `/settings#chat` directly, refresh, browser back/forward — all stable.

## Todo List

- [ ] i18n strings (en + vi)
- [ ] useChatDisambiguationMode hook
- [ ] chat-mode-radio-group component
- [ ] chat-preferences-section component
- [ ] settings-page.tsx widened
- [ ] hash-route smoke test

## Success Criteria

- Selecting 'Aggressive' in the section persists across page refresh.
- Same selection visible immediately in the chat panel chip (phase-04 dependency).
- `/settings#chat` deep link works.
- No regression in three existing tabs.

## Risk Assessment

- **R3.1**: `localStorage` unavailable (SSR / sandboxed iframe) — `createUserPrefsStore` already returns default and silently no-ops on write. Acceptable.
- **R3.2**: Pref schema evolves later (more modes / additional knobs) — keep store value scalar; widen union before adding new options. Document.

## Security Considerations

- localStorage value is non-sensitive enum; no risk surface.

## Next Steps / Dependencies

- Phase 04 imports `useChatDisambiguationMode` and the `ChatDisambiguationMode` type.
- Phase 05 receives `mode` value over chat-service HTTP (per-request) — not via this store directly.
