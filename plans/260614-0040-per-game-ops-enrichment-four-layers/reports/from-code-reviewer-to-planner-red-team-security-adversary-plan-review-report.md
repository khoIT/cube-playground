# Red-Team Security Review — Per-Game Ops Enrichment (Four Layers)

Lens: Security Adversary + Fact Checker. Target: `plans/260614-0040-per-game-ops-enrichment-four-layers/`.
Every finding carries `file:line` codebase evidence. No praise. Severity: Critical | High | Medium.

---

## Finding 1: Cross-catalog source tables are unqualified — cubes resolve to the wrong catalog and either fail or (worse) silently read the game-scoped catalog

**Severity:** Critical
**Location:** Phases 2–4 (every `sql:`/source-table reference: `billing.pmt_user_daily`, `payment.pmt_billing_ff_callback_trans`, `gds_da.mf_ip2location`, `vga.ingame_user_profile`, `thinking_data.*`, `cs_ticket.*`); plan.md freshness-legend table; phase-02 §"Source tables".

**Flaw:** The plan writes bare two-part names like `billing.pmt_user_daily`. The local Cube driver connects to a SINGLE catalog `game_integration` (`cube-dev/.env:7` `CUBEJS_DB_PRESTO_CATALOG=game_integration`; `cube-dev/cube/cube.js:298-309` `driverFactory` sets only `catalog` + per-game `schema`, NO `data_source`). But the scout report the plan is built on states these tables live in catalog **`stag_iceberg`**, not `game_integration` (`scout-260613-1854-...-report.md:3` "Catalog: `stag_iceberg`"; :17,:19,:20 map `billing`/`payment`/`vga`/`gds_da`/`thinking_data`/`cs_ticket` as `stag_iceberg` schemas). Trino resolves a two-part `billing.pmt_user_daily` against the connection's default catalog → `game_integration.billing.pmt_user_daily`, which does not exist → every phase 2–4 cube fails to compile/query. The plan never adds a `stag_iceberg` data_source nor catalog-qualifies the tables.

**Failure scenario:** Phase 2 ships `payer_daily.yml`. Compile passes (Cube doesn't validate SQL), but the first `/load` throws `TABLE_NOT_FOUND game_integration.billing.pmt_user_daily`. If a schema named `billing` ever DID exist under `game_integration`, it would read THAT instead — a silent wrong-source read with no error.

**Evidence:** `cube-dev/.env:7`; `cube-dev/cube/cube.js:298-309`; `scout-260613-1854-stag-iceberg-enrichment-and-experimentation-map-report.md:3,17,19,20`. Proven-correct precedent for cross-catalog: `cube-dev/cube/model/_shared/segment_membership.yml:20` uses the FULLY-qualified `sql_table: stag_iceberg.khoitn.segment_membership_daily` with comment ":16 Trino resolves cross-catalog refs" — i.e. it works ONLY when the catalog prefix is present.

**Suggested fix:** Mandate three-part names `stag_iceberg.<schema>.<table>` in every cross-cutting cube SQL (mirror `_shared/segment_membership.yml:20`), OR add a `stag_iceberg` data_source to `cube.js` + `data_source:` per cube (mirror prod's `trino_gio`). Add a Phase-1 gate that confirms the local driver can reach `stag_iceberg` at all. This is a build-blocker, not a polish item — it should be a locked decision in plan.md, not left to author discretion.

---

## Finding 2: `mf_ip2location` is `(game_id, user_id)`-grained but the plan joins on `user_id` alone — cross-game geo/VPN bleed

**Severity:** Critical
**Location:** Phase 3 §Key Insights + §Implementation Steps 1–2 (`user_geo` cube).

**Flaw:** Phase 3:20 itself records the key as `(game, user_id)` but the only mandated verification is "verify user_id == mf_users.user_id" — it does NOT require filtering the table's own `game_id` column. `mf_ip2location` is ONE Trino table holding all games (86.8M rows, "game × user" grain — `scout-...-report.md:62`). `mf_users` is per-game-schema-scoped (`cube-dev/cube/model/cubes/cfm/mf_users.yml:7-16`, bare `mf_users` table). A `many_to_one` join `{CUBE}.user_id = {mf_users}.user_id` matches cfm's numeric user_id 12345 to `mf_ip2location` rows for the SAME user_id in OTHER games. GDS user_id may be globally unique, but the plan does not VERIFY that — and if `mf_ip2location.user_id` is a game-local id (the scout flags `user_id` format variance across these tables, :40,:66), one game reads another game's IP geography, multi-country, and VPN/fraud flags.

**Failure scenario:** A cfm analyst opens a member's geo card. The "multi-country" and "VPN" flags are computed from `first_ip != last_ip` across rows that actually belong to that user's jus and pubg sessions. False fraud flag on a clean cfm user; cross-game location disclosure.

**Evidence:** `scout-...-report.md:62` (game × user grain, 86.8M); plan phase-03:20 (key is `(game, user_id)` but no game-column filter mandated); `cube-dev/cube/model/cubes/cfm/mf_users.yml:7` (mf_users bare/per-game). Same risk applies to `vga.ingame_user_profile` (also "game × user", :61) and `billing.pmt_user_daily` (user×product×day, NOT game-keyed, :34).

**Suggested fix:** For every cross-game shared table, the cube `sql:` MUST add a literal game filter (`WHERE game_id = '<this game schema>'` or the table's game column) IN ADDITION to the mf_users join — the join alone is insufficient when the foreign user-id namespace is not proven globally unique. Phase 1 must empirically prove `user_id` global-uniqueness per table before any cube relies on the join as the game boundary.

---

## Finding 3: Plan asserts "cross-game leak impossible" for these cubes — false; the mechanism that makes existing cubes safe does not apply

**Severity:** Critical
**Location:** plan.md §"Key dependencies / ground truth (verified)" bullet 1 ("Per-game scoping is free… never leak rows"); phase-02:41-42 ("game-scoped for free; cross-game leak impossible (each compiles only into its own model)").

**Flaw:** The "verified" claim conflates two different safety mechanisms. Existing cubes are game-safe because they use BARE table names (`etl_ingame_recharge`, `std_ingame_user_recharge_daily`, `mf_users`) which the per-game driver `schema` (`cube.js:307`) physically scopes to `cfm_vn`/`jus_vn`. The new cross-cutting tables are NOT in the per-game schema — they're shared catalog-wide tables (Finding 1/2). Compiling a cube "only into its own model" controls which YAML is parsed; it does NOT scope a shared physical table. The plan's own phrase "cross-game leak impossible" is therefore a false safety guarantee that will suppress the very game-filter the new cubes require.

**Failure scenario:** An author reads phase-02:41 "cross-game leak impossible", writes `payer_daily.yml` with only the mf_users join (no game filter), ships it. cfm's revenue measures sum jus payer rows for collised user_ids. The "verified" tag means review waves it through.

**Evidence:** Bare-table scoping mechanism: `cube-dev/cube/model/cubes/cfm/mf_users.yml:7` + `cube-dev/cube/model/cubes/cfm/recharge.yml:47` (bare `etl_ingame_recharge`), driven by `cube.js:298-309`. Zero existing cube references any of `billing.`/`payment.`/`vga.`/`thinking_data.`/`cs_ticket.`/`gds_da.` (grep over `cubes/cfm cubes/jus` returned empty) — so this is a NET-NEW trust boundary the "verified" claim never tested.

**Suggested fix:** Strike the "cross-game leak impossible" and "never leak rows" language from plan.md and phase-02. Replace with an explicit invariant: "shared-catalog cubes are game-safe ONLY IF the cube SQL applies a game filter AND the join key is proven globally unique." Make it a Phase-1 success criterion.

---

## Finding 4: PII redaction depends on `public: false` being applied to every PII column, but the plan only says "mirror" with no enforced column list

**Severity:** High
**Location:** Phases 2–4 §Security Considerations ("no raw PII", "mirror vga exclusion", "keep public: false"); phase-03:54,76; phase-04:79.

**Flaw:** The ONLY thing keeping PII out of the unauthenticated member-pull and Catalog is `public: false` — because `/meta` omits non-public members and the member-profile runner drops any column not present in `/meta` (`server/src/services/member-profile-runner.ts:71-73`). The plan relies on this but provides NO mandatory redaction checklist; it says "mirror vga_user_master exclusion list" (phase-03:43,54). The source tables carry hard PII: `payment_raw`/callback logs (`msisdn`, `customer_email`, `country_code`), `mf_ip2location` (raw first/last IP), `thinking_data` (device id, IP, campaign — :63 "device/geo/campaign context"), `cs_ticket` (login_info/social_id — phase-04:79). One forgotten `public: false` on `last_ip` or `customer_email` exposes it to the tokenless API.

**Failure scenario:** Author adds a `last_ip` dimension to `user_geo.yml` for "geo-stability" debugging and forgets `public: false`. It enters `/meta` → becomes selectable as a segment member column → the next segment refresh writes it into `member_profiles_json` → served by the unauthenticated `GET /api/segments/:id/members` (`server/src/routes/segments.ts:458-465`, "Deliberately unauthenticated") to any VPN curl holding the segment UUID. Raw IP leak.

**Evidence:** Redaction enforced only via `/meta` filter: `server/src/services/member-profile-runner.ts:71-73`; tokenless serving path: `server/src/routes/segments.ts:458-465,479,528`; PII columns in sources: `scout-...-report.md:63`, phase-04:79; prod redaction precedent that proves columns must be individually flagged: `/Users/lap16299/Documents/code/cube-prod/cube/model/cubes/vga/vga_user_master.yaml:11,39,51` (`public: false` per dim, plus a separate `vga__user_pii` cube at :16).

**Suggested fix:** Phase 6 (or a new gate in each cube phase) must include an explicit DENY-LIST of source columns that may NEVER become a public dimension (msisdn, customer_email, raw IP, device_id, social_id, login_info, appsflyer_id) and a test asserting none of them appear in `/meta?extended=true` for cfm or jus. Default-deny: model new cubes with PII columns simply not declared as dimensions at all, rather than declared-then-`public:false`.

---

## Finding 5: New enriched member columns silently widen the unauthenticated tokenless members API

**Severity:** High
**Location:** Phase 7 §Implementation Steps 2,5 (new segment dims + member360/care hooks: "payer tier/recency, geo-stability, churn-gap, CSAT/VIP").

**Flaw:** `GET /api/segments/:id/members` is intentionally unauthenticated (segment UUID = capability, VPN-only — `server/src/routes/segments.ts:458-465`) and serves whatever the preset's `memberColumns` resolve to (`member-profile-runner.ts:103-113`, `segments.ts:528`). Phase 7 adds new dims (gross LTV, payer tier, CSAT, VIP id, recency) and wires them into member360/care. If any new dim is added to a segment preset's `memberColumns`, it flows into the tokenless payload. The plan treats these as internal UI facts but never re-evaluates that the SAME data is reachable token-free. Monetization LTV + CS history of a cohort = a sensitive payer dossier exposed to anyone with the URL.

**Failure scenario:** A win-back segment preset is given `memberColumns` including `payer_daily.revenue_vnd_gross` and `cs_ticket_detail.vip_id`. The refresh snapshot now contains per-user lifetime revenue + VIP tier. A CS contractor (or anyone the VPN-shared URL leaks to) curls the endpoint and pulls the top-1000 highest-LTV payers with revenue figures — a prime target list for social-engineering / poaching.

**Evidence:** `server/src/routes/segments.ts:458-465` (unauthenticated by design), :528 (serves member_profiles_json); `server/src/services/member-profile-runner.ts:107-113` (columns → query → snapshot); plan phase-07 steps 2,5.

**Suggested fix:** Phase 7 must add a rule: monetization/CS dims may be surfaced in authenticated member360 UI but must be EXCLUDED from any segment preset's `memberColumns` (which feed the tokenless API), OR the tokenless endpoint must gain auth before these layers ship. Add a test asserting the tokenless payload for a payer-enriched segment contains no revenue/VIP/CSAT fields. Surface this as an explicit open question to the user — it is a policy decision, not an implementation detail.

---

## Finding 6: prod oracle cited as "to port" is itself `public: false` and cross-game — porting it per-game inverts its safety posture without acknowledging it

**Severity:** High
**Location:** Phase 2 §Context Links ("Prod oracle to port: …/vga/vga_payment_history.yaml"); phase-02 step 3 ("Author payment_history.yml from vga_payment_history.yaml").

**Flaw:** The plan presents `vga_payment_history.yaml` as a per-game template to copy into `cubes/{cfm,jus}/`. But that cube is deliberately a CROSS-GAME aggregate: it is `public: false` at cube level (`vga_payment_history.yaml:11`), grained `(user × game)` (:16), reads cross-schema `iceberg.billing.pmt_users_history` (:8), and achieves game-scoping via a composite `(provider_id, client_id)` join with a product→client_id map to AVOID fan-out (:21-33, comment ":22-25 composite key (user × game) tránh fan-out"). The plan's port keeps the mf_users single-key join and drops both the `public:false` and the composite game-disambiguation — re-deriving exactly the fan-out the prod author engineered around, while exposing a cube the prod author chose to hide.

**Failure scenario:** `payment_history.yml` joins `pmt_users_history` to cfm `mf_users` on `user_id` only. Because `pmt_users_history` is one-row-per-(user×game), a user who plays cfm + jus gets BOTH rows summed into cfm lifetime revenue → inflated LTV, and the cube is `public: true` (plan default) so it's browsable/poolable via the tokenless path (Finding 5).

**Evidence:** `/Users/lap16299/Documents/code/cube-prod/cube/model/cubes/vga/vga_payment_history.yaml:8,11,16,21-33,37` (cross-schema, public:false, composite game key, synthetic `(user|product)` PK). Note also the table name differs: prod reads `pmt_users_history` (:8); plan phase-02 source list says `mf_payment_user_history` — verify which actually exists.

**Suggested fix:** Phase 2 must port the composite game-disambiguation (product→game map join), not just the mf_users join, and must justify making the cube `public:true` when the oracle is `public:false`. Phase 1 must confirm the real table name (`pmt_users_history` vs `mf_payment_user_history`).

---

## Finding 7: "member-resolver passthrough on local; new logical names auto-flow to prod" is misleading — these dev-only marts could surface on the prod prefix workspace

**Severity:** Medium
**Location:** plan.md §"Key dependencies" bullet 4 + phase-01:40-42 ("logical names… On local these are passthrough; record them so the prefix mapping (prod) stays consistent if rolled out later").

**Flaw:** The plan implies registering logical names is harmless and "auto-flows". The member-resolver is a pure string transform: on `prefix` workspaces it rewrites `cube.field` → `<prefix>_cube.field` (`src/lib/cube-member-resolver.ts:39,44-45`), and is a no-op only when `gameModel !== 'prefix'` (:39). It does NOT gate which cubes exist — that's the model files. The risk: the prod (prefix) Cube serves a DIFFERENT, flat, prefixed model. If a future roll-out copies these dev-only `stag_iceberg`-backed cubes into the prod model, the resolver will happily physicalize their names with no allowlist check, and the Catalog FE filters prefixes purely client-side (`src/pages/Catalog/use-catalog-meta.ts:99-104`). There is no server-side gate preventing a dev-only payer/CS mart from appearing on prod once its YAML lands there.

**Failure scenario:** Roll-out phase (deferred 6 games) copies `payer_daily` into the prod prefixed model "for consistency". Prod cube now exposes raw lakehouse payer data through a workspace whose access posture (per memory: prod cube-dev is "fully open / no-auth") differs from the VPN-gated local stack. Open-access payer data exposure.

**Evidence:** `src/lib/cube-member-resolver.ts:13-20,39,44-45` (string transform, no allowlist); `src/pages/Catalog/use-catalog-meta.ts:99-104` (prefix filtering is client-side only); plan phase-01:40-42. The resolver comment itself (:16-20) confirms it is "a strict no-op" / "pass-through" — i.e. it provides ZERO access control, contrary to the reassurance the plan draws from it.

**Suggested fix:** plan.md should state that the member-resolver provides naming consistency, NOT access control, and that any prod roll-out of these lakehouse-backed cubes requires a separate access review of the prod workspace's auth posture. Add this to unresolved-questions.md as a roll-out gate.

---

## Finding 8: CS-depth cube exposes a compliance/action-trail at action grain (`cs_ticket_logs`: staff id, status transitions) with no access scoping

**Severity:** Medium
**Location:** Phase 4 §Requirements + step 3 (`cs_action_log` cube: "action_code/name, status_before→after, staff, log_time").

**Flaw:** `cs_ticket_logs` records `by_id`/`created_by` staff identifiers and full status-transition history (`scout-...-report.md:142` "staff (by_id/created_by)"). The plan models this as a normal cube and wires CS facts into segments/care (phase 7). Staff ids are internal-employee PII and the action trail is a compliance artifact. Once it's a cube member it is reachable by the same meta-driven, potentially-tokenless paths as everything else (Finding 5). The plan's security note (phase-04:79) only covers CUSTOMER PII (login_info/social_id), not STAFF identifiers or the action trail.

**Failure scenario:** `cs_action_log.staff_id` becomes a queryable dimension; a segment or dashboard surfaces "tickets handled by staff X" → internal performance/identity data exposed through analytics, possibly via the unauthenticated members API.

**Evidence:** `scout-...-report.md:142,184` (cs_ticket_logs carries by_id/created_by staff + status transitions, framed as the "compliance edge"); plan phase-04 step 3 + :79 (security note omits staff ids).

**Suggested fix:** Mark staff-identity and raw action-trail columns `public: false` (aggregate counts only, e.g. "action count", "avg handling time"); add staff_id to the Finding-4 deny-list. If the experiment-loop compliance reader (scout §6) needs the raw trail, keep it server-side in a dedicated reader, never as a public cube dimension.

---

## Cross-cutting verdict

Phase 1 (identity bridge) is correctly placed as the gate, but it is scoped to match-RATE and grain — it does NOT gate the two boundary failures that actually matter for security: (a) catalog reachability/qualification (Finding 1), and (b) game-column filtering on shared tables (Findings 2,3). Both must become explicit Phase-1 success criteria, and the false "cross-game leak impossible / verified" language in plan.md must be removed before it green-lights an unfiltered shared-table join.

## Unresolved questions (raise with user/planner)

1. Does the local Cube driver have network/credential reach to catalog `stag_iceberg` at all, or is a new data_source + secret required? (Gates the entire plan — Finding 1.)
2. Is GDS `user_id` proven globally unique across games in `mf_ip2location`/`pmt_users_history`/`pmt_user_daily`, or game-local? (Gates Findings 2,3 — the join-as-boundary assumption.)
3. Policy: may monetization/CS/VIP facts ever flow through the unauthenticated `GET /api/segments/:id/members` payload, or must that endpoint gain auth before these layers ship? (Finding 5 — user decision, not implementation.)
4. Real table name for lifetime payment history: `pmt_users_history` (prod oracle) vs `mf_payment_user_history` (plan source list)? (Finding 6.)
