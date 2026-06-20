# CS Activation Platform — End-to-End Design Walkthrough

**Anchor use case:** `days_since_last_login >= 3` for top-2 VIP tiers (NTH / jus_vn)
**Purpose:** trace one trigger from raw data to a measured CS outcome, separating the **centralized data layer** (platform, reusable for any segment) from the **product layer** (CS domain, any team can build). Goal is two-fold: (1) surface the product/business questions that are easy to overlook, and (2) pin down enough logic, queue and state-machine detail to be implementable — including how each piece serves re-entry handling, holdout, and treatment-effectiveness insight.

> Scope guard: this doc designs **one** playbook end-to-end. Every mechanism here is meant to generalize, but we deliberately reason through a single concrete trigger so the corners are visible.

---

## 0. The one-paragraph shape

The platform emits **versioned, reproducible membership snapshots** of "who matches a rule" each cadence tick, and diffs consecutive snapshots into **entry/exit deltas**. The product layer treats the **entry delta** (not the standing set) as the CS trigger, runs each candidate through an ordered **eligibility pipeline** (8 gates), reserves a **holdout at the moment of entry**, and admits survivors into a **stateful task queue**. CS works the queue; the **exit delta** drives self-resolution; CS logs the action; the platform measures the **outcome from the same pipeline** and rolls per-run results into a **treatment-effect library**. The seam between the two layers is a single, generic data contract: a snapshot + its delta.

---

## 1. Two layers and the contract between them

```
┌─────────────────────────── CENTRALIZED DATA LAYER (platform) ───────────────────────────┐
│  reusable for ANY segment, not just CS                                                    │
│                                                                                           │
│   definition (versioned SQL)  ──▶  snapshot per tick  ──▶  delta {entered,exited,stayed}  │
│                                         │                          │                       │
│                                  freshness/availability      outcome-metric                │
│                                  declaration                 measurement (same pipeline)   │
└───────────────────────────────────────────┬───────────────────────────────────────────────┘
                                             │  CONTRACT = (definition_version, as_of_ts, members[]) + delta
                                             ▼
┌─────────────────────────────── PRODUCT LAYER (CS domain) ─────────────────────────────────┐
│  any team can build; full of domain-specific business rules                               │
│                                                                                           │
│   entry-event trigger ─▶ eligibility pipeline (8 gates) ─▶ holdout split ─▶ task queue     │
│        ▲                                                          │            │           │
│   exit delta ──────────────── self-resolution ───────────────────┘     task lifecycle FSM │
│                                                                              │             │
│                                                          CS-side outcome writeback         │
│                                                          + member-360 / delivery surface   │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

**Design rule:** anything *generic across all segments* belongs to the platform (snapshots, diffing, freshness, outcome measurement). Anything *domain-specific to how CS works* belongs to the product (triggering policy, cooldowns, arbitration, queue lifecycle). The product shouldn't re-derive deltas; the platform shouldn't bake in CS cooldown rules.

---

## PART A — CENTRALIZED DATA LAYER

### A1. The snapshot contract: `(definition_version, as_of_ts, members[])`

One snapshot = the answer to *"who was in this segment, by which rule, at what moment."*

| Field | Meaning | Why it must be explicit |
|---|---|---|
| `definition_version` | which rule produced the set (the exact SQL/threshold/scope) | the day someone edits 3→5 days or changes the tier scope, it's a **new version**; sets from different versions are not comparable and must never be silently diffed |
| `as_of_ts` | the clock the rule was evaluated against | "≥3 days" is meaningless without an anchor; this is what makes a snapshot **reproducible** — same `(version, as_of_ts)` ⇒ identical set, always |
| `members[]` | the uids satisfying `definition_version` at `as_of_ts` | the raw set, nothing more |

Reads as: *"By rule v2, as of 2026-06-21 00:00 Asia/Saigon, these 1,240 VIPs had not logged in for ≥3 days."*

**Repo status:** snapshot persistence exists (`segment-snapshot-writer`, `segment-definition-writer`, snapshot-log migration 048).

#### ⚠ Overlooked questions — trigger semantics
- **What is "login"?** Account login, character/role login, or any authenticated session? A player can be account-logged-in daily but not playing. Pick the event that maps to the *business* notion of "absent."
- **What anchor — midnight or rolling 72h?** And **in whose timezone** — server or player-local? A player in a different region crosses "3 days" at a different wall-clock instant.
- **Late-arriving / backfilled data:** if login logs land late or a backfill corrects history, a player could *retroactively* enter or exit a past snapshot. Do we re-emit corrected snapshots (and risk disturbing tasks already actioned), or freeze snapshots as-observed? This is a governance decision, not a code detail.

### A2. The delta: `diff vs previous snapshot → {entered[], exited[], stayed[]}`

Pure set arithmetic over two **same-version** snapshots:

```
entered = today.members − yesterday.members      (newly matching → the CS trigger)
exited  = yesterday.members − today.members       (left the segment → self-resolution signal)
stayed  = today.members ∩ yesterday.members        (still matching → must NOT re-fire)
```

Worked example, rule v2, daily cadence:

```
Jun 19  members = {A, B, C}                       (first snapshot; nothing to diff)
Jun 20  members = {A, C, D, E}
        entered = {D, E}   → CS trigger today
        exited  = {B}      → B logged back in
        stayed  = {A, C}   → already known, do NOT re-fire
Jun 21  members = {A, D, F}
        entered = {F}
        exited  = {C, E}
        stayed  = {A, D}
```

The standing list on Jun 20 has 4 people but CS should act on **2** (`entered`). The diff is what converts an ever-growing standing pool into a small, correct daily work feed — and because it's generic, the platform computes it once for *every* segment.

**Why the standing set is unusable directly:** `days_since_login >= 3` only grows — a player idle 200 days still matches. Feed the standing set to a queue and you get millions of rows and a queue that never drains. The **entry event** (the day they cross 3) is the signal; the standing set is not.

**Repo status:** delta computation exists (`segment-delta-writer`, `segment-movement-reader`).

### A3. Freshness / availability declaration

Cadence is **not** a free choice of daily-vs-hourly. It is:

```
effective_cadence = min(desired_cadence, upstream_data_availability)
```

`days_since_login` computed off a **daily** login ETL cannot be fresher than daily, no matter how often the job runs. The platform must **declare** the freshness it can actually deliver per definition, and the product's SLA indicator must reflect the truth, not the wish.

**Repo status:** availability-gating pattern exists in the care POC (`availability.ts`).

#### ⚠ Overlooked questions — freshness
- For this trigger, is daily enough? (No-login is inherently a slow signal; hourly buys little.) Reserve hourly/minutes for triggers where it matters (payment-fail, sentiment).
- If upstream is late on a given day, does the product layer **skip** that tick (no trigger fired) or **run on stale data** with a freshness warning? Skipping risks missing entrants; running stale risks calling people about week-old absence.

### A4. Outcome-metric measurement (same pipeline)

The metric that decides whether the contact "worked" must be measured by the **same platform**, off the same definitions — not a side spreadsheet. For this use case: *did the player log back in within the attribution window?* (and/or recharge). Crucially, this metric must be **declared at playbook-creation time**, so you cannot cherry-pick the metric after seeing results.

**Repo status:** outcome/series readers + treatment-effect library exist (`segment-metric-series-reader`, `treatment-effect-library`, migrations 053/060/066).

---

## PART B — PRODUCT LAYER

### B1. Entry-event triggering + scoping

- **Trigger = `entered[]`**, never `members[]`.
- **Scope** at the definition level (top-2 VIP tiers) so the standing set is already small, and re-assert scope as a cheap gate (defense in depth).
- `stayed[]` is explicitly ignored as a trigger — this is the mechanism that stops re-alerting on a player every day they remain idle.

### B2. The eligibility pipeline (admission state machine)

Each cadence tick hands the engine `entered[]` (say 1,240 candidates). The engine is an **ordered pipeline of gates**; each gate returns one of four verdicts:

- **ADMIT** → next gate
- **SUPPRESS** → drop, record reason, done
- **DEFER** → not now, re-evaluate next tick (carry forward)
- **REROUTE** → hand to arbitration

```
                 entered[]  (1,240 candidates this tick)
                     │
            ┌────────▼─────────┐
            │ 1. ACTIONABLE?    │  contactable identity + owning team exists?
            └────────┬─────────┘  no → SUPPRESS:no_identity
            ┌────────▼─────────┐
            │ 2. SCOPE          │  in top-2 VIP tiers?  no → SUPPRESS:out_of_scope
            └────────┬─────────┘
            ┌────────▼─────────┐
            │ 3. SUPPRESSION    │  opted-out / DND / truly-churned /
            └────────┬─────────┘  already in another live campaign? → SUPPRESS:suppressed
            ┌────────▼─────────┐
            │ 4. COOLDOWN /     │  contacted in last N days? playbook fired recently?
            │    FREQUENCY CAP  │  weekly cap hit? → DEFER:cooldown
            └────────┬─────────┘
            ┌────────▼─────────┐
            │ 5. DEDUP          │  already an OPEN task for (player, playbook)?
            └────────┬─────────┘  → SUPPRESS:already_queued
            ┌────────▼─────────┐
            │ 6. ARBITRATION    │  qualifies for >1 playbook today?
            └────────┬─────────┘  pick highest-priority; losers → DEFER:lost_arbitration
            ┌────────▼─────────┐
            │ 7. HOLDOUT SPLIT  │  deterministic hash(player, experiment_id)
            └───┬──────────┬───┘
         control│          │treatment
                ▼          ▼
        record to     ┌──────────────────┐
        experiment,   │ 8. CAPACITY       │  queue has room today vs CS throughput?
        NEVER queue   └───┬──────────┬───┘
        (HELD_OUT)        │admit     │full
                          ▼          ▼
                      ENQUEUED   DEFER:capacity (carry, ranked)
```

1,240 in → maybe **47** `ENQUEUED`. The other ~1,193 each exit at a **named gate with a reason code**. The engine emits an **admission ledger**, not just a queue — without it you cannot answer "why didn't VIP X get called?" or tune the gates. (No silent caps.)

**Two ordering decisions that are easy to get wrong:**
- **Holdout split sits after gates 1–6, before capacity.** Treatment and control must have passed *identical* filters to be comparable; biased filtering ⇒ biased lift. Capacity is a treatment-delivery concern and must not touch control.
- **Capacity DEFERs, it does not SUPPRESS.** A dropped treatment task is a delivery failure that muddies measurement — carry it forward, ranked by priority.

**Properties that make it trustworthy:**
- **Idempotent** — re-running the same tick over the same `entered[]` yields the same admissions. Holdout hash keyed on `(player, experiment_id)` so the split never drifts.
- **Re-entry aware** — cooldown + dedup stop a player bouncing idle/active daily from generating a task each day, while a genuinely fresh re-entrant after a long gap is admitted (see B4).

**Repo status:** the care POC's `care-case-engine` / `calibrate` / `playbook-registry` cover parts of gates 1–4 and capacity; arbitration + admission-ledger are the net-new pieces.

#### ⚠ Overlooked questions — eligibility (mostly *who owns the number?*)
- **Cooldown length** per playbook and **global cross-playbook cap** — who sets these? (e.g., max 1 proactive contact / VIP / 7 days across all playbooks.)
- **Suppression list ownership** — who maintains opt-out / DND, and is there **consent/legal** basis for proactive outreach to this tier?
- **"Already in another live campaign"** — is there a campaign registry (CDP/Tesseract) to check against, or are playbooks blind to each other?
- **Arbitration priority** — static priority order, or value-weighted (whale > high-roller)? Who arbitrates ties? (deep-dive candidate)
- **Capacity** — how many proactive contacts/day can CS sustain for top-2 tiers, pooled or per-agent? This number caps the entire product's throughput.

### B3. The task lifecycle (post-admission state machine)

Once `ENQUEUED`, a task is a stateful object the product layer owns:

```
QUEUED ──assign──▶ ASSIGNED ──pick up──▶ IN_PROGRESS ──log contact──▶ CONTACTED
   │                  │                      │                            │
   │                  │                      │                            ▼
   │                  │                      │                    OUTCOME_PENDING
   │                  │                      │                  (attribution window open)
   │                  │                      │                     │            │
   │                  │                      │                win  │            │ no effect
   ▼                  ▼                      ▼                     ▼            ▼
 (any pre-contact) ── player logs back in ─▶ SELF_RESOLVED   CLOSED_WIN  CLOSED_NO_EFFECT
 (any pre-contact) ── TTL elapsed ─────────▶ EXPIRED
 (any state)       ── opt-out / churn fires ▶ SUPPRESSED_LATE
```

The valuable exits are the non-obvious ones:

- **SELF_RESOLVED** — player appears in `exited[]` (logged back in) *before* CS contacted them. Problem fixed itself; close, don't call. This is the direct feedback of the platform's **exit delta** into the task machine.
- **EXPIRED** — sat past TTL without contact; a no-login-3d alert is stale after ~a week. Don't let CS call someone about being idle on two-week-old data.
- **SUPPRESSED_LATE** — eligibility re-checks **open** tasks too; a later opt-out pulls the task from the queue.
- **CLOSED_WIN / CLOSED_NO_EFFECT** — only resolvable after the attribution window closes, by measuring the outcome metric. "Win" is defined against the **control group**, not absolute return (see B5).

#### ⚠ Overlooked questions — lifecycle
- **Self-resolution policy:** auto-close on re-login, or still send a "soft touch"? The re-login may be coincidental; some teams want the relationship touch regardless. **Business call.**
- **TTL length** — when is this trigger stale?
- **What counts as "contacted"** — attempt vs reached? No-answer → retry how many times, over how long, before EXPIRED?
- **Outcome writeback mechanics** — does CS log in their existing tool and we sync back, or do they work our queue UI directly? Writeback latency affects when CLOSED_* can resolve.

### B4. Re-entry handling (cross-cutting)

A player who exits then re-enters is the trickiest case and touches every component:

- **Bouncing daily** (idle→active→idle): cooldown + dedup gates suppress repeat tasks. The *length* of cooldown is the knob.
- **Fresh re-entry after a long gap:** legitimately a new candidate → admit. Define the gap that resets eligibility.
- **Holdout stability on re-entry:** must the player keep their *original* treatment/control arm, or re-randomize? Keeping it stable avoids contamination (a control suddenly getting treatment); but if the playbook *version* changed since, the old arm may be stale. **Decision needed** — recommended default: arm is stable per `(player, experiment_id)`, and a new experiment_id (new playbook version) re-randomizes.
- **Identity collisions:** one human with multiple uids/roles. Dedup at the **human** level or **uid** level? Contacting the same person twice via two characters is a real failure mode.

### B5. Holdout + experiment tracking

- **Reserved at entry, frozen, excluded from queue.** Deterministic `hash(player, experiment_id) → {treatment, control}` at the instant of qualification. Control is recorded identically but **never enqueued**. Picking the holdout after CS works the list bakes in selection bias and destroys measurement.
- **Sizing for power:** VIP base rates are small and the population is small, so the holdout must be large enough to detect a plausible lift — which directly trades against the cost of withholding care.
- **Attribution window + win definition:** declared up front. "Win" = treatment reactivation rate > control reactivation rate over the window, not "this player came back."

**Repo status:** frozen-split / experiment registry exists (migration 060), feeds the treatment-effect library (migration 053).

#### ⚠ Overlooked questions — holdout & measurement (the highest-stakes corner)
- **Ethics/business of withholding care from whales.** Is it acceptable to *not* proactively help a paying top-tier VIP to keep a clean control? Likely a **per-tier policy**: measure on lower tiers, exempt the very top (and accept you lose clean causal proof there).
- **Attribution window length** — 7d / 14d / D30? Longer = cleaner signal but slower learning.
- **Win metric** — reactivation (logged back in), recharge, or retained-at-D30? Can be multiple, but must be pre-declared.
- **Contamination / spillover** — control whale hears about a treatment gift via community/Discord. Small VIP communities are tight; this is a real threat to validity.

### B6. Context bundle + delivery surface

A uid is not actionable. Each queue item carries a **member-360 bundle**: name, VIP tier, last-login, LTV, recent CS tickets, recommended script/offer — so the agent acts without hunting. Plus: **where it lands** (existing CS console / queue UI / export to CDP/Tesseract), **who owns** each VIP, a **freshness/priority** stamp.

**Repo status:** member-360 exists in the care POC.

#### ⚠ Overlooked questions — delivery
- Where do CS agents actually work — our UI or their tool? Determines integration surface and writeback path.
- **Ownership model:** round-robin pool vs each VIP permanently assigned to a named agent (relationship management). This reshapes assignment + priority design entirely. **Business call.**

---

## 2. Minimal data model (enough to implement)

**Platform side**
- `segment_definition(version_id, sql, scope, login_event_def, anchor_tz, created_by, created_at)`
- `segment_snapshot(version_id, as_of_ts, member_uid)` — the set
- `segment_delta(version_id, as_of_ts, uid, transition ∈ {entered,exited,stayed})`
- `definition_freshness(version_id, declared_cadence, last_upstream_ts)`
- `outcome_metric(playbook_id, metric_def, attribution_window)` + measured series

**Product side**
- `playbook(id, definition_version, priority, cooldown_days, ttl_days, holdout_pct, holdout_policy, win_metric, owner_team)`
- `admission_ledger(tick_ts, uid, playbook_id, verdict, gate, reason)` — every candidate's fate
- `task(id, uid, playbook_id, experiment_id, arm, state, assigned_to, created_at, contacted_at, closed_at, close_reason)`
- `contact_log(task_id, agent, channel, action, attempted_at, reached)`
- `experiment(id, playbook_version, split_seed)` + `experiment_member(experiment_id, uid, arm, entered_at)`

---

## 3. End-to-end trace (one player)

```
Jun 20  Player D appears in entered[] (rule v2, as_of Jun20 00:00, daily).
        Eligibility: actionable✓ scope✓(Vô Song) suppression✓ cooldown✓ dedup✓
                     arbitration: also tripped no-recharge-7d → no-login loses (lower priority) → DEFER:lost_arbitration
        → D is NOT queued for no-login today; queued for the higher-priority playbook instead.

(alternate) Jun 20  Player E: passes all gates → holdout split hash(E, exp_17)=treatment
        → capacity has room → ENQUEUED. Control twin (some other uid) recorded, never queued.
Jun 21  E assigned to agent → contacted (gift + check-in) → OUTCOME_PENDING, 7d window.
Jun 24  E appears in exited[] (logged back in). Task already CONTACTED → stays OUTCOME_PENDING.
Jun 28  Window closes. Treatment reactivation (incl. E) = 42% vs control 31% → +11pp.
        Task → CLOSED_WIN. Result rolls into treatment-effect library for "no-login-3d outreach".
```

---

## 4. What exists vs net-new (repo reality check)

| Capability | Layer | Status |
|---|---|---|
| Versioned reproducible snapshots | platform | **exists** (snapshot/definition writers, mig 048) |
| Entry/exit/stayed delta | platform | **exists** (delta writer, movement reader) |
| Freshness/availability declaration | platform | **pattern exists** (care `availability.ts`) |
| Outcome-metric measurement | platform | **exists** (metric-series reader, treatment-effect lib) |
| Entry-event triggering + scoping | product | small new glue over existing delta |
| Eligibility gates 1–4 + capacity | product | **partial** (care-case-engine, calibrate, playbook-registry) |
| Arbitration + admission ledger | product | **net-new** |
| Task lifecycle FSM + self-resolution | product | **net-new** (the core build) |
| Holdout-at-entry + experiment tracking | product | **machinery exists** (mig 060), needs wiring to queue |
| CS-side outcome writeback | product | **net-new** (depends on delivery surface) |
| Member-360 + delivery surface | product | **POC exists** (care) |

**Honest headline:** most *data-layer* primitives already exist. The genuinely new build is the product layer's **arbitration + admission ledger + task-lifecycle FSM + writeback** — i.e., the part that turns a segment into a CS workflow. That's also the part that should live with the domain team, because it is full of business rules (cooldowns, arbitration order, self-resolution, holdout policy) the platform must not hard-code.

---

## 5. Decisions that are genuinely the business's to make

These shape everything downstream and cannot be defaulted by engineering:

1. **Self-resolution:** if a player logs back in before contact — auto-close, or still send a soft touch?
2. **Holdout on top-tier VIPs:** withhold proactive care from whales to measure lift, or exempt the very top tier (losing clean causal proof there)? Likely per-tier.
3. **Queue ownership:** round-robin pool vs named-agent-per-VIP relationship model.
4. **Cooldown + global frequency cap** numbers, and **arbitration priority order** across playbooks.
5. **Win metric + attribution window** per playbook (pre-declared).
6. **Login definition + anchor timezone** for the trigger itself.
7. **Backfill policy:** re-emit corrected snapshots (disturbing actioned tasks) or freeze as-observed?

## 6. Open questions (unresolved)

- Is there an existing **campaign registry** (CDP/Tesseract) the suppression gate can query for "already in another campaign," or are playbooks mutually blind today?
- **Consent/legal** basis for proactive outreach to VIP tiers — does it exist, and does it differ by channel?
- **Identity grain** for dedup: is there a reliable human-level key across a VIP's multiple uids/roles, or only uid?
- **CS working surface:** do agents work our queue UI or their existing tool — and what is the writeback latency/path?
- **Holdout re-randomization on playbook-version change** — confirm the recommended default (stable per experiment_id, re-randomize on new version) is acceptable to the measurement owner.
