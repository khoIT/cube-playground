# Research mode toggle — implementation report

## Files Modified

| File | Change |
|---|---|
| `src/pages/Chat/components/chat-research-mode-toggle.tsx` | NEW — renamed from `chat-deep-research-toggle.tsx`; label "Research mode"; aria/title updated |
| `src/pages/Chat/components/chat-deep-research-toggle.tsx` | DELETED |
| `src/pages/Chat/components/chat-composer.tsx` | Import swapped; comment updated; no prop renames (deepResearch/onToggleDeepResearch kept for call-site compat) |
| `src/pages/Chat/components/chat-empty-hero.tsx` | Lifted `deepResearch` state to parent; added `researchMode`+`onToggleResearchMode` props; removed no-op comment |
| `src/pages/Chat/components/chat-thread-view.tsx` | Added `researchMode`+`onToggleResearchMode` props; threaded into `ChatComposer` |
| `src/pages/Chat/chat-thread-page.tsx` | Added `researchMode` useState; passes to `ChatEmptyHero`+`ChatThreadView`; `sendTurn(text, bypassCache, researchMode)` |
| `src/pages/Chat/hooks/use-chat-stream.ts` | `sendTurn` signature: `(message, bypassCache?, researchMode?)` → forwarded to store |
| `src/stores/chat-stream-store.ts` | `StartTurnOptions.researchMode?: boolean`; forwarded to `openChatTurn` |
| `src/api/chat-sse-client.ts` | `OpenChatTurnOptions.researchMode?: boolean`; sends `X-Research-Mode: 1` header (only when true, mirroring X-Bypass-Cache) |
| `src/shell/chat-overlay/use-panel-chat-state.ts` | `researchMode` useState; `sendTurn(text, undefined, researchMode)`; exported on `PanelChatState` |
| `src/shell/chat-overlay/chat-panel.tsx` | Destructures `researchMode`+`onToggleResearchMode`; passes to empty-state `ChatComposer` and `ChatThreadView` |
| `server/src/routes/chat.ts` | Forwards `X-Research-Mode` header to chat-service (same pattern as X-Bypass-Cache) |
| `chat-service/src/api/turn.ts` | Reads `x-research-mode === '1'` as `turnOverride`; ORs into both `webSearchEnabled` and `researchModeEnabled` gates |
| `server/test/chat-proxy.test.ts` | +2 tests: forwards `X-Research-Mode: 1` when present; absent = not forwarded |

## Mechanism chosen: header (X-Research-Mode)

Same transport as `X-Bypass-Cache` — not a body field. Rationale: the main-server proxy reads/forwards request headers selectively (body is already serialized to the upstream body schema); adding a header keeps the pattern consistent, requires no body schema change, and is trivially testable via header inspection.

## Where OR-in happens in turn.ts

```ts
const turnOverride = req.headers['x-research-mode'] === '1';
const webSearchEnabled =
  config.chatEnableWebSearch && (turnOverride || skillMeta?.enableWebSearch || false);
const researchModeEnabled =
  config.chatEnableResearchMode && (turnOverride || skillMeta?.enableResearchMode || false);
```

Env flags (`CHAT_ENABLE_WEB_SEARCH`, `CHAT_ENABLE_RESEARCH_MODE`) remain the master kill-switch — toggle cannot enable either if env flag is off.

## Test results

- `server/test/chat-proxy.test.ts`: **15/15 pass** (13 pre-existing + 2 new)
- FE chat/overlay suite: **136/136 pass** (21 test files)
- `chat-service` full suite: **852/852 pass** (98 test files)
- `server tsc --noEmit`: clean
- `chat-service tsc --noEmit`: clean
- FE `tsc --noEmit` (our files): clean (pre-existing errors in unrelated files)

## Status

**DONE**

**Summary:** Renamed toggle component+file to "Research mode", wired toggle state FE→proxy→chat-service via `X-Research-Mode: 1` header, OR'd into both `webSearchEnabled` and `researchModeEnabled` gates with env kill-switch preserved.
