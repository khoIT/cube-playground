---
title: "Chat Diagnose→Conclude→Recommend Rail (genre-aware, cited)"
description: "Make analytics chat reason in genre levers and ship the diagnose→conclude→recommend rail as one cited, outcome-looped unit."
status: pending
priority: P1
effort: ~5d
branch: main
tags: [chat-service, advisor, care, knowledge-library, genre-levers, outcome-loop]
created: 2026-06-19
---

# Chat Diagnostic → Prescriptive Rail

Make the analytics chat reason like a game-ops + business leader. Ship the flagship
**diagnose → conclude → recommend rail AS ONE UNIT**. Chat reasons in genre-aware
**levers** (not raw metrics); every prescriptive output cites the engine + signal +
benchmark that produced it. ~80% is wiring engines that already exist; the net-new
asset is an enriched multi-genre knowledge library + chat tools + rail orchestration +
trust/citation layer + outcome-loop writes.

## Locked decisions (build to these)
1. Benchmarks = BOTH internal portfolio percentiles AND external published F2P/FPS/MMORPG norms. Each metric shown against both.
2. Genre enrichment MULTI-GENRE from start: cfm_vn (competitive FPS) + jus_vn (wuxia MMORPG) on a genre-tag framework.
3. Forecast-vs-target = follow-on (out of scope; seam only).
4. Outcome loop wired NOW: accepting a recommendation writes to existing care-case / experiment ledgers.

## Critical design principle
Chat **PROPOSES**, user/FE **CONFIRMS** writes. Agent never silently triggers write-gated
mutations (sweep / case create / experiment create). It surfaces recommendation + confirm
action; the write happens on explicit confirm — mirrors `propose_segment` (verified
`chat-service/src/tools/propose-segment.ts:6`, FE `src/pages/Chat/components/segment-proposal-card.tsx`).
Reads (diagnose, recommend preview, list playbooks/cases) call directly.

## Phases
| # | Phase | Scope (one line) | Status | Blockers |
|---|-------|------------------|--------|----------|
| 1 | [Knowledge library](phase-01-genre-knowledge-library.md) | Genre-tagged lever library: cfm_vn FPS + jus_vn MMORPG; signal→cubes(data-gate)→benchmark(internal+external)→action | pending | — |
| 2 | [Diagnostic uplift](phase-02-diagnostic-uplift.md) | `decompose_metric` tool wraps `/advisor/diagnose`; mandatory benchmark-aware narrative conclusion in diagnose skill | done | P1 |
| 3 | [Prescriptive reads](phase-03-prescriptive-read-tools.md) | `recommend_actions` + `care_queue` tools through library; every output cited; 403/latency handling | done | P1,P2 |
| 4 | [Rail + trust](phase-04-rail-and-trust-layer.md) | Chain diagnose→conclude→recommend one flow; citation + blind-spot guardrails | pending | P2,P3 |
| 4b | [Prescriptive door: `advise` skill](phase-04b-prescriptive-advise-skill.md) | New `advise` skill + router keyword block so prescriptive-first phrasings ("what should I do") reach the rail and auto-chain to recommend; diagnose unchanged | pending | P2,P3,P4 |
| 5 | [Outcome loop](phase-05-outcome-loop-writes.md) | Confirm-gated proposers create care case / experiment on acceptance; scorecard read seam | pending | P3,P4 |
| 6 | [Tests + docs](phase-06-tests-docs-lessons.md) | TDD coverage per phase incl. routing tests (prescriptive→advise, diagnostic→diagnose, descriptive→explore); docs update, lessons-learned entry | pending | P1-P5,P4b |

## Key dependencies
- Server endpoints all exist & verified: `/api/advisor/diagnose|recommend` (`server/src/routes/advisor.ts:92,111`, feature-gated `:89`), `/api/care/playbooks|cases|cases/sweep` (`server/src/routes/care-*.ts`), `/api/experiments*` (`server/src/index.ts`, `server/src/experiments/experiment-store.ts:57`).
- Seam: `chat-service/src/services/server-client.ts` (getJson/postJson/patchJson + typed `ServerClientError`).
- Seed: server `lever-map.ts` (factor→family→playbook, FPS/VIP-centric, NO genre tag) + 21 `SEED_PLAYBOOKS` (`server/src/care/playbook-registry.ts`).
- Tool registry: `chat-service/src/tools/registry.ts` (flag-gated push pattern at `:185`).
- Diagnose lenses 1-4 sync (~3-5s), 5-9 lazy opt-in (`server/src/advisor/diagnosis-engine.ts:40-43`).

## Resolved open questions (defaults — see phase-01/03/05 for rationale)
1. **Library home/format/owner**: server-side TS module `server/src/knowledge/genre-levers/` (genre-tagged config, mirrors `playbook-registry.ts`), served read-only via new `GET /api/knowledge/levers?game=`. Edited by analysts as code-config (same story as playbooks). Chat-service consumes via server-client — single source of truth, no duplication across two services.
2. **Diagnose latency vs turn budget**: sync block on lenses 1-4 only (~3-5s, within turn). Lenses 5-9 surfaced as optional "deeper" follow-up, never auto-run. No SSE-progress machinery (YAGNI).
3. **Internal percentiles**: computed across all live portfolio games over trailing 30d window; recomputed nightly by a new server job; persisted to `segments.db` (new migration). Chat reads point-in-time snapshot — deterministic within a turn.
4. **Confirm-gated write UX**: lever's `actuator` decides default — `cs` levers → propose care case (single playbook) or sweep (cohort); `system`/experiment-worthy levers → propose experiment draft. Library row carries `defaultWrite: 'case'|'sweep'|'experiment'`.
5. **recommend→sweep = TWO confirms**: confirm #1 accepts the recommendation (records intent, opens care case as the durable record); confirm #2 (separate explicit action on the case/queue) triggers the cohort sweep. Never one-click cohort mutation.

## Out of scope (seams only)
- Forecast-vs-target unit. Scorecard *write/measurement* loop beyond creating the experiment+reading scorecard.
- New genres beyond cfm_vn/jus_vn (framework supports plug-in; not authored).
