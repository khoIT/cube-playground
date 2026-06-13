# Whale-Segment CS Care Tab

Add a **Care** tab to segment detail that overlays customer-support history onto VIP/whale members,
plus a small recharge-trajectory "CS impact" cohort strip. Direction A (CS-lead insight) primary +
embedded Direction B (contacted-vs-not forward spend) strip.

## Why
Whales who contact CS skew to high-stakes issues (payment-failed/refund, account security) and some
carry negative sentiment + ≤2-star ratings — a direct "needs proactive outreach" signal for CS/VIP-care
leads. Forward recharge shows whether a bad CS experience precedes a spend dip.

## Verified grounding (this session)
- CS warehouse: `iceberg.cs_ticket`, daily batch refresh, **next-day freshness** (latest log_date = today).
- Join key: `cs_ticket_info.user_id` = segment member `uid` — **Ingame/Web/Phone sources only (~8% coverage)**;
  Facebook/AIHelp (~90%) use PSID, not joinable.
- Product map: **jus_vn → 832, cfm_vn → 856** (`cs_map_product`).
- Signals: AI label category (`cs_ticket_map_ai_label`), sentiment + rating + status (`cs_ticket_new_master`;
  NB `cs_ticket_master` has a stale Iceberg metadata pointer — use `_new_master`).
- Recharge trajectory: `game_integration.<schema>.std_ingame_user_recharge_daily`
  (`user_id` LIKE `<uid>%`, `ingame_total_recharge_value_vnd`, `log_date`). Proven per-member before/after.
- UI: tabs registered in `src/pages/Segments/detail/detail-view.tsx` (`BASE_TABS` + `DetailTabId`);
  follow `insights-tab.tsx` + design-guidelines tokens.

## Phases
| # | Phase | Status |
|---|-------|--------|
| 01 | [CS data-access layer + game→product map](phase-01-cs-data-access-layer.md) | ✅ done — SQL validated live (22/276 ≈ 8% coverage) |
| 02 | [Segment CS-care endpoint (pulse/mix/watchlist/impact)](phase-02-segment-cs-care-endpoint.md) | ✅ done — registered, live-validated incl. recharge pre/post |
| 03 | [Care tab UI (4 widgets, gated, tokens)](phase-03-care-tab-ui.md) | ✅ done — **Watchlist-first** layout (huashu B), tokens only |
| 04 | [Tests + docs + lessons](phase-04-tests-docs.md) | ✅ tests done (21 pass) + code review clean; docs in progress |

## Outcome (260613)
- Built per **Direction A + embedded B strip**, **daily recharge trajectory**, **Watchlist-first** layout (huashu variant B, user-picked).
- Backend: `cs-product-map.ts`, `cs-ticket-reader.ts`, `cs-recharge-trajectory.ts`, route `segment-cs-care.ts` (+`-assembly.ts`). UI: `care-tab.tsx` + `care/` (5 files), `src/api/segment-cs-care.ts`.
- **File-location deviation:** CS modules live in `server/src/lakehouse/` (no `server/src/config/` dir exists; lakehouse is the established Trino-reader home).
- Tests: 17 server + 4 UI = 21 green. Code review: no critical/blocking; applied `run_date` partition-prune on master CTE + 2 clarifying comments.
- Live verification of the *populated* React tab deferred (would require restarting the shared dev API server; concurrent sessions edit this repo).

## Key decisions (locked)
- Direction: **A + embedded B strip**.
- Forward metric: **daily recharge trajectory** (not just in-segment LTV).
- B strip framed as **directional, small-sample** — never a significance claim at N≈21.

## Dependencies / risks
- Coverage ceiling ~8% — tab must surface "X of N members have CS history" honestly, never imply full coverage.
- Trino latency (cold 3.5–15s) — endpoint must cache + degrade gracefully (segment members already cached).
- `user_id` may carry `@`-suffix — match with `split_part(user_id,'@',1)` like the cube join does.
