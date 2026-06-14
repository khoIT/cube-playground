# Phase 03 — Human-closed KPI outcome + badge (B4)

## Context links
- Brainstorm: `plans/reports/brainstorm-260609-1813-cs-demo-artifact-care-loop-report.md` (§B4, Open Q1)
- Plan overview: `plan.md` · Depends on Phase 01 + 02

## Overview
- **Priority:** P2
- **Status:** pending
- **Description:** On a **treated** case, expose "Close · KPI met" / "Close · KPI missed" → `patch{status:'resolved', outcome}`. Resolved rows show a `kpi_met ✓ / missed` badge. **Human-closed only — no `runKpiEval`/Cube auto-eval this round.** Frontend only.

## Key insights
- `patchSchema.outcome` enum `'kpi_met'|'kpi_missed'|'na'` already accepted (`care-cases.ts:46`); `patchCase` stamps `closed_at` on `→resolved` (`care-case-store.ts:179`). No server work.
- `runKpiEval()` exists but stays UNWIRED this round (locked decision) — do NOT import it.
- **Q1 RESOLVED (user-confirmed 2026-06-09):** `buildPortfolio` (`use-care-playbooks.ts:160-186`) computes `attainmentRate = (treated+resolved) / total` and ignores `outcome` (`:167-169`); PortfolioStrip renders it (`portfolio-strip.tsx:182-187`). **Decision: KEEP `attainmentRate` exactly as-is (no regression). ADD a separate `kpiMetRate = kpi_met / closed-with-outcome` as a NEW portfolio stat + card.** Do NOT redefine attainment.

## Data flow
```
Treated case ──► "Close · KPI met"  ► patchCareCase(id,{status:'resolved', outcome:'kpi_met'})
            └──► "Close · KPI missed"► patchCareCase(id,{status:'resolved', outcome:'kpi_missed'})
   └─► closed_at stamped, leaves open queue, history event 'resolved' shows outcome badge
PortfolioStrip attainment (if rewired): kpi_met / (cases with outcome ∈ {kpi_met,kpi_missed})
```

## Requirements
**Functional**
1. Close control appears only when case `status === 'treated'` (must be treated first — enforces the loop). Two buttons: KPI met / KPI missed.
2. → `patch{status:'resolved', outcome}` → refetch; case leaves open queue, resolved history event shows outcome badge (reuse `OutcomeChip`, `cs-care-history-timeline.tsx:49`).
3. Resolved rows in the queue/history render `kpi_met ✓` / `kpi_missed ✗` badge (semantic tokens, existing chip).
4. Gated on `canWrite`; pending/error inline.

**New ROI stat (confirmed — additive, no regression)**
5. Add `kpiMetRate = kpi_met / (cases with outcome ∈ {kpi_met,kpi_missed})` to `buildPortfolio` as a NEW field alongside the untouched `attainmentRate`. Render a NEW "KPI met %" card in `portfolio-strip.tsx` next to the existing attainment card. `attainmentRate` semantics stay exactly as today. Extend the `use-care-playbooks` test to cover the new field (and assert `attainmentRate` is unchanged).

**Non-functional:** tokens only; reuse OutcomeChip; no regression.

## Architecture
- Add `closeCaseWithOutcome(id, outcome)` to `cs-case-actions.ts` (Phase 02) — wrapper over `patchCareCase`. DRY.
- Close control in the rail (acts on the treated top case) + optional inline on queue treated rows.
- Outcome badge: reuse `OutcomeChip` from `cs-care-history-timeline.tsx`; extend `CareCase`→timeline mapper (Phase-01 derive) to emit `resolved` events carrying `outcome`.

## Related code files
**Create**
- `src/pages/Dashboards/cs/__tests__/portfolio-kpi-met-rate.test.ts` — lock `attainmentRate` unchanged + assert new `kpiMetRate`.

**Modify**
- `src/pages/Dashboards/cs/cs-case-actions.ts` — add `closeCaseWithOutcome`.
- `src/pages/Dashboards/cs/member360/cs-recommended-action-rail.tsx` — Close · KPI met/missed (treated-only).
- `src/pages/Dashboards/cs/member360/cs-member360-derive.ts` — resolved events carry `outcome` for the badge.
- `src/pages/Dashboards/cs/case-ledger.tsx` — outcome badge on resolved rows (resolved rows aren't in open queue but appear in By-Playbook status filters).
- `src/pages/Dashboards/cs/__tests__/cs-case-actions.test.ts` — extend for close payload.
- `src/pages/Dashboards/cs/use-care-playbooks.ts` — add `kpiMetRate` to `buildPortfolio` (additive). `portfolio-strip.tsx` — new "KPI met %" card.

## Implementation steps
1. **TDD-first** — extend `cs-case-actions.test.ts`: close → `{status:'resolved', outcome:'kpi_met'}` / `kpi_missed`. Extend `cs-member360-care.test.tsx`: close control hidden until treated; clicking emits the patch; resolved badge renders.
2. Add `closeCaseWithOutcome` helper.
3. Treated-only Close control in rail; wire patch+refetch.
4. Derive: resolved events carry outcome → OutcomeChip in timeline + queue.
5. Add `portfolio-kpi-met-rate.test.ts`: lock `attainmentRate` unchanged, assert new `kpiMetRate`. Add `kpiMetRate` to `buildPortfolio` (additive) + new "KPI met %" card in `portfolio-strip.tsx`.
6. tsc + suites green.

## Todo
- [ ] Extend `cs-case-actions.test.ts` (close payloads)
- [ ] Extend `cs-member360-care.test.tsx` (treated-gate + badge)
- [ ] `closeCaseWithOutcome` helper
- [ ] Treated-only Close control + patch/refetch
- [ ] Resolved outcome badge in timeline + queue
- [ ] `portfolio-kpi-met-rate.test.ts` + additive `kpiMetRate` + "KPI met %" card
- [ ] tsc + suites green

## Success criteria
- Close appears only on treated cases; closing stamps `outcome` + `closed_at`; persists.
- Resolved rows/events show correct KPI met/missed badge.
- New `kpiMetRate` card shows real met %; existing `attainmentRate` byte-for-byte unchanged.
- Existing suites green.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Accidentally altering `attainmentRate` while adding `kpiMetRate` | M×H | Test asserts `attainmentRate` unchanged; `kpiMetRate` is a NEW field, separate card |
| Close offered before treat (breaks loop) | M×M | Gate control on `status==='treated'` |
| `outcome:'na'` path unused this round | L×L | Don't surface `na` button; keep enum value reserved |
| `kpiMetRate` divide-by-zero when no closed-with-outcome cases | M×M | Guard: render "—" when denominator 0 |

## Security
- Existing `/api/care` editor/admin gate. No new endpoint.

## Open questions
None — Q1 resolved (additive `kpiMetRate`, attainment untouched).

## Next steps
- Loop now end-to-end (surface→claim→treat→close→outcome). Independent of 04/05.
