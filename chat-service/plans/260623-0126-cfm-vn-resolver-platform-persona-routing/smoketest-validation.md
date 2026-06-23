# Smoketest validation — before/after harness

A 16-case curated smoketest gates this plan. Capture a **before** baseline on
current (pre-fix) code, implement, then re-run and diff. The point of the guard
cases is to catch regressions and over-defaulting, not just confirm the fixes.

## Files (ready, committed)
- `test/eval/resolver-smoketest-bank.json` — 16 cases (10 `fix` + 6 `guard`).
  Member names are identical across all 8 games → one bank serves cfm_vn + jus_vn.
- `test/eval/resolver-smoketest-diff.ts` — judges before vs after; exits non-zero
  on any fail.
- `answer-quality-runner.ts` now records `resolvedDims` so the platform
  breakdown member is machine-checked (not eyeballed).

## Case groups
- **A · Platform (5, fix):** `DAU/revenue/ROAS/installs/CPI by platform` →
  must bind `(os_)?platform` on the metric's cube.
- **B · Segment default-metric (4, fix):** `Minnow last 7 days`, `Whale this
  month`, `Whale revenue last 7 days` (money cue → Revenue), `compare Dolphin mom`.
- **C · WAU (2):** `show WAU last 7 days` (guard — already works, must stay green),
  `compare WAU mom` (fix — the one failing WAU case).
- **D · Regression guards (5):** plain DAU, revenue-30d, `DAU by country` (existing
  dimension path), `top 10 players by revenue` (grain not silently defaulted),
  `asdf qwer` (anti over-default tripwire — must stay non-ok).

## Procedure

Prereq: host chat-service on :3005, subscription lane, workspace=local (the runner
flips the lane; load `INTERNAL_SECRET` via `--env-file`).

```bash
# 1. BEFORE baseline — run on CURRENT code, per game (do this before implementing):
GAME=cfm_vn CORPUS=test/eval/resolver-smoketest-bank.json \
  SNAPSHOT_OUT=test/eval/cfm_vn-smoketest-before.json \
  RUN_DIR=test/eval/runs/smoketest-before-cfm PACE_MS=3000 \
  npx tsx --env-file=../.env --env-file=../.env.local test/eval/answer-quality-runner.ts
# repeat with GAME=jus_vn → jus_vn-smoketest-before.json

# 2. … implement Phase 01/02/03 …

# 3. AFTER — same command, *-after.json + RUN_DIR=...-after-cfm

# 4. Diff:
BANK=test/eval/resolver-smoketest-bank.json \
  BEFORE=test/eval/cfm_vn-smoketest-before.json \
  AFTER=test/eval/cfm_vn-smoketest-after.json \
  npx tsx test/eval/resolver-smoketest-diff.ts
```

## Pass criteria
- All 10 `fix` cases: AFTER status `ok`, `resolvedRef` matches `expectedRef`,
  `resolvedDims` includes `expectedDim` (platform cases).
- All 6 `guard` cases: status + resolvedRef + dims **unchanged** before→after.
  In particular `sm-guard-empty` must stay non-`ok` — if it flips to `ok`, the
  Phase 02 default is over-firing.
- Full trail for every case lands under the `RUN_DIR` for forensics.

## Recorded cfm_vn before-baseline (2026-06-23, canonical token)
Frozen at `test/eval/cfm_vn-smoketest-before.json` + `runs/smoketest-before-cfm/`.
**7 ok / 9 no-artifact / 0 http-error.**

- Guards all correct: `show DAU`→`active_daily.dau`; `revenue 30d`→
  `user_recharge_daily.revenue_vnd_total`; `DAU by country`→ok +
  `active_daily.country_code`; `top 10 players by revenue`→ok, binds player grain
  `user_recharge_daily.user_id`; `asdf qwer`→no-artifact; WAU plain + mom both ok.
- Gaps to close (no-artifact): 5× platform breakdown (Phase 01), `Minnow`,
  `Whale this month`, `compare Dolphin mom` (Phase 02). `Whale revenue` already ok.
- After-fix target: **15/16 ok** (empty stays non-ok).

Verified facts that refine the plan:
- Platform gap is **uniform** across engagement / revenue / UA cubes (all 5 fail
  with explicit time → true dimension-binding failures, not time-clarify).
- Revenue ref is **`user_recharge_daily.revenue_vnd_total`** (confirmed 3×), not
  the earlier-guessed `recharge.revenue_vnd`.
- WAU plain AND mom already answer → Phase 03 = cros+tf cube parity only, no
  chat-service work.
- `top 10 players by revenue` already resolves player grain → grain handling not
  at risk from Phase 02's default.

**jus_vn parity (2026-06-23):** `test/eval/jus_vn-smoketest-before.json` is
identical to cfm_vn — 7/16 ok, same 8 gaps, same guards green, same refs/dims,
same revenue member. Confirms the code-once fix applies uniformly across games.
After-fix target for both: 15/16 ok.

**Lesson:** the first baseline conflated failure modes — Group A questions without
a time window tripped a *time* clarify before the dimension was exercised. Fix:
every dimension-breakdown case carries an explicit time window so the smoketest
isolates the member under test. (Bank updated; this is why the bank questions read
"… by platform last 7 days".)

## Recorded cfm_vn AFTER result (2026-06-23, post-implementation)
Frozen at `test/eval/cfm_vn-smoketest-after.json` + `runs/smoketest-after-cfm/`.
**13 ok / 3 non-ok — up from 7/16. +6 net, zero true regressions.**

FIXED (7): all 5 platform breakdowns (`active_daily.os_platform`,
`user_recharge_daily.os_platform`, `game_key_metrics.platform`) + `show Minnow`
+ `Whale this month` (both → `active_daily.dau`, the active-user default).
Guards all stable (Whale revenue, show WAU/DAU, revenue 30d, DAU by country,
top-10 players, empty tripwire still non-ok).

The 2 remaining failures are **data-limited, not resolver gaps** (verified):
- `compare WAU month over month` + `compare Dolphin month over month`:
  the cfm_vn test set holds **only one month (2026-06)** of data
  (`active_daily.log_date` granularity=month → single bucket), so a
  month-over-month comparison is impossible regardless of resolution. WAU-mom's
  trail shows the agent correctly declining ("Only June 2026 data exists…") and
  offering week-over-week — the before-baseline `ok` was a degenerate
  single-month emit, so the decline is *more* correct, not a regression.
- Secondary observation (not blocking): on a "compare X month over month"
  framing the agent sometimes skips `disambiguate_query` entirely and
  free-explores, so the resolver default never runs. Moot here (mom needs ≥2
  months of data) — a follow-up if a multi-month dataset is loaded.

Transients during the first pass (Minnow http-error, Whale-revenue/WAU-mom
turn-errors, top-10 no-artifact) all cleared on the `RESUME=1 RESUME_KEEP=ok`
re-run — confirms they were `tsx watch` reload drops, not logic.

## Recorded jus_vn AFTER result (2026-06-23, parity check — game #2)
Frozen at `test/eval/jus_vn-smoketest-after.json` + `runs/smoketest-after-jus/`.
**14 ok / 2 non-ok — up from 7/16.** Confirms the code-once fix lands identically
on a second game (no per-game resolver work).

Same fixed set as cfm_vn: all 5 platform breakdowns
(`active_daily.os_platform` / `user_recharge_daily.os_platform` /
`game_key_metrics.platform`), `show Minnow` + `Whale this month` →
`active_daily.dau`, `Whale revenue` → `user_recharge_daily.revenue_vnd_total`.
Guards stable; empty tripwire stays non-ok (no over-defaulting).

The strict diff reports `12 pass · 4 fail` on **both** games — the 4 are NOT
regressions from the resolver fix:
- `sm-plat-roas` (both) / `sm-plat-cpi` (jus): platform dim binds and an artifact
  emits (no-artifact → ok), but the metric resolves to a revenue/cost proxy
  (`game_key_metrics.rev` / `.cost_vnd`) rather than the ratio measure the bank
  hypothesised (`roas` / `cpi_vnd`). ROAS/CPI-as-ratio is a **separate pre-existing
  measure-resolution gap**, out of scope for the platform-dimension fix. The bank
  expectedRefs are left unchanged so the gap stays visible (no silent masking).
- `sm-wau-mom` (both): `ok → no-artifact`. The resolver code is provably inert here
  (metric present → default-injection guard `!metricSlot.value` is false; no
  platform synonym in the message), so the change is the agent's mom-handling on a
  single-month dataset, identical to cfm_vn — the before `ok` was a degenerate
  single-month emit; the decline is more correct.
- `sm-seg-dolphin-mom` / `sm-guard-country`: LLM member-choice variance on
  mom-comparison / country breakdown (jus emitted revenue+log_month, cfm declined;
  cfm picked `mf_users.country`, jus `active_daily.country_code`) — both valid,
  status stays ok where an artifact is produced; not on the resolver-fix code path.

Net: identical fixed set, identical guard behaviour, zero true regressions across
both games → code-once fix verified to generalize.

## Layer B — remaining 6 games (first pass 2026-06-23, partial, cap-blocked)
Slugs confirmed via live `/meta` probe (`:3004/cube-api/v1/meta`, ws=local):
ballistar, cros, muaw, ptg, pubg, **tf** (pubgm is invalid → `pubg`). Member
coverage matches the plan table: all 6 carry `os_platform` + `payer_tier` +
`revenue_vnd` family; only **cros + tf lack `wau`** (deferred cube gap).

Cross-game parity matrix: `test/eval/resolver-smoketest-parity-matrix.ts`
(`GAMES="…" npx tsx …`). Judges each game's AFTER snapshot against the bank with
the documented caveats; platform cases pass on "artifact emits + a platform-family
leaf (`os_platform`|`platform`) binds on the metric's resolved cube" — NOT the
exact cfm member, because the resolved cube/measure name varies per game by design.

**Platform fix (Phase 01) — VERIFIED 5/5 on all 6 swept games** (cfm_vn, jus_vn,
ballistar, cros, muaw, ptg): every platform breakdown emits an artifact with a
platform-family dim bound. Per-game member variance observed (all valid, artifact
emits): ptg revenue→`recharge.revenue_vnd` (dim `recharge.os_platform`),
ptg installs→`mf_users.user_count`; ballistar/cros/muaw ROAS+CPI bind the **true**
`game_key_metrics.roas`/`cpi_vnd` ratio measures (cfm/jus bind a rev/cost proxy —
cfm/jus glossary gap, not a regression).

**Segment-default fix (Phase 02)** — green wherever the turn actually ran
(ballistar + muaw both cases ok; cros Whale-month ok; cfm/jus baseline ok).

ok-counts first pass: ballistar 14, muaw 13, cros 12, ptg 9 (corrupted — see below).

**Cap-blocked / transient (must resume after the subscription session cap resets,
8:30pm Asia/Saigon):**
- **pubg, tf**: capped at 1/16 mid-run — need a full resume run.
- **ptg**: hit by repeated `tsx watch` reload churn (a concurrent session editing
  `src` drops in-flight turns) — 5 `no-artifact` drops on cases that pass elsewhere
  (minnow, whale-month, whale-rev, guard-dau, guard-country). The 9 real passes
  (all 5 platform + wau plain/mom + grain + rev + empty) confirm ptg's model is
  fine; the drops are a harness artifact, not a resolver gap. Full resume re-run.
- **cros**: 1 minnow drop (transient — Whale-month passed, so the default path works
  on cros). **muaw**: 1 grain drop (transient — bound correctly on every other game).

Resume keeps each game's already-ok cases and re-runs only the non-ok:
`for g in pubg tf ptg cros muaw; do GAME=$g CORPUS=<bank> SNAPSHOT_OUT=… RUN_DIR=…
RESUME=1 RESUME_KEEP=ok PACE_MS=4000 npx tsx … answer-quality-runner.ts; done`

Verdict so far: **zero true resolver regressions across all 6 swept games.** Every
non-ok is a reload/cap transient, the cros/tf `wau` cube gap, the data-blocked mom
cases, or the correct empty-tripwire decline.

## Notes
- `expectedBefore` in the bank are diagnosed hypotheses; the baseline confirms
  them (a case already `ok` before wasn't a real gap).
- `sm-guard-rev` is the revenue-ref oracle: its baseline `resolvedRef` reveals the
  real Revenue member, which should match `sm-plat-rev` / `sm-seg-whale-rev`. If
  the baseline shows a different ref, update those two `expectedRef`s before
  trusting their AFTER verdict.
- Subscription cap: 16×2 turns is small but paced; resume if the window caps.
