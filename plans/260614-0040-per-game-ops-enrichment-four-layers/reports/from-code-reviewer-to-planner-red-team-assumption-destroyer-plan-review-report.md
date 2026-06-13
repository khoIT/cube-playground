# Red-Team Plan Review — Assumption Destroyer + Scope Auditor
**Plan:** 260614-0040-per-game-ops-enrichment-four-layers
**Reviewer lens:** Assumption Destroyer / Scope Auditor (hostile)
**Date:** 2026-06-14

Verdict: the plan's identity-bridge gating (Phase 1) is sound and honestly hedged. But the "port from prod" framing across Phases 2/3/4 is largely a **fantasy** — the prod cubes the plan names as port sources are built on a VGA central-identity graph (`vga__provider`/`vga__product_map`/`vga__client`/`vga__user_master`) that does NOT exist in the dev per-game model. What the plan calls a "port" is a near-total rewrite against different tables with a different join path. Several reuse claims for consumer surfaces are also wrong in load-bearing ways.

---

## Finding 1: "Port from prod" for monetization & CS is a rewrite, not a port — prod cubes depend on a VGA identity graph dev does not have
**Severity:** Critical
**Location:** plan.md:47,49; phase-02 lines 5-7,57; phase-04 lines 8,45; prod `cube-prod/cube/model/cubes/vga/vga_payment_history.yaml:6-34`; `vga/cs_ticket_report.yaml:20-25`; `vga/vga_cs_customer.yaml:8-39`; `vga/vga_user_master.yaml:5-30`
**Flaw:** Plan repeatedly says "Port recharge/user_recharge_daily patterns" and "Author payment_history.yml from vga_payment_history.yaml" / "Prod oracle to port: vga_cs_customer.yaml". But every prod `vga__*` cube scopes per-game and resolves identity through infrastructure that has ZERO presence in dev:
- `vga__payment_history` reads `iceberg.billing.pmt_users_history` (flat, all-games), gets game via `product_code → view_vga_map_product (vga__product_map) → client_id`, and joins `vga__provider` on `provider_id` to get a user. Its `user_id` IS `vga__provider.provider_id`, NOT `mf_users.user_id` (vga_payment_history.yaml:9,18-19,27,46).
- `vga__cs_customer` reads `iceberg.cs_ticket.customers_v2` and resolves game via `product_id → cs_map_product → view_vga_map_product → client_id`, joining `vga__provider` (vga_cs_customer.yaml:8-33). `user_id` = "VGA provider_id space (KHÔNG phải vga_id)" (line 24,49).
- `vga__user_master` = `iceberg.vga.latest_vga_user` (76M platform users), keyed on `id` = `vga_id`, with the full graph `vga__user_pii / vga__social_profile / vga__provider / vga__tier_profile` (vga_user_master.yaml:5-30).
- Dev has NO such cubes: `grep vga__provider|vga__product_map|pmt_users_history|view_vga_map_product` across `cube-dev/cube/model/cubes/` returns NONE; dev game folders contain no vga/product_map/provider cube.
**Failure scenario:** Implementer opens `vga_payment_history.yaml` as a template, copies its `product_code→client_id` scoping + `vga__provider` composite join, and nothing compiles because none of those cubes/tables exist in dev. They then must invent an entirely new model (dev's `billing.pmt_user_daily` + a phase-1 bridge to GDS `user_id`). The 6-day estimate assumes copy-adapt; reality is design-from-scratch for monetization-history and CS, doubling those phases.
**Evidence:** prod files cited above; `cube-dev/cube/model/cubes/{cfm,jus}/` listing (no vga cubes); grep for vga infra in dev = empty.
**Suggested fix:** Reclassify Phases 2-4 prod files from "port oracle" to "semantic reference only (measure names, dedup-status filter, ARPPU formula)". State explicitly: the dev cubes are NEW, built on dev tables (`billing.pmt_user_daily`, `cs_ticket.cs_ticket_info`) with a GDS bridge — the ONLY genuinely portable prod cube is `jus_vn/user_recharge_daily.yml` (`sql_table: jus_vn.std_ingame_user_recharge_daily`, direct `user_id` join) and **dev already has that cube**. Re-estimate accordingly.

## Finding 2: Phase 2 (the P0 deliverable) has a kill-path the plan never names — if pmt_user_daily.user_id can't bridge to GDS, the whole live layer dies
**Severity:** Critical
**Location:** phase-02 lines 13,24; phase-01 lines 20-21; unresolved-questions.md #8; freshness legend plan.md:35
**Flaw:** The entire "live monetization" value prop rests on `pmt_user_daily` (the only `live` revenue source). Phase 1 itself flags `pmt_user_daily.user_id` "format VARIES (numeric vs game-account string); prefer vga_id where populated" — and "vga_id" is the VGA namespace that, per Finding 1, has no resolver in dev. The recharge.yml bridge (the cited pattern, recharge.yml:45-49) works because a `std_ingame_role_recharge` bridge table exists keyed on `transaction_id`. There is NO stated equivalent bridge for `pmt_user_daily` → GDS. The plan treats this as "Phase 1 picks the highest reliable key" but never states what happens to the P0 deliverable if the answer is "no reliable key < some threshold".
**Failure scenario:** Phase 1 probes `pmt_user_daily`, finds the numeric `user_id` matches mf_users at e.g. 4% and `vga_id` is mostly NULL (plausible given dev lacks the VGA graph), flags BLOCKED per the resolution rule (phase-01:60). Phase 2 — the only P0, the only `live` layer, the headline of the plan — is now dropped. Everything downstream (segment live-metric rows, live dashboard cards) collapses to lagging-only. The plan presents no contingency and no kill-criterion threshold.
**Evidence:** phase-01:20 (key "VARIES"); unresolved-questions.md #8; recharge.yml:45-49 (bridge needs a translation table that is unspecified for pmt_user_daily); registry note `server/src/lakehouse/segment-metric-registry.ts:14-18` (jus uids carry @-suffix on BOTH sides — implies pmt_user_daily.user_id likely does NOT equal bare GDS id).
**Suggested fix:** Add an explicit Phase-1 GO/NO-GO gate for `pmt_user_daily`: define the minimum acceptable match-rate (e.g. ≥80%) and the named bridge table candidate (which std mart carries pmt user_id ↔ gds user_id?). If unmet, state the plan's fallback: demote P0 to "payment_history lagging only" and flag the live layer as a separate blocked follow-up. Do not let the headline deliverable depend on an unverified, un-named bridge.

## Finding 3: jus mf_users acquisition dims are NOT structurally identical to cfm's — they are `max()`-collapsed over a dual-identity GROUP BY
**Severity:** High
**Location:** plan.md:60-61 ("`mf_users` ... already carries acquisition + LTV + lifecycle dims"); phase-05 (channel→LTV views); `cube-dev/cube/model/cubes/jus/mf_users.yml:5-31`; `cfm/mf_users.yml:54-64`
**Flaw:** Plan treats cfm and jus mf_users as interchangeable spines carrying the same acquisition dims. They both expose `media_source/campaign_id/is_paid_install/appsflyer_id` — BUT jus's mf_users is a synthetic `SELECT ... max(media_source), max(campaign_id), max(is_paid_install) ... GROUP BY user_id` that merges a dual-identity layout (an `<id>@vng_vie.win.163.com` row holds ingame columns; another row holds attribution). cfm's are plain column refs. So a jus channel→LTV breakdown silently assumes `max()` correctly picks the attribution row per user — an assumption that breaks if a user has conflicting attribution across the merged rows.
**Failure scenario:** Phase 5 builds a "channel → LTV" exploration view on jus assuming clean per-user attribution. Users with multiple source rows get the lexical-max media_source, skewing paid-vs-organic LTV comparisons. The plan's "best-effort acquisition" caveat covers CAC cost, not this attribution-merge hazard, so it ships unflagged.
**Evidence:** `jus/mf_users.yml:5-8,19-31` (the GROUP BY + max() merge + comment about dual rows); `cfm/mf_users.yml:54-64` (plain `sql: media_source`).
**Suggested fix:** Phase 5 must document the jus attribution-merge semantics and verify `max()` doesn't conflate distinct campaigns. State that jus and cfm acquisition dims are *nominally* the same but jus carries a merge caveat; do not assume identical fidelity.

## Finding 4: segment-metric-registry cannot host the monetization mart as the plan describes — it joins membership to BARE marts in the game schema with NO bridge
**Severity:** High
**Location:** phase-07 lines 9,43,53 ("add LIVE monetization mart rows"); `server/src/lakehouse/segment-metric-registry.ts:1-34,39-62`
**Flaw:** Plan says wiring live monetization into segment metric-movement = "add LIVE monetization mart rows (gated by phase-1 probe pass)". But the registry's contract is narrow and the plan misreads it:
1. `mart` is a "**Bare** mart table name, resolved under **the game's Trino schema**" (registry.ts:26). `pmt_user_daily` lives in the `billing` schema, NOT `cfm_vn`/`jus_vn`. The registry has no cross-schema mart support.
2. The join is `membership.uid ⨝ mart.user_id` **directly** (registry.ts:3-5,16-18). The whole point of Phase 1 is that `pmt_user_daily.user_id` needs a bridge to GDS. The registry has no bridge step — it explicitly warns that a bare-uid jus segment "would zero-join".
3. Scope note: "Cube-model-internal derived metrics ... are NOT representable here" (registry.ts:10-13). A bridged-SQL cube measure is exactly that.
**Failure scenario:** Implementer adds a `revenue_live` row pointing `mart: pmt_user_daily` and it either errors (table not found under `cfm_vn`) or zero-joins (uid namespace mismatch), producing a flatline metric in the segment metric-movement chart that looks like "no revenue" rather than a wiring bug.
**Evidence:** `server/src/lakehouse/segment-metric-registry.ts:1-18,26,36-37` (existing rows use `std_ingame_user_recharge_daily`/`std_ingame_user_active_daily`, both bare game-schema marts with direct `user_id`).
**Suggested fix:** Either (a) drop the live-monetization-into-segments goal and reuse the existing `std_ingame_user_recharge_daily` revenue row that already works, OR (b) scope a registry extension (schema-qualified mart + optional bridge mart) as explicit NEW work in Phase 7, not a one-line "add rows". The current existing `STD_RECHARGE` binding likely already satisfies the segment monetization need.

## Finding 5: Freshness tiers are hardcoded strings in `description:` that rot silently — and the live-tier dims rely on CURRENT_DATE windows that drift if pipelines stall
**Severity:** High
**Location:** plan.md:31-40 (freshness legend); phase-06:21-23,47; `cube-dev/cube/model/cubes/cfm/mf_users.yml:181-327` (15 CURRENT_DATE refs)
**Flaw:** Two rot vectors the plan doesn't guard:
1. **Static tier labels:** `[freshness: live|lagging|archive]` is a hand-typed token in each cube description, derived from a scout snapshot dated 2026-06-13 (vga ~2mo, td ~4mo, cs ~3mo). Nothing recomputes it. A `live`-tagged cube whose pipeline stalls keeps claiming `live` forever; a `lagging` source that gets fixed stays mislabeled. The chat-agent and Catalog surface the stale tag verbatim (plan.md:40), propagating the lie.
2. **CURRENT_DATE-relative dims:** existing mf_users churn/recency dims compute `DATE_DIFF('day', ingame_last_active_date, CURRENT_DATE)` (mf_users.yml:181-202,321-327). These ASSUME data is current-to-yesterday. The plan tags mf_users-derived acquisition/LTV as `live` (plan.md:35) — but if mf_users upstream lags (jus is built off a merged mart of unknown freshness), every "days since" window is silently inflated and the `dormant_30d`/`active_7d` segments misclassify users while the cube still says `[freshness: live]`.
**Failure scenario:** A live segment gate ("active in last 7 days") on a stalled-but-live-tagged source includes users who've been gone for weeks; an alerting dashboard card reads it as "current" because the badge says live. This is exactly Top-risk #3 the plan names — but the mitigation (a static description token) is itself the rot vector.
**Evidence:** plan.md:39-40 (token is the only mechanism); `cfm/mf_users.yml:181-327`; freshness numbers sourced from a single 2026-06-13 scout (phase-01:4).
**Suggested fix:** Make freshness measured, not asserted: add a `max(date_col)` freshness measure per cube (or a small server check) and derive the badge from observed max-date vs today at query time. At minimum, add an explicit "freshness tags are a point-in-time snapshot; re-validate before relying on `live`" caveat and a recheck task. Do not let a hand-typed string be the only thing standing between a lagging source and a live alert.

## Finding 6: CS "port" cites prod cubes that use a different table AND a different join than the dev plan — and the dev join matches only ~8%
**Severity:** High
**Location:** phase-04 lines 8,9,17,45; memory `cs-ticket-schema-join`; prod `vga/cs_ticket_report.yaml:5,23-25`, `vga/vga_cs_customer.yaml:8-17,24`
**Flaw:** Phase 4 lists prod `cs_ticket_report.yaml` + `vga_cs_customer.yaml` as the "Prod oracle" while building dev cubes on `cs_ticket.cs_ticket_info` joined via `split_part(user_id,'@',1)`. These are unrelated:
- Prod uses `iceberg.cs_ticket.cs_ticket_report` (filtered `ticket_status='New'`) → join `vga__cs_customer` on `customer_id` → resolve user via `vga__provider` (cs_ticket_report.yaml:5,23-25; vga_cs_customer.yaml:8-33). Identity = VGA provider_id space.
- Dev plan uses `cs_ticket_info` → `split_part(user_id,'@',1)` → mf_users GDS id, which the project memory records as ~8% match, with FB/AIHelp PSID unresolvable.
So the "oracle" provides neither the table, the dedup key (`ticket_status='New'` vs an unstated dev canonical status), nor the join. The only transferable thing is the *measure shape* (closed/rejected/active, resolution_rate, CSAT).
**Failure scenario:** Implementer leans on prod's `customer_id`-based dedup and `vga__cs_customer` join, none of which apply, and wastes a cycle before falling back to the memory-documented split_part path that only resolves ~8% — making the cube look broken (Phase 4 already flags this as Med risk, but mislabels prod as a usable oracle).
**Evidence:** prod files above; memory `cs-ticket-schema-join` / `cs-facebook-aihelp-uid-unresolvable`; dev has no cs cubes/tables (grep returns none).
**Suggested fix:** Demote prod CS files to "measure-name reference only". State the dev CS cube is new on `cs_ticket_info` with the split_part bridge, expected ~8% resolve, and the dedup canonical-status filter must be discovered in Phase 1 (not copied from prod's `ticket_status='New'`, which is a different schema). This is already half-acknowledged in Key Insights — make the "oracle" caveat explicit so it isn't trusted as copy-source.

## Finding 7: Plan asserts "members ... consume cube data; this HOOKS into them" for member360/Care, but never verifies the readers accept bridged cross-schema cubes
**Severity:** Medium
**Location:** phase-07 lines 18-19,46,57; plan.md:64 (member-resolver claim)
**Flaw:** Phase 7 asserts member360 and Care tabs "already exist and consume cube data" and the new layers just "HOOK in". Verified that the surfaces exist (dirs present) and Catalog auto-discovery is genuinely meta-driven (use-catalog-meta.ts:104, no allowlist). But "consume cube data" is assumed to mean these readers will accept the NEW cubes' member shapes (bridged user_id, freshness-tagged, possibly `public:false` PII dims). No reader file is cited proving member360 reads arbitrary cube members vs a fixed query shape. Phase 7's only verification step is "verify predicate catalog auto-picks new dims" — member360/Care reader compatibility is unverified.
**Failure scenario:** member360 reader has a hardcoded list of cube members or expects a specific identity dim; the new monetization/CS members don't surface, and "hook in" becomes "modify the reader" — hidden scope inside a P1 phase.
**Evidence:** phase-07:18-19,46 (assertion, no reader file cited); contrast with the well-verified Catalog claim (use-catalog-meta.ts:104 confirmed meta-driven). The plan verified Catalog but extrapolated the same property to member360/Care without checking.
**Suggested fix:** Add a Phase-7 step to read one member360 reader and one Care tab reader and confirm they consume cube members generically (meta-driven) vs a fixed shape. If fixed, scope the reader change explicitly. Don't let "already consume cube data" stand as a verified reuse claim when only Catalog was actually verified.

---

## Severity summary
| # | Severity | One-line |
|---|----------|----------|
| 1 | Critical | "Port from prod" monetization/CS = rewrite; prod depends on VGA identity graph absent in dev |
| 2 | Critical | P0 live layer has unnamed kill-path: pmt_user_daily→GDS bridge unproven, no GO/NO-GO threshold |
| 3 | High | jus mf_users acquisition dims are max()-merged over dual-identity, not identical to cfm |
| 4 | High | segment-metric-registry can't host pmt_user_daily (cross-schema + needs bridge it doesn't support) |
| 5 | High | Freshness = hand-typed string + CURRENT_DATE windows → silent rot; mitigation IS the rot vector |
| 6 | High | CS prod "oracle" uses different table+join than dev path (~8% match); not a copy-source |
| 7 | Medium | member360/Care "already consume cube data" reuse claim unverified (only Catalog verified) |

## What survived scrutiny (not findings, stated for fairness of the gate)
- Phase 1 identity-bridge gating + BLOCKED resolution rule is sound and honestly hedged (phase-01:53-60).
- Per-game scoping by folder is real; Catalog auto-discovery is genuinely meta-driven, no allowlist (use-catalog-meta.ts:104,126).
- mf_users acquisition dims DO exist in both games (cfm/mf_users.yml:54-64, jus:19-31) — the claim is true, just not "identical" (Finding 3).
- `jus_vn/user_recharge_daily.yml` IS a real direct-join cube — but dev already has its equivalent, so it's not net-new work.

## Unresolved questions
1. Is there ANY std mart in the dev game schema that bridges `pmt_user_daily.user_id` ↔ GDS `user_id`? Finding 2's kill-path turns on this; the plan names none.
2. What is the minimum acceptable match-rate that distinguishes "author the cube" from "flag BLOCKED"? The resolution rule says "reliably resolved" without a number.
3. Does member360/Care render arbitrary cube members or a fixed query shape? (Finding 7 — needs one reader file read to close.)
