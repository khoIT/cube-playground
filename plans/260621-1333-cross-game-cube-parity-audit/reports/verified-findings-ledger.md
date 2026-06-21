# Verified findings ledger — cube structural audit (Phases 1+2)

Source: `cube-dev/scripts/reports/parity-findings.jsonl` (373 findings: 0 correctness · 121 parity · 252 cosmetic, harness severity).
Method: every accepted finding re-read against BOTH dev YAML and prod-clone oracle YAML; PK candidates confirmed empirically via Trino. No finding accepted on summary alone.

**Scope update vs plan:** plan split oracle (cfm/jus/ballistar/cros/tf) vs oracle-less (muaw/ptg/pubg). Stale — cube-prod now has oracles for muaw/ptg/pubgm too. All 8 games audited oracle-backed; Phases 1 & 2 merged here.

GAME→oracle schema: cfm→cfm_vn, jus→jus_vn, ballistar→ballistar_vn, cros→cros, tf→tf, muaw→muaw, ptg→ptg, pubg→**pubgm**.

---

## A. PK findings (the only correctness-class divergences) — VERIFIED

Harness rated all 3 `parity` ("PK differs from oracle — verify grain"). Verification result:

| Game | dev PK (`recharge.yml`) | oracle PK | Trino uniqueness on dev source | Verdict |
|------|------------------------|-----------|--------------------------------|---------|
| **ptg** | `transactionid` (`recharge.yml:46`) | composite `transactionid+accountid+rechargetime` (same table `ptg.etl_ingame_recharge`) | bare `transactionid` < whole-row count | **REAL — fix.** Oracle deliberately composites the same-table key dev uses bare → dev PK less-unique than validated model. |
| **pubg** | `fsequence_no` (`recharge.yml:48`) | composite `user_id+transaction_id` (oracle source `pubgm.std_ingame_role_recharge`) | `fsequence_no` had 577 dup rows / 2.34M (even on dirty staging) | **REAL but minor (~0.02%).** No clean composite from dev's columns (`vopenid`,`fsequence_no`) — 577 are full-row dups. Fix non-trivial. |
| **muaw** | `transaction_id` (`recharge.yml:46`) | composite `user_id+transaction_id` (oracle source `muaw.std_ingame_role_recharge`) | `transaction_id` = 1.00× UNIQUE (4.15M=4.15M) | **NOT A BUG — clear.** Oracle composites only because it reads a different role-grain `std_` table. Auto-flipping dev would be wrong. Suppress from worklist. |

**Magnitude caveat (important):** Trino `game_integration.ptg.etl_ingame_recharge` returned 37.7M rows vs 20.1M distinct on transactionid AND on the oracle composite (identical) → the extra rows are full-row duplicates. The validated oracle uses that same composite on that same-named table, so prod's table is presumably clean and this profiler/staging table is **double-loaded**. ⇒ the 1.88× figure is a staging artifact, NOT trustworthy as a prod fan-out magnitude. The fix basis is **oracle authority over PK**, not the staging count.

**jus recharge PK** (composite 5-part) — re-confirmed **CLEAN**, dev == oracle byte-for-byte. Regression guard holds (prior fix 9d3691a / 77b3982).

---

## B. Measure-parity findings (118) — VERIFIED, dedupes to a small root-cause set

All on **canonical (generator-owned) cubes** (`user_recharge_monthly`, `user_active_monthly`, `recharge`, ptg `ccu`):

| Root cause | Affected games | Count | Verdict |
|------------|----------------|-------|---------|
| `user_recharge_monthly` missing ~25 oracle measures (row_count, recharge_days, ingame_*_recharge_role_level, …) | ballistar, ptg, pubg | 75 | **PARITY-backfill candidate** via generator. cfm/jus/cros/tf already at parity → dev generator output drifted leaner for these 3 games. ASK: is leaner intentional? |
| `user_active_monthly` missing ~11 oracle measures | ballistar, ptg, pubg | 33 | same as above |
| ptg `ccu` missing samples/peak_ccu/avg_ccu | ptg | 4 | PARITY-backfill (source `ccu` table has the cols) |
| recharge measure deltas | jus, muaw, pubg | 6 | minor; case-by-case parity |

Why only 3 games: cfm/jus/cros/tf `user_*_monthly` match their oracles (0 findings). ballistar/ptg/pubg were generated/authored from an older canonical template. **One generator edit closes all three** (the Phase-4 dedupe win) — IF backfill is desired.

---

## C. Cosmetic findings (252) — VERIFIED benign

| Dimension | Count | Verdict |
|-----------|-------|---------|
| `identity` | 20 (all jus) | **Intentional** — documented `split_part()` identity-bridge pattern (jus vopenid/account_id merge). WONTFIX; expected to keep flagging — candidate for baseline suppression. |
| `measure` (label/desc/ordering) | 140 | Cosmetic drift; WONTFIX unless a label is user-facing-wrong. |
| `structure` | 91 | Field ordering / block-shape drift. WONTFIX. |
| `ratio` | 1 (jus `role_recharge_daily:128`) | `SUM(vnd)/NULLIF(COUNT(DISTINCT user_id),0)` — integer-truncation heuristic. VND ARPU truncating sub-1-dong = negligible. LOW: optional explicit `CAST(... AS DOUBLE)`. |

---

## Verdict summary

- **Real correctness divergences:** 2 (ptg PK, pubg PK) — both bespoke `recharge.yml`, hand-edit.
- **Cleared false-alarm:** 1 (muaw PK — unique on dev source).
- **Parity backfills:** ~112 measures → ≤3 generator/cube edits (ballistar/ptg/pubg monthly cubes + ptg ccu) — GATED on "is leaner intentional?".
- **WONTFIX/intentional:** 252 cosmetic incl. 20 jus identity-bridge.

## Unresolved questions
1. Is the ptg `game_integration` staging table double-loaded, or does prod also carry dup rows? (Affects whether ptg PK fix changes any served number or is purely defensive.) Needs a prod-catalog check, not the profiler catalog.
2. Is the leaner `user_*_monthly` measure set on ballistar/ptg/pubg an intentional scope decision or unintended generator drift? (Owner call — gates the backfill.)
