# Phase 01 — Remove advisor + care tools from chat-service

## Overview
- **Priority:** first (skills in phase-02 must not reference deleted tools)
- **Status:** DONE (2026-06-20)
- Strip the three advisor/care tools and their two private helpers from
  chat-service, and unregister them.

## Related code files

Delete:
- `chat-service/src/tools/recommend-actions.ts`
- `chat-service/src/tools/decompose-metric.ts`
- `chat-service/src/tools/care-queue.ts`
- `chat-service/src/tools/recommendation-citation.ts` (shared only by the two above)
- `chat-service/src/tools/recommendation-trust-guard.ts` (ditto)
- `chat-service/test/tool-decompose-metric.test.ts`
- `chat-service/test/recommendation-trust-guard.test.ts`
- `chat-service/test/tool-prescriptive-reads.test.ts` (covers recommend/decompose/care reads)

Edit:
- `chat-service/src/tools/registry.ts` — remove the 3 imports (lines ~30/32/33)
  and the 3 registration blocks (decomposeMetric / recommendActions / careQueue,
  ~lines 185–211).

## Implementation steps
1. Grep once more for any importer of the 5 deleted files outside themselves +
   their tests. Expected: none. If found, resolve before deleting.
2. Remove the 3 imports + 3 registration entries from `registry.ts`.
3. Delete the 5 source files + 3 test files.
4. `npx tsc --noEmit` (chat-service) — must be clean (catches any missed ref).
5. `npx vitest run` registry/boot tests — registry must boot with the smaller
   tool set.

## Todo
- [x] Confirm no external importers (only registry.ts imported the 3 tools; helpers only by the deleted tools)
- [x] Edit registry.ts
- [x] Delete 5 src + 3 test files
- [x] tsc clean
- [x] registry/boot tests green

## Success criteria
- chat-service compiles with zero references to recommend_actions /
  decompose_metric / care_queue / recommendation-citation / -trust-guard.
- Tool registry boots; no dangling skill→tool references yet remain ONLY in
  advise/diagnose (fixed in phase-02).

## Risk
- Deleting a helper still used elsewhere → guarded by step 1 grep + tsc.
