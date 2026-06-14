# Phase 03 — Advisor UI: Diagnosis + Peer Studio (the Explore surface)

> Implements the **Explore** posture and the **Explain → Refine** loop. Visual contract:
> `plans/260614-0018-experiment-command-center/visuals/optimization-advisor.html` (Diagnosis + Peer Studio screens).
> Design system is mandatory — read `docs/design-guidelines.md`; reuse tokens, page-header pattern, semantic pills.

## Overview
- **Priority:** P0.
- **Status:** pending.
- Build the Diagnosis screen (dual goal trees + per-factor A/C/B signals + editable peer cohort + refine bar +
  provenance + the 9-lens evidence panel) and the Peer Studio (named peers, side-by-side profile, the
  three-class predicate panel, member sample). This is where the user *explores*; nothing commits here.

## Prototype versions (kept for comparison, `visuals/`)
- `optimization-advisor-v2-analyst-console.html` — dense analyst-first console. Rejected: buries the ₫ lede.
- `optimization-advisor-v3-guided-journey.html` — linear persona-first wizard. Good language, fixed path. Survives as the "express" path for simple goals.
- `optimization-advisor-v4-investigation-board.html` — board with **4 artifact-type lanes** (Reasoning/Data/Segments/Analyses). Superseded: lanes organized by artifact type don't teach how to build an experiment.
- `optimization-advisor.html` (**v5, current — the chosen IA**) — the **Experiment Builder**: same agent-filled / cover-toggle-triage mechanics, but reorganized around the **anatomy of an experiment**. Now also includes: empty blueprint slots tagged with their stage emoji+label (obvious link to the stepper); custom-angle **refine** (reword & re-investigate) + **needs-info** flow (Advisor can't source it → asks the manager for the missing piece → retry); and a wired **CommandCenter** hand-off screen (lifecycle stepper · preserved thesis · pluggable delivery [in-system CS queue vs external/manual export] · treatment-vs-hold-out monitoring · guardrails · provenance). The delivery-ownership model is the answer to "the action is often outside our system" — see command-center plan's Principles → the hand-off contract.

## Experiment-anatomy model (v5 — the chosen IA)
The investigation is NOT organized by artifact type; it is organized by the **building blocks of an experiment**, a left-to-right causal chain where each stage produces one slot of the final experiment:
**Opportunity → Target → Cause → Lever → Proof → (Decide).**
1. **Flexible goal.** Manager types the question in plain words (+ quick-pick chips) and picks Revenue / Engagement. The agent fills the chain — no rigid goal enum. **Both goal templates exist** (revenue + engagement); same 5 stages, different aspect content.
2. **Each stage teaches how to ask better.** A stage shows its guiding question, **`builds:` <the slot it fills>**, and **"what a strong answer looks like"** — so the manager knows which angle to look for next. This is the answer to "how does each lane contribute": every stage maps to a slot of the experiment.
3. **Cover · toggle · triage** per aspect card — two decisions at two moments, deliberately distinct:
   - **Toggle** (pre-investigation scope gate): "should the Advisor even look at this?" Off = skip; the angle is an *unexplored blind spot*, not a verdict.
   - **Triage** (post-investigation verdict on the returned finding): **✓ Keep** = true & load-bearing → fills the blueprint slot; **⚑ Flag** = interesting-but-unsure → stays an open question, no slot; **✕ Rule out** = looked and it doesn't change the plan → dropped but *explored* (covered ground, not a blind spot). The toggle-off vs ✕-rule-out distinction matters for coverage: unexplored ≠ explored-and-rejected. (Earlier prototype label collision — both said "set aside" — fixed: dismiss → "Rule out", toggle → "skip".)
4. **Add your own angle (wired in v5).** Each stage has an in-card composer: the manager types a custom question → the Advisor adds it as a live card ("digging…" → finding), badged **"your angle"**, fully triageable. Its kept slot is the manager's own words, so a custom angle can literally fill the blueprint sentence. In the build this is `/api/advisor/diagnose` scoped to the typed question; prototype returns an honest stage-aware placeholder (no fabricated metrics).
5. **Live blueprint.** A sentence ("Among **<target>** who **<opportunity>**, the cause is **<cause>** — so we'll run **<lever>**, expecting **<proof>**") **assembles from kept findings**; empty slots are greyed jump-buttons. Makes the contribution of each stage visible and shows gaps ("no cause kept → your lever is a guess").
6. **Where agents appear:** goal-setup (lays out the chain) · per-card "look into this" (builds one artifact) · per-stage/batch "investigate this step" (fan-out) · per-stage "add your own angle" composer (custom question → live card) · Decide (synthesises kept findings).
7. **Top step navigation** across the 5 stages + Decide, each showing kept/open status.
8. **Decide page** makes the blueprint→experiment mapping explicit: a "How each step shaped this experiment" list traces every kept finding to the slot it filled, then the editable, reversible draft ("nothing launches until you say so"). Readiness = a finding kept in ≥4 of 5 stages (a near-complete blueprint), not an arbitrary count.
Implementation note: each aspect card = a lens / segment / candidate from Phases 1–2; "Look into this" = on-demand `/api/advisor/diagnose` scoped to that aspect; the 5 stages map to: Opportunity=lenses A/decomp + money-model, Target=peer Segment + holdout, Cause=reasoning lenses (concentration/anomaly/cross-signal), Lever=lever-map (feasibility-gated), Proof=Treatment-Effect Library prior + power-check + guardrails. Triage + blueprint state persist per investigation (new lightweight store). v3's linear screens survive as the express path.

## Persona layering (red-teamed 2026-06-14 — the hard acceptance criteria)
The surface must pass the **game business-manager** (P&L owner, not analyst) test: explore real data → understand the recommendation → drive with AI. Verified failures of the analyst-first v2 prototype and their fixes are now baked into the v3 prototype and are acceptance criteria here:
1. **Lead with the business lede, not machinery.** Diagnosis H1 = the ₫ at stake + the human cause ("≈312M₫/mo — your whales last paid 27–34d ago vs 1–5d for healthy ones"). Percentiles, the 9-lens grid, peer-axis toggles, predicate classes are **demoted behind "show the evidence / advanced" expanders** — never the default surface.
2. **Confidence = one pill + a plain sentence** ("High — 3 independent checks agree, and we've recovered this before"); the 9-lens detail lives behind "what makes us confident?". Remove the locked-v2 (model-predicted) chip from the default view.
3. **Plain-language power + visible safety on every recommendation card** — "Big enough for a clear answer in 14 days ✓" / "Too few players — grow the group first"; kill "pp"/"MDE"/"powered ≥4pp". Each card shows a Safety-checks line (no <7d-payer contact · hold-out measured · 1 contact/player cap).
4. **Proven-vs-bet is an explicit one-liner per card**, never a color pill alone ("We've tested this — it worked (+6). High confidence." vs "Untested estimate — treat as a bet").
5. **The Drive moment is a real screen:** "Review & set up experiment" → an on-screen **editable draft** (cohort N, treatment/hold-out split, window, CS queue, safety) with a "Nothing launches until you say so" banner. Renaming "Launch →" to a review verb is required (it must not read as auto-launch).
6. **NL ask-box is prominent** on Diagnosis; its answer renders as a plain in-line paragraph, not a chat silo.
7. **Explode works:** every card's "Why do you recommend this?" jumps to the plain-language evidence (not the lens grid).
Jargon-kill list + the 6-screen flow (Goal → What's wrong → Dig in → What to do → Set it up → Command Center) are in the red-team report and reflected in `visuals/optimization-advisor.html` (v3). Analyst affordances are retained for the Explore posture but always opt-in.

## Key insights — the Explore↔Hand-off spine in the UI
- **Glass-box is non-negotiable.** Every number → an "Open in Playground" deep-link (measure + dims + segment
  filter + compiled-SQL preview + source cube/table + rows). The `ProvenanceDrawer` from the prototype is the contract.
- **Refinement recomputes, not resets.** Toggle a peer axis / trend window / reference population → the B
  signal re-runs → opportunity confidence + ranking recompute. The peer editor is the prominent, obviously-editable card (orange-bordered) from the prototype.
- **Predicate honesty (Phase 0 surfaces here).** The Peer Studio predicate panel shows each condition's class —
  direct (success-ink) / derived-date (info-ink) / statistical (warning-ink) — and warns when a class needs the
  Phase 0 engine. Already reflected in the updated prototype; the React build must preserve it.
- **Peer cohort IS a Segment.** "Add from Segments" opens the real builder; do not build a second cohort language.
- **NL follow-up lands in-place.** "why is lifespan dropping?" → chat-service → answer rendered inside the explore layer (a lens annotation), not a separate chat panel.

## Requirements
Functional:
1. `src/pages/Advisor/` route + entry points: "Suggest experiments" on a Segment page, "Optimize" on a game; goal picker (Revenue↑ / Engagement↑ / both) + optional constraint (don't-annoy-whales, CS capacity/day).
2. **Diagnosis screen** — dual goal trees with A/C/B signal chips per factor; weak factor highlighted; refine bar (trend window 30/60/90, reference population payers/all); `ProvenanceDrawer`; 9-lens evidence panel → X/9 confidence.
3. **Peer cohort editor** — prominent editable card; toggle match axes (each tagged with predicate class); live N + B-gap readout recompute; "Open Peer Studio".
4. **Peer Studio screen** — named peer set (look-alike / population / reactivated + "Add from Segments"); side-by-side profile table (weak factors highlighted); three-class predicate panel; masked member sample (target/peer toggle, reused ranked-members API).
5. **Explain/Refine** wired to the Phase 1 engine (`/api/advisor/diagnose` from Phase 4 routes); recompute on refine.
6. NL follow-up box routing to chat-service, answer rendered as an in-line lens annotation.

Non-functional: design-token compliance (cross-check an adjacent page); lazy-load lenses 5–9 (spinner, not block); masked ids only.

## Related code files
Create: `src/pages/Advisor/index.tsx`, `diagnosis-screen.tsx`, `peer-cohort-editor.tsx`, `peer-studio.tsx`, `provenance-drawer.tsx`, `lens-evidence-panel.tsx`, `goal-tree-view.tsx`, `src/api/advisor.ts`.
Modify: Segment page + game/ops page (entry-point actions); route registration (`src/index.tsx`).
Read: the prototype HTML (visual contract); `docs/design-guidelines.md`; existing Segments builder + ranked-members components for reuse; Care console patterns.

## Implementation steps
1. Route + entry points + goal picker.
2. `goal-tree-view.tsx` + Diagnosis screen scaffold from the prototype; wire to `/api/advisor/diagnose` (Phase 4).
3. `peer-cohort-editor.tsx` with class-tagged axes + live recompute.
4. `provenance-drawer.tsx` (deep-link + compiled-SQL preview + source + rows).
5. `lens-evidence-panel.tsx` (9 chips → X/9; lazy lenses).
6. `peer-studio.tsx` (named peers + profile + three-class predicates + member sample); "Add from Segments" → builder.
7. NL follow-up → chat-service, in-line annotation.
8. `npm run build`; Playwright pageerror==0 on both screens; design cross-check vs Dashboards/Segments.

## Todo
- [ ] route + entry points + goal picker
- [ ] Diagnosis screen + goal-tree view (wired)
- [ ] peer cohort editor (class-tagged, recompute)
- [ ] provenance drawer (deep-link + SQL preview)
- [ ] lens evidence panel (lazy 5–9)
- [ ] Peer Studio (named peers + profile + 3-class predicates + member sample)
- [ ] NL follow-up → chat-service in-line
- [ ] build clean + Playwright 0 errors + design cross-check

## Success criteria
- Opening the Advisor on `5ee78131…` shows payer-lifespan as the weak factor with A/C/B chips, an X/9 confidence, and every number opening a working Playground link.
- Toggling a peer axis recomputes the B gap + confidence without a full reload.
- Peer Studio predicate panel shows the three classes honestly (matches the prototype) and "Add from Segments" opens the real builder.
- Surface passes design cross-check vs an adjacent page.

## Risks
| Risk | L×I | Mitigation |
|---|---|---|
| Design drift from system | M×M | mandatory cross-check; reuse tokens + page-header pattern. |
| Provenance links break on refine | M×M | derive deep-link from the live query state, not a snapshot. |
| Lens panel blocks on cold Trino | M×M | render sync set; lazy lenses with spinners. |

## Security (PII)
Member sample uses masked ids via the redacting ranked-members API; no contact columns ever rendered.

## Next steps
Phase 4 adds the Recommend cards + the reversible Drive hand-off on top of this Explore surface.
