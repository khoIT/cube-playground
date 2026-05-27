# Phase 06 — Docs + lessons-learned + journal

## Context Links
- `docs/lessons-learned.md` — bug-shape catalog (cache-mask, ratio-cast, member-path entries)
- `docs/journals/2026-05-27-chat-revamp-activation-glossary-and-tool-toggles.md` — prior journal
- `docs/system-architecture.md`, `docs/codebase-summary.md` — update if resolver named there
- `plans/260526-0643-chat-service-agent-revamp/phase-02a-glossary-resolution-v2.md` — supersession

## Overview
- **Priority:** P3 (closes out)
- **Status:** done
- Record the contract flip (term → cube member at load), the resolver consolidation, the cache
  caveat, and the flag rollback so future work doesn't re-bolt a fourth short-circuit.

## Key Insights
- The durable lesson: a resolver and its validator MUST agree on the ref contract. The bug was a
  catalog-path/cube-member mismatch the /meta gate turned into mandatory clarification.
- Document WHY (the invariant), per `.claude/rules/review-audit-self-decision.md §5` — no
  phase/finding codes in lessons or code comments.

## Requirements
- New `lessons-learned.md` entry: "Resolver/validator contract mismatch → silent clarify trap".
- Journal entry (today's date file or a new dated file) summarizing the consolidation + eval flip.
- Update `docs/system-architecture.md` / `codebase-summary.md` if they describe the nl-to-query
  resolver layers (replace "base + v2 post-pass" with "single load-normalized resolver").
- Note the `CHAT_GLOSSARY_V2` → `CHAT_GLOSSARY_LEGACY` migration + planned removal next release.

## Implementation Steps
1. Add lessons-learned entry — Rule / Why / Signal / Apply:
   - **Rule:** resolver output ref and the /meta validator must speak the same vocabulary (cube
     members). Normalize catalog paths → `formula.ref` at load.
   - **Signal:** every query for a catalog-backed metric returns a clarification listing siblings.
   - **Apply:** when adding a resolution layer, assert the produced ref against `/meta` member
     vocabulary in a test, not just in prod.
   - **Cache caveat:** response cache replays stale clarifications — bypass cache when verifying.
2. Write journal entry: problem, the generic load-time normalization, resolver consolidation,
   flag default flip + rollback, eval gold migration.
3. Update architecture/summary docs if the resolver is described there.
4. Mark `phase-02a-glossary-resolution-v2.md` superseded (one-line note + link to this plan).
5. Open follow-up task: delete `CHAT_GLOSSARY_LEGACY` + legacy `pickMetric` path next release.

## Todo List
- [x] lessons-learned entry added (Rule/Why/Signal/Apply + cache caveat)
- [x] journal entry written
- [x] architecture/summary docs updated (if applicable)
- [x] phase-02a doc marked superseded
- [x] follow-up task filed to remove the kill-switch

## Success Criteria
- A future engineer reading lessons-learned can spot the contract-mismatch shape before shipping.
- Docs no longer describe a flag-gated v2 post-pass as the live design.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Docs drift from code | L×M | Update in the same PR as the code phases |
| Kill-switch never removed | M×L | Explicit follow-up task with target release |

## Security Considerations
- Docs only.

## Next Steps
- Code-review the full change set; ship behind the kill-switch; verify live with cache bypass.
