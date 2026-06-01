# chat-service turn.ts — profile-then-decompose

**Status:** Phase 0 shipped (instrumentation + gateway quick-win). Phases 1–3 pending baseline numbers.
**Branch:** `perf/chat-turn-profiling-and-gateway-quickwins`

## Why

`chat-service/src/api/turn.ts` is the single worst maintainability liability in the repo (911 LOC, ~4.5× the 200-LOC guideline) and sits on the per-turn hot path. It was flagged the strongest refactor+perf candidate across the three services.

**Honest framing (verified, not assumed):** several perf claims from the initial survey were overstated and were dropped after reading the code:
- Per-request Cube-token minting → HMAC-SHA256 over ~100 bytes is microseconds, not a bottleneck. **Dropped.**
- `getMetaVersion` before cache lookup → already LRU+TTL cached (60s) with a memoized hash (`cube-meta-cache.ts:26-28,112-121`); costs a fetch only ~once/60s per (workspace,game), not per turn. **Low priority.**

On cache **hits** the LLM is skipped and the rest is in-process SQLite (microseconds); on cache **misses** the LLM call dominates (hundreds–thousands of ms). So the primary value of touching `turn.ts` is **decomposition/testability**, and perf fixes are **contingent on what profiling shows** — hence profile first.

## Phases

| Phase | Title | Status | Gate |
|---|---|---|---|
| 0 | Instrumentation + gateway quick-win | ✅ done | — |
| 1 | [Profiling & baseline](./phase-01-profiling-and-baseline.md) | pending | run real turns w/ `CHAT_TURN_PROFILING=1` |
| 2 | [Decompose turn.ts → 5 modules](./phase-02-decompose-turn.md) | ✅ done (911→724) | — |
| 3 | [Contingent perf fixes](./phase-03-contingent-perf-fixes.md) | pending | phase 1 shows the stage is hot |

## Phase 2 (shipped this session)

Extracted 5 self-contained concerns out of `turn.ts` (911→724 LOC), behaviour-preserving, 869 tests green after every step, code-review confirmed no drift:
- `turn/build-observer.ts` (105) — observer stack construction
- `turn/try-response-cache-hit.ts` (131) — cache lookup + early-exit hit path
- `turn/precheck-auto-compact.ts` (80) — pre-stream compaction
- `turn/maybe-summarise-title.ts` (78) — title summariser
- `turn/write-session-focus.ts` (54) — focus-bag snapshot

**Deliberately NOT extracted:** the runner loop + event accumulation (the truly entangled `emit`/registry/controller/observer/accumulator core). It would need threading ~10 shared refs for less safety margin — the orchestrator shell staying ~700 LOC is an acceptable trade vs the risk. Revisit only if it keeps growing.

**Pre-existing (not introduced):** on a cache hit the per-turn `timeoutHandle` isn't cleared before the early return; the later fire is a documented no-op (`turn.ts`). Candidate cleanup, not a regression.

## Phase 0 (shipped this session)

- `chat-service/src/observability/turn-timing.ts` — stage timer, gated by `CHAT_TURN_PROFILING`, marks: `compose → meta-hash → cache-replay | llm-first-event → llm-done → persist`, one structured log line per turn exit (cache_hit / finish / error).
- `turn.ts` — timer created + 6 marks + 3 flushes wired (zero cost when flag off).
- `config.ts` — `chatTurnProfilingEnabled` flag.
- Gateway quick-win: `server/src/routes/segments.ts` — `GET /api/segments` N+1 tag lookup → single bulk `IN (...)` query (`loadTagsBySegment`). 546 server tests green.

## Key dependencies

- Phase 1 needs a working chat-service (LiteLLM keys + Cube up) to generate real turns.
- Phase 2 is the main deliverable; phase 3 only proceeds for stages phase 1 proves hot.
</content>
