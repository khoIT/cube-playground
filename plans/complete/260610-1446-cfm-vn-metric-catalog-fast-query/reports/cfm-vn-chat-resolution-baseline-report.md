# cfm_vn Chat Agent Resolution Baseline Report

Captured: 2026-06-10 (GMT+7)
Game: cfm_vn | Workspace: local

---

## 1. Resolution Entrypoint Map

NL question → agent resolution path:

```
User message
  └─ /agent/turn (POST, SSE response)
       └─ claude-runner.ts (tool-use loop)
            ├─ disambiguate_query            ← intent classification, glossary hit
            │    └─ synonym-resolver.ts      ← resolveTerms() / findExactMatch()
            │    └─ member-resolution.ts     ← resolveQueryTerms() → cube member refs
            ├─ resolve_query_terms           ← NL terms → ranked Cube member matches
            │    └─ glossary-client.ts       ← fetchOfficialGlossary()
            │    └─ cube-meta-cache.ts       ← live /meta
            ├─ get_business_metric           ← fetch full metric YAML by id
            │    └─ /api/business-metrics/:id
            ├─ preview_cube_query            ← validate query against /meta + run
            └─ emit_query_artifact           ← validate, deeplink, SSE event
                 └─ SSE: event: query_artifact
                         data: { id, title, query, source, sourceRef, ... }
```

Key fields for resolution eval:
- `query_artifact.query.measures[]` → backing Cube member(s) → cube name prefix
- `query_artifact.sourceRef.id` → resolved business metric id (when `source='business-metric'`)
- `tool_call { name:'get_business_metric', args: { id } }` → fallback metric id extraction

The `sourceRef` is populated only when the LLM explicitly passes `source='business-metric'` to
`emit_query_artifact`. In practice many turns emit with `source='raw'`, so the `get_business_metric`
tool call is the reliable metric-id signal (extracted via `extractMetricIdFromToolCalls()`).

---

## 2. Corpus Summary

33 NL questions across 9 curation groups, weighted toward metrics affected by catalog curation:

| Group | Count | Focus |
|-------|-------|-------|
| `duplicate-ref` | 8 | `revenue` vs `gross_bookings` → both target `recharge.revenue_vnd` |
| `arpdau-cross-cube` | 4 | ARPDAU cross-cube ratio — key verdict cases |
| `arpu-arppu-ambiguity` | 4 | ARPU (snapshot) vs ARPPU (ratio) resolution |
| `paying-users-variants` | 4 | `paying_users` (recharge) vs `paying_users_30d` (mf_users snapshot) |
| `engagement` | 4 | DAU / WAU / MAU → active_daily |
| `ua` | 4 | installs, ROAS, NPU, NRU |
| `concepts` | 2 | spender, whale entity questions |
| `ltv` | 1 | LTV cohort |
| `edge-cases` | 2 | unknown metric, ambiguous compare |

Source: `chat-service/test/metric-resolution-eval/cfm-vn-eval-corpus.json`

---

## 3. Baseline Live Run Status

**Run started:** 2026-06-10 ~15:38 GMT+7
**Run process:** PID 63636 (tsx, still in flight at report write time)
**Status at report write:** 4/33 cases completed

### Partial results (live, from runner stdout)

| Case | Question (truncated) | Status | Cube |
|------|---------------------|--------|------|
| revenue-basic | show revenue last 7 days | ✓ ok | recharge |
| gross-bookings-basic | show gross bookings last 7 days | ✗ no-artifact | — |
| revenue-vi | doanh thu 7 ngày qua | ✓ ok | recharge |
| revenue-cube-ref | recharge.revenue_vnd last month | ✓ ok | recharge |

Key early observations:
- `revenue` queries correctly resolve to `recharge` cube
- `gross_bookings` (case `gross-bookings-basic`) produced **no artifact** — the agent did not
  resolve this alias to any metric/query. This is a meaningful baseline data point: curation
  that adds a proper `gross_bookings` glossary entry should turn this from ✗ → ✓.
- Vietnamese alias (`doanh thu`) correctly resolves — synonym-resolver's Vi alias index works.

The full snapshot (`cfm-vn-baseline-snapshot.json`) will be written atomically when the runner
completes all 33 cases. Expected completion: ~90-120 min from start (turns avg ~3-5 min each
due to real LLM inference + Cube round-trips).

---

## 4. ARPDAU Query Shape Verdict

**Verdict: CROSS-CUBE FAN-OUT — 2-measure single query expected**

Evidence from the official glossary snapshot (frozen at `cfm-vn-glossary-snapshot.json`):

```json
{
  "id": "arpdau",
  "label": "ARPDAU",
  "refKind": "ratio",
  "measureRef": null,
  "ratioRef": {
    "numerator": "recharge.revenue_vnd",
    "denominator": "active_daily.dau"
  }
}
```

This is the **authoritative signal**: the glossary defines ARPDAU as a ratio whose components
span two cubes — `recharge` and `active_daily`.

### What this means for the agent

When the agent resolves ARPDAU:
1. It fetches the metric via `get_business_metric('arpdau')`
2. The metric's `ratioRef` gives it both measure refs
3. It must emit a query with `measures: ['recharge.revenue_vnd', 'active_daily.dau']`

This is a **cross-cube fan-out** in a single `emit_query_artifact` call — Cube supports
multi-cube measures in one query when the schema has a join path. Whether Cube actually
executes this as a single load or two joined loads depends on the cube model.

### Shape options and implications

| Shape | Description | Later work needed? |
|-------|-------------|-------------------|
| **Combined** `[revenue_vnd, dau]` in one query | Agent emits both measures together | Schema must join recharge ↔ active_daily; if join missing, Cube errors → agent must split |
| **Blended** two separate queries | Agent emits two artifacts and computes ratio client-side | No schema join required; more agent logic |

**From the 4 completed baseline cases:** ARPDAU cases have not yet run (they are cases 10-12
in the corpus). The live verdict will appear in `cfm-vn-baseline-snapshot.json` once the runner
reaches those cases (~30-45 min from report write time).

**Pre-verdict inference from code:** The `emit_query_artifact` tool validates all measures against
`/meta` before emitting. If `recharge.revenue_vnd` and `active_daily.dau` are in different cubes
without a join, the tool will reject the combined query with `unknown_member` on one of them. In
that case the agent falls back to a single-measure query or asks for clarification — producing a
`no-artifact` or a single-cube query in the baseline.

**Action required by later phases:** Check `cfm-vn-baseline-snapshot.json` for `arpdau-*` cases:
- If `emittedQueries[0].measures` contains BOTH `recharge.revenue_vnd` AND `active_daily.dau`
  → combined shape confirmed; no ratio-reshape needed in agent layer
- If `emittedQueries` contains only one of them (or is empty)
  → ratio reshape is a real gap; later curation/agent work must address it

---

## 5. Scorer Usage

```bash
# After a curation/reseed run, compare against the frozen baseline:
npx tsx chat-service/test/metric-resolution-eval/metric-resolution-scorer.ts \
  chat-service/test/metric-resolution-eval/cfm-vn-baseline-snapshot.json \
  chat-service/test/metric-resolution-eval/cfm-vn-rerun-snapshot.json

# Machine-readable:
npx tsx ... --json   # writes cfm-vn-score-report.json
```

Verdicts:
- `mismatch` and `no-artifact` = regressions (blocked merges)
- `query-shape-changed` = flagged only; must be reviewed but does not auto-block
- `newly-working` = improvements (e.g. gross_bookings getting a proper glossary entry)

---

## 6. Files Created

| Path | Purpose |
|------|---------|
| `chat-service/test/metric-resolution-eval/cfm-vn-eval-corpus.json` | 33-case annotated corpus |
| `chat-service/test/metric-resolution-eval/cfm-vn-glossary-snapshot.json` | Frozen glossary |
| `chat-service/test/metric-resolution-eval/metric-resolution-runner.ts` | Live SSE runner |
| `chat-service/test/metric-resolution-eval/metric-resolution-scorer.ts` | Diff scorer |
| `chat-service/test/metric-resolution-eval/types.ts` | Shared TS types |
| `chat-service/test/metric-resolution-eval/README.md` | Re-run + usage docs |
| `chat-service/test/metric-resolution-eval/cfm-vn-baseline-snapshot.json` | **Written by runner when complete** |

---

## 7. Build / Test Status

- `tsc --noEmit` (full chat-service): **PASS** (0 errors)
- `tsc --noEmit` (eval files only): **PASS** (0 errors)
- `vitest run`: **PASS** — 129/129 files, 1125/1125 tests
- No secret written to any file (token passed via env only)

---

## Unresolved Questions

1. **ARPDAU live verdict pending**: runner has not reached `arpdau-*` cases yet at report write time. Check `cfm-vn-baseline-snapshot.json` cases 10-12 once runner completes.

2. **gross_bookings no-artifact**: `gross-bookings-basic` produced no artifact in partial run. Is this because `gross_bookings` is not in the glossary as a distinct alias, or because the agent resolves it to `revenue` and deduplicates? The tool-call trace in the completed session (tracked by `sessionId`) will clarify.

3. **resolvedMetricId mostly null in current run**: The running instance was launched before the `get_business_metric` tool-call fallback fix. Re-run the snapshot after runner completes to get proper `resolvedMetricId` values. The `resolvedCube` and `emittedQueries` fields are correctly captured in the current run and are sufficient for the ARPDAU verdict.

4. **Runner auth-mode switch requires INTERNAL_SECRET**: The runner's `setSubscriptionLane()` call silently skips if `INTERNAL_SECRET` env is missing. Operator must either pre-switch via curl or pass the secret: `INTERNAL_SECRET=<secret> npx tsx ...`.
