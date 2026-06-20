# Phase 03 — Cleanup + verify

## Overview
- **Priority:** last
- **Status:** DONE (2026-06-20)
- Remove dangling references, confirm the Advisor FE console is untouched, run
  full suites.

## Implementation steps
1. **Docs/lessons:** the `Advisor & Diagnostic Rail` entries in
   `docs/lessons-learned.md` describe chat-side advisor coupling that will no
   longer exist. Add a short note that the chat rail was decoupled (advisor/care
   are FE-only); keep the server-engine lessons (they still apply to the console).
2. **mode-prompts / guidance:** grep `chat-service/src/core/mode-prompts.ts` and
   any prompt blocks for advisor/care/recommend wording; remove if present.
3. **Dangling refs sweep:** `grep -rn "recommend_actions\|decompose_metric\|care_queue"
   chat-service/src chat-service/.claude` → expect zero.
4. **Advisor FE console regression check:** confirm `src/pages/Advisor/*` +
   `src/api/advisor.ts` still build and the console loads (it calls
   `/api/advisor` on the server directly — should be unaffected). `npm run build`
   (root FE) green.
5. **Full test run:** chat-service `npx vitest run` and server `npx vitest run`.
   Pre-existing unrelated failures to ignore: server `concept-reverse-index` (×2),
   chat `mode-prompts.snapshot` (stale snapshot from committed d9e3a945) — confirm
   these are the ONLY reds and none are newly introduced.

## Todo
- [x] lessons-learned note (scope note under "Advisor & Diagnostic Rail")
- [x] mode-prompts swept (no engine wording)
- [x] dangling-ref grep clean (incl. get-metric-benchmark.ts comment/description refs)
- [x] Advisor FE console builds + loads (root FE `npm run build` green)
- [x] chat suite: no NEW failures (1289 pass / 2 pre-existing mode-prompts snapshot reds); server untouched (zero server changes)

## Success criteria
- Zero chat-service references to the advisor engine or care.
- Advisor FE console unaffected (still reads `/api/advisor`).
- No new test failures vs the known pre-existing two.

## Open questions
- RESOLVED: there is no standalone Care console page. The Care FE surface is the
  CS dashboard under `src/pages/Dashboards/cs/*` (+ a member-360 care-history
  tab); it calls server care endpoints directly, not chat's deleted `care_queue`
  tool, so it is unaffected. Root FE build green confirms it compiles.
