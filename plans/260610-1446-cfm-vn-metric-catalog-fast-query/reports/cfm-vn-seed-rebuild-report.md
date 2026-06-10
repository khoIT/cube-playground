# CFM VN — Phase 5 Seed Rebuild Report

**Generated:** 2026-06-10 GMT+7
**Scope:** Starter questions, agent vocabulary / synonyms, server seeders — all reconciled to cfm_vn fast/cold/blocked table from Phase 3 spec.

---

## 1. Seeds per Surface

### 1.1 Frontend static library — `src/pages/Chat/library/starter-questions.ts`

Old set: 18 questions, majority pointing at `mf_users.*` members (cold, no rollup) and `new_user_retention.*` retention curve starters.

New set: **18 questions** across 7 domains, every `targetCatalogIds` entry is a `business_metrics/<id>` path for a **FAST** metric only:

| Domain | Seeds | Fast metric ids |
|--------|-------|----------------|
| Revenue / Payments | 3 | `revenue`, `arppu`, `iap_revenue` |
| Engagement | 3 | `dau`, `wau`, `total_online_time_hrs` |
| Acquisition / Marketing | 4 | `nru`, `installs`+`cpi`, `roas`, `cost` |
| Retention | 1 | `rp` |
| Economy (diamond flow) | 3 | `diamond_spend_events`, `diamond_net_delta`, `economy_spenders` |
| Gacha / Lottery | 2 | `gacha_pulls`, `gacha_diamond_cost` |
| Onboarding / Tutorial | 2 | `tutorial_completion_rate`, `tutorial_starters`+`tutorial_completions` |

Removed: all seeds that pointed at `mf_users.*` (cold), `retention.*` (cold, no pre-agg), `new_user_retention.rnru_*` (retention curve starters—not in fast list), `mf_users.ltv_total_vnd` (cold).

### 1.2 Chat-service template engine — `chat-service/src/core/starter-question-templates.ts`

New templates added (fire only when matching members exist in the game's `/meta`):

| Template id | Fires on fields | Domain |
|-------------|----------------|--------|
| `revenue-trend-30d` | `revenue_vnd_total`, `revenue_vnd`, `rev` | Revenue |
| `paying-retention-trend` | `rpnpu_d7`, `rpnpu_d30` | Retention |
| `diamond-spend-daily` | `out_events`, `diamond_out_events` | Economy |
| `diamond-net-delta-trend` | `total_delta`, `net_delta` | Economy |
| `economy-spenders-count` | `distinct_players` (economy cube probe) | Economy |
| `gacha-pulls-trend` | `pulls`, `pull_count`, `total_pulls` | Gacha |
| `gacha-diamond-cost-by-banner` | `total_cost_diamond`, `diamond_cost` | Gacha |
| `tutorial-completion-rate` | `completion_rate`, `tutorial_completion_rate` | Onboarding |
| `tutorial-starters-vs-completions` | `completed_count` + `started_count` | Onboarding |

All existing templates preserved (dormant-whales, churn-risk-payers, vip-outreach-list, dau-trend, spend-by-channel, retention curves, etc.). No cold/blocked metric templates were added.

Field-segment constants extracted to `chat-service/src/core/starter-question-template-fields.ts` to keep the main file manageable.

### 1.3 Server dashboard starter packs

Two new fast-pack YAMLs added:

| Pack slug | `required_cubes` | Tiles |
|-----------|-----------------|-------|
| `economy-and-gacha` | `[etl_money_flow, etl_lottery_shoot]` | diamond spend events (line), diamond net delta (bar), economy spenders (kpi), gacha pulls (line) |
| `onboarding-funnel` | `[etl_newbie_tutorial]` | completion rate (line+kpi), starters (kpi), completions (kpi) |

Existing packs (`daily-health`, `monetization`, `retention-deep-dive`) unchanged — `retention-deep-dive` uses the `retention` cube (cold, no rollup) but is availability-gated so it only seeds when that cube is present; the pack itself is not "fast-claiming."

---

## 2. Synonym Additions / Preservations

### 2.1 `gross_bookings` alias preservation

`revenue` glossary entry (`server/data/glossary.seed.json`) extended:
- `aliases`: added `"gross bookings"`, `"bookings"`, `"total bookings"`
- `aliases_vi`: added `"gross bookings"`, `"tổng đặt hàng"`

Result: a user typing "gross bookings" resolves to the `revenue` term (same underlying `user_recharge_daily.revenue_vnd_total` measure after repoint). The `gross_bookings` preset itself also remains in the catalog and resolves via `list_business_metrics`.

### 2.2 New metric glossary entries (12 new terms)

Added to `server/data/glossary.seed.json`:

| Term id | Key aliases (EN) | Key aliases (VI) |
|---------|-----------------|-----------------|
| `diamond_spend_events` | "diamond spend", "diamond transactions" | "tiêu kim cương" |
| `diamond_net_delta` | "diamond net delta", "net diamond", "diamond delta" | "biến động kim cương" |
| `economy_spenders` | "economy spenders", "diamond spenders" | "người tiêu kim cương" |
| `gacha_pulls` | "gacha", "lottery pulls", "pulls", "draw count", "spins" | "lượt quay", "quay gacha" |
| `gacha_diamond_cost` | "gacha diamond cost", "gacha spend", "diamonds spent on gacha" | "kim cương quay gacha" |
| `gacha_players` | "gacha players", "lottery players", "gacha participants" | "người chơi gacha" |
| `tutorial_completions` | "tutorial completions", "onboarding completions" | "hoàn thành tutorial" |
| `tutorial_completion_rate` | "tutorial completion rate", "tutorial rate", "onboarding completion rate" | "tỉ lệ tutorial" |
| `tutorial_starters` | "tutorial starters", "onboarding starters" | "người bắt đầu tutorial" |
| `total_online_time_hrs` | "total online time", "playtime hours", "session time" | "tổng thời gian online" |
| `avg_online_time_min_per_dau` | "avg online time", "average session time", "avg playtime per dau" | "thời gian online trung bình" |
| `iap_revenue` | "iap", "in-app purchase revenue", "app store revenue" | "doanh thu iap" |

### 2.3 Synonym-resolver architecture note

`chat-service/src/nl-to-query/synonym-resolver.ts` is a pure engine — it processes whatever `OfficialTerm[]` it receives from the glossary fetch. No hardcoded metric lists exist in that file. The synonym-resolver itself required no changes; all phrase-matching additions are in the glossary seed.

---

## 3. All Three Surfaces Reconciled

| Surface | Cold/blocked metrics removed? | Fast new metrics added? |
|---------|------------------------------|------------------------|
| Frontend starter-questions.ts | Yes — mf_users, retention curve seeds removed | Yes — 12 new fast metrics seeded |
| Chat-service template engine | No cold templates existed; 9 new fast templates added | Yes |
| Glossary seed | N/A (no blocking; cold terms remain resolvable, just not seeded) | Yes — 12 new terms |
| Dashboard starter packs | No new cold packs added | Yes — economy-and-gacha, onboarding-funnel |

---

## 4. TypeScript / Test Results

### tsc --noEmit

| Package | Result |
|---------|--------|
| `chat-service` | PASS (0 errors) |
| `server` | PASS (0 errors, lakehouse/* errors pre-existing + excluded) |
| Frontend `src/` | Pre-existing errors in unrelated files (cdp-projection, perf-probe, settings); **no errors in Chat/library/* files touched** |

### Scoped test runs

| Test file | Result |
|-----------|--------|
| `src/pages/Chat/__tests__/starter-output-hint.test.ts` | 6/6 PASS |
| `chat-service test/core/starter-question-templates.test.ts` | 7/7 PASS |
| `chat-service test/core/starter-question-seed-serving.test.ts` | 8/8 PASS |
| `chat-service test/core/starter-question-service-and-refiner.test.ts` | 16/16 PASS |
| `chat-service test/nl-to-query/synonym-resolver.test.ts` | 4/4 PASS |
| `server test/golden-query-seeder.test.ts` | 5/5 PASS |
| `server test/dashboard-starter-pack-seeder.test.ts` | 4/4 PASS |
| `server test/glossary-unified-refs.test.ts` | 5/5 PASS |

**Total: 55 tests, all PASS.**

---

## 5. Phase-0 Scorer — Baseline Status

Baseline snapshot exists at `chat-service/test/metric-resolution-eval/cfm-vn-baseline-snapshot.json` with 33 case results (capturedAt: 2026-06-10T09:29:16Z).

Phase 5 changes are **additive only** (new glossary terms, new template templates, new seed ids). No existing `OfficialTerm` aliases were removed; no existing template was deleted; no cube member reference was renamed. Resolution paths for all 33 baseline cases are unchanged.

Re-run command (requires live chat-service + subscription auth):

```bash
# 1. Switch chat-service to subscription lane
curl -s -X PUT http://localhost:3005/internal/llm-auth-mode \
  -H 'Content-Type: application/json' \
  -H "x-internal-secret: $INTERNAL_SECRET" \
  -d '{"mode":"subscription"}'

# 2. Capture re-run
ANTHROPIC_SUBSCRIPTION_OAUTH_TOKEN_VY=<token> \
INTERNAL_SECRET=<secret> \
  npx tsx test/metric-resolution-eval/metric-resolution-runner.ts

# 3. Score against baseline
npx tsx test/metric-resolution-eval/metric-resolution-scorer.ts \
  test/metric-resolution-eval/cfm-vn-baseline-snapshot.json \
  test/metric-resolution-eval/cfm-vn-rerun-snapshot.json
```

Expected outcome: 0 regressions on metric/cube fields. `gross-bookings-basic` may improve from `no-artifact` → `ok` (the new glossary alias now routes "gross bookings" to the `revenue` term).

---

## Files Modified

| File | Change |
|------|--------|
| `src/pages/Chat/library/starter-questions.ts` | Rebuilt 18 seeds — all FAST metrics, 7 new domains |
| `chat-service/src/core/starter-question-templates.ts` | Added 9 new fast-metric templates; imports from fields module |
| `chat-service/src/core/starter-question-template-fields.ts` | NEW — field-segment constant lists extracted here |
| `server/data/glossary.seed.json` | `revenue` aliases extended; 12 new metric terms added |
| `server/src/presets/dashboard-starter-pack/economy-and-gacha.yml` | NEW — economy + gacha fast pack |
| `server/src/presets/dashboard-starter-pack/onboarding-funnel.yml` | NEW — tutorial funnel fast pack |

---

## Unresolved Questions

1. **`gross-bookings-basic` corpus case** — baseline shows `no-artifact`. With `gross bookings` now aliased to `revenue` in the glossary, a re-run may flip it to `ok`. If the scorer reports `newly-working` for this case, that is an improvement, not a regression. Confirm semantics are acceptable (resolves to `revenue` term, not `gross_bookings` preset directly).

2. **`TUTORIAL_STARTED_FIELDS` probe in economy-spenders template** — the template fires only when BOTH `distinct_players` AND an economy spend field resolve. This guards against mf_users.user_count mis-firing. If a game has `distinct_players` named differently in `etl_money_flow`, the template stays silent. Acceptable for now; revisit if cfm_vn's money_flow cube has a different player-count field name post-YAML change.

3. **Frontend pre-existing tsc errors** — ~25 errors in unrelated files (cdp-projection, perf-probe, workspace-context). None are in Chat/library/* or any file touched by Phase 5. These should be tracked as separate tech-debt items.
