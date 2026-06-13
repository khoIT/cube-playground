# Phase 05 — Scorecard / Readout UI

## Context links
- Report §4.3 item 6, §4.5 (scorecard: lift, CI, significance; ITT + treated-on-treated).
- Charts: recharts is already in the stack (report names it; verify `grep recharts package.json`). Existing chart usage: `src/pages/Liveops/cohort/*` and segment trajectory views.
- Shared from Phase 4: `experiments-client.ts`, `experiment-header.tsx`, `experiments.module.css`.
- Backend: `GET /api/experiments/:id/scorecard` (Phase 3).
- Design tokens / semantic status colors: `src/theme/tokens.css`.

## Overview
- **Priority:** P1.
- **Status:** pending.
- Treatment-vs-holdout readout page: ITT uplift cards + treated-on-treated cards + cumulative re-pay timeseries by arm + significance/CI. Pure presentation over the scorecard payload.

## Key insights
- Two side-by-side result blocks: **ITT** (assigned treatment vs control — the honest primary) and **Treatment-on-Treated** (contacted vs control — secondary, compliance-adjusted). Clearly label which is primary.
- Each block: re-pay rate per arm, lift % (relative), absolute diff, 95% CI, two-proportion p-value, n per arm. Plus mean rev/user with CI.
- Timeseries: cumulative re-pay rate (or cumulative rev/user) per arm over the window via recharts `LineChart` — the "loop closing" visual.
- A "compliance summary" strip: of treatment arm, how many actually contacted (from exposure), CSAT distribution. Surfaces the §4.8 open risk (outbound logging) honestly — if 0 contacted, ToT block shows "no logged contacts".

## Requirements
Functional:
1. Fetch `GET /api/experiments/:id/scorecard`; render ITT + ToT cards, compliance strip, cumulative timeseries.
2. Significance presented plainly (p-value + "significant at 95%?" badge using semantic tokens — positive/destructive/muted).
3. Degraded payload (null section) → show "outcome/exposure data unavailable" placeholder, not a crash.

Non-functional: lazy-loaded; tokens only; recharts styled to match existing charts (axis/grid colors from tokens).

## Data flow
```
route /experiments/:id/scorecard → useExperimentScorecard(id) → GET scorecard
  → ITT cards | ToT cards | compliance strip | recharts cumulative series
```

## Related code files
Create:
- `src/pages/Experiments/scorecard-page.tsx`
- `src/pages/Experiments/use-experiment-scorecard.ts`
- `src/pages/Experiments/scorecard-cards.tsx` (ITT/ToT card block, reusable for both)
- `src/pages/Experiments/scorecard-timeseries.tsx` (recharts LineChart by arm)
- `src/pages/Experiments/compliance-strip.tsx`

Modify:
- `src/index.tsx` — `Route key="experiments-scorecard" path="/experiments/:id/scorecard"`.

Read for context: existing recharts page (`src/pages/Liveops/cohort/*`), `experiment-header.tsx`, `tokens.css`.

## Implementation steps
1. Verify recharts present (`grep -n recharts package.json`); if absent, fall back to the existing chart lib used by cohort page (do NOT add a new dep — YAGNI).
2. `use-experiment-scorecard.ts` — fetch hook.
3. `scorecard-cards.tsx` — generic arm-comparison card (rate, lift, CI, p, n); render twice (ITT, ToT) with a `variant`/label prop.
4. `compliance-strip.tsx` — contacted count, contact rate, CSAT summary; handles "0 contacted" gracefully.
5. `scorecard-timeseries.tsx` — cumulative re-pay by arm; tokens for colors.
6. `scorecard-page.tsx` — compose header (shared) + cards + strip + chart; degrade per-section.
7. Wire route; compile + lint.

## Todo
- [ ] confirm recharts (or reuse cohort chart lib)
- [ ] `use-experiment-scorecard.ts`
- [ ] `scorecard-cards.tsx` (ITT + ToT)
- [ ] `compliance-strip.tsx` (0-contact safe)
- [ ] `scorecard-timeseries.tsx`
- [ ] `scorecard-page.tsx` + route
- [ ] compile clean, visual cross-check

## Success criteria
- Scorecard renders ITT primary + ToT secondary with lift/CI/p-value and per-arm n.
- Significance badge correct against hand-computed fixture.
- Timeseries shows two arms; 0-contact experiment renders ToT placeholder, not a crash.
- Visual parity with existing chart pages; tokens only.

## Risks
| Risk | L×I | Mitigation |
|---|---|---|
| recharts not actually in deps | L×M | Step 1 verifies; reuse cohort page's lib if missing — no new dep. |
| Misleading stats presentation | M×H | Label ITT as primary; show n + CI alongside every lift; stats computed server-side (Phase 3 tested). |
| Tiny-n CI/p-value instability | M×M | Show n prominently; badge "underpowered" when n below a documented floor (e.g. <100/arm). |

## Security (PII)
- Aggregate metrics only — no member rows on this page. Member-level lives in Phase 6 drilldown (still uid-keyed, no PII).

## Next steps
Phase 6 links scorecard → experiment-360 member drilldown.
