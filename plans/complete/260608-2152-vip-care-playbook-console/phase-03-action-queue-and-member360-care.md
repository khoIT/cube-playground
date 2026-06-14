# Phase 3 · Case Ledger / VIP Action Queue + Member-360 Care Tab

**Priority:** high — where CS actually works.
**Status:** completed.
**Reference:** flow prototype surfaces ②③.

## Overview
Two lenses over the `care_cases` ledger + the per-VIP history tab. This is the stateful work surface (writes case state) — reached from the monitor, not a generic dashboard tile.

## Surfaces
1. **Case Ledger** with `By Playbook` / `By VIP` toggle:
   - *By Playbook:* single-playbook queue; each row shows the **stats snapshot at match time** + state pill (new/in_review/treated). Row → Member-360.
   - *By VIP (action queue):* `GET /api/care/cases/by-vip` — one row/VIP, cases deduped across playbooks, priority-ranked (registry `priority`), with **contact-fatigue guard** (Phase 5 supplies the cap; show ⚠/Deferred).
2. **Member-360 → Care history tab:** extends existing Member-360. Timeline of every case for the uid (open + treated + outcome), a **Recommended next action** panel (top open case → action+channel+SLA from registry, bundle hint), and **Mark treated · log outcome** (PATCH case).

## Related files
- Create: `src/pages/Dashboards/cs/case-ledger.tsx`, `action-queue.tsx`, `use-care-cases.ts`; `src/pages/Segments/member360/care-history-tab.tsx`, `recommended-action.tsx`.
- Modify: Member-360 view to add the Care tab (`src/pages/Segments/...member360...`); route `/dashboards/cs/queue`.
- Read: existing Member-360 (`server/src/routes/segment-member360.ts` + FE), `src/pages/Segments` member list.

## Implementation steps
1. `use-care-cases(game, mode, playbook?)` → list / by-vip.
2. `case-ledger` with segmented toggle; By-Playbook table (snapshot column) + By-VIP table (case chips, priority, last-contact/fatigue, "Take care"/"Deferred").
3. Member-360 Care tab: timeline + recommended-action panel + treatment form (PATCH `status→treated`, channel, notes).
4. Wire monitor → ledger (row click sets playbook) and ledger → Member-360 (uid).
5. Tests: PATCH treatment transitions case; by-vip dedup; snapshot vs live shown side-by-side.

## Todo
- [x] use-care-cases hook (both lenses)
- [x] Case Ledger + toggle + snapshot column
- [x] VIP Action Queue (dedup, priority, fatigue placeholder)
- [x] Member-360 Care tab + recommended action + treatment logging
- [x] navigation wiring + tests

## Success criteria
- A VIP in 2 playbooks appears **once** in By-VIP with both case chips + top-priority surfaced.
- Marking treated moves the case state and reflects in monitor "Open/Treated" counts.
- Care tab shows full cross-playbook history with KPI outcome tags.

## Risks
- Member-360 fan-out is row-level (out of preagg scope) — use existing precompute/cache; don't regress member-360 perf.
- Assignment = **shared pull pool**: `assignee` stamped on first action (PATCH). Optional **AM affinity** — if a VIP has a known account manager, the queue routes/sorts it to them first (flag-gated enhancement). No idle round-robin.
