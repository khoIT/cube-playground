# Metric Catalog Per-Game Rollout Template

**Purpose:** Step-by-step checklist to onboard a new game to the metric-catalog standard, reaching the same quality bar as cfm_vn (36 fast metrics, cold-labeled stragglers, blocked stubs). Worked example: cfm_vn reports linked below; adapt steps per game's unique schema/pipeline.

**Estimated effort:** 40–60 hours of work (audit + YAML edits + testing + seed regeneration). Parallelizable across 2–3 people.

**Timeline:** 2–3 weeks per game, sequential (one game after cfm_vn), assuming data availability.

---

## Phase 0: Resolution-Regression Harness (Gate: Run First)

**Objective:** Capture baseline accuracy metrics before any edits, to gate regressions after implementation.

### 0.1 Build chat-agent resolution harness (if not inherited from cfm_vn)

See cfm_vn Phase 0 report for harness design. The harness:
- Runs chat-service with the game's metric catalog loaded
- Probes 50–100 randomized phrases against the starter-question library
- Captures: phrase, resolved metric ID, query shape, latency, result (success / 400 / timeout)
- Baseline snapshot stored (e.g., `plans/[game]-catalog/reports/[game]-resolution-baseline-[date].json`)

**Deliverable:** baseline.json with 50–100 sample runs. Re-run after Phases 2, 4, 5 to verify no accuracy regressions.

### 0.2 Verify harness compiles & runs

```bash
cd server
npm run test -- chat/resolution-baseline.test.ts
# Should emit baseline snapshot to plans/[game]-catalog/reports/
```

---

## Phase 1: Availability & Trino Audit

**Objective:** For each of the 57 cfm_vn baseline metrics, determine whether the game's `/meta` + Trino have the backing columns. Outcome: working / broken-ref / stub-error / no-data verdict per metric.

**Deliverable:** Availability matrix table (like cfm_vn report §1).

### 1.1 Probe game's /meta snapshot

```bash
# Fetch live /meta for the game's workspace
curl -H 'x-cube-workspace: local' \
  -H 'x-cube-game: [game_id]' \
  http://localhost:3004/cube-api/v1/meta > /tmp/[game]_meta.json

# Validate: does /meta contain the 6 logical cubes?
#   active_daily, recharge (or revenue table), mf_users, retention,
#   user_recharge_daily (or daily-payer mart), game_key_metrics (or acq mart)
python3 -c "
import json
with open('/tmp/[game]_meta.json') as f:
  data = json.load(f)
  cubes = {c['name'] for c in data.get('cubes', [])}
  print('Cubes found:', cubes)
  print('Missing:', {'active_daily', 'recharge', 'game_key_metrics'} - cubes)
"
```

### 1.2 Per-metric Trino probe (one curl per logical cube)

For each cube in /meta, run one `/load` probe to confirm data presence:

```bash
# Example: active_daily.dau probe
curl -s -X POST -H 'x-cube-workspace: local' -H 'x-cube-game: [game_id]' \
  -H 'Content-Type: application/json' \
  -d '{
    "query": {
      "measures": ["active_daily.dau"],
      "timeDimensions": [{
        "dimension": "active_daily.log_date",
        "granularity": "day",
        "dateRange": "last 7 days"
      }]
    }
  }' \
  http://localhost:3004/cube-api/v1/load | \
  python3 -c "
    import json, sys
    r = json.load(sys.stdin)
    if 'error' in r:
      print(f'ERROR: {r[\"error\"][\"message\"]}')
    else:
      print(f'OK: {len(r[\"data\"])} rows, {r[\"query\"][\"executionTime\"]}ms wall')
  "
```

Repeat for all 6 cubes. Classify each metric verdict:

| Verdict | Meaning | Action |
|---------|---------|--------|
| `resolvable+data` | /meta ✓, probe successful | Keep working |
| `broken-ref` | /meta cube exists, measure absent | Recover (repoint) or drop |
| `stub-errors` | /meta ✓, probe times out / 400 | Label cold or architecture fix |
| `no-data` | /meta ✓, probe returns 0 rows | Investigate upstream |

### 1.3 Recharge PK verdict (Critical for revenue metrics)

For games with a recharge/payment table, verify PK uniqueness:

1. **Check YAML:** is there a `primary_key: true` declaration on the transaction ID field?
2. **Cross-source agreement:** sum revenue from two sources; do they match?
   - Source A: `recharge.revenue_vnd` (raw iamount sum)
   - Source B: `user_recharge_daily.revenue_vnd_total` (pre-agg mart)
   - If ratio ~1:1, PK is PASS; if >10× divergence, possible fan-out (like cfm initially suspected, turned out to be test-traffic noise, not PK)
3. **Ratio sanity:** txns per user per day; is it plausible (<5:1 for daily window)?
4. **Oracle comparison:** if game has prod cube model in cube-prod, compare PK design; cfm vs jus contrast in memory note.

**cfm_vn example:** `primary_key: true` on vng_transaction; cross-source revenue agreement = exact match; txns/user ratio 1.29/day → PK PASS.

**jus_vn contrast:** recharge requires composite PK (5 fields) because transid repeats per user per day; structural difference in source table schema.

### 1.4 Deliver availability matrix

Create a table:

| Metric ID | Cube | Verdict | Evidence | Notes |
|-----------|------|---------|----------|-------|
| dau | active_daily | resolvable+data | /meta ✓, 516ms wall time | — |
| nru | game_key_metrics | broken-ref | measure `nru` absent | Recover via repoint |
| ... | ... | ... | ... | ... |

Reference cfm_vn report §1 as template. Save to `plans/[game]-catalog/reports/[game]-availability-matrix-report.md`.

---

## Phase 2: Width Curation & Data-Presence Audit

**Objective:** Decide: keep working / recover broken ones via repoint / add new metrics from game's event tables / drop structurally absent ones. Outcome: locked decisions on catalog scope.

**Deliverable:** Curation report (like cfm_vn §2–4).

### 2.1 Grouping broken refs by pattern

From Phase 1 broken-ref list, group by missing measure set:

```
game_key_metrics missing measures:
  - nru, npu, nnpu, installs, cost, clicks, impressions
    → Are these columns in cons_game_key_metrics_daily?
    → If yes, repoint presets from mf_users to game_key_metrics
    → If no, data-platform request or drop

mf_users missing measures:
  - new_users, new_paying_users, marketing_cost, paying_retained_d7
    → Same audit: do columns exist in upstream mf_users table?
    → Or recover via game_key_metrics repoint?

Funnel metrics (4):
  - funnel cube absent entirely
  → Drop (would need ETL + new cube)
```

### 2.2 Recover candidates via cross-cube bridging

For each broken metric, ask:

1. **Does a different cube carry the same logical concept?**
   - `nru` (new registered users) broken in mf_users → exists in game_key_metrics.nru? → Yes, recover.
   - `revenue_d7_cohort` broken in game_key_metrics (no cohort join) → exists in retention or new_user_retention? → TBD per game.

2. **Is a segment or filter sufficient?**
   - `organic_installs` broken (no separate measure) → `installs` with `is_paid_install='0'` filter → recoverable as new measure with filter.

3. **Is the metric truly unavailable or just needs schema audit?**
   - `acu` (all concurrent users) → search entire game schema for concurrency columns → found? no? → drop.

### 2.3 Event-table width proposals

Inspect game's raw event tables NOT yet in the catalog. Common patterns:

```
Games often have:
  - etl_money_flow / etl_economy → economy & resource metrics (diamond, gold, items spent)
  - etl_lottery_shoot / etl_gacha → gacha pull & pity metrics
  - etl_newbie_tutorial / onboarding → tutorial funnel + completion rates
  - user_gameplay_daily → session time, boss battles, dungeon clears
  - etl_clan / guild system → clan size, member count, activity
  - pvp arena, battle pass → ranked season metrics
```

Per game, list unmodeled event tables:

| Event table | Logical concept | Additive measure idea | Dimensions | Pre-agg status |
|-------------|-----------------|----------------------|------------|---|
| etl_money_flow | economy | `out_events` (sum), `distinct_players` | money_type, reason_label | pre-agg? |
| ... | ... | ... | ... | ... |

Add 2–6 new metrics from available tables (all must be additive; include pre-agg confirmation).

**cfm_vn reference:** Added 12 new metrics (economy, gacha, onboarding, engagement). All use existing pre-agg rollups.

### 2.4 Lock decisions

User choices to document:

1. **Revenue metric:** repoint to game_key_metrics or keep on recharge table?
2. **Acquisition metrics:** how many broken metrics to recover (conservative: only unambiguous ones; aggressive: all that exist in game_key_metrics)?
3. **Event-table width:** add all proposed new metrics, or pick subset?
4. **Blocked stubs:** keep unavailable as tombstones (for agent + catalog to flag "not available"), or remove from presets entirely?

### 2.5 Deliver curation report

Save to `plans/[game]-catalog/reports/[game]-curation-and-additions-report.md`:
- Summary scoreboard (working, recoverable, new, drop)
- Decisions locked (with user sign-off)
- Repoint list (old cube.measure → new cube.measure)
- New metric list (with column evidence)
- Blocked list (with reason)

---

## Phase 3: Fast-Query Design (Rollup & Routing)

**Objective:** For each fast-candidate metric, confirm a rollup exists + includes all needed measures. For cross-cube ratios, design workaround or label cold. Outcome: exact YAML edits + preset rewrites.

**Deliverable:** Fast-query design spec (like cfm_vn §3).

### 3.1 Audit existing rollups per cube

For each cube the game uses, inspect YAML:

```bash
# Example: active_daily rollup audit
cat cube-dev/cube/model/cubes/[game]/active_daily.yml | grep -A 50 'pre_aggregations:' | head -60
```

Record per cube:

| Cube | Rollup name | Time-dim | Measures in rollup | Additive? | Lambda fallback? |
|------|-------------|----------|------------------|-----------|---|
| active_daily | dau_by_ingame_dims_daily_batch | log_date | dau, wau, mau, total_online_time_sec, paying_dau | YES | YES (lambda union) |
| game_key_metrics | key_metrics_by_source_daily_batch | report_date | cost_vnd, impressions, clicks, installs, nru, npu, trans | ~~PARTIAL~~ nnpu missing | YES |
| etl_lottery_shoot | lottery_pulls_batch | log_date | pulls, distinct_players, total_cost_diamond, total_cost_gold | YES | YES |

### 3.2 Identify measure gaps + plan new rollups

For each metric NOT covered by existing rollups:

```
revenue (user_recharge_daily.revenue_vnd_total)
  → In rollup recharge_daily_by_channel_batch? YES → fast
  
arpu (mf_users.arpu_vnd)
  → In rollup? NO (ltv_by_install_cohort_batch keyed on install_date, not daily time-series)
  → Verdict: COLD (or add new mf_users_daily pre-agg — deferred)
  
nnpu (game_key_metrics.nnpu)
  → In rollup key_metrics_by_source_daily_batch? NO (missing measure)
  → Plan: ADD nnpu to rollup measures list
  
organic_installs, paid_installs (game_key_metrics.installs_paid/_organic)
  → Measures missing entirely
  → Plan: ADD installs_paid (filtered sum), installs_organic (filtered sum) to YAML + rollup
```

### 3.3 Design cross-cube ratio workarounds

For metrics spanning 2+ cubes (e.g., ARPDAU):

```
ARPDAU = revenue (user_recharge_daily.revenue_vnd_total) / dau (active_daily.dau)

Both components exist in fast rollups on different cubes, keyed on same log_date.
But Cube can't cross-cube-join at rollup build time.

Options:
  A. Create a conforming upstream mart (etl_arpdau_daily) in Trino — ETL work
  B. Add a pre-agg that pre-joins at build time — requires SQL override in Cube YAML
  C. Keep COLD — flag as architectural limitation

cfm_vn decision: COLD + blocked.
jus_vn decision: TBD
```

Document per game.

### 3.4 Plan derived ratio measures

For metrics that are post-agg ratios (e.g., `cpi = cost / installs`):

```yaml
# In game_key_metrics.yml, measures block, add:
  - name: cpi_vnd
    sql: "CAST({cost_vnd} AS DOUBLE) / NULLIF({installs}, 0)"
    type: number
    description: Cost per install (VND)
    # NOT added to pre-agg (non-additive ratio)
    # Computed at query time from cost_vnd + installs (both in rollup)
```

List all new derived measures per cube:

| Cube | Measure | Formula | Rollup? | Pre-agg adds? |
|------|---------|---------|---------|---|
| game_key_metrics | cpi_vnd | cost / installs | NO (ratio, computed post-query) | cost_vnd, installs already present |
| game_key_metrics | cpn | cost / nru (new) | NO | cost_vnd, nru already present |
| game_key_metrics | cti | installs / clicks (new) | NO | both present? — TBD per game |

### 3.5 Deliver fast-query design spec

Save to `plans/[game]-catalog/reports/[game]-fast-query-design-spec.md`:

- §1: Rollup audit per cube
- §2: New measures + derived ratios to add
- §3: Pre-agg build/verify checklist
- §4: Fast/cold/blocked assignment table (all 69 metrics)

Reference cfm_vn design spec §0–4 as template.

---

## Phase 4: Implement Semantic Layer

**Objective:** Apply all YAML edits + preset rewrites. Build/warm rollups. Verify routing. Gate before seed regeneration.

**Deliverable:** cfm_vn status = Phase 4 complete (pending; implementation in progress).

### 4.1 Cube YAML edits

Per cube, edit `cube-dev/cube/model/cubes/[game]/[cube].yml`:

```bash
# Example: add missing measures to game_key_metrics
# ADD to measures block:
  - name: nnpu
    type: sum
    description: New register and paying users

  - name: cpi_vnd
    sql: "CAST({cost_vnd} AS DOUBLE) / NULLIF({installs}, 0)"
    type: number
    description: Cost per install (VND)
    
  - name: cpn
    sql: "CAST({cost_vnd} AS DOUBLE) / NULLIF({nru}, 0)"
    type: number
    description: Cost per new registered user (VND)

# ADD to pre_aggregations[key_metrics_by_source_daily_batch].measures:
  - nnpu
  - cpi_vnd  ← NO (non-additive; not in rollup)
```

Land all changes. See cfm_vn design spec §1 for complete YAML diff.

### 4.2 Preset repoints

Per preset YAML in `server/src/presets/business-metrics/*.yml`, update formula refs:

```yaml
# OLD revenue.yml:
formula:
  type: measure_ref
  ref: recharge.revenue_vnd

# NEW revenue.yml (if repointed to user_recharge_daily):
formula:
  type: measure_ref
  ref: user_recharge_daily.revenue_vnd_total

game_compatibility:
  required_cubes: [user_recharge_daily]
```

See cfm_vn design spec §3A–3F for full preset edit list.

Create new preset files for 12 new metrics (or game's custom count).

### 4.3 Cube restart (DEV_MODE=false required)

```bash
# After all YAML changes are committed:
docker-compose down
docker-compose up -d

# Wait for /readyz:
until curl -f http://localhost:3004/cube-api/v1/readyz; do sleep 5; done
```

### 4.4 Pre-agg build & partition seal

Trigger rebuild for rollups with new measures:

```bash
# Cube provides a build trigger API (or manual partition export):
curl -X POST http://localhost:3004/cube-api/v1/pre-aggregations/rollups/[game]/[cube]/[rollup_name]/build

# Wait for build completion (can take hours for 1B+ row tables):
curl http://localhost:3004/cube-api/v1/pre-aggregations/rollups/[game]/[cube]/[rollup_name]/status
```

Confirm partitions are sealed (not growing; latest partition closed).

### 4.5 Routing verification (per-metric SQL inspection)

For each fast metric, assert compiled SQL uses pre-agg:

```bash
# revenue metric (should route to recharge_daily_by_channel_batch)
curl -s -X POST -H 'x-cube-workspace: local' -H 'x-cube-game: [game_id]' \
  -H 'Content-Type: application/json' \
  -d '{
    "query": {
      "measures": ["user_recharge_daily.revenue_vnd_total"],
      "timeDimensions": [{
        "dimension": "user_recharge_daily.log_date",
        "granularity": "day",
        "dateRange": "last 30 days"
      }]
    }
  }' \
  http://localhost:3004/cube-api/v1/sql | \
  python3 -c "
    import json, sys
    r = json.load(sys.stdin)
    sql = r['sql'][0]
    if 'prod_pre_aggregations' in sql or 'pre_agg' in sql.lower():
      print('✓ ROUTES TO ROLLUP')
    else:
      print('✗ ROUTES TO SOURCE (not fast!)')
    print(sql[:300])
  "
```

Assert for all 36 fast metrics: SQL contains rollup reference.

### 4.6 Warm latency verification

Run `/load` for sample fast metrics:

```bash
time curl -s -X POST -H 'x-cube-workspace: local' -H 'x-cube-game: [game_id]' \
  -H 'Content-Type: application/json' \
  -d '{
    "query": {
      "measures": ["user_recharge_daily.revenue_vnd_total"],
      "timeDimensions": [{
        "dimension": "user_recharge_daily.log_date",
        "granularity": "day",
        "dateRange": "last 30 days"
      }]
    }
  }' \
  http://localhost:3004/cube-api/v1/load > /tmp/load.json

cat /tmp/load.json | python3 -c "
  import json, sys
  r = json.load(sys.stdin)
  wall = r['query']['executionTime']
  print(f'Wall time: {wall}ms', '✓ FAST' if wall < 2000 else '✗ SLOW')
"
```

Sample: revenue, nru, dau, gacha_pulls (one from each cube). All should be <2s.

### 4.7 Cold metric regression check

Verify cold metrics still resolve (not 400):

```bash
# transactions (recharge, no rollup):
curl -s ... "measures": ["recharge.transactions"] ... | grep -q error && echo "✗ BROKEN" || echo "✓ RESOLVES"

# arpdau (cross-cube, times out):
timeout 20 curl -s ... "measures": ["user_recharge_daily.revenue_vnd_total"], "dimensions": ["active_daily.dau"] ... | grep -q error && echo "✗ OR TIMEOUT" || echo "✓ RESOLVES"
```

### 4.8 Blocked metric gate

Verify blocked metrics are wired unavailable:

```bash
# GET /api/business-metrics?game=[game_id] should return metrics with trust: unavailable
curl -s 'http://localhost:3004/api/business-metrics?game=[game_id]' | \
  python3 -c "
    import json, sys
    metrics = json.load(sys.stdin)['metrics']
    blocked = [m for m in metrics if m.get('trust') == 'unavailable']
    print(f'Blocked metrics: {[m[\"id\"] for m in blocked]}')
  "
```

All 12 blocked metrics (acu, ccu, pcu, lcu, *_role, funnel CVRs) should be present with trust=unavailable.

### 4.9 preagg-readiness.ts probe fix (if repointing revenue)

If revenue.yml is repointed, update the readiness probe:

```typescript
// server/src/services/preagg-readiness.ts, line ~72:
// OLD: const readinessMeasure = 'recharge.revenue_vnd'
// NEW: const readinessMeasure = 'user_recharge_daily.revenue_vnd_total'
```

---

## Phase 5: Rebuild Seeded Questions & Agent Surface

**Objective:** Regenerate starter questions using the final metric list (only fast metrics). Re-run resolution harness to verify no regressions.

**Deliverable:** Updated seed YAML + chat-service starters + harness re-baseline.

### 5.1 Filter seed generation (fast metrics only)

```bash
# Before regenerating, pass only fast metrics to seed generator:
cat > /tmp/fast-metrics-only.json << 'EOF'
{
  "metrics": [
    { "id": "dau", "label": "Daily Active Users", ... },
    { "id": "revenue", "label": "Daily Revenue", ... },
    ... (36 fast + 12 new if approved)
  ]
}
EOF

# Seed generator script (generates seeds across 3 surfaces):
npx ts-node scripts/generate-catalog-seeds.ts \
  --game [game_id] \
  --metrics-file /tmp/fast-metrics-only.json \
  --output plans/[game]-catalog/[game]-seeded-questions.md
```

### 5.2 Update chat-service starter questions

```typescript
// src/pages/Chat/library/starter-questions.ts:
// Or server equivalent: src/routes/chat/starter-questions.ts

const STARTER_QUESTIONS = [
  {
    game: '[game_id]',
    category: 'Monetization',
    question: 'What is my daily revenue trend?',
    relatedMetricIds: ['revenue', 'paying_users'],
  },
  // Add ~10–15 questions using top-tier (tier 1–2) fast metrics
  // EXCLUDE cold metrics; avoid arpdau, rr01/rr07/rr30 in starters
];
```

### 5.3 Re-run resolution harness (post-Phase-5 gate)

```bash
npm run test -- chat/resolution-baseline.test.ts \
  --game [game_id] \
  --baseline-snapshot /tmp/[game]_baseline_before.json \
  --output /tmp/[game]_baseline_after.json

# Compare:
python3 -c "
  import json
  before = json.load(open('/tmp/[game]_baseline_before.json'))
  after = json.load(open('/tmp/[game]_baseline_after.json'))
  
  before_accuracy = len([r for r in before if r['resolved']]) / len(before)
  after_accuracy = len([r for r in after if r['resolved']]) / len(after)
  
  print(f'Before: {before_accuracy:.1%}')
  print(f'After: {after_accuracy:.1%}')
  
  if after_accuracy < before_accuracy * 0.95:
    print('✗ REGRESSION (>5% drop)')
  else:
    print('✓ NO REGRESSION')
"
```

---

## Phase 6: Documentation & Knowledge Transfer

**Objective:** Document decisions + rollout outcomes for next game. Update cross-game master list.

### 6.1 Finalize [game]-specific catalog report

Save to `docs/` or archive under `plans/[game]-catalog/`:

- Availability matrix (Phase 1)
- Curation decisions (Phase 2)
- Fast-query design (Phase 3)
- Implementation log (Phase 4)
- Harness re-baseline (Phase 5)
- Summary: fast/cold/blocked counts + metric IDs

### 6.2 Update cross-game master list

Link: `docs/metric-catalog-master-list.md`

For each metric row, add a column for [game_id]:

| Concept | ID | cfm_vn | [game_id] | jus_vn | ... |
|---------|----|----|---|---|---|
| DAU | dau | **fast** (active_daily, rollup) | **cold** (TBD, no rollup) | **fast** (TBD) | ... |
| Revenue | revenue | **fast** (user_recharge_daily) | **cold** (recharge, no rollup) | **TBD** | ... |

Populate once per-game work is done.

### 6.3 Knowledge capture

Document game-specific divergences discovered:

```markdown
## [game_id] Specific Notes

### Schema Differences
- active_daily uses `dt_log` instead of `log_date` → all time-dims must adapt
- recharge PK is composite (5 fields) vs cfm's simple PK → revenue deduping strategy differs
- game_key_metrics.nnpu column was missing; added via YAML edit

### Data Gaps
- mf_users lacks new_users, installs, marketing_cost columns → cannot recover 12 metrics; drop or request from data platform
- etl_lottery_shoot pre-agg was not built; added trigger; took 8h for 213M rows

### Rollup Optimizations
- Opportunity: add mf_users_daily_snapshot rollup to serve arpu warm (deferred to Phase 7)
- Blocked: cross-cube arpdau still times out; would need conforming upstream mart

### Learnings for Next Game
- Always check Trino schema before assuming columns don't exist (data may be there but not modeled in YAML)
- Pre-agg build times are unpredictable for large tables; plan 12–24h buffer
- Dedup decisions (revenue vs gross_bookings) need product input early
```

---

## Checklist Summary

| Phase | Task | Owner | Status |
|-------|------|-------|--------|
| 0 | Build + run resolution harness | eng | — |
| 1 | Availability audit + PK verdict | eng | — |
| 2 | Curation decisions (user sign-off) | product + eng | — |
| 2 | Width proposals + broken-ref recovery | eng | — |
| 3 | Fast-query design spec | eng | — |
| 4 | Cube YAML edits + preset rewrites | eng | — |
| 4 | Restart + build + routing verify | eng | — |
| 4 | Latency proof (<2s warm) | eng + qa | — |
| 5 | Seed regeneration | eng | — |
| 5 | Re-run harness (gate) | eng | — |
| 6 | Documentation + master-list update | eng | — |

**Estimated team composition:** 1 backend eng (lead, Cube/YAML), 1 data eng (rollup audit, pre-agg build monitoring), 1 frontend eng (preset YAML + chat integration). Parallelizable weeks 1–2 (audit + design); sequential week 3 (implementation gate).

---

## cfm_vn Worked Example (Reference Links)

- **Plan + locked decisions:** `plans/260610-1446-cfm-vn-metric-catalog-fast-query/plan.md`
- **Phase 1 (Availability audit):** `plans/260610-1446-cfm-vn-metric-catalog-fast-query/reports/cfm-vn-metric-availability-matrix-report.md`
- **Phase 2 (Curation):** `plans/260610-1446-cfm-vn-metric-catalog-fast-query/reports/cfm-vn-curated-catalog-and-additions-report.md`
- **Phase 3 (Design spec):** `plans/260610-1446-cfm-vn-metric-catalog-fast-query/reports/cfm-vn-fast-query-design-spec-report.md`

When working on a new game, reference these reports for template structure + decision patterns, but **do NOT copy the values** — each game's schema differs.

---

## Unresolved Questions

1. **Standardized time-dimensions:** Should all games use `log_date` (event date) as canonical, or accommodate `report_date` (captured date) / `cohort_date` (install date) per cube? Current cfm_vn mixes all three. Needs org-wide decision.

2. **Identity + multi-game blending:** mf_users uses vopenid; game_key_metrics uses user_id; retention uses implicit cohort identity. How to safely blend metrics across games when identities differ?

3. **Pre-agg build automation:** Current process requires manual monitoring for large tables (213M+ rows). Should CI/CD include a pre-agg health check, or keep as ops task?

4. **Cold-metric labeling visibility:** Should cold metrics (transactions, arpu, arpdau) appear in the Catalog with a "slow" badge, or be excluded entirely? Trade-off: user discovery vs setting incorrect latency expectations.

5. **Per-game metric drift:** Once a metric is seeded into starter questions, how to detect + respond if the underlying cube is updated (measure renamed, rollup extended, etc.)? Regression harness helps but needs to run regularly (automated or manual?).
