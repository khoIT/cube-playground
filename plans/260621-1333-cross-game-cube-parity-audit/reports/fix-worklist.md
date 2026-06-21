# Fix worklist (Phase 4) — deduped, classified, sequenced

## Phase 5 execution status (after D1–D3 decisions)
- **W1 ptg — ✅ DONE.** D1 verification escalated this far beyond a "PK label": the served `game_integration.ptg.etl_ingame_recharge` carries re-ingestion version duplicates → **recharge revenue inflated 1.88× (raw SUM 2.81T vs true 1.50T).** Cube `primary_key` does NOT collapse duplicate fact rows for SUM, so the fix is a latest-version dedup CTE (`ROW_NUMBER() OVER (PARTITION BY transactionid ORDER BY updated_time DESC)=1`), not a PK swap. Proven safe: distinct transactionid == distinct business-row (20,114,541), 0 multi-item txns → no legitimate revenue lost. Dedup also makes the existing PK genuinely unique. Applied to `ptg/recharge.yml`.
- **W2 pubg — ✅ DONE.** Same etl re-ingestion pattern, dedup on `fsequence_no` (576 of 577 dup rows removed; ~0.02%). Applied to `pubg/recharge.yml`.
- **muaw — confirmed CLEAR** (transaction_id unique; oracle composite is for its different role-grain source). No edit.
- **W3/W4/W6 measure backfill — ⏸ RE-GATED (approved mechanism backfires).** D3 approved "via generator", but verification shows the canonical cubes emit from a **shared cfm template (40 measures)** while prod oracle counts are **non-uniform**: cfm=40, jus=43, ballistar/ptg/pubg=57, cros=43, tf=43, muaw=40 — and dev cros=45 is already AHEAD of its oracle. Expanding the shared template + regenerating would push cfm/jus/muaw/tf ABOVE their oracles (new divergences) and clobber cros. Correct backfill is **per-game + source-gated**, which on generator-owned cubes needs generator surgery (per-game measure overlays) or graduating these cubes to hand-authored — an architecture decision. NOT executed; needs re-decision.
- **W7 metric N/A — deferred** with the backfill decision (low-risk applicability flags; confirm per-game source-absence first).
- **Live compiled-SQL verification** of W1/W2 pending a Cube restart (DEV_MODE=false, no hot-reload) — Phase 6.

---



Consolidates the verified cube ledger + metric-layer findings into root-cause groups. One row per root cause; per-game repeats collapsed. **Phase 5 gate:** nothing here is auto-applied — correctness fixes touch served PKs (high-risk), parity backfills touch a generator with wide blast radius and may reverse a scope decision. All await explicit go-ahead.

Legend: mechanism `hand_edit` (bespoke cube) · `via_generator` (canonical cube → regenerate all games) · `metric_yaml` (applicability flag).

| ID | Class | Root cause | Affected | Mechanism | Files | ASK? |
|----|-------|-----------|----------|-----------|-------|------|
| W1 | **FIX-correctness** | ptg recharge PK = bare `transactionid`; oracle composites `transactionid+accountid+rechargetime` (same table) | ptg | hand_edit | `cube-dev/cube/model/cubes/ptg/recharge.yml:46` | confirm prod-table dup state first |
| W2 | **FIX-correctness (minor)** | pubg recharge PK = `fsequence_no` w/ 577 dup rows; oracle uses `user_id+transaction_id` on a different std table | pubg | hand_edit | `cube-dev/cube/model/cubes/pubg/recharge.yml:48` | yes — no clean composite from dev cols; needs decision |
| ~~muaw PK~~ | **CLEARED** | transaction_id unique (1.00×); oracle composite is for its different role-grain table | muaw | — | — | suppress, document |
| W3 | FIX-parity | `user_recharge_monthly` missing ~25 oracle measures | ballistar, ptg, pubg | via_generator | `canonical-cube-config.mjs` + regen | **yes — leaner intentional?** |
| W4 | FIX-parity | `user_active_monthly` missing ~11 oracle measures | ballistar, ptg, pubg | via_generator | same | **yes — leaner intentional?** |
| W5 | FIX-parity | ptg `ccu` missing samples/peak_ccu/avg_ccu | ptg | hand_edit | `cube-dev/cube/model/cubes/ptg/ccu.yml` | low — likely safe backfill |
| W6 | FIX-parity (metric GAP) | FIXABLE metric refs: active_daily online-time + WAU/trailing, recharge paying_rate/users, user_recharge_daily trailing, mf_users paying-role | all 8 (where source present) | via_generator | canonical cubes | **yes — some trailing_* were deprioritized** |
| W7 | N/A (not a fix) | BLOCKED metric refs: gacha / tutorial / funnel / money_flow-where-absent | per-game | metric_yaml | `server/src/presets/business-metrics/*.yml` `meta.applicability` | no — but probe source-absence first |
| W8 | WONTFIX/intentional | 20 jus identity-bridge `split_part` cosmetic + 232 label/structure cosmetic | jus + all | baseline | `parity-baseline.json` (Phase 6) | no |
| W9 | LOW (optional) | jus `role_recharge_daily:128` ratio without explicit DOUBLE cast | jus | hand_edit | `.../role_recharge_daily.yml:128` | no — negligible |

## Sequencing (when approved)
1. **W1, W2** correctness first (bespoke hand-edits, smallest blast radius, revertible one commit each). Verify by compiled SQL: load cube, confirm PK expr, confirm a SUM measure no longer double-counts.
2. **W3/W4/W6** generator backfill (only after the "leaner intentional?" decision) — snapshot canonical cubes pre-regen, diff post-regen to catch collateral drift, regenerate affected games.
3. **W5** ptg ccu hand backfill.
4. **W7** metric-YAML N/A — after source-absence probe; re-run `audit:metric-trust` to confirm GAP→N/A.
5. **W8** baseline file (Phase 6).

## Decisions needed before Phase 5 (BLOCKING)
- **D1 (W1):** Apply ptg composite PK now (oracle-authoritative, defensive) even though prod-table dup magnitude is unconfirmed? Or first verify against the prod catalog whether any served ptg number actually changes?
- **D2 (W2):** pubg has 577 unfixable-by-composite dup rows (full-row dups, ~0.02%). Accept & document, or pursue upstream dedup / distinct-row PK?
- **D3 (W3/W4/W6):** Is the leaner `user_*_monthly` measure set + the trailing_*/online-time metric GAPs an intentional scope choice, or do you want the generator backfill that closes them across all games?

Everything above this line is read-only analysis. Phase 5 makes the first cube-model edits — held for your call on D1–D3.
