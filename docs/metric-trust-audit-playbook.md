# Metric-Trust Audit Playbook

Repeatable procedure to take a game's business-metrics from "pile of drafts" to
"certified where honest, with a clear worklist for the rest". Generalized from
the cfm_vn pass (2026-06-17).

## Mental model (read first)

- **Trust is global, resolvability is per-game.** Each metric is one YAML in
  `server/src/presets/business-metrics/` with a single `trust:` field
  (`draft` / `certified` / `deprecated`). Certifying writes `trust: certified`
  for *every* game.
- **The badge is honest per-game anyway.** `resolveTrustForGame`
  (`server/src/services/metric-trust-resolver.ts`) downgrades a certified
  metric to `draft` at display time for any game whose `/meta` doesn't resolve
  the metric's formula refs. It never upgrades. So a metric can be globally
  certified yet show draft for a game that lacks the cube — that's by design.
- **The cert gate** (`PATCH /api/business-metrics/:id/trust`) refuses to
  certify unless every formula ref resolves against the target game's `/meta`
  (and the actor is admin; auto in `AUTH_DISABLED` dev). This is what the
  playbook drives — it never edits YAML directly.
- **Applicability ≠ trust.** `meta.applicability[{game, applicable}]` marks a
  metric structurally N/A for a game (e.g. no source pipeline). Orthogonal to
  trust; used to keep N/A metrics out of the chat agent's available set.

## The four buckets

For a game G, every metric lands in exactly one:

| Bucket | Condition | Action |
|---|---|---|
| **CERTIFIED** | refs resolve, already `certified` | none |
| **READY** | declared `draft`, refs resolve, applicable | **auto-certify** (governed PATCH) |
| **GAP** | refs unresolved, *applicable* for G | **modeling work** — build the missing cube/measure, then it becomes READY |
| **N/A** | refs unresolved, `applicable:false` for G | leave draft; keep the note accurate |

## Run it

```bash
cd server
npm run audit:metric-trust                 # report, all games
npm run audit:metric-trust -- --game jus_vn # one game
npm run audit:metric-trust -- --promote     # certify every READY metric
npm run audit:metric-trust -- --json        # machine-readable
```

Script: `server/src/scripts/audit-and-promote-metric-trust.ts`. Drives the
running dev server (`API_BASE`, default `http://localhost:3004`) so the same
governed gate runs as in the UI. Read-only without `--promote`. Companion to
`check:metric-drift` (the read-only CI gate); this one also classifies and acts.

**Order of operations per game:**
1. Run report-only. Auto-certify the READY set with `--promote`.
2. For GAP metrics, walk the build-decision tree below. Build where cheap+real.
3. Restart the dev cube (`docker restart cube-playground-cube-api-dev` —
   `DEV_MODE=false` ⇒ no hot-reload) so new measures land in `/meta`.
4. Re-run `--promote`: the just-unblocked metrics are now READY and certify.
5. Verify a real query returns sensible non-zero data before trusting it.

## Build-decision tree for GAP metrics

A GAP means the metric is *meant* for this game but its ref doesn't resolve.
Find out **why** before building — do not fabricate a measure to make a badge
go green.

1. **Does the source data exist?** Check the raw table the cube would read.
   - *No source at all* (e.g. concurrency CCU samples) → **do not build.** Mark
     `applicable:false` with an accurate note. Building = fabrication.
   - *Source exists but un-surfaced* (columns present, not modeled — e.g.
     per-role recharge lives in `etl_ingame_recharge.role_id` but isn't on
     `user_roles`) → **build**: it's a modeling change on data we already read.
   - *Source exists, columns reserved-but-empty upstream* → **do not build**
     (would return a confident 0). Mark N/A pending the upstream fill.
2. **Is the whole cube missing?** (e.g. `funnel` exists for no game) → larger
   project: needs ingestion + a new cube. Scope separately.
3. **Does a sibling game already model it?** Port that cube/measure. cfm is the
   most complete reference today — most GAPs are "cfm has the cube, game X
   doesn't". Porting beats re-deriving.

**Never fabricate, never reverse a documented decision silently.** If an
`applicable:false` note looks wrong, verify against the live model before
flipping it (cfm's "single-character" note was factually wrong — `user_roles`
proves multi-role — so flipping it was justified; the concurrency notes are
correct, so they stay).

## Current snapshot (2026-06-17, local workspace — after role-measure sweep)

| game | certified | gap | n/a |
|---|---|---|---|
| cfm_vn | 63 | 0 | 10 |
| ptg | 54 | 19 | 0 |
| ballistar | 52 | 21 | 0 |
| jus_vn | 52 | 21 | 0 |
| muaw | 52 | 21 | 0 |
| pubg | 52 | 21 | 0 |
| cros | 47 | 26 | 0 |
| tf | 45 | 28 | 0 |
| **total** | **417** | **157** | **10** |

`ready` is 0 everywhere: because trust is global, the cfm pass already
certified every globally-resolvable metric for all games. Remaining drafts are
GAP or N/A — all modeling work, nothing left to auto-promote until a cube is
added.

The `active_role` / `new_role` pair (+14 certified, prior snapshot 403→417)
moved out of GAP for all 7 non-cfm games on 2026-06-17 by porting the
`active_roles` / `new_roles` measures into every game's `user_roles` cube
(`mf_ingame_roles` exists in all 8 schemas — confirmed via
`information_schema.tables`). No PATCH was needed: the metrics were already
globally `certified`, so once the cube resolved the refs they un-downgraded
on display. Verified real on jus_vn: 190,711 active / 55,284 new roles (last
30d), distinct, with role grain genuinely above user grain (2.13 roles/user
in-window).

### Verified source reality (2026-06-17) — the "port from cfm" assumption was wrong

Before this pass the worklist assumed cfm's event cubes could be ported to the
other games. An `information_schema.tables` check across all 8 game schemas in
`game_integration` **falsifies that for three of the four**:

- `etl_ingame_lotteryshoot` (gacha) → **cfm_vn only.**
- `etl_ingame_newbietutorial` (tutorial) → **cfm_vn only.**
- `etl_ingame_moneyflow` (the exact cfm table) → **cfm_vn only.** jus_vn and ptg
  have a *differently named* cousin (`etl_ingame_money_flow`, underscore) with
  its own schema + its own currency/reason enums — a per-game modeling project,
  NOT a verbatim port. The cfm cube's `money_type` / `reason_base` / `reason_action`
  CASE maps are CrossFire-specific and would mislabel any other game.
- `mf_ingame_roles` (role grain) → **all 8 schemas** — the one genuinely
  portable piece; done this pass.

cfm_vn is uniquely deep-instrumented: 28 `etl_ingame_*` tables vs 4–11 for the
rest. Porting a cube onto a table that doesn't exist in the target schema does
NOT unblock the metric — the cube fails to introspect and the ref stays broken.
So these are GAP-blocked-on-source, not portable.

### Systematic gaps (the worklist) — corrected against verified table reality

| Missing | Metrics | Games affected | Verdict |
|---|---|---|---|
| `user_roles` active/new_roles | active_role, new_role | all but cfm | ✅ **DONE 2026-06-17** — measures added to all 7; resolve + display-certify |
| `etl_lottery_shoot` | gacha_pulls, gacha_players, gacha_diamond_cost | all but cfm | **blocked: source absent** — `etl_ingame_lotteryshoot` is cfm-only; needs per-game gacha t-log ingestion, not a port |
| `etl_newbie_tutorial` | tutorial_*starters/completions/rate | all but cfm | **blocked: source absent** — `etl_ingame_newbietutorial` is cfm-only |
| `etl_money_flow` | diamond_net_delta, diamond_spend_events, economy_spenders | all but cfm | **blocked: source absent** for verbatim port; jus_vn/ptg have own `etl_ingame_money_flow` (different schema + enums) = separate per-game project; diamond_* are cfm-currency-specific |
| `active_daily` online-time/trailing | avg_online_time, total_online_time, (cros/tf also wau, trailing_mau, trailing_wau) | most | per-game cube completeness |
| `user_recharge_daily` | trailing_mpu, trailing_wpu | cros, tf | per-game |
| `recharge` | paying_rate, paying_users | tf only | tf recharge-cube gap |
| `mf_users` paying_role/new_paying_role | paying_role, new_paying_role | all | build role-grain recharge from `etl_ingame_recharge` (has role_id); best value on multi-role games (jus_vn ≈2.13 roles/user in-window, 7 servers; cfm 1.03/1 server) |
| `funnel` (cvr_*) | cvr_install, cvr_register, cvr_login_form, cvr_cdn_download | all | **blocked**: no funnel cube anywhere + AppsFlyer feed not ingested — new source + cube |
| `mf_users` concurrency | acu, ccu, lcu, pcu | all | **mostly N/A**, but **jus_vn + ptg have `etl_ingame_ccu`** (raw concurrent-user samples) → buildable there with CCU sampling semantics; cfm + the other 5 have no CCU source → N/A |

**Reality after this pass:** the one clean cross-game sweep (role measures) is
done. The remaining 157 gaps are NOT ports — they need per-game source
ingestion or per-game cube modeling. The next real opportunities are narrow,
not broad: (a) role-grain recharge → paying_role/new_paying_role on the
multi-role games; (b) jus_vn/ptg concurrency from `etl_ingame_ccu`;
(c) jus_vn/ptg money_flow as bespoke per-game cubes.

## Worked examples from the cfm pass

- **Built + certified** `active_role`/`new_role`: added `active_roles`/`new_roles`
  count-distinct measures to `cfm/user_roles.yml`, repointed refs from the
  nonexistent `mf_users.*` to `user_roles.*`, flipped applicability to true.
  Verified 671k active / 146k new roles (last 30d) — real, distinct.
- **Left N/A** acu/ccu/lcu/pcu: no concurrency source exists; corrected the
  notes to say so precisely.
- **Left N/A** paying_role/new_paying_role: source is derivable
  (`etl_ingame_recharge.role_id`) but un-surfaced; flagged as a build candidate,
  best targeted at multi-role games, not cfm.

## Unresolved questions

- Should "certified" stay global, or become per-game? Today a metric certified
  off one game reads `certified` in YAML while display-downgrading for games
  that lack the cube. Honest at the badge, slightly surprising in the file.
- `distinct_servers=1` for cfm in the loaded slice — confirm against prod
  before concluding cfm is genuinely single-server vs a narrow test-data load.
- Funnel (cvr_*) needs an upstream decision: is the AppsFlyer funnel feed ever
  going to land in these games' namespaces, or should the 4 metrics be retired?
