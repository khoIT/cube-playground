---
phase: 4
title: "Phase 1 tests (S1-S3 S5)"
status: completed
priority: P1
effort: "0.5d"
dependencies: [3]
---

# Phase 4: Phase 1 tests (S1, S2, S3, S5)

## Overview

Cover Phase 1 behavior with automated tests so future refactors don't regress the resume UX. Mix of unit (store + hook), integration (mocked SSE), and one Playwright/Vitest browser test for the cross-view live-binding.

## Requirements

- Functional:
  - Store unit tests: event→state transitions, refcount semantics, `startTurn` guard, `done`-fires-onDone.
  - Hook integration tests: `useChatStream` returns same slice across re-renders when subscribing to same `sessionId`.
  - Browser/E2E: submit → unmount panel-side mount → assert state still streams; remount → assert state continues.
- Non-functional:
  - No flaky timers; use deterministic fake timers + mock SSE event source.

## Architecture

- Unit tests live next to the store: `src/stores/chat-stream-store.test.ts`.
- Hook tests with `@testing-library/react` + `renderHook`.
- Integration test stubs `openChatTurn` with a controllable AsyncIterable that we push events into manually.
<!-- Updated: Validation Session 1 - JSDOM-only commitment, no Playwright (Q6) -->
- Repo has no Playwright config today, so cross-view coverage uses a JSDOM integration test with simulated router unmount/remount. (If Playwright is later added to the repo, a complementary spec can be authored under a separate plan.)

## Related Code Files

- Create: `src/stores/chat-stream-store.test.ts`
- Create: `src/pages/Chat/hooks/use-chat-stream.test.tsx`
- Create: `src/pages/Chat/__tests__/cross-view-resume.test.tsx` (JSDOM, simulated router unmount/remount).
- Read for context: existing test patterns in `tests/` and `src/**/*.test.ts(x)`.

## Implementation Steps

1. Write store unit tests for: token append, reasoning append, artifact push, chart push, tool_call → tool_result pairing, done transition + onDone fire, error transition, refcount sub/unsub, startTurn guard.
2. Write hook integration test: mount two consumers for same sessionId, push events, assert both observe identical slice.
3. Write unmount/remount test: mount A → push N events → unmount A → push M more events → assert store still accumulates → mount B → assert B sees N+M.
4. Write the JSDOM cross-view test: render two consumers (panel + main) wrapped in a memory router → submit on `/chat/:id` → push N tokens → swap route to `/segments` → assert panel selector still observes streaming slice → swap back → assert main view shows accumulated tokens + continues live.
5. Wire into existing test scripts (`npm run test` or `vitest`). All must pass before merge.

## Success Criteria

- [x] Store + hook test files green, ≥85% coverage for the store.
- [x] Cross-view test passes locally and in CI.
- [x] S1, S2, S3, S5 demonstrated as automated assertions.

## Risk Assessment

- Risk: JSDOM cross-view test mocks router transitions instead of exercising the real browser. Mitigation: pair with a manual smoke checklist (S1/S2/S3/S5 in Phase 3); upgrade to Playwright in a follow-up plan if needed.
- Risk: Mocked SSE diverges from real behavior. Mitigation: one real-server smoke test (env-gated) that runs chat-service locally.
