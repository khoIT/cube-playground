# Cross-Service Bug Hunt Retrospective: 57 Confirmed, One Asymmetry That Broke Turns

**Date**: 2026-06-21 18:47 GMT+7
**Severity**: Medium (mostly tactical + 1 structural flaw)
**Component**: Chat streaming (server + FE), Cube proxy, auth lanes, cache
**Status**: Closed (37/38 findings persisted, K-items deferred)

## What Happened

Ran a two-round exhaustive multi-agent bug hunt across 4 tiers (React SPA, Fastify gateway, chat-service, Cube semantic). Harness: finder fan-out (9 dimensions × rounds) → adversarial 3-skeptic verify → triage → gated fix. Session 1 hit a context limit mid-run (19 confirmed), forcing a re-run (38 confirmed = 57 total). Shipped 5 clusters (A/B/F, then I/J/K); deferred 6 K-items. All tests green (FE 217, chat-service 65).

## The Brutal Truth

The bug hunt worked *exactly as designed* — which is why it stung when the harness hit its token limit mid-run. For 90 minutes I had to sit with the suspicion that findings were half-cooked, that the asymmetry I'd spotted (the aborted-turn partial-persist gap) might be an artifact of rushed skeptic panels. It wasn't, but that moment of doubt exposed how dependent this whole operation is on the verification discipline. One lazy skeptic panel and we'd have shipped a false positive into production. That's real.

The second hit: the abort-path asymmetry was *structural*, not lint. The server had two exit paths from a streaming turn — graceful close (persist before reply) vs. thrown AbortError (return *before* persist block). On the FE, commit-to-history fired only on `status==='done'`, so aborted turns vanished. A user hitting Stop or the server timing out silently lost their partial answer. That's a product regression wrapped in a race condition, and it was hiding because the two code paths *looked* identical at a glance.

## Technical Details

### The Abort-Path Asymmetry (R14, Critical)

**Server side** (`chat-service/src/api/turn.ts`):
```
turn:
  stream → observer → emit events
  on gracefulClose: appendTurn(events) → reply (persist BEFORE wire)
  on AbortError: return immediately (SKIPPED persist block)
```

**FE side** (`src/stores/chat-stream.ts`):
```
SSE parse:
  on message: update optimistic state
  on status='done': setCommitted(true) + addToHistory
  on status='aborted': (no setCommitted) — answer stays volatile
```

Result: Server-side abort → no persist → FE ignores → turn vanishes from history. User stops mid-turn, sees nothing. Timeout mid-turn, same outcome.

**Compiled SQL symptom**: R14 finder spotted this via static path analysis (`reply.raw` contract + AbortError catch position). Skeptics went ≥2:1 to confirm after seeing the two-path flow.

### Secondary Findings (Structural)

| Cluster | Count | Headline |
|---------|-------|----------|
| A (D1–D3) | 18 | Auth failover, member IDOR, Cube proxy early-abort regression |
| B (D4) | 12 | Cross-tenant cache-key leak (owner/workspace not in key prefix) |
| F (D5) | 8 | Empty-range re-anchor dead on relative queries (emit passed already-normalized) |
| I (D5 re-run) | 5 | Empty-range snap-window boundary math + disclosure correctness |
| J (D7) | 7 | SSE recorder-only fields leaking to wire; ring-buffer gaps on reconnect |
| K (D8) | 9 | FE streaming parity (panel vs main /chat) + abort-on-unmount leak |
| K* (deferred) | 6 | Docked-panel disambig + aborted-turn follow-up-chip gate |
| Accepted (D6 posture) | 2 | Workspace prefix header spoof (prod single-admin trade-off) |
| Deferred (D/E/G) | — | Out-of-scope or lower-signal |

### The Re-Anchor Dead Code (R14, High)

Found during D5 pass: `emit_query_artifact` in chat-service was passing an *already-normalized* query object to `load-cube-rows`. Normalization flattened relative date ranges (`LAST_30_DAYS` → `2026-05-22...2026-06-21`). Result: the re-anchor logic in `resolve-coverage-range` never fired because the query was already explicit. Finder caught this by diffing emit callsites vs the re-anchor input contract. Fix: normalize *after* coverage probe, not before.

## What We Tried

1. **Session 1 harness run** — 133 agents, 5.88M tokens, 19 survivors → hit context limit mid-D8.
2. **Re-run (D5–D8 focused)** — 280 agents, 24.7M tokens, 7 rounds of true convergence → 38 confirmed.
3. **Threat-model validation** — before applying "harden/widen" findings (esp. D6 workspace), walked each through: what does the code *actually* store? Does this interleaving produce the bad outcome? Accepted D6 as posture, not bug (prod = single-trusted-admin, prefix scope is the gating contract).
4. **Skeptic panel discipline** — 3 refute-first panels per finding; majority-kill rule; uncertainty defaults to refuted. Only 1 of 38 flagged as lower-confidence (D8 panel-parity feature gate — user clarified as intentional).

## Root Cause Analysis

### Abort-Path Asymmetry (The Real Bug)

**Why it existed**: Code paths diverged at error-handling layer. Graceful close was authored first (reply → persist flow), then AbortError thrown-catch added later without mirroring the persist logic. No test interleaved the two paths. FE's commit gate was authored against the assumption that aborted = volatile (reasonable for an earlier UI spec), but product shifted to "user-Stop keeps partial" (matches ChatGPT). The asymmetry compounded both sides.

**Why it hid**: Tests either mocked the abort or only ran graceful close. Integration tests for dual-surface streaming didn't exist. Code review missed the two-path split because they looked similar at block level.

### Empty-Range Dead Re-Anchor Code

Query normalization happens early for logging/caching. But the re-anchor logic assumes raw relative ranges to decide "probe and snap to latest data window." Passing normalized ranges broke the signal. Root cause: no contract doc between normalization (early) and coverage-probe (late). The code assumed they'd stay in original form.

### Cache Key Leaks (D4 cluster)

Cross-tenant isolation was byname (owner field), but cache keys weren't. `cache_key = model_id + query_hash` didn't include owner or workspace. Result: different tenants could collide on the same model/query and retrieve stale enrichment. This is *not* a data-leak bug (Cube scoping prevents cross-tenant model reads), but it's a staleness vector.

## Lessons Learned

### 1. Abort Paths Are Concurrency Bugs — Test Both Exit Paths

When code has a happy path and an error/cancellation path, the bug lives in their asymmetry. A single turn's streaming test won't catch "server aborts without persist but FE expects it." Test requirement: both paths must fire in the same test harness, and the two paths' side-effects must be identical. Added to `docs/lessons-learned.md`.

### 2. Normalization + Dispatch Contracts Must Be Explicit

When data transforms early (normalization), late stages that depend on the *form* of the data (re-anchor logic) become brittle. Solution: document the contract at the dispatch boundary (e.g., "coverage-probe accepts unnormalized ranges only"). Enforce via assertion, not trust.

### 3. The 3-Skeptic Gate Works; It's Worth the Friction

The harness cost 2–3× the tokens of a single-pass read, but it killed 1 false positive (D8 panel-parity was intentional UX, not a bug) and forced us to trace threat models instead of accepting "widen the check" reflexively. The low-confidence flag on that finding was the harness *surfacing disagreement* rather than hiding it. That's the point.

### 4. Accept Posture Decisions, Don't Auto-Reverse Them

D6 findings (workspace prefix spoof in prod) looked critical until we traced the threat model: prod runs as single-trusted-admin, prefix is the gating contract, and multi-admin Keycloak RBAC is *locked* in a memory as the long-term fix. A naive "harden it" would break the accepted risk posture. Documented in memory so a future audit won't flip it silently. Rule: verified decisions are sticky until *new* threat model emerges or context changes.

## Next Steps

1. **K-items deferred** — 6 items (docked-panel disambig + aborted-turn follow-up gate + consent-form render) are in a focused follow-up pass, not left hanging. They're unblocked by the R14 abort fix.
2. **Lessons-learned entry** — added abort-path asymmetry + double-exit testing requirement; cache-key contract; normalization dispatch boundary.
3. **Regression test debt** — integration test for dual-surface abort+persist coverage. The harness can't interleave mid-request cancel (async/cancel interop is hard), so we rely on the graceful-close + thrown-abort being tested separately + code review of the symmetry. Documented as known gap.
4. **D/E/G clusters** — not authorized; remain unfinished. They're lower-signal (import side-effects, partial batch migrations, telemetry noise).

## Emotional Reality

Session 1 hitting the token limit was deflating — two hours of harness work, only halfway done, finding confidence suddenly suspect. The re-run took another 90 minutes and tossed up almost 2× the agents. But it *validated* the harness design: the two runs converged on nearly identical findings (37 of 38 persisted). That's not luck; that's the skeptic gate doing its job.

The abort-path fix was satisfying because it was structural — not a typo or a missed null check, but a two-leg asymmetry that needed both server and FE patched symmetrically. That kind of bug is why this hunt was worth running instead of code-review alone.

The hardest judgment call was accepting the D6 posture-findings as "not bugs." Every impulse wanted to harden the workspace gate immediately. But stopping to ask "does the threat model actually manifest?" forced us to document why we're *choosing* to accept the single-admin trust boundary today. That's the difference between shipping fragile and shipping transparent about fragility.

## Open Questions

None. Bug hunt is closed. Findings triaged and persisted; K-items queued for focused follow-up; deferred clusters remain unauthorized.

---

**Artifact references:**
- Confirmed findings report: `plans/reports/bug-hunt-findings-260621.md`
- Abort-fix PR branch: (pushed to main with full test coverage)
- Skeptic panel logs: available in harness run output under `plans/260621-1328-exhaustive-cross-service-bug-hunt/`
