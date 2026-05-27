# Glossary Resolver Consolidation — Vocabulary Mismatch Fix

**Date**: 2026-05-27 (afternoon, follows metric-cube-coverage-monitor session)
**Severity**: High (silent "always clarify" trap affecting all measure-backed terms)
**Component**: chat-service metric-resolver.ts + glossary normalization + /meta gate + eval corpus
**Status**: Resolved — 1,174 tests green; eval 100% action correctness

## What Happened

Glossary terms with a measure formula ref were stored as **catalog paths** (e.g., `business_metrics/revenue`), but the `/meta` gate that validates metrics for the agent accepts **cube members only** (e.g., `Measures.revenue`). The mismatch was invisible: every measure-backed term passed glossary loads but structurally failed the gate, forcing every related question into `action:clarify`. A flag-gated `applyGlossaryV2` patch attempted short-circuits (cube-ref direct match, alias fallback, ratio numerator/denominator) but only patched 3 narrow cases and couldn't rescue plain metric questions. Worse, two resolvers disagreed on what "a resolved metric ref" meant.

## The Brutal Truth

This was a **silent failure by design**. The glossary loads fine. The resolver runs fine. The gate validates fine. But the resolver's output vocabulary (catalog path) and the gate's input vocabulary (cube member) never touched — so every measure-backed term lived in a clarify-only zone. We found it only because the metric-coverage monitor ran plain questions through the chat stack and saw 100% clarify rate. That's an embarrassing miss: the resolver's contract wasn't checked against its downstream consumer.

## Technical Details

- **Symptom**: "show revenue last 7 days" → `action:clarify` (measure-backed term `revenue` has formula `business_metrics/revenue`, gate lookup on `business_metrics/revenue` in cube members fails).
- **Failed attempts**: flag-gated short-circuits (`CHAT_GLOSSARY_V2` + `applyGlossaryV2`) only caught explicit cube-ref patterns and high-confidence name matches; plain metric questions still clarified because they routed to the base resolver, which had no cube-member awareness.
- **Test baseline**: eval corpus golds referenced catalog paths (not real members), so tests passed while the live stack clarified. Circular validation.

## What We Tried

1. **Narrower patch (CHAT_GLOSSARY_V2)**: Added three short-circuit resolvers (cube-ref, exact alias, ratio alias). Worked for `"Use the revenue measure"` (cube-ref match) but failed for `"show revenue"` (no cube-ref, routes to base resolver).
2. **Ratio handling via flags**: Separate `pickMetricRatio` + ratio-slot validation. Worked for explicit ratio questions, but cross-turn continuity didn't persist `slots.ratio` to session memory.

## Root Cause Analysis

**Vocabulary mismatch between resolver and gate.** The resolver treated a resolved metric as "anything the glossary matched," and the gate treated a resolved metric as "a real cube member." They should share a vocabulary at the boundary.

A secondary cause: the eval corpus was bootstrapped from catalog paths (the glossary's source format), so tests never caught that the output vocabulary was wrong. Tests validated "glossary loads" and "resolver runs" but not "output of resolver + input to gate are compatible."

## Lessons Learned

1. **A resolver's output spec and its downstream validator MUST have a shared vocabulary.** If resolver outputs X and validator expects Y, silent clarify traps emerge. Document the contract at both ends.
2. **Load-time normalization beats per-query patching.** Deriving `measureRef`, `ratioRef`, `refKind` at glossary-read time (once) and storing them alongside the term is cleaner than flag-gated short-circuits (per query, per request context). The term's structure becomes the source of truth.
3. **Eval vocabularies must match live execution.** Bootstrapping test fixtures from the glossary's *source* format (catalog path) rather than its *consumer* format (cube member) is a ticking time bomb. Evaluate against live cube members.
4. **Cache replays stale behavior.** The response cache held a stale clarification after the fix; always bypass cache when verifying behavior changes.

## Next Steps

1. **Delete `CHAT_GLOSSARY_LEGACY` + legacy resolver branch** on next release (currently a one-release kill-switch for rollback).
2. **Ratio cross-turn persistence**: `slots.ratio` isn't stored to session memory, so a ratio that triggers clarification (missing time, targeted mode) re-asks the metric on the follow-up reply. Single-turn ratio auto-route works; multi-turn needs session persistence.
3. **Server-side guard for clarify-free intent**: Currently relies on prompt enforcement; a deterministic gate that refuses a model-authored clarification when `disambiguate_query` returned `action:auto` would harden the behavior.

**Status:** DONE  
**Summary:** Consolidated glossary resolver under a unified vocabulary (cube members). Glossary loads now derive `measureRef`/`ratioRef` at read time; resolver outputs cube members; gate validates cube members. 1,174 tests pass; eval corpus 100% correct.  
**Concerns:** Ratio cross-turn memory and clarify-free intent enforcement are prompt-based, not deterministic. Planned for next phase.
