# The Optimization Advisor — the decision rail in front of the command center

**Date:** 2026-06-14 (GMT+7) · game-ops / optimization product thinking
**Premise (user's reframe):** the command-center *machinery* isn't the value-add. The value is: **given a segment (e.g. `/segments/5ee78131…`) or a game (`cfm_vn`) and a goal (more revenue / more playtime), tell me what experiment to run.** This is the decision layer; the command center is the execution layer it hands off to.

> One-line product: **an Optimization Advisor that diagnoses a cohort's binding constraint against a chosen goal, matches it to a lever we can actually pull, and proposes power-checked, impact-ranked experiments — then launches them into the command center and learns from the result.**

---

## 1. Why the decision rail is the moat
- Picking the wrong lever on the right segment (or the right lever on a segment too small to move) wastes the whole experiment cycle. **The expected value of an experiment is mostly fixed at design time.** A tool that improves *which* test you run beats a tool that merely runs tests cleanly.
- We already have the three things a recommender needs and competitors don't bundle: **(a)** rich per-segment data (game_integration metrics + billing LTV + CS history), **(b)** a real actuator (CS team) with logged delivery, **(c)** a closed measurement loop. The Advisor turns those into *suggested* action instead of *requested* action.
- Precedent in-house: the sibling **cube-advisor** already spawns `claude -p` → "top-3 ideas per category" dashboard. Same pattern, pointed at experiments. Reuse it.

## 2. Goals decompose into levers (the engine's backbone)
The Advisor doesn't think in "ideas" — it thinks in **goal trees**, finds the weak factor for *this* segment vs baseline, and that factor *is* the opportunity.

**Revenue goal** → `Revenue = Payers × ARPPU × Payer-lifespan`, plus leakage:
| Weak factor (diagnosis) | Lever family | Feasible today (CS actuator)? |
|---|---|---|
| Low free→payer conversion | first-purchase nudge / starter offer | CS-delivered offer to engaged non-payers |
| Low ARPPU (payers spend little) | bundle/upsell, price anchoring | partial (CS upsell script) |
| Payer churn / lapsing whales | win-back outreach (the POC) | ✅ fully |
| Payment failure / friction | provider/method fix, retry assist | CS-assisted recovery |
| Reactivation of dormant payers | care call + comeback path | ✅ fully |

**Engagement goal** → `Playtime = Session frequency × Session length × Lifespan`:
| Weak factor | Lever family | Feasible today? |
|---|---|---|
| Declining session frequency | re-engagement touch, daily-loop nudge | ✅ CS / future push |
| Short sessions / content exhaustion | content surfacing, difficulty tuning | LiveOps (not yet) |
| Early funnel drop (new players) | onboarding assist | CS welcome touch |
| Social isolation (no guild) | guild matchmaking nudge | CS / LiveOps |

Engagement is the **leading indicator**; revenue is lagging. The Advisor should let you optimize engagement *as a path to* revenue and say so.

## 3. The 4-step engine
**① Diagnose** — profile the segment against the game baseline and its nearest peer segments. Decompose the chosen goal; surface the 1–2 factors where this cohort most underperforms its potential (theory-of-constraints: optimize the bottleneck, not the already-good). Output: ranked *opportunities*, each a quantified gap ("payer-lifespan is 38% below comparable cohorts → ~X₫ left on the table").

**② Map to lever** — match each opportunity to a lever family, then to a concrete **playbook** (reuse the 21 VIP-Care playbooks already built). Filter hard by **actuator feasibility** — be honest: "this gap wants a price-anchored offer; we can't push offers, nearest feasible = CS-delivered offer." No vaporware recommendations.

**③ Prioritize + power-check** — rank candidate experiments by **expected incremental value**:
`addressable_N × expected_effect × value_per_unit × feasibility × confidence ÷ effort`.
Then a **realism gate** most tools skip: a power/sample-size check. "Segment N=2,400, reachable 78% → can detect ≥4pp lift in 14d at 80% power; smaller effects won't reach significance." Segments too small to move are flagged, not recommended.

**④ Hand off + learn** — one click drops the chosen experiment into the command center (segment → assignment → CS queue → scorecard). The result writes back to a **Treatment-Effect Library** → becomes the prior for ③ next time. *This feedback flywheel is the durable moat:* after N experiments the Advisor knows "win-back lifts cfm_vn whales ~6pp, jus_vn mid-spenders ~2pp" and stops guessing.

## 4. Where expected-effect numbers come from (honesty about priors)
Three sources, each labeled with confidence so leadership trusts the ranking:
1. **Our own past experiments** (Treatment-Effect Library) — highest confidence; empty at first, fills fast.
2. **Cross-segment benchmark** — "comparable cohorts that improved on this factor moved X."
3. **Game-ops priors / defaults** — explicitly marked *assumption* until replaced by (1).

Cold-start is fine: early recommendations lean on (2)/(3) and say so; the loop replaces them with measured truth.

## 5. Product surface
- **Entry points:** a "Suggest experiments" action on a Segment page; an "Optimize" action on a game. Pick north-star (Revenue↑ / Engagement↑) + optional constraint (don't annoy whales, CS capacity = N/day).
- **Diagnosis panel:** the goal decomposition for this segment vs baseline, weak factor highlighted. This alone is a valuable artifact even if you run nothing.
- **Ranked experiment cards:** hypothesis · lever/playbook · expected lift + confidence · addressable N · feasibility (actuator) · **power verdict** · expected incremental ₫ · "Launch in Command Center."
- **Generation:** quantitative diagnosis (deterministic, from Cube/lakehouse) + an LLM pass (cube-advisor `claude -p` pattern) that turns the diagnosis + playbook library into 3 phrased, defensible hypotheses. LLM proposes; data ranks.

## 6. Worked example (segment `5ee78131…` / cfm_vn, goal = Revenue↑)
1. **Diagnose:** segment = high-lifetime payers; conversion is N/A (already payers), ARPPU healthy, but **payer-lifespan / recency is the weak factor** — a lapsing cohort. Opportunity = recover lifespan.
2. **Map:** lever = win-back; playbook = "lapsing whale care call"; actuator = CS ✅.
3. **Prioritize:** N=2,400, reachable 78% → powered for ≥4pp; expected lift prior +6pp (from the POC); expected incremental ₫ = top-ranked card.
4. **Hand off:** launches the exact experiment the command center already models. Loop closes; result updates the prior.
   *(If instead the segment were engaged non-payers, the weak factor flips to conversion and the top card becomes a CS-delivered starter-offer test — same engine, different lever.)*

## 7. How it reuses what exists (low net-new)
- Segment cohort + defining metric + ranked members → existing tokenless members API.
- Playbook library + thresholds → VIP-Care console.
- Execution + measurement → the command-center plan (260614-0018).
- LLM idea-generation → cube-advisor `claude -p` top-3 pattern.
- Net-new = the **diagnosis/decomposition engine** + the **Treatment-Effect Library** (priors store). Everything else is wiring.

## 8. Guardrails (game-ops realism)
- **Don't optimize a non-bottleneck** — TOC discipline; the diagnosis must justify the lever.
- **Don't cannibalize** — discounting whales who'd pay anyway destroys value; holdout measures incrementality, Advisor must warn when a lever risks subsidizing organic behavior.
- **Contact fatigue** — CS outreach is a scarce, annoyable channel; cap frequency per user across experiments.
- **Engagement≠revenue** — be explicit when recommending a leading-indicator play.

---

## Multi-angle analysis (the diagnostic toolkit — the v1 differentiator)
The predictive/uplift model (D) isn't available yet, so the Advisor's power comes from **triangulating many descriptive lenses**. An opportunity confirmed across several angles is trustworthy; one that shows on a single metric is a maybe. The diagnosis engine runs these lenses per segment + goal and *synthesizes* them — this is what makes v1 empowering, not the ranking alone:

| # | Lens | Question it answers | Built from |
|---|---|---|---|
| 1 | **Level vs population (A)** | Where does this segment sit in the game's distribution? | Cube percentile of the factor |
| 2 | **Trajectory (C)** | Is the factor improving or declining vs its own recent past? | factor over trailing windows |
| 3 | **Peer / look-alike (B)** | Are comparable cohorts (same tenure/tier/geo) doing better? | within-game peer match |
| 4 | **Decomposition (growth accounting)** | Which factor in the goal tree is the *bottleneck*? | Payers × ARPPU × lifespan; freq × length × lifespan |
| 5 | **Concentration / Pareto** | Is value broad or carried by a few whales? (defend vs broaden) | Gini / top-decile share |
| 6 | **Funnel / conversion** | Where do stage drop-offs happen? (engaged→payer→repeat→whale) | stage rates |
| 7 | **Lifecycle / cohort** | Is a "gap" structural (new players) or real? | behavior by tenure |
| 8 | **Cross-signal correlation** | Which leading indicators move the goal? (CS-contact↔retention, method↔churn, session-freq↔spend) | pairwise corr over members |
| 9 | **Anomaly / change-point** | Did something shift suddenly (post-patch/event)? | change detection on the series |

Synthesis: each candidate **opportunity** carries a *confidence* = how many lenses agree (level low **and** declining **and** below peers **and** the bottleneck factor = high confidence). The UI shows the triangulation, not just a verdict. (D / model-predicted potential is the v2 upgrade once the Treatment-Effect Library can train it.)

## Glass-box: traceability + refinement (required — the Advisor is not a verdict)
Analysts won't trust an opaque recommender. Two layers, both reusing existing surfaces:

**Provenance (explain).** Every number traces to a Playground query.
- Each **factor** → "Open in Playground" deep-link (exact measure + dimensions + segment filter; reuses the existing deep-linkable query state + compiled-SQL preview) + source cube/table (`billing_detail` → `iceberg.billing.std_billing_delivery_trans_gds`) + row count.
- Each **lens** exposes inputs + method: A → reference population + N; C → the two windows; B → the peer cohort definition.

**Refinement (steer).** The diagnosis is recomputable, not frozen.
- **Peer cohort is explicit + editable** — show the exact peer set with toggleable match axes. Toggle → B re-runs → **opportunity confidence + ranking recompute**.
- Same recompute on **baseline window** (30/60/90d), **reference population** (payers vs all), and **in-place segment refinement** (exclude new players, VN-only, split).

**Peer Studio (deep peer comparison).** A dedicated surface for "who are we comparing against?":
- **A peer cohort IS a segment** — reuse the Segments builder + tokenless ranked-members API; do NOT build a second cohort/predicate language. Fine-grain predicates come for free.
- **Multiple peers = a small set of NAMED reference roles, not unbounded:** Look-alike-healthy (aspirational ceiling, default primary) · Population norm (is this just where everyone sits?) · A-cohort-we-already-moved (grounds expected lift) · + one custom from Segments. Gap shown vs the primary, **corroborated** by the others — trailing *all* peers ⇒ high confidence; beating one ⇒ the framing is the finding.
- **Side-by-side profile table** (members, ARPPU, lifespan, repeat rate, D30, sessions, geo, tenure) with the weak factors highlighted.
- **Member sample** for target + peer (masked ids, reused ranked-members API, no contact PII) — makes "who am I targeting" concrete.
- Guardrail: Peer Studio justifies/refines the B baseline; free-form exploration stays in the Playground (linked out), not duplicated here.

**Predicate reality (verified 2026-06-14).** Segments filter via a predicate tree of `{member, operator, values}` over Cube members, compiled to Trino SQL (`segment-definition-writer.ts`, `types/predicate-tree.ts`, same shape as `care/threshold-rule.ts`). Peer predicates fall in **three classes** — the engine (reused from Segments) must handle all three:
1. **Direct** — `last_login_country = 'VN'`, channel, device, os (`cfm/mf_users.yml`). Native Cube filter.
2. **Derived relative-date** — tenure (from `first_login_date`), recency / "not-lapsed" (from `last_active_date`). Derived dimension or relative-date filter.
3. **Statistical/relative** — "top-quartile LTV", "above-median". NOT a stored attribute → two-pass: compute the percentile cutoff over the cohort, then threshold (or precompute an `ltv_tier` dimension).
The demo's four chips glossed these as identical toggles — real UI must distinguish direct vs derived vs statistical.

**RESOLVED (verified 2026-06-14):** the Segments builder supports ONLY 15 scalar operators (`server/src/types/predicate-tree.ts:6-21`; UI `src/pages/Segments/editor/predicate-builder/operators.ts:14-46`) — **no percentile or relative-date-derived operator.** So classes 2 (derived) and 3 (statistical) are a real, concrete gap. Trino + Cube both support `approx_percentile` natively — the gap is the compiler, not the DB. A two-pass percentile pattern already exists for Care playbooks (`server/src/care/threshold-rule.ts:57-71` `PercentileRule` + `server/src/care/calibrate.ts:109-112`) but its cutoff resolution is itself unwired and no seed playbook uses it. → **Closing this is Phase 0 of the Advisor plan: `plans/260614-1813-optimization-advisor/phase-00-predicate-engine-foundation.md`** (generalizes the Care two-pass into the Segments compiler). The prototype's Peer Studio + diagnosis peer editor now render the three classes honestly (direct/derived/statistical color tags + a gap warning).

## Interaction surfaces (product-layer — 3 modes + feedback)
Beyond "pick a recommendation", the Advisor is a steerable workspace:
- **Explain** — drill any factor/lens → Playground source.
- **Refine** — toggle peer axes / windows / reference pop; refine or split the segment in place; NL follow-up ("why is lifespan dropping?") via chat-service.
- **Decide** — (a) **tune a candidate** (arm split / window / metric / expected-effect) → power+CI+₫ recompute live; (b) **portfolio under CS capacity** (capacity + guardrails → pick the *mix* that maximizes ₫, a knapsack not a single pick); (c) **add a manual hypothesis** → Advisor power-checks + estimates it.
- **Feedback loop** — **dismiss/pin** an opportunity with a reason (structural / known / not now) → trains future diagnosis; human half of the Treatment-Effect Library.

## Locked decisions (2026-06-14)
1. **Baseline = Level + Trajectory + Peer (A+B+C) for v1.** Population percentile (A) = ceiling; cohort's own decline (C) = trigger; within-game peer cohorts (B) = "users like these, doing better". All three shown as independent signals; opportunity confidence = how many agree. B = similar cohorts **within the same game** (same tenure/tier/geo) — NOT similar games; cross-game stays a labeled cold-start prior only. Model-predicted (D) deferred to v2.
2. **Goal scope v1 = Revenue + Engagement together.** ⇒ engagement measures (session frequency / length / lifespan, from game_integration) must be wired alongside the revenue tree. Diagnosis panel shows both trees; engagement framed as leading indicator of revenue.
3. **Cold-start = ship with labeled defaults.** Expected-lift seeded from game-ops priors / cross-segment benchmarks, marked "assumption"; Treatment-Effect Library replaces them as experiments complete. Useful day 1.
4. **Diagnosis grain = on-demand live Cube read.** Query the ops cubes per segment when the Advisor opens (always fresh, reuses semantic layer). Accept cold-Trino latency at open; add caching only if it bites.

## Still open
1. **Peer-matching definition** — now that B is in v1: what makes a cohort "comparable"? (tenure band + spend tier + geo is the starting proposal). Drives lens #3.
2. **Actuator roadmap** — which non-CS levers (offers, LiveOps, push) become feasible and when? Gates half the lever families. (Today: CS-only.)
3. **Engagement measures availability** — confirm session frequency/length/lifespan exist per-segment in the game_integration cubes for cfm/jus (needed now that goal scope includes engagement).
4. **Money conversion** — agree the ₫-per-unit factors used to express each gap as "expected incremental revenue" (drives ranking).
5. **Lens compute cost** — 9 lenses × on-demand live Cube read per segment open could be slow (cold Trino); may need a short-TTL cache or a few precomputed lenses.
