---
title: "Glossary Resolver Consolidation"
description: "Normalize catalog refs to cube members at load time and fold the v2 short-circuits into one ranked resolver so plain metric/timeseries questions auto-route."
status: complete
priority: P1
effort: 12h
branch: main
tags: [chat-service, nl-to-query, glossary, resolver]
created: 2026-05-27
---

## Problem (verified)

Base engine resolves a glossary term to its **catalog path** (`synonym-resolver.ts:35` sets
`cubeRef = primaryCatalogId`, e.g. `business_metrics/revenue`). The /meta gate
(`disambiguate-query.ts:145-159`) accepts **cube members only**, so every measure-backed term
structurally fails and forces `action:clarify`. The `CHAT_GLOSSARY_V2` layer
(`disambiguate-query.ts:200-303`, default off `config.ts:257`) patches only three narrow paths
(fully-qualified ref / verbatim exact / leaderboard-concept) and cannot rescue
"show revenue last 7 days". Two resolvers disagree on the contract for "a resolved metric ref".

## Generic-rollout principle

Resolve `primary_catalog_id` → the catalog YAML's formula **at glossary load**, so EVERY
catalog-backed term yields a canonical resolution automatically — no per-term seed editing:
- `type: measure` → `measureRef` (a single cube member, e.g. `recharge.revenue_vnd`).
- `type: ratio` → composed `{ numerator, denominator }` cube members so the resolver builds a
  ratio query — "show retention rate" auto-runs the same as "show revenue" (full generic).
- `type: expression` → resolved members where derivable; otherwise null + tag → clarify.

`default_measure_ref` stays an explicit override. One resolver returns one contract
`{ ref, refKind, confidence, gap, alternatives }` (`refKind` ∈ measure | ratio); the /meta gate
becomes a true safety net. Goal: ALL glossary terms resolve generically, ratios included.

## Phases

| # | Phase | Status | Depends on |
|---|-------|--------|-----------|
| 01 | [Load-time ref normalization + ratio composition](phase-01-load-time-ref-normalization.md) | done | — |
| 02 | [Unified resolver + contract type + ratio query build](phase-02-unified-resolver-and-contract.md) | done | 01 |
| 03 | [Wire into disambiguate-query; retire/default the v2 flag](phase-03-wire-disambiguate-and-flag.md) | done | 02 |
| 04 | [/meta gate as safety net](phase-04-meta-gate-safety-net.md) | done | 02, 03 |
| 05 | [Tests + eval expansion](phase-05-tests-and-eval-expansion.md) | done | 01-04 |
| 06 | [Docs + lessons-learned + journal](phase-06-docs-and-journal.md) | done | 01-05 |

## Key dependencies / decisions

- **Normalization lives server-side** (main-server glossary API). `formula.ref` is reachable
  there via `business-metrics-loader` (`getById`); chat-service cannot see the catalog YAMLs.
  Confirmed: `routes/glossary.ts` does not yet import the loader; `index.ts:55-59` registers
  business-metrics + glossary in the same boot, loader cache is populated at boot
  (`index.ts:33 loadAll`).
- New wire field `measureRef` (cube member) added to glossary term shape, alongside the
  existing `primaryCatalogId`. Chat-service `OfficialTerm` gains `measureRef`.
- Resolver replaces base `pickMetric` + `concept-resolver` + the three `applyGlossaryV2`
  short-circuits. The flag `CHAT_GLOSSARY_V2` becomes always-on default (Phase 03 decision:
  unify, keep one-release kill-switch env then remove).
- Eval fixture/corpus currently encode the BROKEN contract (refs = catalog paths like
  `business_metrics.revenue`). Phase 05 migrates golds to real cube members + a real
  `knownMembers` set, then adds plain-intent cases.

## Cache caveat (verify step)

Behavior change on a cached surface. When verifying live, bypass the response cache
(`Bypass-cache` pill / cold cache) — a stale clarification can replay and mask the fix
(lessons-learned "Cache can mask a fix").

## Resolved decisions (user-confirmed 2026-05-27)

1. **Ratio concepts → COMPOSE, not clarify.** `type: ratio` catalog entries (rr/rr01/rr07/rr30,
   roas) resolve to `{ numerator, denominator }` cube members; the resolver + query-composer
   build a ratio query so they auto-run like measure terms. Phase 01 emits the composed members;
   Phase 02 builds the query; Phase 05 adds ratio auto-route cases. `type: expression` stays
   null + tag → clarify until a real expression case demands more (YAGNI).
2. **`secondary_catalog_ids` → out of scope.** Normalize `primary_catalog_id` only; secondaries
   are cross-links, not the resolution target.
3. **Flag removal → keep one-release kill-switch.** Unified resolver on by default; ship
   `CHAT_GLOSSARY_LEGACY` kill-switch for one release, then delete the env var.
4. **Eval gold rewrite → safe, proceed.** Verified only test fixtures reference the old
   `business_metrics.*` strings (no production consumer; one source hit is a comment). Migrate
   corpus golds to real cube members (`recharge.revenue_vnd`) + a real `knownMembers` set.

## Unresolved questions

None — all four open questions resolved above.

## Follow-ups

1. **Delete `CHAT_GLOSSARY_LEGACY` kill-switch + legacy `pickMetric` path** (next release). The unified resolver is stable; the fallback branch serves no production purpose after one release window and becomes tech debt. Target release: 2026-Q2 (1 cycle window from ship).

2. **Ratio-metric cross-turn continuity gap** (open for future work). Single-turn ratio auto-routing works (e.g., "show retention rate" resolves and runs). Multi-turn ratio refinement (e.g., "retention rate" on turn 1, then "for the last 7 days" on turn 2) does not persist `slots.ratio` into session memory, so the follow-up re-asks the user to disambiguate. The resolver sees only the isolated follow-up message, not the prior ratio term. Mitigation: wire ratio composition into session memory like metric/dimensions. Estimated effort: 4h. Post Phase 06.
