# Red-Team — /ops Console plan (2 hostile reviewers, 2026-06-14)

Two adversarial reviewers: (A) data-correctness, (B) architecture/scope. 10 + 8 findings. Dispositions
below. Two findings touch USER-CONFIRMED decisions → surfaced to user, NOT auto-applied.

## Accepted — DATA CORRECTNESS (reviewer A)

| ID | Finding | Sev | Disposition |
|----|---------|-----|-------------|
| A1 | `paying_users` = count_distinct_approx → **non-additive**; summing daily payers double-counts uniques | Crit | ACCEPT. Headline payers/txn = single ungrouped windowed query (no day granularity). Daily trend series is display-only, NEVER summed. Test asserts headline query has no `granularity`. |
| A2 | **jus billing_detail is mixed USD+VND**; `cash_charged_gross` SUM blends currencies into nonsense | Crit | ACCEPT. jus money MUST filter `currency='VND'` OR use `recharge.revenue_vnd_real` (VND-normalized). cfm is A49/VND-only (safe). Per-game money path. |
| A3 | recon "+42%" apples-to-oranges (gateway-charged vs ingame-delivered, payer-pop); contradicts cube's own "≈1.78×" comment (`billing_lifetime.yml:13`) | Crit | ACCEPT. Reframe as structural gateway-vs-delivery **wedge** (take-rate + currency), not a "leak". Reconcile +42% vs 1.78× before any number ships. Demote from hero. |
| A4 | `billing_lifetime` + `mf_users` are **snapshots** (no usable date dim) → window toggle + Δ on recon/cross-border cards is meaningless | High | ACCEPT. Mark both as **as-of snapshot, no window, no Δ**; "as-of {date}" tag; render outside the window effect. |
| A5 | `geo_moved` = first≠last login country (travel/VPN/sharing proxy, per `mf_users.yml:98`), NOT cross-border residence; "18×/30× richer" = tenure/selection bias | High | ACCEPT. Drop "Nx richer". Relabel "first≠last login country (travel/VPN/account-sharing signal)"; show raw count + LTV only, caveated. |
| A6 | `closed_tickets`/`open_tickets` use a broken status predicate (=0 for cfm) | High | ACCEPT. Ship only status-independent CS measures (total_tickets, avg_csat, negative_sentiment, avg_resolution). Relabel `unresolved_member_tickets` as "not mapped to a game member (~FB, expected)", not a backlog. Fix status taxonomy = follow-up. |
| A7 | jus has no validated recon; card set hardcoded, not per-game | High | ACCEPT. Per-game card manifest; jus recon hidden/`n/a` until validated per currency; Phase-6 adds a jus verification row. |
| A8 | blended ROAS ill-defined; "÷ spend" not pinned to `cost_vnd` | Med | ACCEPT. Pin `marketing_cost.cost_vnd`; relabel "revenue ÷ spend (blended, not cohort-attributed)"; footnote numerator includes non-acquired-this-window revenue. |
| A9 | Δ on avg_csat/resolution distorted by CS ~2d lag (current window truncated vs complete prior) | Med | ACCEPT (mostly moot once Δ dropped). For any lagging Δ, end the window at `max(created_date)`, not today; tag "through {max}". |
| A10 | aggregate ≠ safe if grouped to n=1 (`vip_id`, `ingame_name`, `user_id`) | Low | ACCEPT. Phase-6 PII test checks DIMENSIONS too (deny `user_id`/`member_user_id`/`ingame_name`/`vip_id`), + k-anonymity threshold. |

## Accepted — ARCHITECTURE / SCOPE (reviewer B)

| ID | Finding | Sev | Disposition |
|----|---------|-----|-------------|
| B1 | `Member360View` is **propless, route-coupled** (`useParams`/`?game=`) → phase-4 "embed with gameId+uid" impossible without a refactor; reusable seam is `CsMember360View` (takes props) + lifting orchestration into a `useMember360Profile` hook | Crit | ACCEPT. Phase-4 rewritten: extract `useMember360Profile(gameId, uid)` (incl. `useCubeApiBootstrap`, B-L8) → render `CsMember360View`. OR cut to link (see USER decision below). |
| B2 | `showSection('ops')`/`hasFeature('ops')` **won't compile** — `NavItemId`/`FeatureKey` are closed unions, mirrored server-side (two-stack) | Crit | ACCEPT. Do NOT invent an 'ops' key. Add the nav item under the existing `dashboards` section, gated `showSection('dashboards') && ['cfm','jus'].includes(gameId)` (mirrors CS sub-item, sidebar.tsx:217). |
| B3 | Care embed double-polls (CsActivityStrip 30s) + "identical" only true if loading/error/empty scaffolding replicated → needs `care-monitor-body.tsx` extraction; unmount inactive tabs | High | ACCEPT (if tabs kept). Extract shared body; inactive tabs unmount (no display:none). OR cut to link. |
| B4 | game-gating **ready-race**: `gameId` defaults to `'ballistar'`, corrected async → deep-link flashes wrong gate + fires Overview queries on ballistar (may 400) | High | ACCEPT. Gate on `const {gameId, ready}=useGameContext(); if(!ready) return Loading`; fire Overview queries only when `ready && cfm/jus`. |
| B6 | Phase-6 tests don't catch the real traps (distinct-sum, snapshot Δ); cites a non-matching template; playwright boots on ballistar without localStorage seed | Med | ACCEPT. Add raw==rollup equality test (real double-count guard); export Overview query objects for the aggregate/PII contract; playwright `addInitScript` seeds `localStorage gds-cube:active-game=cfm` + workspace (pattern from existing e2e-probe spec). |
| B7 | deploy: page + rollup not atomic; ship page (bounded raw) first, reseal rollup as separate push | Low | ACCEPT. Phase-6 notes independent deployability; raw is the safe fallback. |

## Data-forced finding (new, from prior-period probe)

**No prior-30d data exists.** `billing_detail` Apr 15–May 14 returns null/0 — the source holds only ~30d
of history. → **A 30d Δ-vs-prior is impossible.** 7d Δ is possible (prior 7d within the ~30d window).
Combined with A4 (snapshots can't Δ), per-card Δ-vs-prior is cut/restricted (see USER decision).

## ⚠️ Surfaced to USER (reverse a confirmed decision — NOT auto-applied)

**U1 — Members + Care tabs (decision #2 "fold in member and care tabs").** Both reviewers (B-M4, B-C1,
B-B3) recommend cutting the EMBEDDED tabs for v1 → replace with `<Link>`s to the already-routable
`/dashboards/cs/members/:uid` and `/dashboards/cs`. Rationale: ~70% duplication of shipped surfaces;
embedding costs the B1 hook-extraction + B3 body-extraction + double-poll risk for an entry-point
convenience. Cuts ~1.5d + all of C1/B3/L8. This reverses the user's "fold in" decision → ASK.

**U2 — per-card Δ-vs-prior (my addition; window toggle is user-confirmed #3).** Δ is data-forced out
for 30d (no prior data) and meaningless on snapshots (A4). The 7d/30d window toggle + trend charts stay
(user-confirmed). Cutting per-card Δ does not reverse a user decision (Δ was mine), but confirm.

## Revised real-only card set (post-red-team)

Hero: Cash (cfm VND / jus VND-normalized) · Transactions · Paying users (single windowed distinct).
Trends: cash daily · payers-vs-cash · gateway-mix-over-time (all real, billing ≤31d, gateway on June-
sealed rollup = 13d).
Panels: Gateway mix · Support health (status-independent measures only) · Lifetime wedge (as-of, no Δ,
reframed) · Travel/VPN signal (geo_moved, as-of, count+LTV only, caveated) · Acquisition spend + blended
revenue÷spend (cost_vnd pinned).
DROPPED: promo-aware ARPU (data=0), store (1:1 gateway), item_type (single value), per-card Δ on snapshots.

## Unresolved questions
1. Reconcile recon +42% (probe) vs 1.78× (cube comment `billing_lifetime.yml:13`) — which slice is right?
2. `cs_ticket_detail.ticket_status` distinct values — to fix `closed_tickets=0` (follow-up).
3. Does the audit's jus ₫14.24B filter `currency='VND'`? If not, already wrong (A2).
4. U1 + U2 user decisions above.
