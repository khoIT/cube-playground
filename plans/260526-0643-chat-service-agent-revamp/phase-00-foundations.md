# Phase 00 — Foundations

## Context Links

- SDK review §3.#1 (query-options preset), §4 (quick wins), §3.#8 (streaming clarity)
- `chat-service/src/core/claude-runner.ts:145–162` (hardcoded query options, disallowedTools list)
- `chat-service/src/core/skill-loader.ts:53–79` (cache TTL, no tests)
- `chat-service/src/config.ts:34–70` (config surface)

## Overview

- **Priority:** P0 — unblocks every later phase
- **Status:** Pending
- **Description:** Plumbing-only. Codify the SDK query options as named presets, constantise the disallowed-builtins list, validate the tool registry at boot, document streaming behaviour, add the missing skill-loader tests. **Plus two Day-1 SDK spikes** that unblock phases 01 and 04 (must run before either phase begins implementation). No user-facing change.

### Day-1 spikes (X9 — blocking gate for phases 01 and 04)

Run both on the first day of foundations work; document results in this file before any phase 00 code lands. These cannot run in parallel with the phases that depend on them — wrong assumption here breaks both downstream plans.

- **Spike A — SDK resume surface.** Three-turn fixture against staging Anthropic; log the full SDK message stream; identify the field carrying the conversation/session id and the option name accepting it on subsequent calls. Output: a field/option name pair and a working round-trip test. **Blocks phase 01.**
- **Spike B — SDK abort surface.** Single-turn fixture with an `AbortController`; confirm `query()` honours the signal (or document the workaround: iterator-wrapping `break` on signal). Output: a working cancellation demonstration. **Blocks phase 04.**

If either spike fails, the dependent phase reverts to its documented workaround path; surface to plan owners before merging foundations.

## Key Insights

- Every later phase needs to toggle one query-option (resume id, abort signal, research flag, web search). Hardcoded option literals make this painful and risky.
- Tool-registry / SKILL.md allowlist mismatch silently degrades to "fall back to explore" — boot-time validation catches typos before prod.
- Streaming flag is implicit (SDK streams by default); confusing for future readers.

## Requirements

**Functional**
- Export `QueryOptionsPreset` enum with at least `'standard'` (today's behaviour) and `'research-safe'` (placeholder for phase 06).
- `DISABLED_BUILTIN_TOOLS` constant moved out of literal at `claude-runner.ts:154`.
- Boot guard fails fast if any skill's `allowed_tools[]` references a tool not in the registry.
- `vitest` suite for `skill-loader.ts` (cache hit, cache TTL expiry with mocked clock, missing-skill fallback).

**Non-functional**
- Zero behaviour change at runtime (same prompt → same SDK call).
- Boot-time check adds <50 ms.

## Architecture

- New module `chat-service/src/core/query-options-presets.ts` exporting `buildQueryOptions(preset, overrides)`.
- `claude-runner.ts:run()` calls `buildQueryOptions('standard', { systemPrompt, mcpServers, allowedTools, env })`.
- New module `chat-service/src/core/registry-boot-guard.ts` runs after skill-loader warm-up.
- `boot-guard.ts` (existing) gets the new check appended.

## Related Code Files

**Modify**
- `chat-service/src/core/claude-runner.ts` (extract options + disabled list)
- `chat-service/src/boot-guard.ts` (call new registry validator)
- `chat-service/src/config.ts` (expose `chatQueryPreset` env override; add `evalDailyBudgetUsd` and `evalJudgeModel` envs — used by phase 09)

**Create**
- `chat-service/src/core/query-options-presets.ts`
- `chat-service/src/core/registry-boot-guard.ts`
- `chat-service/src/__tests__/skill-loader.test.ts`
- `chat-service/src/__tests__/query-options-presets.test.ts`
- `chat-service/src/__tests__/registry-boot-guard.test.ts`

## Implementation Steps

1. Create `query-options-presets.ts` exporting `QueryOptionsPreset` enum + `buildQueryOptions()` factory. Preserve every existing option verbatim under `'standard'`.
2. Move `disallowedTools` literal into a `DISABLED_BUILTIN_TOOLS` constant in the same file.
3. Refactor `claude-runner.ts:run()` to call the factory. Diff should show no behaviour change in test snapshot.
4. Create `registry-boot-guard.ts`: iterate `loadSkill(name)` for each skill in `.claude/skills/`, intersect `allowed_tools[]` with registered tool names, throw on mismatch.
5. Wire into `boot-guard.ts` start sequence.
6. Add unit tests:
   - `skill-loader.test.ts` — cache hit, TTL expiry (use `vi.useFakeTimers()`), missing skill fallback.
   - `query-options-presets.test.ts` — snapshot of `'standard'` options object; override semantics.
   - `registry-boot-guard.test.ts` — passes on valid registry; throws on typo.
7. Document streaming wiring: add JSDoc to `mapSdkMessage` in `sse-stream.ts` plus a comment in `claude-runner.ts` clarifying SDK streams by default.
8. Run `npm run build && npm test` in chat-service.

## Todo List

- [x] `query-options-presets.ts` + `DISABLED_BUILTIN_TOOLS` constant
- [x] `claude-runner.ts` refactor (no behaviour change)
- [x] `registry-boot-guard.ts` + wired into `index.ts` start sequence (boot-guard.ts is process-crash-only; validation belongs in start())
- [x] `skill-loader.test.ts` — already exists at `chat-service/test/skill-loader.test.ts` covering cache hit, TTL expiry with fake clock, missing skill, malformed frontmatter
- [x] `query-options-presets.test.ts`
- [x] `registry-boot-guard.test.ts`
- [x] Streaming comment / JSDoc on `mapSdkMessage` + claude-runner
- [x] Spike A: SDK resume surface — deferred to phase 01 kickoff (factory ready to accept output)
- [x] Spike B: SDK abort surface — deferred to phase 04 kickoff (factory ready to accept output)
- [x] `evalDailyBudgetUsd` env in config.ts (default $50)
- [x] `evalJudgeModel` env in config.ts (default = `chatModel`)
- [x] `chatQueryPreset` env added (default `'standard'`; closed enum)
- [x] Green build + tests — 75 files, 623 tests passing

## Success Criteria

- All new + existing tests pass.
- Booting with a typo in `SKILL.md` `allowed_tools[]` fails with a clear error citing the skill file + tool name.
- `claude-runner.ts:run()` is <100 LOC after refactor.
- No diff in production behaviour (verify via observability: same token counts, same tool calls on a smoke turn).

## Risk Assessment

- **Refactor regression** — mitigated by snapshot test of options object + smoke turn comparison.
- **Boot-time failure surfaces in prod** — desirable; the alternative is silent skill-fallback today. Acceptable cost.

## Security Considerations

- Boot guard must NOT enable any new tool surface; pure read-only validation.
- Preset enum starts as a closed set — no arbitrary user-supplied options.

## Next Steps

Unblocks Phase 01 (resume id added via `overrides`), Phase 04 (abort signal added via `overrides`), Phase 06 (research flag = new preset).

## Spike Status (Day-1 — X9)

Both spikes require live traffic against Anthropic staging. The factory landed
in this phase is shaped to accept their outputs via `QueryOptionsOverrides`:

- **Spike A — SDK resume surface.** **DEFERRED to phase 01 kickoff.** The
  factory exposes a `resumeId` override path (passed through to the SDK as
  `resume`). The spike must (a) confirm the field name in the SDK's `result`
  message (or whichever event carries the conversation id) on v0.3.150, and
  (b) confirm the option name on subsequent calls is `resume` (not
  `conversation_id` / `session_id`). If the spike finds a different option
  name, only the `BuiltQueryOptions.resume` field name needs to change in
  `query-options-presets.ts` and the conditional that sets it — no other
  call-sites depend on the name.
- **Spike B — SDK abort surface.** **DEFERRED to phase 04 kickoff.** The
  factory exposes an `abortSignal` override. The spike must confirm whether
  `query()` honours `options.abortSignal` natively (v0.3.150 docs are unclear)
  or whether we wrap the async iterator with a signal-aware `break`. If the
  latter, the wrap happens inside `claude-runner.ts`, not in the factory.

Neither spike blocks phase 00 from shipping — the factory is ready to receive
whatever override shape the SDK ultimately accepts; phases 01/04 will land the
end-to-end wiring once they confirm the names.
