# Chat turn duplication fix

**Date:** 2026-05-24
**Branch:** `new_design`
**Commit:** `83e9008`

## Symptom

Every assistant turn appeared **twice** in the chat once streaming finished — same reasoning trace, same tool calls, same artifact card, same trailing text. Visible in both `/chat/:id` route and the side-panel surface.

## Root cause

`chatStreamReducer`'s `DONE` action preserved every streaming buffer (`currentText`, `currentReasoning`, `currentArtifacts`, `currentToolCalls`). Both consumers — `chat-thread-page.tsx` and `use-panel-chat-state.ts` — used this render branch:

```ts
if (isStreaming || (status === 'done' && currentText)) {
  displayMessages.push({ role: 'assistant', id: '__streaming__', sections });
}
```

The same effect that detected `status → 'done'` also committed those buffers into `committedMessages` as a real assistant turn. Result: on the post-commit render, `committedMessages` had the turn, AND the render branch still pushed a `__streaming__` clone (because `currentText` was still populated). The clone never disappeared — `current*` is never cleared until the next `START`.

## Fix

1. `CLEAR_STREAM_BUFFERS` reducer action — zeroes only the streaming fields. Preserves `status`, `sessionId`, `lastCompactWarning`, `retryAfterMs`, `error`.
2. `useChatStream` exposes `clearStreamBuffers()`.
3. Both consumers call it immediately after the `setCommittedMessages(...)` in their `done`-transition effect. React 18 batches the two updates → single paint, no flicker.
4. Dropped the `(status === 'done' && currentText)` render branch. Live preview only renders while `status` is `loading`/`streaming`. Even if a future edit forgets to clear, the duplicate can no longer surface.

## Files

- `src/pages/Chat/hooks/use-chat-stream-reducer.ts` — action + case
- `src/pages/Chat/hooks/use-chat-stream.ts` — expose method
- `src/pages/Chat/chat-thread-page.tsx` — call clear + drop branch
- `src/shell/chat-overlay/use-panel-chat-state.ts` — call clear + drop branch
- `src/pages/Chat/hooks/__tests__/use-chat-stream-reducer.test.ts` — regression (4 cases)

## Verification

- All 25 chat tests green (4 new + 21 existing).
- Chat-related typecheck clean. Unrelated TS errors in `QueryBuilderV2`/`rollup-designer`/`smart-search` pre-existed on `main`.

## Lessons

Reducer state surviving a "terminal" status (`done`) is a code smell when the render layer derives display from the same buffers. Either clear at the source on terminal transitions, or make the live-preview branch gate exclusively on a non-terminal status — ideally both, as defense-in-depth.

The `(status === 'done' && currentText)` branch looked like a paranoia check ("keep showing while we commit") but the commit happens in a single React tick, batched with the buffer clear — there is no gap to bridge.

## Unresolved

- `use-chat-stream.ts:86-88` reads `state.currentText` from a closure that can be stale (a `result` event arriving before the reducer commits the latest `TOKEN`). Unrelated to this bug and not currently observed in production; left for a follow-up.
