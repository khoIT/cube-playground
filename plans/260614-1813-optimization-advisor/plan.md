---
title: "Optimization Advisor — decision rail"
description: "Diagnose a cohort's binding constraint vs a goal, map it to a feasible lever, propose power-checked impact-ranked experiments, hand off to the command center, and learn. Read-heavy analysis + a reversible hand-off bridge."
status: pending
priority: P1
effort: ~9d
branch: main
tags: [advisor, segments, care, lakehouse, monetization, experiment, decision-layer]
created: 2026-06-14
upstream_of: plans/260614-0018-experiment-command-center/
---

# Optimization Advisor

**The decision rail in front of the command center.** Given a Segment (e.g. `/segments/5ee78131…`)
or a game (`cfm_vn`) + a goal (Revenue↑ / Engagement↑), the Advisor diagnoses the cohort's binding
constraint, maps it to a lever we can actually pull (CS-actuated today), proposes power-checked,
impact-ranked experiments, and hands the chosen one off to the Experiment Command Center
(plan `260614-0018`) — then learns from the result.

Product source of truth: `plans/260614-0018-experiment-command-center/experiment-recommender-product-layer.md`.
Prototype: `plans/260614-0018-experiment-command-center/visuals/optimization-advisor.html` (3 screens — Diagnosis · Peer Studio · Recommendations).

This plan is **upstream of** the command center: the Advisor decides *what* to run; the command
center *runs* it. They share the cohort = a Segment, the playbook library, and the measurement loop.

---

## Governing UX principle — the Explore ↔ Hand-off spectrum

> **The single hardest design question: support the analyst who wants to dig through data AND the
> operator who wants the tool/AI to just drive — on one surface, with control reversible at every step.**

The answer is **one spine, three postures, no dead ends.** The same artifacts (diagnosis, peer cohort,
opportunity, experiment draft) are present throughout; what moves is *who holds the pen*. Posture is a
**commitment gradient**, not rigid tabs:

| Posture | Who drives | What the user does | What the Advisor does |
|---|---|---|---|
| **Explore** | analyst | toggle lenses, edit peer cohort, open provenance, run ad-hoc Playground queries | acts as a *lens* — surfaces signals, never commits |
| **Recommend** | advisor | review ranked opportunities + experiments, drill into the "why" | proposes power-checked, ₫-ranked cards; every card explodes back to its evidence |
| **Drive** | tool / AI | accept → inspect/edit the scaffolded experiment draft → launch | scaffolds cohort (a Segment) + arms + power + CS queue as an **editable draft**, never a black-box commit |

**Two bridge mechanics make the hand-off reversible — this is the whole design:**
1. **Every recommendation is *explodable*** back into the explore layer (the lenses + provenance that produced it). No verdict without its evidence one click away.
2. **Every exploration is *promotable*** forward into a recommendation, then into an experiment draft. No analysis dead-ends; "I found something" always has a "→ test it" path.

**Trust ladder governs how far the AI may drive:** the Advisor offers to *set things up* only as
evidence confidence rises (how many of the 9 lenses agree). Low confidence → it stays in Explain/"here's
what I see, you decide." High confidence + a library-backed prior → it offers "I can draft this experiment
for you," and the draft lands in the builder for inspection. The AI never silently commits; the hand-off
is always glass-box and kickable-back-to-explore.

Concretely in the UI: a persistent **Explain → Refine → Decide** loop on every screen (Explain = drill to
Playground source; Refine = toggle peer axes / windows / refine the segment; Decide = tune a candidate /
build a portfolio / add a manual hypothesis), plus a **dismiss/pin with reason** feedback control that
trains future diagnoses. The NL follow-up ("why is lifespan dropping?") routes to chat-service and lands
its answer *inside* the explore layer, not a separate chat silo.

---

## Architecture at a glance

```
Segment|game + goal
  → Diagnosis engine (9 descriptive lenses, on-demand live Cube read) ──┐
  → Peer cohort (IS a Segment — reuses predicate engine) ───────────────┤→ ranked Opportunities (gap + confidence)
  → Goal-tree decomposition (Revenue / Engagement) ─────────────────────┘
        → Lever map (feasibility-gated) → Playbook (VIP-Care 21) → Power/MDE check + ₫ estimate
        → Treatment-Effect Library (priors; fills from past results)
        → Ranked experiment cards → [Drive] reversible hand-off → Command Center draft
        → result writes back → updates the Library prior (the flywheel)
```

Net-new vs everything we already shipped = **(1)** the predicate-engine extension (derived-date +
percentile classes), **(2)** the diagnosis/lens engine, **(3)** the Treatment-Effect Library priors store,
**(4)** the Advisor UI + reversible hand-off. Cohort, members, playbooks, execution, measurement, and the
LLM idea-pass (cube-advisor `claude -p`) are reuse.

## Principles
- **KISS/YAGNI:** v1 = CS-actuated levers only; Revenue + Engagement goal trees; lenses A+B+C as the spine, the other 6 as corroboration. Model-predicted potential (D) deferred to v2.
- **DRY:** peer cohort = a Segment (reuse builder + tokenless ranked-members API); percentile reuses the Care `PercentileRule` + `calibrate` two-pass pattern; execution/measurement = command-center plan; idea-pass = cube-advisor.
- **Glass-box always:** no number without an "Open in Playground" provenance link; no AI hand-off without an editable draft.
- **No raw PII:** aggregate metrics + masked member samples only, same redaction as the ranked-members API.

## Phases

| # | Phase | Status | Depends on |
|---|-------|--------|-----------|
| 0 | [Predicate-engine foundation (derived-date + percentile)](phase-00-predicate-engine-foundation.md) | ✅ done | — |
| 1 | [Diagnosis lens engine (9 lenses + synthesis)](phase-01-diagnosis-lens-engine.md) | ✅ done (live smoke deferred to host) | 0 |
| 2 | [Goal trees → lever map → prioritization + power check + Library](phase-02-lever-mapping-prioritization.md) | ✅ done (live smoke deferred to host) | 1 |
| 3 | [Advisor UI — Diagnosis + Peer Studio (Explore surface)](phase-03-advisor-ui-diagnosis-peer-studio.md) | pending | 1, 2 |
| 4 | [Recommendations + reversible hand-off to Command Center (Drive)](phase-04-recommendations-handoff-bridge.md) | pending | 2, 3, command-center 1–3 |
| 5 | [Tests + docs](phase-05-tests-docs.md) | pending | 0–4 |

## Locked decisions (2026-06-14, do not re-derive)
1. **Baseline = Level + Trajectory + Peer (A+B+C).** A = population percentile (ceiling), C = own decline (trigger), B = within-game peer cohort (same tenure/tier/geo — NOT similar games). Confidence = # lenses agreeing. D deferred to v2.
2. **Goal scope = Revenue + Engagement together.** Both trees shown; engagement framed as leading indicator. Requires session freq/length/lifespan wired alongside the revenue tree (open Q#3).
3. **Cold-start = labeled defaults.** Expected-lift seeded from game-ops priors / cross-segment benchmarks, marked "assumption"; the Library replaces them as experiments complete.
4. **Diagnosis grain = on-demand live Cube read.** Query ops cubes per segment on open; accept cold-Trino latency; add short-TTL cache only if it bites (open Q#5).

## Verified facts (do not re-derive)
- **Predicate gap (verified):** Segments builder supports only 15 scalar operators (`server/src/types/predicate-tree.ts:6-21`; UI `src/pages/Segments/editor/predicate-builder/operators.ts:14-46`). **No percentile / relative-date-derived operator.** Trino + Cube both support `approx_percentile` natively — the gap is the compiler, not the DB. A two-pass percentile pattern already exists for Care playbooks (`server/src/care/threshold-rule.ts:57-71` `PercentileRule`; `server/src/care/calibrate.ts:109-112`) but its cutoff resolution is itself an unwired follow-up and no seed playbook uses it. Phase 0 generalizes that pattern into the Segments compiler.
- **Cohort/ops data:** read through the ops cubes (`billing_detail` / `billing_lifetime` / `cs_ticket_detail` / `user_identity`, branch `feat/per-game-ops-enrichment-cubes`) — they inherit the verified per-game gate + joins (memory `iceberg-vs-stag-iceberg-source-catalog`). cfm_vn (A49, VND-only) is the clean v1 game.
- **Members + rank:** tokenless ranked-members API (`server/src/services/member-profile-runner.ts:116`) orders by a measure post-hoc — reuse for the Peer Studio member sample; it does NOT filter (cannot express "top quartile") — that is exactly Phase 0's job.

## Cross-cutting risks
- **Lens compute cost:** 9 lenses × on-demand live Cube read on open can be slow on cold Trino. Mitigate: compute A/B/C synchronously, lazy-load lenses 4–9; short-TTL cache if it bites. (open Q#5)
- **Percentile correctness:** two-pass cutoff must be computed over the *intended reference population*, not the target cohort, or "top quartile" is circular. Phase 0 makes the population explicit.
- **Over-trusting cold-start priors:** every expected-effect must carry a confidence label; ranking must not present an "assumption" prior as measured truth.
- **Hand-off that isn't reversible** is the failure mode that kills analyst trust — the editable-draft + explode-to-evidence mechanics are acceptance criteria, not nice-to-haves.

## Unresolved questions
Carried from the product doc §"Still open": #1 peer-matching definition, #2 actuator roadmap (CS-only today), #3 engagement-measure availability per-segment for cfm/jus, #4 ₫-per-unit conversion factors, #5 lens compute cost / caching. Each is flagged in the phase that depends on it.
