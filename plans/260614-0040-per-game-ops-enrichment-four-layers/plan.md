---
title: "Per-Game Ops Enrichment — Four Cross-Cutting Data Layers (cfm + jus)"
description: "Add monetization, acquisition, identity/behavior, and CS-depth layers as game-scoped cubes sourced from the iceberg catalog, wired into views/catalog/segments/dashboards/care surfaces — MVP monetization layer ships first."
status: in-progress
priority: P2
effort: ~6d (cfm+jus only; template roll-out to 6 other games deferred)
branch: main
tags: [cube, enrichment, monetization, identity, cs, acquisition, freshness, per-game, iceberg]
created: 2026-06-14
---

# Per-Game Ops Enrichment — Four Cross-Cutting Data Layers

Add FOUR cross-cutting data-model layers into the existing per-game Cube metrics, sourced from the
**`iceberg` catalog** (canonical / prod-aligned). Cubes live in `cube-dev/cube/model/cubes/{cfm,jus}/`
and game-scope EITHER by joining the game's `mf_users` spine on the GDS-snowflake `user_id`, OR by
filtering on the game's `product_code`(s) — never by a bare unscoped id. Build/test cfm + jus only this
round; template must be roll-out-ready to the other 6 local games. **The P0 monetization layer ships
standalone first; identity/CS/acquisition layers follow incrementally (do not block monetization on them).**

## Source catalog: `iceberg` (canonical) — `stag_iceberg` removed

`iceberg` is the canonical, prod-aligned, regularly-updated source. `stag_iceberg` is exploration-only
(not regularly refreshed) and is **no longer a source** for any cube in this plan — mention it only as an
exploration fallback if a table is missing from `iceberg`. All cube `sql_table` / `sql` refs use
fully-qualified 3-part `iceberg.<schema>.<table>` names (cross-catalog from the `game_integration` Trino
session is proven — see `cube/model/_shared/segment_membership.yml:15-16` resolving a cross-catalog ref;
`iceberg` reachability empirically confirmed by introspection 2026-06-14).

### Verified source tables + join keys (iceberg, empirically probed 2026-06-14)

| Layer | Table (iceberg) | Grain | Rows | Freshness | Game scope | Join to mf_users |
|-------|-----------------|-------|------|-----------|-----------|-------------------|
| Monetization (LIVE) | `billing.std_billing_delivery_trans_gds` | transaction | 58.6M | hourly | `product_code` | `user_id` IS the GDS snowflake → joins `mf_users.user_id` DIRECTLY (per-game auto scope, like recharge.yml) |
| Monetization lifetime | `billing.pmt_users_history` | user×product_code | 18.5M | daily | `product_code` | `user_id` direct; PK (user_id, product_code) |
| Monetization monthly (opt) | `billing.pmt_users_monthly` | user×product×month | 51.1M | daily | `product_code` | `user_id` direct |
| Scope map | `mdm.map_product_code` | product_code | 1.23K | batch | — (the map) | `product_code → game_id` (+ `gds_bundle_code`) |
| Identity profile | `gds_da.etl_user_profile` | (game_id, user_id) | 3.25M | daily | `game_id` | direct `(game_id const + user_id)` |
| Identity profile (broad) | `vga.std_all_game_user_profile` | (game_id, user_id) | 400.6M | daily | `game_id` | direct `(game_id const + user_id)` |
| Identity profile (alt) | `vnggames.std_user_profile` | (game_id, user_id) | 1.17M | daily | `game_id` | direct `(game_id const + user_id)` |
| Behavior/geo events | `gds_da.etl_sdk_login` | login event | 285M | daily | `game_id` | direct (event grain — DEFERRED cube; PII heavy) |
| CS ticket | `cs_ticket.cs_ticket_info` | ticket | 4.67M | 2-day lag | via `customer_id` | `customer_id → customers_v2.product_id` then product_id→game |
| CS ticket enriched | `cs_ticket.cs_ticket_report` | ticket | 4.66M | 2-day lag | `product_id` | same customer_id bridge (99.9%) |
| CS bridge | `cs_ticket.customers_v2` | customer×product | 12.66M | — | `product_id` | PRIMARY CS bridge (customer_id, 99.9% match) |
| CS actions | `cs_ticket.cs_ticket_logs` | action | — | 2-day lag | `product_group` | inherits ticket's customer_id |
| CS CSAT | `cs_ticket.cs_rating_processes` | rating process | — | 2-day lag | inherits ticket | inherits ticket |

**Resolved product_code(s) (probed 2026-06-14):** cfm spans **two** product_codes — `A49` (game_id `cfmvn`,
gds_bundle_code `cfm_vn`) AND `267` (`cfmobile`); jus = `A70` (`jusvn`, `jus_vn`). Phase 1 must resolve and
filter on ALL of a game's product_codes. **CS namespace caveat:** `cs_ticket.customers_v2.product_id` uses
the `267` namespace for cfm — a DIFFERENT product_code value than billing's `A49`. Phase 1 must reconcile
BOTH (billing product_code vs CS product_id) → game.

**Gross revenue only:** NO refund/chargeback/reversal table exists anywhere in iceberg (confirmed across all
8 monetization schemas). Monetization cubes expose GROSS revenue only (`revenue_vnd_gross`); document the gap.
Follow-up: sample `WHERE payment_charged_amount < 0` rows in `std_billing_delivery_trans_gds` to check whether
refunds are negative-amount rows (unresolved Q).

**Acquisition / CAC stays deferred (user decision):** `iceberg.appsflyer.map_appsflyer_games` is DEAD (27 rows,
1 active = tpg) → per-game CAC bridge unavailable. BUT `cube-dev/cube/model/cubes/{cfm,jus}/marketing_cost.yml`
EXISTS (spend/CPC/CPM + media_source at channel grain) — so **channel-grain CAC is computable today**; only
bundle-level CAC is blocked. `mdm.map_product_code.gds_bundle_code` is a POSSIBLE future bundle-level CAC bridge
(follow-up, not this round).

## Locked decisions (user-confirmed, verbatim — do NOT re-litigate)

1. **Games: cfm + jus ONLY this round** (live-data games). Template roll-out-ready to the other 6.
2. **Acquisition: best-effort, DEFER bundle-level CAC.** Expose mf_users acquisition dims + channel→LTV +
   channel-grain CAC (marketing_cost exists). Bundle-level CAC + `gds_bundle_code↔game` cost bridge = follow-up.
3. **Surface depth: data models + exploration surfaces + consumer surfaces** — (a) new per-game cubes,
   (b) extend each game's `user_360` view, (c) members browsable in Playground/Catalog, (d) segment dimensions,
   (e) dashboard cards, (f) Care-console / member360 hooks.
4. **Freshness: expose ALL layers, TAG each cube/member with a freshness tier.** See advisory note below.

## Freshness tier — ADVISORY, not runtime-enforced

| Tier | Meaning | iceberg sources | Use |
|------|---------|-----------------|-----|
| `live` | current to yesterday | `billing.std_billing_delivery_trans_gds` (hourly), `billing.pmt_users_*` (daily), `gds_da.etl_user_profile` (daily), mf_users-derived acquisition | live dashboards, segment gating |
| `lagging` | 1–4 days/months behind | `cs_ticket.*` (2-day lag), `vga.std_all_game_user_profile` (daily but broad) | triage / historical; not live SLA alerting |
| `archive` | frozen / superseded | stale snapshots (do not source) | reference only |

The `[freshness: live|lagging|archive]` token in each cube `description:` (+ optional `meta: { freshness }`)
is **an ADVISORY label** — nothing reads it at runtime today; it is a string the chat-agent and Catalog UI
surface verbatim. It is NOT an enforcement guard. A real freshness gate (e.g. in
`server/src/lakehouse/segment-metric-registry.ts`) is OPTIONAL and requires explicit user sign-off — do NOT
describe the tag as "enforced" / "guarded" anywhere. Phase 7 adds a UI badge; that is a label, not a block.

## MVP cut (ships first, standalone)

The P0 monetization layer must ship without waiting on the lagging CS / broad-identity layers. Monetization KEEPS the
existing `user_recharge_daily` (authoritative daily revenue) and ADDS two billing enrichment cubes; no duplicate
daily-payer cube is built. Named MVP cubes:

1. KEEP `user_recharge_daily` (cfm, jus) — authoritative ingame daily revenue (unchanged); + KEEP `mf_users` LTV dims.
2. `billing_detail` — txn→user×day×breakdown from `billing.std_billing_delivery_trans_gds`: payment
   method/gateway/store/item + charged-vs-delivered amounts + promo (`promotion_type` + promo-charged measures), LIVE.
   ADDITIVE enrichment, not a revenue replacement.
3. `billing_lifetime` — user×product lifetime from `billing.pmt_users_history`, a canonical-billing LTV cube to
   CROSS-CHECK against ingame mf_users LTV, LIVE.
4. `user_geo` — geo/identity from `gds_da.etl_user_profile`, LIVE.
5. `lifecycle_profile` — lifecycle from `vga.std_all_game_user_profile`, lagging-ish.
6. `cs_ticket_detail` — CS ticket cube via the 99.9% `customer_id→product_id` path, lagging (2-day).

Each cube is authored ONLY after its key passes the Phase-1 match-rate GO/NO-GO gate. Orphan cubes (no named
Phase-7 consumer) are DEFERRED — see Phase 8 / red-team #15.

## Phases (incremental — monetization layer is independently shippable)

| # | Phase | Status | Depends on | One-line |
|---|-------|--------|------------|----------|
| 1 | [Identity-bridge foundation](phase-01-identity-bridge-foundation.md) | ✅ DONE | — | GO/NO-GO gate run; bridge-spec written. Monetization GO (100%/99.99%); identity GO-lagging (vga, etl_user_profile lacks cfm/jus); CS GO game-aggregate (member-join ~23%/9.5%, FB-bottlenecked); jus channel→LTV BLOCKED (attribution/spend disjoint); cfm billing=A49-only; jus mixed-currency; CS product_id 856/832. |
| 2 | [Monetization / payer-360 cubes](phase-02-monetization-payer360-cubes.md) | ✅ DONE (pre-agg→8) | 1 | `billing_detail` + `billing_lifetime` authored cfm+jus, compile + execute via Cube /load, game-isolated, currency-aware, promo dims, gross-only. Reconciliation ran: gateway≈1.78× ingame (Apple pricing), canonical stays ingame. Pre-agg deferred to Phase 8. |
| 3 | [Identity cube](phase-03-identity-behavior-cubes.md) | ✅ DONE (consolidated) | 1 | ONE `user_identity` cube from `vga.std_all_game_user_profile` (etl_user_profile lacks cfm/jus); geo/lifecycle/channels; `[freshness: lagging]`; PII public:false; events cube DEFERRED. |
| 4 | [CS depth cube](phase-04-cs-depth-cubes.md) | ✅ DONE | 1 | `cs_ticket_detail` from `cs_ticket_report` via product_code (100% game-scope) + customer_id→customers_v2→mf_users member join (gated, honest unresolved_member_tickets); CSAT/sentiment/VIP/resolution; coexists with cs-ticket-reader.ts; lagging. |
| 5 | [Acquisition best-effort](phase-05-acquisition-best-effort.md) | NO NEW CUBE | 1 | cfm channel→LTV composable today over standardized mf_users + marketing_cost (media_source 99.3% for payers); jus channel→LTV BLOCKED (0 rows with attribution+spend). Realized as view composition in Phase 6 (cfm) + documented blocker (jus). |
| 6 | [View + catalog wiring + freshness](phase-06-view-catalog-freshness-wiring.md) | ✅ DONE | 2 (then 3,4,5) | cfm/jus `user_360` view extended per-layer (4 ops panels + geo_moved); advisory freshness tag + meta on every ops cube; catalog auto-discovers (meta-driven, no allowlist). |
| 7 | [Consumer surfaces](phase-07-consumer-surfaces.md) | PARTIAL | 6 | DONE: member360 ops panels + Details "Ops" tab; tokenless `GET /api/segments/:id/members` protected via `redactSensitiveMembers` (strips monetization/CS/VIP cols for unauthenticated callers — satisfies red-team #11 PII goal) + `public:false` PII deny-list on cubes. REMAINING: dashboard cards (design-token surfaces); segment-metric-registry live monetization row (needs a new mart or binding path — non-trivial). |
| 8 | [Tests + pre-aggs + validation](phase-08-tests-preaggs-validation.md) | PARTIAL | 7 | DONE: vitest (member360 data-layer, redaction, ops-tab contract). REMAINING: CubeStore pre-agg build verification for `billing_detail` (date-prune, routing via COMPILED-SQL); big-cube guard test for `billing_detail` in `cube.js`; ground-truth WITH real_users_only; playwright; deploy/rollback (push to `second` → auto-deploy). |

## Key dependencies / ground truth (verified)

- **Per-game model loads ALL YAMLs in `model/cubes/<game>/` at request time** (`cube-dev/cube/cube.js:335-354`
  `repositoryFactory`). A cube in `cubes/{game}/` only compiles into that game's model — but folder-compile alone
  does NOT game-scope a cross-cutting table: the table carries another game's rows too. Each cube MUST filter on
  the game key (`product_code` for billing/CS, `game_id` for gds_da/vga identity) OR join the game's mf_users on
  the GDS snowflake `user_id`. A bare unscoped `user_id` join risks matching a collided id from another game.
- **One bad YAML fails the WHOLE game model compile** (`cube.js:348-350` reads every `.yml`); `DEV_MODE=false` ⇒
  no hot reload (`segment_membership.yml:12`). Land cubes with an isolated compile-check; restart `cube_api` to
  pick up new rollups. See Phase 8 deploy/rollback.
- **`mf_users` is the join spine** (`cube-dev/cube/model/cubes/cfm/mf_users.yml`, jus :1-417), PK `user_id`
  (GDS snowflake). **jus mf_users is NOT identical to cfm**: jus does a `max()`-merge over dual identity rows
  (`jus/mf_users.yml:2-35`) — acquisition dims resolved via merge, not a plain column. Phase 5 must handle this.
- **Bridge pattern to copy:** `cube-dev/cube/model/cubes/cfm/recharge.yml:42-63` — bridge SQL in the cube `sql:`
  block, never in app code. For billing the bridge is trivial (`user_id` IS the snowflake → direct join).
- **`real_users_only` filter is mandatory** for bridged revenue cubes — unbridged rows inflate revenue ~100x
  (`recharge.yml:11-21,17-21`). Every monetization cube needs a matched/non-dummy `user_id` filter equivalent.
- **member-resolver** (`src/lib/cube-member-resolver.ts`, `server/src/services/cube-member-resolver.ts`) is
  passthrough on `local`; new logical names auto-flow. Never hardcode physical cube names in app code.
- **Catalog auto-discovers members** from Cube `/meta?extended=true` (`src/pages/Catalog/use-catalog-meta.ts:104`)
  — registering = make it compile + add `meta`/`description`. No catalog code change for browse (verify, don't assume).
- **segment-metric-registry is evidence-gated AND mart-bound** (`server/src/lakehouse/segment-metric-registry.ts:1-19`)
  — entries are BARE mart tables under the game schema, derived/YAML-internal metrics are NOT representable. New
  monetization rows are a registry EXTENSION (only after Phase-1 probe pass), not a one-liner.
- **TOKENLESS members endpoint** `GET /api/segments/:id/members` (`server/src/routes/segments.ts:458-465`) serves
  preset member columns unauthenticated (`server/src/services/member-profile-runner.ts:103-118` builds dims/measures
  from `memberColumns`). New monetization/CS/VIP dims added to a preset would flow through it token-free —
  RESOLVED by red-team #11: Phase 7 auth-gates this endpoint before any such dim enters a preset.
- **Big-cube scan guard** lives in `cube-dev/cube/cube.js:91-120` (`BEHAVIOR_VIEWS` + `TIME_DIM_FIELDS`). Any new
  big event cube must be added there or it escapes the unbounded-query 4xx guard.
- **Pre-agg routing is read by COMPILED SQL, not `usedPreAggregations`** (`server/src/services/preagg-readiness.ts:15-21`:
  lambda unions mask `usedPreAggregations` to empty). Phase 8 asserts the FROM-clause route, not that field.
- **Trino introspection:** `cube-dev/examples/trino_q.py` (REST client; fully-qualify `iceberg.<schema>.<table>`).

## Top risks

1. **Identity-bridge mismatch / wrong game key** (High×High) — a cross-cutting table joined on the wrong key or an
   unscoped id silently zero-matches (looks empty), fans out (inflates), OR leaks another game's rows. Phase 1
   gates everything: every bridge empirically probed (match-rate + one-row-per-grain + game-isolation proof)
   before any cube trusts it; GO/NO-GO threshold ≥70% or BLOCKED.
2. **Event-table scan blowup** (Med×High) — `gds_da.etl_sdk_login` (285M) fans out and explodes scans. DEFER the
   events cube (no Phase-7 consumer yet); if ever authored, separate event grain + mandatory date-prune + CubeStore
   pre-agg + registration in `cube.js` big-cube guard.
3. **Revenue inflation from unbridged rows** (High×High) — without a `real_users_only`-equiv filter, unbridged/dummy
   rows inflate revenue ~100x. Mandatory filter on every monetization cube; Phase-8 ground-truth compares WITH it.
4. **Duplicating / misreading existing cubes** (Med×Med) — billing cubes must not be mistaken for the canonical daily
   revenue (that stays `user_recharge_daily`); CS cube overlaps `cs-ticket-reader.ts`. Phase 2 KEEPS `user_recharge_daily`
   and adds billing as enrichment (no duplicate); a reconciliation probe documents the gateway-vs-delivery gap. Phase 4
   reconciles the CS reader.
5. **Tokenless PII exposure** (High — user policy) — new monetization/CS/VIP dims on a preset flow through the
   currently-unauthenticated members endpoint. RESOLVED: Phase 7 auth-gates `GET /api/segments/:id/members`
   (`segments.ts:458-465`) BEFORE any such dim enters a preset; every new cube also carries an explicit `public:false`
   PII deny-list (phone/email/IP/device/staff-id) as defense in depth.

## Red Team Review

15 accepted findings from the 4-reviewer red-team. Several are RESOLVED by the iceberg flip (the original
stag_iceberg join hazards no longer apply). All evidence re-verified against the codebase 2026-06-14.

| # | Finding | Sev | Disposition | Applied to |
|---|---------|-----|-------------|------------|
| 1 | Folder-compile ≠ game-scoped; shared tables carry a game key | Crit | Applied — mandate product_code / game_id filter or mf_users join in every cube; removed "leak-impossible/verified" language | plan.md, phase-01 (criterion), phase-02 |
| 2 | Cubes must use fully-qualified `iceberg.<schema>.<table>`; driver reachability | Crit | Applied + VERIFIED (iceberg reachable; cross-cat ref cites segment_membership.yml:15-16) | plan.md, phase-01 (check) |
| 3 | P0 bridge GO/NO-GO gate | Crit | Largely RESOLVED by iceberg (billing.user_id = GDS snowflake → direct mf_users join); kept ≥70% threshold + fallback to `user_recharge_daily` | phase-01, phase-02 |
| 4 | "Port from prod" reframed | Crit→down | Applied — only measure/dim SHAPES port; dev cubes read iceberg directly; lifetime table = `pmt_users_history` (verified) | phase-02 |
| 5 | Freshness tag is ADVISORY, not enforced | Crit | Applied — downgraded all "guard/enforce" language to "advisory label"; real gate optional + needs sign-off | plan.md, phase-06, phase-07 |
| 6 | Big event cubes escape `enforceBehaviorBounds` | Crit | Applied — mandate adding new big cubes to BEHAVIOR_VIEWS + TIME_DIM_FIELDS (cube.js:91-120) + 4xx test; events cube DEFERRED anyway | phase-03, phase-08 |
| 7 | Phase-8 must NOT assert `usedPreAggregations` (lambda masks) | Crit | Applied — use compiled-SQL FROM-clause routing; reuse preagg-readiness.ts + cubestore-query-cache-check.ts | phase-08 |
| 8 | Every bridged cube needs `real_users_only`-equiv filter (~100x inflation) | High | Applied — mandate filter; phase-8 ground-truth WITH filter | phase-02, phase-08 |
| 9 | `payer_daily` duplicates existing `user_recharge_daily` (built lambda); view multi-fact fan-out | High | RESOLVED — no duplicate built: KEEP `user_recharge_daily` authoritative; ADD `billing_detail` (different grain: method/promo/cash breakdown) + `billing_lifetime` (LTV cross-check). Reconciliation probe reports gateway-vs-delivery gap (canonical unchanged); phase-6 multi-fact whale query test + user_360-safe measure list | phase-02, phase-06 |
| 10 | False "no media-cost cube" — `marketing_cost.yml` EXISTS | High | Applied — corrected; channel-grain CAC computable today, only bundle-level blocked | phase-05 |
| 11 | New dims flow through UNAUTHENTICATED members endpoint | High (user policy) | Accept — auth-gate scoped into Phase 7: add auth to `GET /api/segments/:id/members` (`segments.ts:458-465`) BEFORE any monetization/CS/VIP dim enters a preset; keep `public:false` PII deny-list as defense in depth | plan.md, phase-07, unresolved-questions.md |
| 12 | segment-metric-registry = bare marts, excludes derived; phase-7 row-add is a registry extension | High | Applied — reconcile vs existing STD_RECHARGE binding; extension only after probe pass | phase-07 |
| 13 | CS join: split_part ~8% → iceberg customer_id 99.9% | High | RESOLVED by iceberg — replaced framing; `cs_ticket_new_master`/`cs-ticket-reader.ts` is a raw reader NOT a cube; coexist + reconciliation | phase-04 |
| 14 | jus mf_users acquisition dims NOT identical to cfm (max()-merge) | High | Applied — phase-5 channel→LTV handles jus attribution-merge hazard | phase-05 |
| 15 | Over-build + sequencing + deploy-safety | High | Applied — MVP cut (4 cubes), incremental per-layer phases, defer orphan cubes, deploy/rollback subsection, phase-7 dims demoted to verification, member360/Care reuse cites actual reader | plan.md, phase-01, phase-03, phase-06, phase-07, phase-08 |

**Resolved-by-iceberg (no longer a hazard):** #3 (billing.user_id is the GDS snowflake → direct join, no fragile
bridge), #13 (CS 99.9% via customer_id, not 8% split_part). #4 partially (lifetime table confirmed). The rest are
applied as plan changes.

### Whole-Plan Consistency Sweep (2026-06-14)

- **No `stag_iceberg` source refs remain** in any phase or plan.md. (`stag_iceberg` appears ONLY in
  `cube/model/_shared/segment_membership.yml`, which is a pre-existing snapshot cube OUTSIDE this plan's scope;
  cited only as cross-catalog-ref proof, never as a new source.) Old `scout-…-stag-iceberg-…` report no longer
  drives sourcing — superseded by the four `iceberg` schema-map reports.
- **No "cross-game leak impossible / verified" language remains** — phase-02 architecture and plan.md risks
  rewritten to "folder-compile does NOT game-scope; explicit key filter required".
- **All source tables now 3-part `iceberg.*`** and match the verified table list above.
- **Freshness language is uniformly "advisory"** across plan.md / phase-06 / phase-07 (no "enforce/guard" claim).
- **Old table names purged:** `pmt_user_daily`, `mf_payment_user_history`, `pmt_billing_ff_callback_trans`,
  `vga.ingame_user_profile`, `mf_ip2location`, `thinking_data.*` → replaced with verified iceberg equivalents.

See [unresolved-questions.md](unresolved-questions.md) for build-gating open items.

## Validation Log

User validation decisions applied 2026-06-14 (confirmed — not re-litigated):

1. **Payment model = keep existing + add billing-detail + add lifetime cross-check.** KEEP `user_recharge_daily`
   (authoritative daily ingame revenue) and `mf_users` LTV dims; do NOT build a duplicate daily-payer cube (resolves
   red-team #9). ADD `billing_detail` (txn-grain breakdown: payment method/gateway/partner/provider, item, store,
   charged-vs-delivered amounts, promo) scoped per-game via `mf_users.user_id` direct join + `product_code` filter
   (cfm=A49+267, jus=A70), mandatory matched-user_id filter, gross-only. ADD `billing_lifetime` from `pmt_users_history`
   as a canonical-billing LTV cube to cross-check ingame mf_users LTV. → phase-02.
2. **Canonical revenue = ingame stays authoritative; billing = enrichment.** A REQUIRED reconciliation probe compares
   billing `payment_charged_amount` (gateway cash) vs ingame `revenue_vnd` (delivery) for a known user/day and REPORTS
   the gap + cause; canonical source NOT switched (different funnel points → gap expected). → phase-02 success criteria.
3. **Members-API PII = auth-gate before exposing monetization dims** (resolves red-team #11). REQUIRED sub-task: add
   auth to `GET /api/segments/:id/members` (`server/src/routes/segments.ts:458-465`) BEFORE any monetization/CS/VIP dim
   enters a preset's `memberColumns`; keep `public:false` PII deny-list as defense in depth. → phase-07; red-team #11
   disposition flipped open→Accept.
4. **Promo decomposition = IN SCOPE this round.** Model promo-aware ARPU (`promotion_type` dim + promo-charged vs
   cash-charged measures) in `billing_detail` now; txn grain → pre-aggregate per the lambda pattern + big-cube scan-guard
   registration if it qualifies (red-team #6). → phase-02.

**Verification:** skipped heavy re-verify — the Red Team Review already carries codebase evidence (file:line citations
re-verified 2026-06-14); these are decision confirmations, not new claims.

### Whole-Plan Consistency Sweep (validation pass, 2026-06-14)

Grepped all phase files + plan.md for contradictions the 4 decisions could introduce:
- **No lingering "duplicate payer_daily" framing** — all `payer_daily` references reframed to "KEEP `user_recharge_daily`
  + ADD `billing_detail`/`billing_lifetime`" (plan.md MVP cut, Phases table, risks, red-team #9; phase-02 throughout).
  Note: the term `payer_daily` survives ONLY inside red-team #9's finding *title* (historical finding text) with a
  RESOLVED disposition — intentional, not a stale source ref.
- **No "members API open decision" left unresolved** — plan.md red-team #11 = Accept; Key-dependencies tokenless line =
  RESOLVED; phase-07 = required auth-gate sub-task; unresolved-questions.md #5 = RESOLVED.
- **No "promo deferred" text** — promo decomposition is explicitly IN SCOPE in phase-02 and the Validation Log; no phase
  defers it.
- **Zero unresolved contradictions** introduced by the 4 decisions.
