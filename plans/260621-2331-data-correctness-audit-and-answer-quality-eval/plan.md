# Data-Correctness Audit + Answer-Quality Eval

**Goal:** Two-layer quality net for the analytics product, sequenced so the foundation lands first.
1. **Trust the numbers** — systematic (game × cube × measure) correctness audit vs the `cube-prod` oracle (Idea 1).
2. **Trust the product's reach** — does chat/advisor route real users to the right, non-empty, trust-gated answer (Idea 2).

**Sequencing rationale:** Idea 2 scores *"did chat pick the right cube/measure + non-empty range"* — it does NOT validate the number is correct. Running it before Idea 1 = false comfort ("85% correct" on top of fan-out-inflated measures). So: trust numbers → then measure whether chat reaches them.

## Key decisions (locked)

- **Question bank = asked + likely-to-be-asked.** Asked = mined from `chat.db` (`user_text`) + advisor runs (`segments.db`). Likely-to-be-asked = synthesized from `game_key_metrics.yml` per game (the questions a DA *should* be able to ask). Logs alone miss under-queried measures — exactly where silent wrong numbers hide.
- **Extend, don't rebuild.** Idea 1 → extend `cube-parity-recorder` (migration 067). Idea 2 → extend `metric-resolution-eval` harness (corpus/runner/scorer) beyond cfm_vn.
- **Traffic-rank before fan-out.** Don't blind-sweep ~171 cube/measure pairs; rank by question-bank frequency, deep-audit the top slice first.
- **CI shape:** parity matrix = deterministic hard gate (fail on new 🔴). Answer-quality eval = periodic scorecard, not a hard gate (LLM nondeterminism).
- **LLM auth:** eval runs on the **subscription lane** (per harness README + `[[seed-generation-uses-local-subscription-auth]]`) — never burn the sonnet-only gateway key on batches.

## Phases

| # | Phase | Status | Depends on |
|---|-------|--------|-----------|
| 01 | [Unified question bank (asked + likely-to-be-asked)](phase-01-unified-question-bank.md) | 📋 planned | — |
| 02 | [Data-correctness audit (Idea 1 — numbers first)](phase-02-data-correctness-audit.md) | 📋 planned | 01 (ranking) |
| 03 | [Answer-quality eval (Idea 2 — reach)](phase-03-answer-quality-eval.md) | 📋 planned | 01 (corpus), 02 (trusted numbers) |

## Existing assets (verified)

- `server/src/scripts/record-cube-parity-run.ts` + `services/cube-parity-recorder.ts` → migration 067, Model Audit "Run audit now" route.
- `server/package.json`: `audit:metric-trust`, `audit:cube-parity-record`.
- `chat-service/test/metric-resolution-eval/` → corpus + runner (SSE `/agent/turn`) + scorer + frozen cfm_vn baseline.
- `chat-service/test/agent-intelligence-eval/` → newer corpus (Jun 17).
- Oracle: `/Users/lap16299/Documents/code/cube-prod`. Asked-history: `chat-service/runtime/chat.db`, `server/data/segments.db`.

## Cross-references

`[[metric-trust-audit-playbook]]` · `[[cube-prod-pk-schema-oracle]]` · `[[advisor-run-audit-console]]` · `[[seed-generation-uses-local-subscription-auth]]` · `[[batch-llm-verification-subscription-auth-first]]`
