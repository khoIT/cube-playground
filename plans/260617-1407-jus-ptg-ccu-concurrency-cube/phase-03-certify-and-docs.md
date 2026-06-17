# Phase 03 — Certify, document, commit

**Priority:** P1 · **Status:** not started · **Depends on:** phase-02

## Steps
1. **Certify.** `cd server && npm run audit:metric-trust -- --game jus_vn --promote`
   then `--game ptg --promote`. The 4 ccu metrics are `trust: draft` (unlike
   active_role they were never globally certified), so they'll appear as READY
   once refs resolve and auto-certify via the governed PATCH (cert gate
   validates vs that game's /meta). Expect +4 promoted.
2. **Verify global state.** `npm run audit:metric-trust` — confirm:
   - jus_vn + ptg: 4 ccu metrics certified.
   - other 6: 4 ccu metrics now N/A (not GAP).
   - totals: certified +4ish; gap −20ish (the 5×4 leaving GAP to N/A + 2×4 to
     certified, minus the cfm 4 already N/A).
3. **Verify real values** one more time via cube proxy (peak/avg/low last 7d).
4. **Docs.** Update `docs/metric-trust-audit-playbook.md`:
   - worklist concurrency row → "DONE for jus_vn+ptg via ccu cube; N/A for the
     other 6 (no etl_ingame_ccu)".
   - snapshot table numbers.
5. **Memory.** Update `metric-trust-audit-playbook` memory snapshot line.
6. **Commit own files only** (concurrent sessions edit this repo — explicit
   pathspec, no `git add -A`, no stash):
   - `cube-dev/cube/model/cubes/jus/ccu.yml`
   - `cube-dev/cube/model/cubes/ptg/ccu.yml`
   - `server/src/presets/business-metrics/{pcu,lcu,acu,ccu}.yml`
   - `docs/metric-trust-audit-playbook.md`
   - Conventional commit, no AI refs, no plan-artifact refs in any code/YAML
     comment (per code-comment rules).
7. Do NOT push (outward action — needs explicit authorization).

## Success criteria
- 8 metric-displays (4 × jus/ptg) certified, backed by verified real data.
- 20 (4 × other 5) cleanly N/A; cfm 4 consistent.
- Playbook + memory reflect verified reality; nothing fabricated.

## Definition of done
`audit:metric-trust` shows the concurrency cluster fully resolved (certified
where a source exists, N/A where it doesn't) — no concurrency metric left in any
game's GAP list.
