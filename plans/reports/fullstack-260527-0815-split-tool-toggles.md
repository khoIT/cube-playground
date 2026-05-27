# Split Tool Toggles: Web Search + Research Mode

**Date:** 2026-05-27
**Status:** DONE

---

## Files Modified

| File | Change |
|---|---|
| `src/pages/Chat/components/composer-tool-toggle.tsx` | NEW — reusable pill button (`ComposerToolToggle`) |
| `src/pages/Chat/components/chat-research-mode-toggle.tsx` | DELETED — flip-switch replaced |
| `src/pages/Chat/components/chat-composer.tsx` | Swapped `ResearchModeToggle` → two `ComposerToolToggle` pills; added `webSearch`/`onToggleWebSearch` props; local state for both |
| `src/pages/Chat/components/chat-empty-hero.tsx` | Added `webSearch`/`onToggleWebSearch` props threaded to `ChatComposer` |
| `src/pages/Chat/components/chat-thread-view.tsx` | Added `webSearch`/`onToggleWebSearch` props threaded to `ChatComposer` |
| `src/pages/Chat/chat-thread-page.tsx` | Split single `researchMode` state into `webSearch` + `researchMode`; `sendTurn` call updated |
| `src/pages/Chat/hooks/use-chat-stream.ts` | `sendTurn(msg, bypassCache, webSearch?, researchMode?)` — added `webSearch` param |
| `src/stores/chat-stream-store.ts` | `StartTurnOptions` + `startTurn` call: added `webSearch?` |
| `src/api/chat-sse-client.ts` | `OpenChatTurnOptions`: added `webSearch?`; `openChatTurn` sends `X-Web-Search: 1` when true |
| `src/shell/chat-overlay/use-panel-chat-state.ts` | Added `webSearch`/`onToggleWebSearch` state; `sendTurn` updated; returned in `PanelChatState` |
| `src/shell/chat-overlay/chat-panel.tsx` | Destructures + passes `webSearch`/`onToggleWebSearch` to both `ChatComposer` and `ChatThreadView` |
| `server/src/routes/chat.ts` | Forwards `X-Web-Search` header alongside existing `X-Research-Mode` conditional |
| `chat-service/src/api/turn.ts` | Split `turnOverride` into `webSearchOverride` (from `x-web-search`) and `researchOverride` (from `x-research-mode`); each gates only its own flag |
| `src/api/__tests__/chat-sse-client.test.ts` | +4 tests: X-Web-Search header presence/absence, both flags, neither flag |
| `server/test/chat-proxy.test.ts` | +3 tests: X-Web-Search forwarding (present, absent, independent of X-Research-Mode) |
| `chat-service/test/web-search-gating.test.ts` | Updated `resolveWebSearch` to 3-arg (headerOverride added); +8 tests for independent gate logic |

---

## Two-Header Mechanism

```
FE pill ON (webSearch)   → X-Web-Search: 1   → server forwards → chat-service reads x-web-search   → webSearchEnabled only
FE pill ON (researchMode) → X-Research-Mode: 1 → server forwards → chat-service reads x-research-mode → researchModeEnabled only (timeout × 2)
```

No cross-wiring. Each header gates exactly one feature. Env master flags (`CHAT_ENABLE_WEB_SEARCH`, `CHAT_ENABLE_RESEARCH_MODE`) remain the kill-switch for both.

---

## Design Notes

- `ComposerToolToggle`: pill button matching Bypass-cache pill language (same border/bg/color tokens, `2px 8px` padding, `borderRadius 4`, `T.fSans`). Active: `T.brand`/`T.brandSoft`. Hover: `T.surfaceMuted`. Focus-visible ring: `outline 2px T.brand offset 2px` via onFocus/onBlur. `aria-pressed` + `aria-label` + `title`.
- Icons: `Globe` (Web search) + `Telescope` (Research) from lucide-react — both verified present in installed version.
- `compact=true` → icon-only (label hidden, aria-label/title preserved) for side-pane.
- Action row order: `[Web search] [Research] [Bypass cache] <spacer> [send]`.
- Both controls appear in main composer and side-pane (compact icon-only).

---

## Test Results

| Suite | Tests | Status |
|---|---|---|
| `src/api/__tests__/chat-sse-client.test.ts` | 10 | PASS |
| `server/test/chat-proxy.test.ts` | 18 | PASS |
| `chat-service/test/web-search-gating.test.ts` | 16 | PASS |
| `chat-service/test/research-mode-gating.test.ts` | 10 | PASS |
| `src/pages/Chat/**` + `src/stores/__tests__/**` | 165 (23 files) | PASS |

**Typechecks:**
- `npx tsc --noEmit` (repo root): 0 new errors in touched files (71 pre-existing unrelated errors)
- `cd server && npx tsc --noEmit`: CLEAN
- `cd chat-service && npx tsc --noEmit`: CLEAN

---

## Unresolved Questions

None.
