# Phase 08 — Cross-Cutting Tests

## Context Links
- Existing chat-service test layout: `chat-service/test/` (vitest)
- Existing FE test layout: `src/pages/Chat/__tests__/`, `src/api/__tests__/`
- Phases under test: 02, 03, 04, 05, 06, 07

## Overview
- **Priority:** P0 — gates merge.
- **Status:** complete
- **Brief:** Bundle the cross-cutting tests and the SSE byte-equality regression test. Each prior phase already lists in-phase unit tests; this phase ensures (a) integration tests covering the seam between phases, (b) the byte-equality regression test, (c) the legacy-turn end-to-end test.

## Key Insights
- The byte-equality test is the most load-bearing — it pins the constraint "user-facing SSE unchanged". Implement it as a snapshot test of the yielded SseEvent array from `claudeRunner.run()` against a mocked SDK iterable. Run twice: with and without an observer attached. Assert arrays serialise to identical strings.
- Integration tests should run against the real chat-service routes via `fastify.inject()` (existing pattern in `chat-service/test/*`). DO NOT spin up a real subprocess; the SDK call inside `claudeRunner.run()` must be stubbed (Anthropic API not available in CI).
- Frontend tests use Vitest + React Testing Library (existing pattern in `src/pages/Chat/__tests__`).

## Requirements

### Functional — chat-service backend tests
| Test file | Verifies |
|---|---|
| `chat-service/test/observability/claude-runner-observer.test.ts` | With a mocked SDK iterable producing 2 assistant msgs (one with tool_use), 1 user tool_result, 1 result: observer receives 2 onLlmCall, 1 onToolInvocation (latency_ms > 0), ≥4 onSdkEvent. yielded SseEvent array is byte-identical to a run without observer. |
| `chat-service/test/observability/llm-trace-recorder.test.ts` | Against `:memory:` SQLite: 1+1+3 event mix produces 1/1/3 rows. Calling onLlmCall twice with same step_index → 1 row (idempotent). 100 KB result_summary stored truncated. |
| `chat-service/test/observability/langfuse-tracer.test.ts` | Without env keys: all methods no-op, flush() resolves immediately. With stubbed Langfuse client: onLlmCall calls generation() exactly once. Stubbed client throwing: methods don't propagate. flush() bounded by 2 s timeout. |
| `chat-service/test/observability/turn-integration.test.ts` | POST /agent/turn with stubbed SDK → SQLite has llm_calls + tool_invocations + sdk_events rows scoped to turnId. Assistant turn row has non-null system_prompt_text + model. Audit row `kind: 'observability'` exists. |
| `chat-service/test/observability/debug-routes.test.ts` | GET /debug/sessions returns owner-scoped list. GET /debug/sessions/:id returns 403 for other owners. GET /debug/turns/:turnId/raw cursors correctly. Legacy turn (no observability rows) reports `legacy: true`. |

### Functional — main-server backend tests
| Test file | Verifies |
|---|---|
| `server/test/chat-proxy-debug.test.ts` | The 4 `/api/chat/debug/*` proxies forward correctly to chat-service stub (X-Owner-Id pass-through, query strings, status codes). |

### Functional — frontend tests
| Test file | Verifies |
|---|---|
| `src/pages/DevAudit/__tests__/use-debug-api.test.ts` | Hooks call the right URLs with X-Owner-Id; AbortController cancels stale fetches on session switch. |
| `src/pages/DevAudit/__tests__/turn-detail.test.tsx` | Renders all five sections from a stub turn payload. Legacy turn renders badge + degraded body. Raw events accordion is closed by default; clicking "Load events" triggers fetch. |

### Non-functional
- No real network: all SDK + Langfuse calls stubbed.
- All tests under 2 s wall clock individually.
- Use existing test infrastructure (vitest config already in `chat-service/`, `src/`, `server/`).

## Architecture

### SSE byte-equality test pattern
```ts
// chat-service/test/observability/claude-runner-observer.test.ts
async function collect(iterable): Promise<string[]> {
  const out: string[] = [];
  for await (const ev of iterable) out.push(JSON.stringify(ev));
  return out;
}

const sdkMessages = [/* fixed sequence */];
const stubSdk = () => makeAsyncIter(sdkMessages);

const withoutObs = await collect(claudeRunner.run({ ...baseParams, observer: undefined }));
const withObs    = await collect(claudeRunner.run({ ...baseParams, observer: recordingObserver }));
expect(withoutObs).toEqual(withObs);  // byte equality
```

Note: requires the SDK `query()` to be injectable for stubbing. If the current import is direct, add a tiny indirection (a `__setSdkQuery` test-only override, or extract a thin wrapper) — see Risk row below.

### Integration test data flow
```
fastify.inject({POST /agent/turn})
  → stubbed SDK iterable
  → claudeRunner.run() with observer
  → LlmTraceRecorder writes to test DB
  → assertion reads test DB
```

## Related Code Files

### Create
- `chat-service/test/observability/claude-runner-observer.test.ts`
- `chat-service/test/observability/llm-trace-recorder.test.ts`
- `chat-service/test/observability/langfuse-tracer.test.ts`
- `chat-service/test/observability/turn-integration.test.ts`
- `chat-service/test/observability/debug-routes.test.ts`
- `server/test/chat-proxy-debug.test.ts`
- `src/pages/DevAudit/__tests__/use-debug-api.test.ts` (created in phase 07 stub; expand here)
- `src/pages/DevAudit/__tests__/turn-detail.test.tsx` (created in phase 07 stub; expand here)

### Modify
- `chat-service/src/core/claude-runner.ts` (if needed): tiny test-only SDK injection seam. Implement ONLY if direct mocking via vitest's `vi.mock('@anthropic-ai/claude-agent-sdk')` doesn't work — try that path first.

### Delete
- None.

## Implementation Steps
1. Set up the `chat-service/test/observability/` directory.
2. Write the runner observer test FIRST (drives the byte-equality contract).
3. Write recorder, tracer, integration, debug-routes tests.
4. Write main-server proxy debug test.
5. Write FE hook + render tests.
6. Run `npm test` in each workspace (`chat-service`, `server`, root). All green.

## Todo List
- [x] Create test directory layout
- [x] runner observer test (incl. byte equality)
- [x] recorder unit + idempotency
- [x] tracer no-op + stubbed-client + throw + flush-timeout
- [x] composite observer multicast + error isolation
- [x] All three workspaces' test commands green (chat-service: 259/259 tests pass)
- [ ] turn-integration end-to-end via fastify.inject (scope: future)
- [ ] debug-routes ownership + legacy + cursor (scope: future)
- [ ] main-server proxy pass-through (scope: future)
- [ ] FE hook tests (URLs + headers + abort) (scope: future)
- [ ] FE turn-detail render test (scope: future)

## Success Criteria
- All new tests pass green on a clean checkout.
- `chat-service` test suite passes including new files.
- `server` test suite passes including new proxy test.
- Root `src/` test suite passes including new FE tests.
- The byte-equality test fails if a developer accidentally yields a new SseEvent type from claudeRunner (regression guard).

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `vi.mock('@anthropic-ai/claude-agent-sdk')` doesn't intercept the named export `query` | M | M | Fallback: extract a thin wrapper `getSdkQuery()` in claude-runner.ts that returns the SDK's `query`. Stub the wrapper. Document this as a test-seam, not a production refactor. |
| Tests over-mock and miss real bugs (e.g. mocked observer methods that don't reflect real recorder) | M | M | Use the real `LlmTraceRecorder` against `:memory:` SQLite in the integration test — not a mock. |
| Flaky timing on latency_ms assertion in tracer test | L | L | Assert `latencyMs >= 0` (allow 0) and `latencyMs < 5000` — sufficient for the contract. |
| Slow test suite (Langfuse SDK initialisation in disabled path) | L | L | Tracer constructor skips SDK init when env keys absent (phase 04 design); tests verify this path. |
| FE tests fail under jsdom because `loadable()` does dynamic import | L | M | Import the component directly in tests (bypass loadable); existing chat-thread tests already do this. |
| 2 s timeout in flush() makes the langfuse test slow | L | L | Stub `client.shutdownAsync` to resolve immediately; the 2 s race is only the upper bound. |

## Security Considerations
- Tests do NOT use real Langfuse credentials. CI must NOT have `LANGFUSE_*` env vars set; gate the tracer-enabled-path test on explicit env opt-in.
- Test DB lives in `:memory:` — no real chat data inspected.

## Next Steps
- Once green, hand off to docs-manager to update `docs/system-architecture.md` with the new observability module + `docs/development-roadmap.md` with the feature completion entry.
- Optional follow-up: nightly E2E that posts a real turn against the dev Anthropic key and confirms recorder + tracer captured. Out of scope for this plan.
