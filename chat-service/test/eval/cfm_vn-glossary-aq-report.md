# Answer-quality report — cfm_vn (2026-06-22)

Source: `cfm_vn-glossary-aq-snapshot.json` · 84 cases · ws=local

## Scorecard

| dimension | value |
|---|---|
| answered (artifact emitted) | 61% (51/84) |
| resolution (ref == golden) | 22% (14/64) |
| non-empty (rows returned) | 58% (49/84) |
| turn latency p50 / max | 57.2s / 263.1s |
| total LLM cost | $15.64 |

### Outcome mix

| verdict | n | share |
|---|---|---|
| ✅ went well | 13 | 15% |
| ⚠️ wrong ref | 21 | 25% |
| ⬜ empty result | 2 | 2% |
| ❌ not answered | 33 | 39% |
| ◽ answered (no golden ref) | 15 | 18% |

## Where to improve next

### 1. Systematic misroutes (wrong measure) — highest value

| expected → got | # | example question |
|---|---|---|
| `recharge.revenue_vnd` → `game_key_metrics.nnpu` | 4 | show First-time payer last 7 days |
| `active_daily.dau` → `retention.churned_d30` | 3 | show Churner last 7 days |
| `mf_users.installs` → `game_key_metrics.installs` | 3 | show Installs last 7 days |
| `recharge.revenue_vnd` → `user_recharge_daily.revenue_vnd_total` | 3 | show Revenue last 7 days |
| `active_daily.dau` → `user_active_monthly.mau` | 2 | compare Active user month over month |
| `mf_users.arpu_vnd` → `user_recharge_daily.revenue_vnd_total` | 1 | show ARPU last 7 days |
| `active_daily.dau` → `mf_users.user_count` | 1 | show Dormant user last 7 days |
| `recharge.revenue_vnd` → `mf_users.user_count` | 1 | New spender this month |
| `recharge.revenue_vnd` → `user_recharge_daily.paying_users` | 1 | show Spender last 7 days |
| `recharge.revenue_vnd` → `game_key_metrics.npu` | 1 | compare New spender month over month |
| `mf_users.arpu_vnd` → `user_recharge_monthly.arppu_vnd_monthly` | 1 | compare ARPU month over month |

### 2. Empty results (routing OK, data missing)

| cube | empty cases | likely cause |
|---|---|---|
| `mf_users` | 2 | date window with no landed data, or measure unpopulated |

### 3. Not answered (errors / timeouts / refusals)

| question | status | detail |
|---|---|---|
| Active user by platform | no-artifact | — |
| ARPDAU by platform | no-artifact | — |
| Churner by platform | no-artifact | — |
| CPI by platform | no-artifact | — |
| DAU by platform | no-artifact | — |
| show Dolphin last 7 days | no-artifact | — |
| Dolphin this month | no-artifact | — |
| compare Dolphin month over month | no-artifact | — |
| Dolphin by platform | no-artifact | — |
| compare Dormant user month over month | no-artifact | — |
| Dormant user by platform | no-artifact | — |
| First-time payer by platform | no-artifact | — |
| Installs by platform | no-artifact | — |
| LTV by platform | no-artifact | — |
| MAU by platform | no-artifact | — |
| Minnow by platform | no-artifact | — |
| New spender by platform | no-artifact | — |
| Returning user by platform | no-artifact | — |
| Revenue by platform | no-artifact | — |
| ROAS by platform | no-artifact | — |
| compare Spender month over month | no-artifact | — |
| Spender by platform | no-artifact | — |
| WAU by platform | no-artifact | — |
| show Whale last 7 days | no-artifact | — |
| Whale this month | no-artifact | — |
| compare Whale month over month | no-artifact | — |
| Whale by platform | no-artifact | — |
| ARPPU by platform | no-artifact | — |
| ARPU by platform | no-artifact | — |
| show Minnow last 7 days | no-artifact | — |
| Minnow this month | no-artifact | — |
| compare Minnow month over month | no-artifact | — |
| compare WAU month over month | no-artifact | — |

### 4. Coverage gap in the question bank

15 answered case(s) have **no golden `expectedRef`**, so routing correctness can't be auto-verified — these came from mined-asked traffic. Adding golden refs (or sampling for manual spot-check) closes the blind spot.

### 5. Latency outliers (slow turns to optimise)

| question | latency | tools |
|---|---|---|
| show ARPU last 7 days | 263.1s | 15 |
| compare LTV month over month | 226.7s | 17 |
| compare ARPDAU month over month | 172.3s | 6 |
| compare ARPU month over month | 161.4s | 9 |
| show Dormant user last 7 days | 156.6s | 12 |

## Per-case detail (all cases)

| # | verdict | question | got | want | rows | ans-snippet |
|---|---|---|---|---|---|---|
| 1 | ✅ went well | show Active user last 7 days | `active_daily.dau` | `active_daily.dau` | ✓ | The artifact shows {{field:active_daily.dau}} by day for th… |
| 2 | ✅ went well | Active user this month | `active_daily.dau` | `active_daily.dau` | ✓ | {{field:active_daily.dau}} for cfm_vn peaked at **~196.9K o… |
| 3 | ⚠️ wrong ref | compare Active user month over month | `user_active_monthly.mau` | `active_daily.dau` | ✓ | Here's the MoM breakdown for {{field:user_active_monthly.ma… |
| 4 | ◽ answered (no golden ref) | show ARPDAU last 7 days | `user_recharge_daily.revenue_vnd_total` | — | ✓ | ARPDAU for cfm_vn — Jun 16–18 (latest data available): | Da… |
| 5 | ◽ answered (no golden ref) | ARPDAU this month | `user_recharge_daily.revenue_vnd_total` | — | ✓ | ARPDAU for CFM VN in June 2026 is running in the **~2.55M –… |
| 6 | ◽ answered (no golden ref) | compare ARPDAU month over month | `user_recharge_daily.revenue_vnd_total` | — | ✓ | Here's the MoM breakdown for cfm_vn: | Period | Revenue (VN… |
| 7 | ◽ answered (no golden ref) | show ARPPU last 7 days | `user_recharge_daily.revenue_vnd_total` | — | ✓ | ARPPU trended between **~560K – 642K VND** over the 3 days … |
| 8 | ◽ answered (no golden ref) | ARPPU this month | `user_recharge_daily.revenue_vnd_total` | — | ✓ | ARPPU trended from ~₫577k on Jun 1 up to a peak of **₫845k … |
| 9 | ⚠️ wrong ref | show ARPU last 7 days | `user_recharge_daily.revenue_vnd_total` | `mf_users.arpu_vnd` | ✓ |  |
| 10 | ⬜ empty result | ARPU this month | `mf_users.arpu_vnd` | `mf_users.arpu_vnd` | · | **~49,978 VND** is the current {{field:mf_users.arpu_vnd}} … |
| 11 | ⚠️ wrong ref | show Churner last 7 days | `retention.churned_d30` | `active_daily.dau` | ✓ | The artifact shows D30 churners — users from each install c… |
| 12 | ⚠️ wrong ref | Churner this month | `retention.churned_d30` | `active_daily.dau` | ✓ | **149,196 D30 churners** from the May 2026 install cohort —… |
| 13 | ⚠️ wrong ref | compare Churner month over month | `retention.churned_d30` | `active_daily.dau` | ✓ | **Churner MoM — Apr vs May 2026** ✅ | | Apr 2026 | May 2026… |
| 14 | ◽ answered (no golden ref) | show CPI last 7 days | `game_key_metrics.cpi_vnd` | — | ✓ | CPI for cfm_vn over the last 7 days — data available throug… |
| 15 | ◽ answered (no golden ref) | CPI this month | `game_key_metrics.cpi_vnd` | — | ✓ | Data available through **Jun 17** (Jun 18 onward is null — … |
| 16 | ◽ answered (no golden ref) | compare CPI month over month | `game_key_metrics.cpi_vnd` | — | ✓ |  |
| 17 | ✅ went well | show DAU last 7 days | `active_daily.dau` | `active_daily.dau` | ✓ | Data is available through **Jun 18** — the pipeline appears… |
| 18 | ✅ went well | DAU this month | `active_daily.dau` | `active_daily.dau` | ✓ | {{field:active_daily.dau}} trended downward across June — f… |
| 19 | ⚠️ wrong ref | show Dormant user last 7 days | `mf_users.user_count` | `active_daily.dau` | ✓ | **~6.4M users** have been inactive for 7+ days across 4 lif… |
| 20 | ⬜ empty result | Dormant user this month | `mf_users.lapsed_this_month_count` | `active_daily.dau` | · | **~386,734 dormant users this month** — active in May 2026 … |
| 21 | ⚠️ wrong ref | show First-time payer last 7 days | `game_key_metrics.nnpu` | `recharge.revenue_vnd` | ✓ | {{field:game_key_metrics.nnpu}} (Net-New Paying Users) is t… |
| 22 | ⚠️ wrong ref | First-time payer this month | `game_key_metrics.nnpu` | `recharge.revenue_vnd` | ✓ | Mapped "first-time payer" to {{field:game_key_metrics.nnpu}… |
| 23 | ⚠️ wrong ref | compare First-time payer month over m… | `game_key_metrics.nnpu` | `recharge.revenue_vnd` | ✓ | Here's your First-Time Payer MoM comparison using {{field:g… |
| 24 | ⚠️ wrong ref | show Installs last 7 days | `game_key_metrics.installs` | `mf_users.installs` | ✓ | {{field:game_key_metrics.installs}} over the last 7 days — … |
| 25 | ⚠️ wrong ref | Installs this month | `game_key_metrics.installs` | `mf_users.installs` | ✓ | cfm_vn saw **~7,700–10,300 installs per day** from Jun 1–16… |
| 26 | ⚠️ wrong ref | compare Installs month over month | `game_key_metrics.installs` | `mf_users.installs` | ✓ | **{{field:game_key_metrics.installs}} — June 2026 MTD: 141,… |
| 27 | ◽ answered (no golden ref) | show LTV last 7 days | `game_key_metrics.rev` | — | ✓ | LTV dipped from **~153,395 VND** (Jun 16) to **~132,339 VND… |
| 28 | ◽ answered (no golden ref) | LTV this month | `game_key_metrics.rev` | — | ✓ | Daily cohort LTV ({{field:game_key_metrics.rev}} ÷ {{field:… |
| 29 | ◽ answered (no golden ref) | compare LTV month over month | `recharge.revenue_vnd_real` | — | ✓ | **LTV MoM: +28.8%** (May → June) | | May 2026 | June 2026 M… |
| 30 | ✅ went well | show MAU last 7 days | `active_daily.mau` | `active_daily.mau` | ✓ | MAU was **179,872** on Jun 16 and **175,871** on Jun 17 — s… |
| 31 | ✅ went well | MAU this month | `active_daily.mau` | `active_daily.mau` | ✓ | CFM VN MAU for June 2026 is **490,834** — tracked via {{fie… |
| 32 | ✅ went well | compare MAU month over month | `active_daily.mau` | `active_daily.mau` | ✓ | {{field:active_daily.mau}} for June 2026 MTD: **490,834 use… |
| 33 | ⚠️ wrong ref | show New spender last 7 days | `game_key_metrics.nnpu` | `recharge.revenue_vnd` | ✓ | Using {{field:game_key_metrics.nnpu}} — **Net-new paying us… |
| 34 | ⚠️ wrong ref | New spender this month | `mf_users.user_count` | `recharge.revenue_vnd` | ✓ | Queried {{field:mf_users.first_recharge_date}} filtered to … |
| 35 | ✅ went well | show Returning user last 7 days | `active_daily.dau` | `active_daily.dau` | ✓ | Returning users ({{field:active_daily.dau}}) trended at **~… |
| 36 | ✅ went well | Returning user this month | `active_daily.dau` | `active_daily.dau` | ✓ | **495,501 unique users** active in June so far (trailing MA… |
| 37 | ⚠️ wrong ref | compare Returning user month over mon… | `user_active_monthly.mau` | `active_daily.dau` | ✓ | Here's the MoM trend for returning users ({{field:user_acti… |
| 38 | ⚠️ wrong ref | show Revenue last 7 days | `user_recharge_daily.revenue_vnd_total` | `recharge.revenue_vnd` | ✓ | Data is available through **Jun 18** — the pipeline lags ~4… |
| 39 | ⚠️ wrong ref | Revenue this month | `user_recharge_daily.revenue_vnd_total` | `recharge.revenue_vnd` | ✓ | {{field:user_recharge_daily.revenue_vnd_total}} for June 20… |
| 40 | ◽ answered (no golden ref) | show ROAS last 7 days | `game_key_metrics.roas` | — | ✓ | ROAS came in at **8.61x** on Jun 16 and **7.25x** on Jun 17… |
| 41 | ◽ answered (no golden ref) | ROAS this month | `game_key_metrics.roas` | — | ✓ | Daily ROAS for CFM VN in June 2026 is tracking well above b… |
| 42 | ◽ answered (no golden ref) | compare ROAS month over month | `game_key_metrics.roas` | — | ✓ | Here's your ROAS MoM comparison artifact. It uses `compareD… |
| 43 | ⚠️ wrong ref | show Spender last 7 days | `user_recharge_daily.paying_users` | `recharge.revenue_vnd` | ✓ | Data is available through **Jun 18** (pipeline is ~4 days b… |
| 44 | ✅ went well | Spender this month | `recharge.revenue_vnd` | `recharge.revenue_vnd` | ✓ |  |
| 45 | ✅ went well | show WAU last 7 days | `active_daily.wau` | `active_daily.wau` | ✓ | {{field:active_daily.wau}} for cfm_vn, Jun 16–18 (3 data po… |
| 46 | ✅ went well | WAU this month | `active_daily.wau` | `active_daily.wau` | ✓ | WAU for June 2026 across 3 completed ISO weeks: | Week of |… |
| 47 | ⚠️ wrong ref | compare New spender month over month | `game_key_metrics.npu` | `recharge.revenue_vnd` | ✓ | Here's your MoM comparison for **New Spenders (NPU)** — use… |
| 48 | ⚠️ wrong ref | compare Revenue month over month | `user_recharge_daily.revenue_vnd_total` | `recharge.revenue_vnd` | ✓ | Here's the MoM revenue comparison for cfm_vn — {{field:user… |
| 49 | ❌ not answered | Active user by platform | `—` | `active_daily.dau` | · | `"mf_users.platform"` isn't available in this game's data m… |
| 50 | ❌ not answered | ARPDAU by platform | `—` | — | · |  |
| 51 | ❌ not answered | Churner by platform | `—` | `active_daily.dau` | · |  |
| 52 | ❌ not answered | CPI by platform | `—` | — | · |  |
| 53 | ❌ not answered | DAU by platform | `—` | `active_daily.dau` | · |  |
| 54 | ❌ not answered | show Dolphin last 7 days | `—` | `mf_users.user_count` | · | The game's data model is temporarily unavailable (Cube `/me… |
| 55 | ❌ not answered | Dolphin this month | `—` | `mf_users.user_count` | · | The game's data model is temporarily unavailable (Cube `/me… |
| 56 | ❌ not answered | compare Dolphin month over month | `—` | `mf_users.user_count` | · |  |
| 57 | ❌ not answered | Dolphin by platform | `—` | `mf_users.user_count` | · | The game's data model is temporarily unavailable (Cube `/me… |
| 58 | ❌ not answered | compare Dormant user month over month | `—` | `active_daily.dau` | · |  |
| 59 | ❌ not answered | Dormant user by platform | `—` | `active_daily.dau` | · |  |
| 60 | ❌ not answered | First-time payer by platform | `—` | `recharge.revenue_vnd` | · |  |
| 61 | ❌ not answered | Installs by platform | `—` | `mf_users.installs` | · |  |
| 62 | ❌ not answered | LTV by platform | `—` | — | · |  |
| 63 | ❌ not answered | MAU by platform | `—` | `active_daily.mau` | · |  |
| 64 | ❌ not answered | Minnow by platform | `—` | `mf_users.user_count` | · |  |
| 65 | ❌ not answered | New spender by platform | `—` | `recharge.revenue_vnd` | · |  |
| 66 | ❌ not answered | Returning user by platform | `—` | `active_daily.dau` | · |  |
| 67 | ❌ not answered | Revenue by platform | `—` | `recharge.revenue_vnd` | · |  |
| 68 | ❌ not answered | ROAS by platform | `—` | — | · |  |
| 69 | ❌ not answered | compare Spender month over month | `—` | `recharge.revenue_vnd` | · |  |
| 70 | ❌ not answered | Spender by platform | `—` | `recharge.revenue_vnd` | · |  |
| 71 | ❌ not answered | WAU by platform | `—` | `active_daily.wau` | · | Which time range should I use? |
| 72 | ❌ not answered | show Whale last 7 days | `—` | `mf_users.user_count` | · | Which metric should I show for Whale users over the last 7 … |
| 73 | ❌ not answered | Whale this month | `—` | `mf_users.user_count` | · |  |
| 74 | ❌ not answered | compare Whale month over month | `—` | `mf_users.user_count` | · |  |
| 75 | ❌ not answered | Whale by platform | `—` | `mf_users.user_count` | · | Which metric should I show for whales by platform? |
| 76 | ◽ answered (no golden ref) | compare ARPPU month over month | `user_recharge_daily.revenue_vnd_total` | — | ✓ | **Only June 2026 data is available in `user_recharge_daily`… |
| 77 | ❌ not answered | ARPPU by platform | `—` | — | · | Which time range should I use? |
| 78 | ⚠️ wrong ref | compare ARPU month over month | `user_recharge_monthly.arppu_vnd_monthly` | `mf_users.arpu_vnd` | ✓ | **Metric note:** The business-metric `mf_users.arpu_vnd` is… |
| 79 | ❌ not answered | ARPU by platform | `—` | `mf_users.arpu_vnd` | · |  |
| 80 | ✅ went well | compare DAU month over month | `active_daily.dau` | `active_daily.dau` | ✓ | Artifact is live. Click the card to open it in `/build` — t… |
| 81 | ❌ not answered | show Minnow last 7 days | `—` | `mf_users.user_count` | · |  |
| 82 | ❌ not answered | Minnow this month | `—` | `mf_users.user_count` | · | Which metric should I show for Minnow players this month? |
| 83 | ❌ not answered | compare Minnow month over month | `—` | `mf_users.user_count` | · |  |
| 84 | ❌ not answered | compare WAU month over month | `—` | `active_daily.wau` | · |  |

---
_Generated by answer-quality-report.ts from cfm_vn-glossary-aq-snapshot.json._