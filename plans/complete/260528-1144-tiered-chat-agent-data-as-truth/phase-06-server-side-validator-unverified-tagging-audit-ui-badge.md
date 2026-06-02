---
phase: 6
title: "Server-side validator: unverified tagging + audit UI badge"
status: pending
priority: P2
effort: "1d"
dependencies: [5]
---

# Phase 6: Server-side validator — `unverified` tagging + audit UI badge

## Overview
Catch policy drift after-the-fact: any data/hybrid turn that contains numeric facts without
Cube provenance gets tagged `unverified`. A soft gate — no block/strip — surfacing the drift
in the audit UI so we can iterate on prompts.

## Architecture
- **Validator** (`chat-service/src/core/provenance-validator.ts`):
  - Input: assistant `blocks[]`, `sources[]`, `tool_calls_json`, `intent`.
  - Scan: extract numeric tokens from each block (regex covering integers, decimals,
    percentages, k/m/b suffixes, dates with figures, currency). Skip numbers that appear
    inside `emit_query_artifact`/`emit_chart` payloads (those are Cube-sourced by definition).
  - Rule: if `intent ∈ { data, hybrid }` AND a block has numeric tokens AND that block has
    NO `cube`-kind source → mark block as `unverified` with a reason string.
  - Whole-turn flag: `provenance_status: 'verified' | 'unverified' | 'partial'`.
- **Persistence** — extend the Phase 5 `sources_json` with `provenance_status` (could be a
  sibling column `provenance_status TEXT` for indexability). Migration via `addColumnIfMissing`.
- **Audit UI badge**: chat-audit list shows a colored badge per turn
  (`✓ verified` / `⚠ partial` / `⚠ unverified`). Detail page highlights flagged blocks with a
  border + reason tooltip.
- **Whitelisted patterns** — numbers from artifact payloads, numbers in code blocks, and
  numbers in citation tooltips are not flagged. Maintain a tunable allowlist.
- **No retry / no strip** — model output is preserved verbatim; the badge surfaces the drift.
  Iterating on skill prompts is the fix path, not blocking turns.

## Related Code Files
- Create: `chat-service/src/core/provenance-validator.ts`,
  `chat-service/test/provenance-validator.test.ts`
- Modify: `chat-service/src/db/migrate.ts` (add `provenance_status` column),
  `chat-service/src/db/chat-store.ts` (persist + return),
  `chat-service/src/api/turn.ts` (call validator post-stream, before final DB write)
- Modify: chat-audit list + detail UI (badge + flagged-block highlight)

## Implementation Steps
1. Implement validator + unit tests for numeric extraction patterns + allowlist.
2. Add `provenance_status` column; persist on turn save.
3. Hook validator into turn finalize path (after assistant stream complete, before DB write).
4. Audit UI: badge in list, flagged-block highlight + reason in detail.
5. Backfill (optional): run validator over recent turns to populate badges.

## Success Criteria
- [ ] Data turn with all numbers from Cube tool calls → `verified`.
- [ ] Hybrid turn with numbers in "Context (not data)" block → `unverified` for that block.
- [ ] Audit UI shows badges; reviewers can filter to `unverified` for triage.
- [ ] Validator runs in < 50ms per turn (no perceptible latency).

## Risk Assessment
- **False positives on legitimate qualitative answers** — phrases like "version 5" or "Q1"
  shouldn't flag. Mitigation: numeric-token regex carefully bounded; allowlist for known
  patterns (version refs, quarter refs, dates without metrics).
- **Validator missing patterns** — opposite drift. Mitigation: red-team test corpus +
  ongoing review of false-negatives reported via audit UI.
- **Backfill performance** — large turn history. Mitigation: optional, batched, off-peak.
