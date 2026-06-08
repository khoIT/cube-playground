# Phase 6 · Playbook Builder (authoring & overrides)

**Priority:** medium — answers "where do I create/edit a playbook"; enhancement after MVP monitor.
**Status:** pending. **Gates:** blockedBy 0 (merge layer), 2 (monitor entry points).

## Overview
The monitor + 21 seeded playbooks demo without authoring, but CS managers must be able to **create, clone, and edit** playbooks. This adds a **Playbook Builder** over the Phase-0 seed⊕override layer. Net-new and edited playbooks persist as `care_playbooks` rows; seeds stay version-controlled (enable/disable + threshold tune only, never deleted).

## Entry points (where you go)
- **CS Monitor header** → **"+ New playbook"** button → `/dashboards/cs/playbooks/new`.
- **Per playbook row** → kebab menu → **Edit / Clone / Disable** → `/dashboards/cs/playbooks/:id/edit`.
- A seed being edited creates an **override** row (`base_id` set); "Clone" creates a net-new (`base_id=null`).

## Builder form (reuses Segments predicate builder)
1. **Identity:** name, group (NHÓM 1–4), priority (cao/tb/thap).
2. **Condition:** the existing **Segments predicate builder** (AND/OR tree of Cube members) — already the filter UI; threshold rule kind (percentile / ratio / abs / event / tierStep) layered on top with live calibration preview ("≈ N users qualify now").
3. **Watched metric:** Cube measure picker + KPI target string.
4. **Action:** text, channel multiselect (in-game / Zalo ZNS / call / push), SLA minutes.
5. **Data-readiness (live):** as members are picked, the availability resolver runs against the game's `/meta` — a member missing for the game flags the playbook **unavailable** inline (can't enable until data exists). Mirrors the monitor's badge.
6. **Save** → POST/PATCH `care_playbooks`; appears in monitor immediately via merged read.

## Related files
- Create: `src/pages/Dashboards/cs/playbook-builder.tsx`, `condition-step.tsx` (wraps Segments predicate builder), `use-playbook-mutations.ts`; routes `/dashboards/cs/playbooks/new` + `/:id/edit`.
- Modify: monitor header ("+ New playbook"), grid row kebab (Edit/Clone/Disable); `server/src/routes/care-playbooks.ts` (POST/PATCH/DELETE override rows + RBAC: editor/admin only).
- Read: `src/pages/Segments/editor/` (predicate builder to embed), `server/src/care/playbook-merge.ts`, `availability.ts`.

## Implementation steps
1. Override CRUD routes (create/clone/edit/disable; RBAC editor+admin; seeds protected from delete).
2. Builder page: identity + condition (embed predicate builder) + watched metric + action steps.
3. Live calibration preview + inline availability check per picked member.
4. Monitor entry points (header button + row kebab).
5. Tests: edit seed → override row + merged read reflects it; clone → net-new; pick missing member → blocked-from-enable; RBAC denies viewer writes.

## Todo
- [ ] override CRUD + RBAC + seed-protection
- [ ] builder form (4 steps, predicate builder embedded)
- [ ] live calibration preview + inline availability gate
- [ ] monitor "+ New" + per-row Edit/Clone/Disable
- [ ] tests

## Success criteria
- CS edits seed "04 Spend drop" ratio → override persists, monitor reflects new threshold, seed config untouched.
- CS clones it into a net-new playbook with a custom condition; it appears in the grid with correct availability.
- Picking a member absent for jus_vn blocks enabling that playbook for jus_vn (but may be enabled for cfm_vn).

## Risks
- Free-authored predicates could be expensive/raw-cube → builder warns + blocks enabling cohort-scan playbooks on raw `etl_*` (steer to mart members), consistent with Phase 1/4.
- Threshold misconfig → calibration preview must show resulting cohort size before save (guard empty/oversized cohorts).
