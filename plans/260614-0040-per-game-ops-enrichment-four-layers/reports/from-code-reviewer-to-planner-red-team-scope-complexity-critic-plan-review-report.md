# Red-Team Plan Review — Scope & Complexity Critic + Contract Verifier

**Plan:** 260614-0040-per-game-ops-enrichment-four-layers
**Reviewer lens:** YAGNI enforcer (over-engineering, premature abstraction, scope creep) + Contract Verifier (deliverable↔consumer trace)
**User's narrow ask:** "add all 4 layers into the per-game metrics, respect the per-game filter." Locked: cfm+jus only; acquisition best-effort (CAC deferred); consumer surfaces in scope; freshness tagged.
**Verdict:** The 4-layer data-model core (Phases 1–4) is justified. But the plan over-builds: 20 new cubes (10×2 games), a behavior cube with no consumer, a CAC "blocker" that is partly false, and a serial 8-phase chain that needlessly delays the P0 live monetization layer. Phase 7 segment-dimension work duplicates an auto-discovery path the plan itself documents.

---

## Finding 1: `marketing_cost` cube already exists with per-game CAC inputs — Phase 5's "no media-cost cube anywhere" premise is factually wrong

**Severity:** High
**Location:** phase-05-acquisition-best-effort.md:22-24, :41, :56; unresolved-questions.md:8; plan.md:23-24
**Flaw:** Phase 5 and the locked-decision text repeatedly assert "CAC spend cube + bundle_code↔game_id map do not exist in either repo → out of scope" and "no media-cost cube anywhere." This is false. `cube-dev/cube/model/cubes/cfm/marketing_cost.yml` AND `cube-dev/cube/model/cubes/jus/marketing_cost.yml` already exist, both backed by `std_marketing_cost_all_channels_by_game` — a table that is **game-scoped by name and by per-game directory placement**. It exposes `cost_native` / `cost_usd` / `cost_vnd` measures plus `media_source` / campaign / adset dims, and its own header comment states it is "to compute CAC/CPI/CPC/CPM."
**Failure scenario:** Phase 5 writes `deferred-cac-followup.md` documenting a blocker that is only half-real, then ships an `acquisition_ltv` view that omits cost — when channel-grain CAC (cost_vnd by media_source ÷ installs by media_source from mf_users) is computable **today** with zero new tables. The team defers strategically valuable, already-available data based on a false premise. The genuine blocker (`bundle_code↔game_id`) applies only to *bundle-level* CAC, not *channel-level* CAC.
**Evidence:** `cube-dev/cube/model/cubes/cfm/marketing_cost.yml:1-12,102-140` (cost_vnd/cost_usd/CPC/CPM measures, comment "to compute CAC/CPI/CPC/CPM"); `cube-dev/cube/model/cubes/jus/marketing_cost.yml:11-12,114-124` (same source, jus). Plan's own Phase 5 read-list at phase-05:41 lists `marketing_cost.yml` as "what cost data, if any, exists locally" — the plan half-knows this but the prose still says none exists.
**Suggested fix:** Correct the locked-decision wording: CAC *spend* exists per channel; what is deferred is *bundle/SKU-level* CAC attribution (the bundle_code map). Either (a) add a channel-grain `cost_per_install` / `roas` measure composing `marketing_cost` × `mf_users` install counts in the acquisition view — small, high-value, no new scan — or (b) explicitly state in the locked decision that channel-CAC is intentionally deferred too and *why*, so the team doesn't rediscover marketing_cost mid-build and thrash on scope.

---

## Finding 2: `behavior_profile` cube (thinking_data, lagging, 198M-row family) has no consumer in Phase 7 — modeled "because it's there"

**Severity:** High
**Location:** phase-03-identity-behavior-cubes.md:24,42,51,59; phase-07-consumer-surfaces.md:31-34,52-57
**Flaw:** Phase 3 authors `behavior_profile.yml` (cfm+jus) from `thinking_data.{game}__user_profiles` (4-month lagging). Phase 7's consumer list — segment dims (payer/geo/churn/CSAT/VIP/acquisition), dashboard cards (payer-360, geo/churn, CS/CSAT, acquisition-channel), member360 facts (monetization/identity/CS) — **never names behavior_profile**. The "identity" layer cards are geo/churn (from `user_geo` + `lifecycle_profile`), not behavior. No app-code references thinking_data/behavior anywhere.
**Failure scenario:** A lagging cube is authored, freshness-tagged, view-wired (Phase 6), and pre-agg-considered (Phase 8) for a 198M-row source — pure modeling + maintenance cost with zero downstream read. It bloats user_360, the catalog, and the chat-agent's member space with a member nothing consumes, exactly the "198M-row lagging cube no dashboard/segment reads is pure cost" anti-pattern.
**Evidence:** No consumer trace — `grep -rn "thinking_data|behavior_profile|__events" src/ server/src/` returns nothing. Phase 7 requirement (phase-07:31-34) lists payer-360/geo-churn/CS/acquisition cards only. Phase 3 itself already DEFERs the bigger `{game}__events` table (phase-03:53) — the same YAGNI logic should question `user_profiles` too.
**Suggested fix:** Defer `behavior_profile` to a follow-up unless Phase 7 names a concrete consumer (a card, a segment dim, or a member360 fact). If kept, the plan must add the consumer to Phase 7's deliverable list — a deliverable with no consumer is a Contract Verifier failure. Recommend cutting it from this round (it is lagging, so excluded from live decisions anyway).

---

## Finding 3: New `payer_daily` cube duplicates the existing `user_recharge_daily` cube — DRY violation at the cube level

**Severity:** High
**Location:** phase-02-monetization-payer360-cubes.md:13-18,46,52
**Flaw:** Phase 2 authors a new `payer_daily.yml` (user×product×day, revenue_vnd_gross, paying_users, ARPPU, payer tier, recency) from `billing.pmt_user_daily`. But `cube-dev/cube/model/cubes/cfm/user_recharge_daily.yml` **already exists per game** at user×day grain with `revenue_vnd`, `revenue_usd`, `revenue_vnd_iap/web`, `txn_count`, `payment_channel`, `vip_level`, `country_code`, AND a built lambda pre-agg. The plan justifies the new cube as "ADD the cross-cutting billing source," but the *only* concrete deltas it names over the existing cube are `bundle_code`/product grain and `npu/dpu` — and `npu/dpu` are flagged `public:false`/unverified (unresolved Q5).
**Failure scenario:** Two daily-revenue cubes per game with overlapping measures (`revenue_vnd` vs `revenue_vnd_gross`) confuse every consumer: chat-agent, segment-metric-registry, dashboard authors. Users get two different "daily revenue" numbers from two cubes sourced from two tables that may not reconcile, and nobody knows which is authoritative. This is the classic "second source of truth" trap.
**Evidence:** `cube-dev/cube/model/cubes/cfm/user_recharge_daily.yml:11,84-102` (existing user×day revenue cube with revenue_vnd/usd/iap/web/txn_count + mf_users join at :20-22 + lambda pre-agg per memory). Phase 2 read-list (phase-02:49) even lists user_recharge_daily as the cube to "mirror" — i.e. it knows the overlap exists.
**Suggested fix:** Before authoring `payer_daily`, the plan must state the *specific* measures `pmt_user_daily` provides that `user_recharge_daily` cannot (and why they can't be added as measures to the existing cube). If the delta is only `bundle_code` + unverified `npu/dpu`, prefer adding a `bundle_code` dim to the existing cube over a whole new cube. At minimum, the success criteria must include a reconciliation probe: `payer_daily.revenue_vnd_gross` vs `user_recharge_daily.revenue_vnd` for a known user — or the two-source confusion ships.

---

## Finding 4: Phase 7 "new segment DIMENSIONS" work largely duplicates the auto-discovery path the plan itself documents

**Severity:** Medium
**Location:** phase-07-consumer-surfaces.md:15,22-24,51-52,61; phase-06:17-19
**Flaw:** Phase 7 lists "new segment DIMENSIONS (payer tier, recency, geo-stability, churn-gap, CSAT/VIP, acquisition channel)" as a distinct deliverable and a todo. But the predicate member catalog is **meta-driven**: it fetches `/meta?extended=true` and returns dimensions for the segment's primary cube and every joinable cube — exactly like Catalog. Once the new cubes compile and join into user_360 (Phase 6), their dims appear in the segment editor with **no Phase 7 code**. The plan acknowledges this ("verify it picks them up automatically — same meta-driven pattern as Catalog," phase-07:22-24) yet still books it as work.
**Failure scenario:** Phase 7 is scoped/estimated as if "add segment dimensions" is build work when it's a *verification* step. Effort inflates; the team writes registration code for a path that's automatic, or worse, adds a redundant allowlist.
**Evidence:** `src/pages/Segments/editor/predicate-builder/use-predicate-member-catalog.ts:2-15` (fetches /meta?extended=true, returns dims for primary + joined cubes, module-cached) — same pattern as `src/pages/Catalog/use-catalog-meta.ts:104`. Phase 6 (phase-06:17-19) already confirms catalog auto-discovery needs no code change.
**Suggested fix:** Demote "new segment dimensions" from a build deliverable to a one-line verification step in Phase 7 ("confirm new cube dims auto-appear in predicate catalog; register only if an allowlist gates them"). The real Phase 7 build is: dashboard cards + member360/care hooks + segment-metric-registry rows. Re-scope effort accordingly.

---

## Finding 5: Needlessly serial dependency chain delays the P0 LIVE monetization layer behind P1/P2 cubes

**Severity:** Medium
**Location:** plan.md:44-53 (dependency table); phase-02:14; phase-06:8; phase-07:14; phase-08:14
**Flaw:** The chain is 1 → {2,3,4,5} → 6 → 7 → 8, fully serial at the integration tail. Phase 2 (monetization) is the *only* P0/live layer and the user's highest-value target, yet it cannot reach a consumer surface until Phases 3, 4, 5 (all P1/P2, mostly *lagging*) also finish, because Phase 6 (view wiring) `Depends on: 2,3,4,5` and Phase 7 `Depends on: 6`. Monetization is gated behind CS-depth and behavior cubes that are lower priority and lower freshness.
**Failure scenario:** The live payer-360 layer — the thing safe for live decisions and the clearest user win — ships last, bundled with lagging cubes that can't drive live decisions anyway. If CS-depth (Phase 4, ~8% match-rate, partial) stalls on the unresolved match-rate question, it blocks Phase 6, which blocks the already-finished live monetization layer from reaching dashboards.
**Evidence:** plan.md:51 `phase 6 Depends on 2,3,4,5`; plan.md:52 `phase 7 Depends on 6`; phase-02:13 ("P0 — the live monetization layer; the only family current to yesterday"); phases 3/4 are P1, phase 5 is P2.
**Suggested fix:** Make Phase 6/7 incremental per-layer instead of a barrier. Allow monetization (P0) to flow 1→2→6(payer slice)→7(payer card) and ship standalone, with identity/CS/acquisition layers wiring into the same view/surfaces as they complete. This unblocks the highest-value layer first and isolates the risky low-match CS layer from blocking everything.

---

## Finding 6: MVP cut — the smallest thing satisfying "4 layers respect per-game filter" is ~4 phases; the plan should name what's deferrable

**Severity:** Medium
**Location:** plan.md:6 (effort ~6d), :42-53; phase-03:51; phase-04:42-44; phase-02:48
**Flaw:** The plan books 20 new cubes across 8 phases for a user ask of "add the 4 layers, respect the per-game filter." It never states an MVP cut line, so everything reads as mandatory. Several cubes are clearly second-tier within their own layer: `payment_callback` (Phase 2, optional, lagging, provider-health — not a "layer"), `behavior_profile` (Finding 2, no consumer), `cs_action_log` + `cs_rating` (Phase 4 ships 3 CS cubes when `cs_ticket_detail` alone satisfies "CS layer respects per-game filter").
**Failure scenario:** ~6d of build produces a wide surface where half the cubes are lagging/optional/consumer-less, diluting review attention and pre-agg/test budget (Phase 8) across cubes that don't drive live decisions. The user's actual ask is satisfied by far less.
**Evidence:** Per-layer minimum to satisfy "4 layers respect per-game filter": Monetization = `user_recharge_daily` already exists + maybe `bundle_code` dim (Finding 3); Identity = `user_geo` (live) + `lifecycle_profile`; CS = `cs_ticket_detail`; Acquisition = view over existing mf_users dims (no new cube, phase-05:48 already offers fold-into-user_360). That's the 4 layers with ~3-4 *new* cubes, not 20.
**Suggested fix:** Explicit MVP cut — **keep:** Phase 1 (bridge proof, gates everything), Phase 2 reduced to live payer slice (or bundle_code dim on existing cube), Phase 3 reduced to `user_geo` + `lifecycle_profile`, Phase 4 reduced to `cs_ticket_detail`, Phase 5 as a view (no new cube), Phase 6/7 incremental. **Defer:** `payment_callback`, `behavior_profile`, `cs_action_log`, `cs_rating`, thinking_data `__events`. This still delivers all 4 layers respecting the per-game filter, at roughly half the cube count.

---

## Finding 7: Phase 1 over-introspects — 9 table-families × 2 games before any cube exists is a heavy gate

**Severity:** Medium
**Location:** phase-01-identity-bridge-foundation.md:30-34,49-60; unresolved-questions.md:7-14
**Flaw:** Phase 1 mandates DESCRIBE + sample + match-rate + grain + freshness probes for **9 table families × cfm/jus = 18 full bridge specs** before authoring a single cube, and it carries 8 unresolved questions, several of which (refund source Q1, npu/dpu semantics Q5, outbound-CS Q3) gate cubes that Finding 6 would defer anyway. The bridge proof is correct discipline, but its breadth is sized to the full 20-cube plan, not the MVP.
**Failure scenario:** Phase 1 becomes a multi-day Trino archaeology project gating *everything* serially (it's the root dependency for 2,3,4,5). Probing `payment_callback`, thinking_data `__events`, `cs_action_log`, `cs_rating` bridges — all for cubes that should be deferred — front-loads cost onto the critical path before the first cube ships.
**Evidence:** phase-01:30-34 (9 table families enumerated); plan.md:46 (Phase 1 "gates everything"); unresolved-questions.md Q1/Q3/Q5 gate net-revenue/outbound-CS/npu-dpu — all deferrable per Findings 3/6.
**Suggested fix:** Scope Phase 1 to the MVP bridges first: `pmt_user_daily` (Q8 only), `mf_ip2location`, `ingame_user_profile`, `cs_ticket_info`. Probe the deferred-cube bridges (callback, thinking_data, action_log, rating) only if/when those cubes are pulled into scope. This shrinks the critical-path gate and lets Phase 2 start sooner.

---

## Contract Verifier summary (deliverable ↔ consumer)

| Deliverable | Consumer in Phase 7? | Verdict |
|---|---|---|
| payer_daily | payer-360 card, member360, segment dims | OK (but see Finding 3 — overlaps existing cube) |
| payment_history | member360 (lifetime LTV) | OK |
| payment_callback | **none named** | Orphan — defer |
| user_geo | geo/churn card, segment geo-stability dim | OK |
| lifecycle_profile | churn-gap card/dim | OK |
| behavior_profile | **none named** | Orphan — defer (Finding 2) |
| cs_ticket_detail | CS/CSAT card, care tab, VIP dim | OK |
| cs_action_log | **none named** (compliance "future loop") | Orphan this round — defer |
| cs_rating | CSAT card | Partial — folding into cs_ticket_detail may suffice |
| acquisition_ltv | acquisition-channel card, organic/paid dim | OK as view; should include CAC (Finding 1) |

Three orphaned deliverables (payment_callback, behavior_profile, cs_action_log) have no consumer — they are modeled because the source exists, not because anything reads them.

---

## What the plan gets RIGHT (factual, not praise — to avoid bad cuts)

- member-resolver passthrough-on-local claim is **correct** (`src/lib/cube-member-resolver.ts:16,39,44-45` — strict no-op when prefix null). Phases correctly say "do NOT register physical names." No member-resolver code work is needed on local — confirmed, so no phase wastes effort there.
- Catalog auto-discovery claim is **correct** (`use-catalog-meta.ts:104` meta-driven). Phase 6's "no catalog code change" is right.
- Per-game scoping via `cubes/{game}/` directory + mf_users-join filter is sound.
- Freshness tagging in `description:` is a legitimate user-locked requirement, not creep — do not cut it.
- Consumer surfaces (cards, member360/care hooks) are user-locked scope — do not cut the *phase*; the issue is over-build *within* it (Finding 4: dims are auto, not built).

---

## Unresolved questions for planner

1. Does `pmt_user_daily` provide any revenue measure `user_recharge_daily` lacks, beyond `bundle_code` and unverified `npu/dpu`? If not, Finding 3 says collapse into the existing cube.
2. Is channel-grain CAC (marketing_cost.cost_vnd ÷ mf_users installs by media_source) acceptable for the acquisition layer, or did the user specifically want bundle-level CAC (the genuinely blocked part)? Resolving this decides whether Finding 1 adds a cheap CAC measure or stays deferred.
3. Is there a named consumer for `behavior_profile` / `cs_action_log` the plan didn't list, or are they speculative? If speculative, defer per Findings 2/6.
