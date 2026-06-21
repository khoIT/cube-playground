# Exhaustive Cross-Service Bug Hunt — Plan

**Created:** 2026-06-21
**Status:** Ready to execute (workflow opt-in required)
**Scope:** chat-service + gateway server (segments) + cube-dev (model) + FE (SPA)
**Mode:** loop-until-dry finder fan-out → adversarial verify (N skeptics, kill on majority-refute) → triage report. Fix is a **separate gated phase**.

## Goal

Surface real, reproducible defects in the seams memory flags as sharp, with high precision (no plausible-but-wrong findings reach the report). Optimize for *confirmed* bugs, not raw finding count. Auto-fix is **not** in scope for the hunt itself — findings are triaged; the user authorizes fixes per-finding.

## Why a workflow (not a single pass)

These seams are concurrency/contract bugs that hide in interaction, not in one file. A single read pass over 800+ source files biases toward shallow lint-grade findings. The harness instead:

1. **Fans out by dimension** — one finder per seam, each blind to the others, so coverage is broad.
2. **Loops until dry** — keeps spawning finder rounds until K=2 consecutive rounds surface nothing new (the tail of real bugs is long; a fixed pass misses it).
3. **Adversarially verifies** — every fresh finding faces N=3 independent skeptics prompted to *refute*; killed on majority-refute. This is the precision gate that keeps the report trustworthy.

## Target seams (grounded file map)

| Dim | Seam | Primary paths | Bug shapes to hunt |
|---|---|---|---|
| D1 | Auth-lane key failover | `chat-service/src/core/anthropic-key-failover.ts`, `llm-auth-mode.ts`, `api/internal-llm-auth.ts`; `server/src/services/chat-llm-auth-client.ts` | rotation race; cooldown-expiry off-by-one; mode-gate filtering empties rotation; OAuth-token (`CLAUDE_CODE_OAUTH_TOKEN`) path; `isBalanceExhaustedError` false-negative classification; all-keys-share-one-upstream blind spot |
| D2 | Tokenless members + movement reads | `server/src/routes/segments.ts:657`, `segment-movement.ts:188,277,364,433`; `services/member-profile-runner.ts`, `member360-runner.ts` | auth-check-after-load info leak; `guardSegment` ordering / IDOR; rank-measure injection; enrichment cache staleness vs tokenless freshness |
| D3 | Cube proxy abort/disconnect | `server/src/routes/cube-proxy.ts:246-414`, `cube-load-admission.ts`, `cube-load-result-cache.ts` | `reply.raw` vs `req.raw` close-event (POST /load early-abort regression); `writableFinished` guard; continue-wait 499 path; admission-control orphan-abort; load-cache key collision / LRU eviction; **must use reply.raw not req.raw** (known regression class) |
| D4 | Cache layers (both services) | `chat-service/src/cache/*.ts`; `server/src/services/*-cache-store.ts`; `cube-load-result-cache.ts` | cross-tenant key leak (owner/model/workspace not in key); TTL vs eviction interaction; missing invalidation on partition land; unbounded growth |
| D5 | Empty-range re-anchoring | `chat-service/src/services/resolve-coverage-range.ts`, `load-cube-rows.ts`; `tools/{disambiguate,preview,emit}*.ts` | relative-vs-explicit detection; snap-window math at month/year boundaries; disclosure correctness (explicit ranges must stay put); per-member cache key; probe-failure fallback |
| D6 | Cube token mint + workspace routing | `server/src/routes/cube-token.ts`, `services/{sign,resolve}-cube-token.ts`, `middleware/workspace-header.ts` | HS256 secret resolution miss; default-workspace fallback exposing prod; payload scoping (gameId/role/workspace); token reuse across workspaces; header-spoof |
| D7 | SSE registry + recorder-edge stripping | `chat-service/src/api/turn.ts:186-197`, `core/{sse-stream,stream-registry}.ts`, `api/turn/build-observer.ts` | recorder-only fields leaking to wire; ring-buffer overflow/eviction; abort-reason propagation; turnId collision; reconnect/replay event gaps |
| D8 | FE streaming + proxy contract | `src/` chat streaming store (zustand), SSE parse, dual-surface (`/chat` + docked panel) parity, `/build` deep-link `query` param | abort-on-unmount leak; SSE parse desync; panel-vs-main feature parity (follow-up chips / refine row gate); deep-link query injection |
| D9 | cube-dev model correctness | `cube-dev/cube/model/cubes/{game}/*.yml` | non-additive measure in rollup; rollup time-dim ≠ query time-dim; PK fan-out (transid-style); `build_range_end` cap; measures referenced by no model. **Verify via compiled SQL, not skeptic refute.** |

## Harness design

```
loop until 2 consecutive dry rounds:
  round:
    Find    — parallel finder per dimension (D1–D9), each returns FINDINGS[]
    Dedup   — drop findings whose (file:line:title) ∈ seen; add fresh to seen
    Verify  — per fresh finding: 3 skeptics in parallel, each prompted to REFUTE
              (default refuted=true when uncertain); finding survives iff ≥2 say "real"
              [D9 findings verified by compiled-SQL inspection, not refute panel]
    Accrue  — push survivors to `confirmed`
  dry round = 0 fresh survivors
report: group confirmed by severity × dimension → plans/reports/
```

- **Convergence:** `seen` set keyed on `file:line:title` (dedup vs *all* seen, not vs confirmed — else refuted findings re-surface forever).
- **Kill rule:** majority-refute (≥2 of 3). Skeptics default to `refuted=true` under uncertainty → precision over recall.
- **Budget guard:** if a token target is set (`+Nk` directive), loop while `budget.remaining() > 60k`; else cap at K=2 dry rounds.

### Schemas

- **Finding:** `{ dimension, file, line, title, description, repro, severity (crit|high|med|low), impact }`
- **Verdict:** `{ refuted: bool, reason, missedFailureMode? }`

## Phases

| Phase | What | Gate |
|---|---|---|
| 0 | Confirm scope + fix-policy (this plan) | user |
| 1 | **Hunt** — run harness, produce confirmed-findings report | workflow opt-in |
| 2 | **Triage** — user reviews report, marks each finding fix / wontfix / needs-more-data | user |
| 3 | **Fix** (gated, per-finding) — implement + regression test for authorized findings only | user |

Phase 3 is deliberately separated: per the repo's review/audit rules, verified findings are sticky and fixes that touch contracts (auth scoping, cache keys, abort wiring) must be user-authorized, not auto-applied.

## Execution

The harness is authored as a runnable workflow script: [`bug-hunt-workflow.mjs`](./bug-hunt-workflow.mjs). Running it requires multi-agent **workflow opt-in** (it fans out dozens of agents). Launch via the Workflow tool with `scriptPath` pointing at that file. Output: a confirmed-findings report under `plans/reports/`.

## Risks & mitigations

- **False positives reaching report** → 3-skeptic refute gate + uncertainty-defaults-refuted.
- **Never converging** → dedup vs `seen` (not `confirmed`); K=2 dry-round stop.
- **Token blowout** → budget-guarded loop; D9 uses cheap compiled-SQL check not LLM panel.
- **cube-dev is a submodule** → model findings are read-only audit; no YAML edits in the hunt.
- **Concurrency bugs are non-reproducible by reading** → finders must cite the exact interleaving / line, and the `repro` field is required; verifiers reject findings without a concrete trigger.

## Open questions

1. Fix-policy: confirm Phase 3 stays per-finding gated (recommended) vs. auto-fix crit/high after verify.
2. Include D8 (FE) and D9 (cube-dev) in round 1, or run core backend (D1–D7) first then widen? Default: all 9 in round 1.
3. Token target for the run (sets loop depth) — none given → K=2 dry-round stop.
