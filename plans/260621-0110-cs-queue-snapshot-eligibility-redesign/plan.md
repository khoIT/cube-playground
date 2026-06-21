# CS Queue Redesign — snapshot → eligibility → enqueue, demonstrated on Playbook 14

**Status:** PLAN (no code changed). Awaiting decisions in §6.
**Demo target:** `/#/dashboards/cs/queue?game=cfm_vn&playbook=14` — Playbook 14 = **No-login ≥ 3 days** (global seed id 14), the exact anchor use case in the end-to-end design doc.
**Second deliverable:** re-map the playbook set for **jus_vn** to VIP-Requirements-NTH-V2 (19 triggers). Spec in §5.

Context: design doc `plans/reports/cs-activation-platform-design-260621-0026-days-since-login-3d-end-to-end-report.md`.

---

## 1. Key finding — the pipeline already runs; it's just invisible

The scout confirmed the Care POC already implements most of the doc's model. The redesign is therefore **mostly a visibility problem**, plus three thin backend gaps.

| Doc model stage | Already exists | Where | Gap to close |
|---|---|---|---|
| Daily snapshot | ✓ | `care_sweep_runs` + `care_sweep_membership` (mig 041/043); 6h auto-sweep cron | none (cadence is 6h, not daily — see §6 Q4) |
| entered / exited / stayed delta | ✓ (entered/exited) | `membershipDiff()` care-case-engine.ts:27; `diffMembers()` care-sweep-run-store.ts | `stayed` not surfaced; delta not exposed to UI |
| VIP-floor + availability gate | ✓ | `VIP_LTV_FLOOR=1M` care-case-sweep.ts; availability.ts | per-gate **drop counts not recorded** |
| cooldown / suppression | ✓ | fatigue.ts + `care_governance` (mig 038) | verdict computed at display time, not recorded on the case |
| dedup | ✓ | unique partial `ux_open_case` (mig 037) | — |
| arbitration (multi-match) | ✓ | care-case-multi-match-order.ts | not shown as a gate |
| capacity | ✓ | `COHORT_CAP=50k`, `SWEEP_CONCURRENCY=6` | not a CS-throughput cap (acceptable for demo) |
| holdout / control arm | ⚠ machinery only | `experiments`+`experiment_assignment` (mig 060) | **not wired into sweep**; cases carry no arm |
| task lifecycle | ✓ | `care_cases.status` new→in_review→treated→resolved/dismissed | self-resolution = `condition_lapsed` flag, not surfaced |
| outcome writeback | ⚠ stub | `recordResult()` treatment-effect-library.ts (deferred) | out of scope for this demo |

**The queue page today** (`src/pages/Dashboards/cs/case-ledger.tsx`, route `src/index.tsx:257`) shows three flat lenses (By-Playbook / By-VIP / Sweeps). It never shows *why* a VIP is in the queue, the snapshot it came from, what was dropped, or holdout arm. That is the redesign.

---

## 2. Redesigned page — Playbook 14 single-playbook command view

When `?playbook=14` (single id) is present, replace the flat By-Playbook table with a **pipeline-legible command view** that reads top→bottom as snapshot → eligibility → queue. Reuse the existing page-header pattern (padding `24px 32px`, maxWidth 1320, Inter, brand icon + 20px/700 title) and semantic tokens — no new visual system.

```
┌─ HEADER ─ ‹ back · ◷ No-login ≥ 3 days  [playbook 14 · churn · cao]   cfm_vn ▸ ─┐
│            snapshot 2h ago · daily cadence · next sweep 04:00            [Run sweep] │
├─ ① SNAPSHOT & DELTA (new) ──────────────────────────────────────────────────────┤
│   Cohort today 1,240   ▲ Entered 47   ▼ Exited 31   = Stayed 1,193                │
│   (from diff of latest vs prior care_sweep_membership for playbook 14)            │
├─ ② ELIGIBILITY FUNNEL (new) ────────────────────────────────────────────────────┤
│   Entered 47 → VIP-floor → availability → cooldown(defer) → dedup → arbitration   │
│   → holdout(control reserved) → capacity → ENQUEUED  · each gate shows −N + reason │
│   collapsible "why" per gate; reads the admission-ledger counts                   │
├─ ③ THE QUEUE (redesigned) ──────────────────────────────────────────────────────┤
│   [Fresh today N] [Carried M] [Self-resolved K] [Held-out · view-only H]          │
│   row: VIP (name·tier·LTV) | state | eligibility verdict | arm | days_since=N |   │
│         last contact | [Next action →]                                            │
└───────────────────────────────────────────────────────────────────────────────────┘
```

- **① Snapshot strip** — makes the platform's spine visible. `Entered` is the trigger; `Exited` feeds self-resolution; `Stayed` is the carried pool (must not re-fire). Daily-cadence + freshness stamp from `care_sweep_runs`.
- **② Eligibility funnel** — the doc's 8 gates, but using the Care POC's real gates (VIP-floor, availability, cooldown/fatigue, dedup, arbitration, holdout, capacity), each with a recorded drop count and reason. Mirrors the artifact funnel; honest "no silent caps."
- **③ Queue segments** — the existing case list, split by the lifecycle truth that already exists: **Fresh today** (entered + admitted this sweep), **Carried** (stayed, still open), **Self-resolved** (`condition_lapsed=1`, exited pre-contact), **Held-out** (control arm — shown for transparency, not actionable). Row click opens existing Member-360 care drawer (`/dashboards/cs/members/:uid?tab=care`), extended with arm + outcome target ("returns within 7d").

When `?playbook` is absent or multi-valued, keep today's By-VIP / multi-lens behaviour unchanged. The command view is **only** the single-playbook case — scoped exactly to the demo.

---

## 3. Backend gaps to close (thin; one migration)

1. **Record per-gate admission counts** — extend the sweep to emit, per (run, playbook), the count dropped at each gate with a reason code → new table `care_admission_ledger` (migration **067**) or columns on `care_sweep_playbook_results`. Without this the funnel can't show real numbers. (~gate set already computed; we just persist the tallies.)
2. **Snapshot+delta+funnel endpoint** — `GET /api/care/cases/snapshot?game&playbook` returning `{ as_of, cadence, cohort, entered, exited, stayed, gates[] }` from `care_sweep_membership` diff + the admission ledger.
3. **Wire holdout arm at enqueue** — when an experiment is `running` for the playbook's segment, assign arm from `experiment_assignment`; stamp `care_cases.experiment_id` + `arm`; **exclude control from the actionable queue** but list under Held-out. (Resolves scout open-Q5.) Add `experiment_id`,`arm` columns to `care_cases` in mig 067.

Frontend: new focused component (e.g. `cs/queue-playbook-command-view.tsx`, kept <200 lines, composed of `SnapshotStrip` + `EligibilityFunnel` + `QueueSegments`) mounted by `case-ledger.tsx` when single-playbook. Reuse existing hooks; add `useCareSnapshot(game, playbook)`.

---

## 4. Phasing

- **Phase 0 — jus_vn 19-playbook re-map** (§5). Data/override only; independent; ships first.
- **Phase 1 — backend**: migration 067 (admission ledger + case arm columns) + record gate counts in sweep + `snapshot` endpoint. No holdout yet.
- **Phase 2 — frontend redesign**: SnapshotStrip + EligibilityFunnel + QueueSegments for `?playbook=14`. Demonstrable end of phase.
- **Phase 3 — holdout wiring**: arm at enqueue, Held-out segment, outcome target in Member-360.

---

## 5. jus_vn re-map to VIP-Requirements-NTH-V2 (19 triggers)

**DECISION (locked): jus_vn gets its own 01–19 keyspace matching V2 exactly** (per-game numbering, not global seed ids). cfm_vn keeps the global 21-seed ids untouched — so the demo URL `?game=cfm_vn&playbook=14` stays valid. The 19 jus_vn entries reuse the underlying seed *logic* (condition/metric/action) but expose a jus_vn-local id `01`–`19`.

**Content result: V2's 19 = the 21 seed concepts minus {first-deposit, spend-spike}.** So each jus_vn 01–19 row links to a seed for logic reuse (`base_id`), with per-game overrides for scope/condition/priority, plus the jus_vn-local id.

Implementation implication (raises Phase 0 effort vs the global-id option): the `care_playbooks` override table keys on `(game_id, base_id)`. To carry a per-game id we add a `local_id` column (migration 067 or a small dedicated one) and resolve jus_vn playbooks by `local_id`; the frontend/URL for jus_vn uses `local_id`, while cfm_vn continues to use the global seed id. A resolver maps jus_vn `local_id` → backing seed logic. (`base_id` may be NULL for any jus_vn trigger that needs net-new logic.)

The table below: **"jus_vn id" is the new per-game key (01–19)**; "Seed" is the backing logic concept.

| jus_vn id | Seed | Trigger (NTH) | Group | Priority | Scope | Condition override | jus_vn availability today |
|---|---|---|---|---|---|---|---|
| 01 | 02 | Đạt ngưỡng tier VIP | payment | cao | top-2 | tier reached (Vô Song/Truyền Thuyết) | ✓ available (LTV) |
| 02 | 04 | Giảm spending (Churn Pay) | churn-risk | cao | top-2 | **7d** no recharge since last | ✓ available (recharge mart) |
| 03 | 05 | Lỗi nạp / payment failed | payment | cao | top-2 | failed_count **>2** in one session | ✗ blocked (no source) |
| 04 | **14** | Không đăng nhập ≥3d | churn-risk | cao | top-2 | days_since_active **≥3 flat** (drop tier-step) | ✓ available |
| 05 | 15 | Online time giảm mạnh | churn-risk | cao | top-2 | **≥40% below 7d-avg, 3 consec days** | ✓ available (session mart) |
| 06 | 16 | Ticket tiêu cực | churn-risk | cao | top-2 | sentiment=neg or {bug,complaint,refund} | ✗ blocked (no ticket source) |
| 07 | 06 | Đạt top BXH server | ingame | tb | **all users** | rank ≤ 10 | ✗ unavailable (no gameplay) |
| 08 | 07 | Tăng cấp ngoại trang | ingame | tb | all users | cosmetic unlock event | ✗ unavailable (no event) |
| 09 | 08 | Rank drop / loss streak | ingame | cao | top-2 | drop >5 in 48h OR >5 PvP losses | ✗ unavailable |
| 10 | 09 | Đỉnh vinh quang (Top-1) | ingame | cao | all users | Top-1 / tournament win | ✗ unavailable |
| 11 | 10 | Biến động Bang hội | ingame | cao | top-2 | guild downgrade / war loss | ✗ unavailable |
| 12 | 11 | Collector FOMO | ingame | thap | all users | owns ≥4/5 of limited set | ✗ unavailable |
| 13 | 12 | Gacha bad-luck | ingame | cao | top-2 | past pity threshold | ✗ unavailable (no raffle) |
| 14 | 13 | Cảm xúc tiêu cực (Sentiment) | ingame | cao | top-2 | neg keyword scan (world/guild chat) | ✗ blocked (no sentiment) |
| 15 | 17 | Rời bang / giải tán bang | ingame | tb | (unscoped) | guild leave/disband | ✗ unavailable |
| 16 | 18 | Kỷ niệm ngày chơi | event | cao | top-2 | **365-day only** (drop 30/90/180/730) | ✓ available (first_active date) |
| 17 | 19 | Trước patch lớn | event | tb | top-2 | days_until_patch ≤3 (manual calendar) | ⚠ partial (ops-driven) |
| 18 | 20 | Ra mắt môn phái / server | event | tb | top-2 | new faction/server (ops) | ⚠ partial (ops-driven) |
| 19 | 21 | Sinh nhật người chơi | event | tb | top-2 | birth_date = today | ✗ blocked (no demographics) |

**jus_vn tier ladder (NTH / VNGGames Club, by total NTH recharge):** Vô Song ≥200tr · Truyền Thuyết ≥100tr · Lưu Ly ≥50tr · Quỳnh Ngọc ≥30tr · Vàng ≥10tr · Bạc ≥3tr · Đồng ≥150k · Tân Thủ. **"2 tiers cao nhất" = Vô Song + Truyền Thuyết (≥100tr)** — a jus_vn-specific tier floor that must override the generic `VIP_LTV_FLOOR=1M`. Needs a per-game tier config (new small config or `care_governance` extension).

**Trino-reconfirmed availability (2026-06-21, `game_integration.jus_vn`, 43 tables):**
- **Fully available** (raw data present + derivable): jus_vn **01** tier (`mf_users.ingame_total_recharge_value_vnd`), **02** churn-pay (`ingame_last_recharge_date` / `std_ingame_user_recharge_daily`), **04** no-login (`mf_users.ingame_last_active_date`) ⭐ demo, **05** session-drop (`etl_ingame_login`+`etl_ingame_logout` / `std_ingame_user_active_daily`), **16** anniversary (`ingame_first_active_date`).
- **Derivable but unmodeled** (data exists, needs modeling): **08** cosmetic-unlock (`etl_ingame_item_flow`), **11/15** guild signals — **NEW: `etl_ingame_login.guild_id` exists**, so guild membership/leave is derivable from the event stream (upgrades these from "unavailable").
- **Unavailable** (no jus_vn table): **07** rank/BXH, **09** rank-drop/PvP, **10** achievement Top-1, **12** collector-set, **13** sentiment — no leaderboard / PvP / gacha / chat-sentiment tables exist.
- **Blocked / cross-cutting** (not in `game_integration`): **03** payment-failure, **06** negative-ticket (iceberg.cs_ticket, ~8% join), **19** birthday (no demographics).
- **Ops-driven:** **17** pre-patch, **18** new-server (manual calendar).

So **~5 fire today, ~3 more are a modeling effort away** (item-flow, guild via login.guild_id), the rest need new upstream data. Re-mapping defines all 19; the availability resolver gates what actually fires. Matches jus_vn's known coverage.

---

## 6. Decisions

**Locked (2026-06-21):**
1. **Numbering** — ✅ **renumber jus_vn 01–19** (per-game keyspace matching V2). cfm_vn keeps global seed ids; demo URL unaffected. See §5 for the `local_id` implication.
3. **Holdout (demo)** — ✅ **no holdout for the demo**. Held-out segment is rendered structurally but empty; no care withheld. Arm-wiring deferred to Phase 3 when a live experiment exists.
4. **Cadence** — ✅ **keep the 6h auto-sweep**, label the snapshot honestly ("freshest available · ~6h"). No daily lane for no-login.
5. **Self-resolution** — ✅ **auto-close → Self-resolved segment** when `condition_lapsed=1`; no soft touch.

**Still to confirm:**
2. **jus_vn tier floor** — confirm "2 tiers cao nhất = Vô Song + Truyền Thuyết (≥100tr)" and that we add a per-game tier config overriding the flat `VIP_LTV_FLOOR=1M`. Confirm the "all users" set (jus_vn ids 07,08,10,12 per V2) is correct.
6. **Demo scope** — confirm the command view applies ONLY to the single-playbook view (`?playbook=14`); multi/no-playbook lenses stay as-is.

## 7. Out of scope (this plan)
Outcome writeback / treatment-effect measurement (deferred stub stays), CS-throughput capacity caps, generalizing the command view to all playbooks, any cfm_vn registry changes.
