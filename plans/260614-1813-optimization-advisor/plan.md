---
title: "Optimization Advisor — in-process AI experiment agent"
description: "An in-process Claude agent that understands the goal, the deterministic tool layer, the Cube data model, and the Segments — and orchestrates, creates, and recommends powerful experiments. Drives the Experiment-Builder live; numbers gated through deterministic tools (provenance-required); glass-box reversible hand-off."
status: pending
priority: P1
effort: ~16d
branch: main
tags: [advisor, agent, claude-agent-sdk, segments, care, lakehouse, monetization, experiment, decision-layer]
created: 2026-06-14
upstream_of: plans/260614-0018-experiment-command-center/
---

# Optimization Advisor

**An in-process AI agent that orchestrates the decision rail.** Phases 0–4 (BUILT) are a deterministic
tool layer: a 9-lens diagnosis engine, a goal-tree → lever → power → ₫ ranker, a priors library, a
hand-off scaffolder, and the Experiment-Builder UI. **Phases 6–9 (this revision)** put a Claude agent
*in front of that tool layer*: it understands the goal, the tools, the Cube data model, and the Segments
— "more omniscient than the chat-agent" — and its job is to ORCHESTRATE, CREATE, and RECOMMEND powerful,
well-powered, feasible experiments by calling the deterministic tools, then drive the Experiment-Builder
stages live while the user steers.

Given a Segment (e.g. `/segments/5ee78131…`) or a game (`cfm_vn`) + a goal (Revenue↑ / Engagement↑), the
agent diagnoses the cohort's binding constraint (via the tool layer), maps it to a lever we can actually
pull (CS-actuated today), proposes power-checked, impact-ranked experiments, and hands the chosen one off
to the Experiment Command Center (plan `260614-0018`) — then learns from the result. The deterministic
engines remain the **numbers authority**; the agent narrates, orchestrates, and steers but cannot
fabricate a published number.

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
                         ┌─────────────────────────────────────────────────────┐
  user (Explore↔Drive)   │  IN-PROCESS CLAUDE AGENT (Agent SDK, OAuth lane)      │
  steers / kicks-back ──▶│  context pack: data-model summary · goal trees ·      │
                         │  lever map · playbook registry · segment defs         │
                         │  loop: plan → call tools → synthesise → fill stages    │
                         └───────────────┬───────────────────────────────────────┘
                                         │ typed in-process tools (only tools it has)
        ┌────────────────────────────────┼────────────────────────────────────┐
        ▼                                ▼                                      ▼
  DETERMINISTIC TOOL LAYER (Phases 0–4, BUILT — the numbers authority)   CUBE / SEGMENTS READ TOOLS
  diagnose · rankCandidates(mapLevers→checkPower→expectedIncremental      cubeQuery (loadWithCtx) ·
  →getPrior) · scaffoldDraft · listPriors                                 cubeMeta (getMetaWithCtx) ·
        │  every output carries a provenance id                           segmentMembers · predicateCompile
        ▼
  Experiment-Builder stages fill live (SSE stream) → editable draft → Command Center (status='draft')
        → result writes back → updates the Library prior (the flywheel)
```

**HYBRID numbers gate ("free Explore, gated Decide"):** the agent may reason with numbers freely in the
NL transcript (marked "exploratory — not validated"), but any number that lands in a recommendation card
or an experiment draft MUST originate from a deterministic tool call and carry a `provenanceId` proving
which engine produced it. The card/draft assembler rejects un-provenanced numbers.

What this revision adds on top of the BUILT deterministic layer:
**(5)** an in-process Agent SDK runtime (`server/src/advisor/agent/`) on the subscription OAuth lane with
SSE streaming + cost/turn/timeout guardrails; **(6)** the deterministic engines + Cube/Segments reads
wrapped as typed in-process tools + the omniscient context pack + the provenance gate + a redaction guard;
**(7)** the Interactive Drive wiring into `src/pages/Advisor/` (agent fills stages, user steers);
**(8)** guardrails/eval/tests/docs. The agentic loop is NOT the external chat-service; it is a dedicated
in-process runtime.

## Principles
- **KISS/YAGNI:** the agent only ORCHESTRATES the existing tools — it does not re-implement diagnosis, power, or money math. v1 = CS-actuated levers; Revenue + Engagement goal trees; cfm_vn / jus_vn.
- **DRY:** reuse the BUILT engines (`server/src/advisor/*`) as tools (don't fork them); reuse `loadWithCtx`/`getMetaWithCtx`/`WorkspaceCtx` for Cube, `computeMemberProfiles` + `predicateToSql` for Segments, the `subscription` auth-mode concept from `chat-llm-auth-client.ts`, and the SSE pattern from `routes/chat.ts`. Mine cube-advisor `runner.ts` for guardrail/lifecycle DESIGN only (we are in-process, not subprocess).
- **Glass-box always:** every published number has a provenance / "Open in Playground" link; no AI hand-off without an editable draft (`status='draft'`, never auto-launch). Agent-spoken numbers in the transcript are visibly marked exploratory until a tool validates them.
- **Numbers authority = deterministic tools.** The agent narrates and steers; the engines own the math. Enforced by the provenance gate, not by trust.
- **No raw PII:** `user_id` + numeric + reachability only enters the agent context / prompts / tool I/O — same redaction as the ranked-members API. A redaction guard wraps everything entering the agent.

## Phases

**Phases 0–4 are BUILT — they are the deterministic tool layer the agent orchestrates.** Phases 6–9 add
the in-process AI agent on top. Phase 5 (original tests/docs) is folded into Phase 9.

| # | Phase | Status | Depends on |
|---|-------|--------|-----------|
| 0 | [Predicate-engine foundation (derived-date + percentile)](phase-00-predicate-engine-foundation.md) — *tool: predicateCompile* | ✅ done | — |
| 1 | [Diagnosis lens engine (9 lenses + synthesis)](phase-01-diagnosis-lens-engine.md) — *tool: diagnose* | ✅ done (live smoke deferred to host) | 0 |
| 2 | [Goal trees → lever map → prioritization + power + Library](phase-02-lever-mapping-prioritization.md) — *tools: rankCandidates, checkPower, money, listPriors* | ✅ done (live smoke deferred) | 1 |
| 3 | [Advisor UI — Experiment-Builder IA (Explore surface)](phase-03-advisor-ui-diagnosis-peer-studio.md) — *the surface the agent drives* | ✅ done | 1, 2 |
| 4 | [Recommendations + reversible hand-off (Drive)](phase-04-recommendations-handoff-bridge.md) — *tool: scaffoldDraft* | ✅ done (STUB draft store; learn-back deferred) | 2, 3, cc 1–3 |
| 5 | Tests + docs (original) — **superseded; folded into Phase 9** | merged → 9 | 0–4 |
| 6 | [Agent runtime foundation (in-process Agent SDK, OAuth lane, SSE, guardrails)](phase-06-agent-runtime-foundation.md) | ✅ done (live OAuth smoke deferred to token-bearing host) | 0–4 |
| 7 | [Tool surface + omniscient context + hybrid provenance gate + redaction](phase-07-agent-tool-surface-context.md) | pending | 6 |
| 8 | [Interactive Drive UI (agent fills stages live; steer / kick-back)](phase-08-interactive-drive-ui.md) | pending | 7 |
| 9 | [Guardrails, experiment-quality eval, tests, docs](phase-09-guardrails-eval-tests-docs.md) | pending | 6, 7, 8 |

## Locked decisions — agent layer (2026-06-14, user-confirmed, do NOT re-derive or reverse)
1. **Runtime = Claude Agent SDK, IN-PROCESS (Node/TypeScript).** NOT a `claude -p` subprocess, NOT extending the external chat-service. Authenticated on the **subscription OAuth token** (`CLAUDE_CODE_OAUTH_TOKEN` lane), explicitly NOT the gateway key (gateway key is sonnet-only; the OAuth lane unlocks the full model + agentic loop). Tools = in-process TS functions; native streaming to the UI.
2. **Numbers authority = HYBRID ("free Explore, gated Decide").** The agent may reason with numbers freely during exploration/NL, BUT any number that enters a recommendation card or an experiment draft MUST be produced by a deterministic tool call and carry a provenance id proving which engine produced it. Agent-spoken numbers in the transcript are allowed only if visually marked "exploratory — not validated." This is the enforceable contract; the guard is designed explicitly in Phase 7.
3. **Surface = Interactive Drive inside the existing Advisor Experiment-Builder page.** The agent fills the causal-chain stages live (streaming); the user steers / kicks back to Explore. Reuse the built `src/pages/Advisor/` components; do not invent a new page.
4. **Agent flow = "Guided Drive" (resolves Q-A5, 2026-06-15).** Business user states a one-sentence goal + scope, presses **Investigate** (explicit, not page-load auto-fire); the agent then drives the causal chain proactively in plain language. Turn modes: new session → `drive`, follow-up steering on the same session → `steer`, one-off question → `explore`. Encoded in `agent-system-prompt.ts` (Phase 6); wired to the stage UI in Phase 8.

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
