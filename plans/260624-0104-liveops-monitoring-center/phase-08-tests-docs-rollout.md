# Phase 08 — Tests, docs, design cross-check, rollout

**Priority:** P0 (gate to ship) · **Status:** ☐ · Depends: all

## Goal
Verify the center end-to-end, align it to the design system, document it, and roll out safely.

## Tasks
1. **Tests** (Vitest + existing harnesses):
   - Unit: delta-decomposition contribution math (sums to headline ± residual; ratio measures handled); lifecycle transition aggregation; alert-rule comparator eval; digest idempotence guard; annotation overlay positions.
   - Integration: anomaly→notification bridge (dedup + snooze); redirect aliases preserve query; portfolio fan-out error isolation.
   - Reuse `chat-service/test/eval` lane where chat handoffs (diagnose) are touched.
2. **Design cross-check** (CLAUDE.md mandate): compare each new surface to `Dashboards/index.tsx` + `Liveops/cohort/index.tsx` — header pattern (24/32px, icon+20/700 title, eyebrow), tokens only (no raw hex/px), semantic status pills, spacing scale. Fix drift.
3. **Docs**: update `docs/codebase-summary.md`, `docs/system-architecture.md` (new routes/tables/jobs), `docs/lessons-learned.md` (any new bug shapes); add a LiveOps center section. Update nav docs.
4. **Migrations**: confirm `069`–`072` apply cleanly to segments.db; both dev + prod-docker registries per workspace-config rule.
5. **Rollout**: ensure LiveOps section visible (un-blocklist if Phase 00 found it hidden); feature-gate new sub-surfaces behind `liveops` feature; smoke-test `/liveops/*` on local; verify deep-links from anomaly/email survive.

## Success criteria
- [ ] All new unit/integration tests pass; no pre-existing tests regressed (verify baseline via `git show`, not stash — concurrent sessions).
- [ ] Each surface visually matches an adjacent existing page (no token/spacing drift).
- [ ] Migrations apply on dev + prod-docker; cron jobs register without double-fire.
- [ ] Docs + lessons-learned updated; nav visible; redirects verified.
- [ ] `npm run build` + typecheck clean.

## Risks
- Concurrent sessions edit this repo — don't `git stash`; confirm failures pre-exist via `git show`.
- New cron jobs on a single-instance scheduler — verify idempotence before enabling in prod.

## Unresolved questions (roll up from phases)
- diagnose-skill handoff vs parallel (Phase 02) — default: handoff link.
- digest recipients per-user vs team (Phase 06) — default: per-user.
- lifecycle daily vs weekly granularity (Phase 00/04) — default: weekly until rollup justified.
