# Unresolved Questions (build-gating)

Carried from scout + explore reports. Each notes WHAT it gates so the build doesn't silently proceed on a guess.

| # | Question | Gates | Resolve in |
|---|----------|-------|------------|
| 1 | **Refund/chargeback source** — no refund table found (`reward` schema empty); refunds may live in `payment_status` enum of raw logs. | Net-revenue. Until resolved, monetization cubes expose GROSS only (`revenue_vnd_gross`); no "net" claim. | Phase 1/2 |
| 2 | **bundle_code ↔ game_id map** — does not exist in dev or prod YAML. | DEFERRED CAC cube (locked decision: out of scope). Documented in `reports/deferred-cac-followup.md`; future CAC plan needs this map first. | Follow-up plan |
| 3 | **Does outbound/proactive CS outreach create a logged ticket?** — cs_ticket sources seen so far are inbound (AIHelp/Facebook). | CS compliance/exposure use of cs_action_log. CS-depth cube still valid for inbound triage regardless. Operational/process question — not answerable from data. | Ops confirm (Phase 4) |
| 4 | **vga 2-month staleness cause** — sync throttle vs broken pipeline. | Whether lifecycle_profile (vga) can ever be `live`. Currently tagged `lagging`; do not promote without resolution. | Phase 1/3 |
| 5 | **pmt_user_daily.npu / dpu exact semantics.** | Whether npu/dpu can be surfaced as headline measures. Until verified, keep `public: false` or caveated. | Phase 1/2 |
| 6 | **thinking_data.user_vga_id NULL rate** — is `user_ingame_id`+game_id the only reliable behavioral key? | behavior_profile join coverage. Phase 1 measures it; behavior cube documents coverage. | Phase 1/3 |
| 7 | **CS match-rate per game** — `split_part(user_id,'@',1)` ~8% historically; FB/AIHelp PSID unresolvable. | CS-depth coverage. Phase 1 measures real match-rate; cube exposes `unresolved_share`. | Phase 1/4 |
| 8 | **pmt_user_daily.user_id reliable key** — numeric vs game-account; prefer vga_id where populated. | The monetization bridge. Phase 1 picks the highest reliable key empirically. | Phase 1 |

Resolution rule: any table whose join key cannot be reliably resolved in Phase 1 is flagged BLOCKED — its cube
is dropped this round (documented), never faked.
