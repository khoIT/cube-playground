# Phase 03 — Advisor UI: Diagnosis + Peer Studio (the Explore surface)

> Implements the **Explore** posture and the **Explain → Refine** loop. Visual contract:
> `plans/260614-0018-experiment-command-center/visuals/optimization-advisor.html` (Diagnosis + Peer Studio screens).
> Design system is mandatory — read `docs/design-guidelines.md`; reuse tokens, page-header pattern, semantic pills.

## Overview
- **Priority:** P0.
- **Status:** ✅ done (2026-06-14). `src/pages/Advisor/` ports the v5 Experiment-Builder IA: `index.tsx` (`AdvisorPage` shell, route `/advisor/:id?`) → `goal-screen` (NL goal + intent-echo) → `step-nav` + `stage-panel` + `aspect-card` (cover·toggle·triage, "look into this", add-your-own-angle, manager-asserted cause) + `blueprint` (assembles from kept findings) → `decide-screen` (grade-not-gate, split clamped ≥15% hold-out) → `command-center` (hand-off, pluggable delivery, monitoring). `provenance-drawer` for glass-box. Builder stages are demo-driven (honest stage-aware placeholders via `advisor-stage-config`, never fabricated metrics); the Recommend cards are live `/api/advisor/recommend`. Shell wired: sidebar Advisor item (default-on), `nav.advisor` i18n EN+VI, `advisor` NavItemId + FeatureKey. Design-token compliant (0 raw hex), antd v4 (no Space.Compact). Web build + typecheck clean. Live Cube diagnose renders honest error state on this host (no Trino). NL-follow-up-to-chat + a standalone Peer Studio screen folded into the builder's Target stage (deferred as separate screen).
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

## Red-team (POC, 2026-06-14) — every step graded vs the business-manager persona
Independent red-team of the full 8-step flow (Goal → Opportunity → Target → Cause → Lever → Proof → Decide → Command Center). Verdict: v5 already killed most jargon; the persona breaks are concentrated in **trust/recovery moments** (agent wrong · data cold/sparse · manager disagrees), not raw vocabulary. Findings (severity → fix → status):

| Step | Biggest failure | Fix | Severity | Status |
|---|---|---|---|---|
| 1 Goal | binary Revenue/Engagement hides real "goal + constraint"; mis-parse of intent surfaces only 5 steps later | echo one editable interpretation line before digging ("Got it — among **lapsing high-spenders**, grow **revenue**. Right?") | major | **DONE in prototype** (GoalScreen `echo` phase: editable cohort + objective + "Looks right / Fix the goal") |
| 2 Opportunity | toggle(scope)+triage(verdict) is a two-decision analyst loop; managers expect one → toggles ignored → false readiness | card opens in-scope; primary action = triage only; demote scope-toggle to "remove" on hover | major | **DONE in prototype** (all cards `on:true`; scope demoted to a quiet "skip" → collapses to "+ include"; triage is the one primary action) |
| 3 Target | hold-out reads as "deliberately NOT winning back ₫"; no plain why → drives split-slider abuse | one plain line introducing incrementality ("hold a few back, untouched, to prove it *caused* the recovery") | major | **DONE in prototype** (hold-out "why" line on the split control) |
| 4 Cause | cold/sparse data dead-ends the one stage the blueprint hard-gates; no graceful degrade | allow a **manager-asserted cause** as a first-class kept finding, badged "your call (not yet confirmed)" | major | **DONE in prototype** (composer "✋ I already believe this" → auto-kept asserted finding; Command Center thesis tags it "(assumed)") |
| 5 Lever | "not-feasible-yet" reads as a hobbled tool; doesn't say what unlocks it / the feasible substitute | per-card line: why + nearest deliverable substitute ("use this instead") | minor | **DONE in prototype** (non-feasible levers show "Why: … · Nearest we can do today: …") |
| 6 Proof | a prior shown without its thinness = false confidence a P&L owner reports upward | show basis count in plain words ("~6 more payers/100 — based on **1 test**, treat as a bet"); N=0 → "running it *is* how we find out" | major | **DONE in prototype** (📎 basis line on proof cards) |
| 7 Decide | **BLOCKER** — readiness gates on completion not soundness; split draggable to 95/5 → an un-provable draft committed confidently | (a) **grade, don't gate**: "Strong" vs "Exploratory"; (b) **clamp split** to hold-out ≥15% | blocker | **DONE in prototype** (grade banner + slider floor 70–85) |
| 8 Command Center | "~23% uid match · ITT" reads as "tool lost track"; manual delivery counter can't separate reality from logging lag | lead with the headline ("Did it work? measured on everyone assigned"); reframe 23% as confirmed-reach coverage; split "CS says delivered" vs "logged here" | major | **DONE in prototype** ("Did it work?" leads readout; 23% reframed as confirmed-reach coverage; manual mode shows "CS says delivered" vs "Logged here (may lag)"; gross-₫ footnote) |

Cross-cutting: (1) agent-wrong recovery weak end-to-end → Step-1 echo + per-finding "this looks off, re-dig"; (2) cold-data needs honest "we don't have this yet — here's the bet" everywhere, never a confident zero; (3) manager-disagree needs a **pin-with-reason** that teaches the system, not just Rule-out; (4) promise reversibility explicitly ("nothing locked until you freeze groups; archive any time"); (5) audit every rendered string vs a "would my VP say this word" test (kill residual `pp`/`MDE`/`ITT`/`lens`); (6) "₫ at stake" is **gross** — footnote once ("before refunds & costs").
**All 8 step-fixes are now built into the prototype** (verified Playwright pageerrors=0, both revenue + engagement templates). Cross-cutting: gross-₫ footnote DONE; **still deferred to React** = pin-with-reason override (Flag that teaches the system) + per-finding "this looks off, re-dig" + explicit reversibility promise copy. Also DONE earlier: refine works on the Advisor's own AI-generated cards (not just custom).

## Wiring into the app — left nav + component reuse (verified file:line, 2026-06-14)
Connect to existing surfaces; do not rebuild. Scout map:
- **Left nav:** `src/shell/sidebar/sidebar.tsx` (SidebarSection pattern ~L120–276; feature-gate via `showSection(id)` L40–45). Add `{icon: lucide Sparkles/Lightbulb, label: t('nav.advisor'), to:'/advisor'}`; add `nav.advisor` i18n key. **Decision: register in the Settings visibility system (`src/pages/Settings/use-visible-nav-items.ts`) but default it ON/visible** — discoverable from day 1, still hideable per-workspace.
- **Route:** `src/index.tsx` — `loadable(()=>import('./pages/Advisor'))` + `<Route exact path="/advisor">` in the Suspense block (L214–281). Sub-route `/advisor/:id` via `<Switch>` like dashboards if needed.
- **Peer cohort = a Segment (reuse, don't fork):** `src/pages/Segments/editor/predicate-builder/predicate-group.tsx` (`renderRoot` L114) + `editor/hooks/use-predicate-state.ts` (tree + mutation helpers) + `predicate-builder/operators.ts`. Phase 0's new operators surface here automatically.
- **Masked member sample:** `src/api/segments-client.ts` `getMembersPage()` (L91–106, `SegmentMembersPage`) rendered like `detail/tabs/sample-users-tab.tsx`.
- **CS work-queue / monitoring surface:** reuse `detail/tabs/care-tab.tsx` sub-components `CarePulseStrip`/`CareWatchlist`/`CareIssueMix` + `src/api/segment-cs-care.ts` (`CsCarePayload`); member drilldown `getMemberCsTickets`.
- **Treatment-vs-hold-out charts:** `src/pages/Chat/components/assistant-chart-section.tsx` (`AssistantChartSection`, `defaultView="chart"`) as used in `src/pages/OpsConsole/overview-trends.tsx`.
- **Glass-box deep-link:** `src/pages/OpsConsole/open-in-playground.tsx` + `src/utils/playground-deeplink.ts` (`buildQueryDeeplink`). NB: no standalone compiled-SQL-preview component exists — Playground's own Validate shows SQL; the prototype's `ProvenanceDrawer` must be built or deep-link to Playground instead.
- **Design:** `src/theme/tokens.css`; page-header pattern from `src/pages/Dashboards/index.tsx` + `src/pages/Liveops/cohort/index.tsx` (24px/32px padding, maxWidth 1200–1400 for grids, icon + 20px/700 title).

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
Create: `src/pages/Advisor/index.tsx`, `experiment-builder.tsx` (the 5-stage board), `stage-panel.tsx`, `blueprint.tsx`, `command-center.tsx` (hand-off + monitoring), `goal-screen.tsx`, `src/api/advisor.ts`.
Modify (wire in): `src/shell/sidebar/sidebar.tsx` (+ `nav.advisor` i18n, `use-visible-nav-items.ts` gate); `src/index.tsx` (lazy route); Segment + game/ops pages (entry-point actions).
Reuse (do NOT fork — see Wiring map for file:line): Segments predicate-builder (`predicate-group.tsx`/`use-predicate-state.ts`) for the peer cohort; `segments-client.getMembersPage` + `sample-users-tab` for masked member samples; Care `care-tab.tsx` sub-components + `segment-cs-care.ts` for the CS work-queue/monitoring; `AssistantChartSection` for treatment-vs-hold-out charts; `open-in-playground.tsx`/`buildQueryDeeplink` for glass-box.
Read: the prototype HTML (visual contract); `docs/design-guidelines.md`.

## Implementation steps
0. **Wire the shell first:** add the `/advisor` lazy route + left-nav entry (gated) so the page is reachable, then build inward (see Wiring map).
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
