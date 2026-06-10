# cfm_vn Metric-Resolution Eval Harness

Frozen baseline that captures how the chat agent resolves cfm_vn NL questions
to metrics, backing cubes, and emitted query JSON **today** — so any future
curation or reseed work can be diff-scored against this snapshot for regressions.

## Files

| File | Purpose |
|------|---------|
| `cfm-vn-eval-corpus.json` | 33 NL questions with expected metric/cube/shape annotations |
| `cfm-vn-glossary-snapshot.json` | Frozen glossary at capture time (reference only) |
| `cfm-vn-baseline-snapshot.json` | **Immutable** live-run capture — do not overwrite manually |
| `metric-resolution-runner.ts` | Drives corpus through `/agent/turn` SSE, writes snapshot |
| `metric-resolution-scorer.ts` | Diffs two snapshots, reports match/mismatch/shape-changed |
| `types.ts` | Shared TypeScript types for corpus, snapshot, score report |

## Re-run (capture new baseline or regression-check)

```bash
# 1. Switch chat-service to subscription lane (needs INTERNAL_SECRET)
curl -s -X PUT http://localhost:3005/internal/llm-auth-mode \
  -H 'Content-Type: application/json' \
  -H "x-internal-secret: $INTERNAL_SECRET" \
  -d '{"mode":"subscription"}'

# 2. Run the live capture (writes cfm-vn-rerun-snapshot.json by default
#    — rename it to cfm-vn-baseline-snapshot.json to freeze a new baseline)
ANTHROPIC_SUBSCRIPTION_OAUTH_TOKEN_VY=<token> \
INTERNAL_SECRET=<secret> \
  npx tsx test/metric-resolution-eval/metric-resolution-runner.ts

# To write to a custom path:
SNAPSHOT_OUT=test/metric-resolution-eval/cfm-vn-rerun-snapshot.json \
  npx tsx test/metric-resolution-eval/metric-resolution-runner.ts
```

## Score a re-run against the baseline

```bash
npx tsx test/metric-resolution-eval/metric-resolution-scorer.ts \
  test/metric-resolution-eval/cfm-vn-baseline-snapshot.json \
  test/metric-resolution-eval/cfm-vn-rerun-snapshot.json

# Machine-readable JSON output:
npx tsx test/metric-resolution-eval/metric-resolution-scorer.ts \
  cfm-vn-baseline-snapshot.json cfm-vn-rerun-snapshot.json --json
```

## Verdict semantics

| Verdict | Meaning | Counts as regression? |
|---------|---------|----------------------|
| `match` | metric + cube agree with baseline | no |
| `mismatch` | at least one field differs | **yes** |
| `query-shape-changed` | metric/cube match but query structure changed | flagged only |
| `no-artifact` | produced artifact in baseline, not in re-run | **yes** |
| `newly-working` | no artifact in baseline, now produces one | improvement |
| `both-failing` | no artifact in either run | no |

Query-shape changes are **flagged but not auto-failed** — they may be intentional
(cross-cube fan-out collapse, ratio reshape, etc.).

## Corpus curation groups

| Group | What it tests |
|-------|--------------|
| `duplicate-ref` | `revenue` vs `gross_bookings` → same `recharge.revenue_vnd` |
| `paying-users-variants` | `paying_users` (recharge) vs `paying_users_30d` (mf_users snapshot) |
| `arpu-arppu-ambiguity` | ARPU (mf_users.arpu_vnd) vs ARPPU (ratio) — different resolution paths |
| `arpdau-cross-cube` | **Key verdict**: does the agent emit BOTH `recharge.revenue_vnd` + `active_daily.dau`? |
| `engagement` | DAU / WAU / MAU → active_daily cube |
| `ua` | installs, ROAS, NPU, NRU |
| `ltv` | LTV cohort questions |
| `concepts` | spender, whale entity-level questions |
| `edge-cases` | unknown metric, ambiguous comparisons |

## ARPDAU shape verdict (critical)

The `arpdau-*` cases answer whether the agent emits a **combined 2-measure
fanout** (`[recharge.revenue_vnd, active_daily.dau]` in one query) or **two
separate single-cube queries**. The baseline snapshot records the exact
`emittedQueries` array — compare it in the score report under
`query-shape-changed` diffs or inspect `cfm-vn-baseline-snapshot.json` directly.

See `plans/260610-1446-cfm-vn-metric-catalog-fast-query/reports/cfm-vn-chat-resolution-baseline-report.md`
for the full verdict write-up.
