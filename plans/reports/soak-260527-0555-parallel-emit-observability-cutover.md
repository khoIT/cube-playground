# Parallel-Emit Soak — Observability Cutover Decision

**Date:** 2026-05-27
**Phase:** 05 — observability unification (TurnTracer)
**Question:** Is it safe to replace the legacy inline `emit*` dispatch in `claude-runner.ts` with `TurnTracer.onSdkMessage()`?
**Verdict:** ✅ **SAFE TO CUT OVER** — zero structural divergence across 10 live turns / 290 dispatched events.

---

## What was built

| Artifact | Purpose |
|---|---|
| `chat-service/src/observability/parallel-emit-shim.ts` | `RecordingObserver` (captures legacy dispatch), `RecordingSink` (captures shadow tracer), `diffRecordings()` (structural diff, excludes volatile fields) |
| `chat-service/src/observability/parallel-emit-log.ts` | Append-only JSONL writer → `runtime/parallel-emit/diffs.jsonl` (fs side-effect kept out of the pure shim) |
| `chat-service/src/core/claude-runner.ts` | Optional `tracer?` param; drives `onSdkMessage(msg)` per message + `finalize()` after loop, try/catch guarded |
| `chat-service/src/api/turn.ts` | When `OBS_PARALLEL_EMIT=true`: adds `RecordingObserver` to the composite + builds a shadow `TurnTracer` (sink = in-memory recorder only), diffs after the loop, appends one record per turn |
| `chat-service/src/config.ts` | `obsParallelEmitEnabled` ← `OBS_PARALLEL_EMIT` (default **false**, zero overhead when off) |
| `chat-service/src/scripts/run-parallel-emit-soak.ts` | Fires N real questions at a live instance, drains SSE, summarizes the diff log |
| `chat-service/test/observability/parallel-emit-shim.test.ts` | 5 unit tests incl. end-to-end legacy-driver-vs-tracer equivalence |

**Design guarantee (isolation):** the shadow `TurnTracer`'s only sink is the in-memory `RecordingSink` — it holds no DB handle and cannot write. The production path (`BufferedLlmTraceRecorder` + `LangfuseTracer`) stays the sole writer.

---

## How the test ran

- Soak instance on **:3006**, `OBS_PARALLEL_EMIT=true`, pointed at a **copy** of the live DB (`chat-soak.db`) to isolate writes from the user's :3005 instance.
- 10 real questions (no-tool answers, single tool calls, multi-step comparisons, funnels) → live Claude model + real Cube tool round-trips.
- All 10 turns returned HTTP 200 / SSE `done`. Per-turn diff appended to `runtime/parallel-emit/diffs.jsonl`.

## Results

| # | Question (truncated) | legacy | shadow | Δlatency | result |
|---|---|---|---|---|---|
| 1 | What metrics can I explore | 23 | 23 | 15ms | MATCH |
| 2 | show revenue last 7 days | 19 | 19 | 6ms | MATCH |
| 3 | ARPU vs paying-rate per country | 13 | 13 | 7ms | MATCH |
| 4 | iOS vs Android WoW 3 months | 39 | 39 | 8ms | MATCH |
| 5 | Top 10 countries by revenue | 13 | 13 | 6ms | MATCH |
| 6 | DAU yesterday | 61 | 61 | 6ms | MATCH |
| 7 | Retention by install cohort | 13 | 13 | 6ms | MATCH |
| 8 | Conversion install→purchase | 13 | 13 | 7ms | MATCH |
| 9 | Revenue by platform+country | 53 | 53 | 6ms | MATCH |
| 10 | Funnel session→purchase | 43 | 43 | 8ms | MATCH |

**Totals:** 290 events compared — `sdk_event=150`, `llm_call=96`, `tool_invocation=34`, `turn_finalized=10`.
- Byte-identical turns: **10 / 10**
- Structural divergences: **0**
- Max latency delta: **15ms** (informational only — the two paths read `Date.now()` independently; excluded from the structural diff).

**No-double-write proof:** per-turn DB rows in the soak DB equal the recorded legacy counts **exactly** (1×, not 2×) for every turn — e.g. turn `c5e6424c…` recorded 31 sdk / 21 llm / 8 tool, DB held 31 / 21 / 8.

## What "match" means

The diff compares the two callback sequences position-by-position: same length, same `kind` per index, structurally-equal payloads after stripping fields that are non-deterministic by construction (`latencyMs`, `startedAt`, `endedAt`, `at`, permission-decision `id`). Everything that carries signal — `stepIndex`, `seq`, `model`, token counts, content blocks, tool name/args/result summary, `ok`, `stopReason`, denials — matched.

Unit tests independently prove the same claim against a literal replica of the runner's legacy dispatch (incl. abandoned-tool flush), so the equivalence holds beyond the specific traffic sampled.

---

## Recommendation

Cut over: replace the four inline `emit*` sites + post-loop flush in `claude-runner.ts` with a single `TurnTracer` (real sinks via `ObserverSinkAdapter`), then delete `composite-observer.ts` + the runner's direct `sdk-event-extractor` calls. Keep `OBS_PARALLEL_EMIT` + the shim for one more soak immediately after the cutover (tracer now the writer, a second shadow re-verifies), then remove the shim.

## How to re-run

```bash
# terminal 1 — soak instance with the flag on (own DB copy)
cp runtime/chat.db runtime/chat-soak.db
OBS_PARALLEL_EMIT=true PORT=3006 CHAT_DB_PATH=./runtime/chat-soak.db npx tsx src/index.ts
# terminal 2
SOAK_BASE_URL=http://localhost:3006 npx tsx src/scripts/run-parallel-emit-soak.ts
```

## Unresolved questions

- **Abort path not exercised:** all 10 turns ran to completion, so `turn_aborted` dispatch (Phase 04) was not compared live. Covered by unit tests only — worth one cancelled turn during the post-cutover soak.
- **No `permission_decision` events** appeared (bypassPermissions mode → empty `permission_denials[]`). Path is unit-tested but unobserved in the wild.
- **Single game (`ballistar`):** schema-specific tool-arg shapes from other games (`ptg`, `cfm_vn`) not sampled; low risk since the diff is schema-agnostic, but a mixed-game soak would close it.
