---
name: segment
display_name: Create Segment
description: Turn a chat intent into a draft segment proposal — threshold, percentile, or top-N. Never writes a segment; emits a proposal the user confirms in the UI.
trigger_keywords:
  - create segment
  - save segment
  - build segment
  - save that as a segment
  - turn that into a segment
  - create a segment from these
  - create audience
  - build audience
  - save audience
  - create cohort
  - build cohort
  - save cohort
  - tạo phân khúc
  - lưu phân khúc
  - lưu cái đó thành phân khúc
  - tạo nhóm
  - lưu nhóm
  - tạo đối tượng
allowed_tools:
  - get_segmentable_measures
  - propose_segment
  - get_cube_meta
  - resolve_query_terms
  - list_dimension_values
  - list_business_metrics
  - get_business_metric
  - list_segments
  - get_segment
  - offer_choices
enable_web_search: false
enable_research_mode: false
---

# Create Segment Skill

Turn a chat intent into a draft `segment_proposal` that the user can review and confirm in the UI. This skill **never** writes a segment — it only emits a proposal.

## Three entry points

1. **Direct chat (measure)** — user describes the segment by a measure ("top 25% spenders", "users who spent > 1000", "top 100 payers").
2. **Direct chat (dimension/recency)** — user describes the segment by a dimension condition with no prior exploration ("haven't logged in ≥ 3 days", "dormant users", "level > 50 players in VN"). This is a cold `kind='query'` — see *Cold dimension predicate* below.
3. **After exploration** — user says "save that as a segment" or "create a segment from these users"; the prior turn's query filters become the predicate.
4. **Named concept** — user names a concept the glossary defines (e.g. "whales", "VIP payers").

## First step depends on the predicate kind

- **Measure-based** (`threshold` / `percentile` / `top_n`): **always call `get_segmentable_measures({ game: <game_id> })` first.** Never fabricate a `dimension` member name or an `over` population spec — these reference server-controlled physical paths. Use the catalog entry verbatim.
- **Dimension-based** (`kind='query'`): do **NOT** call `get_segmentable_measures` — its catalog holds only ranking measures (spend, active_days), never filter dimensions like recency or attributes. Discover the dimension member another way (prior exploration filters, or `get_cube_meta` — see below), then emit `kind='query'`.

### Cold dimension predicate — introspect, do not punt

When the user asks cold (no prior exploration turn) for a segment defined by a **dimension condition** — recency ("haven't logged in / been active in ≥ N days", "dormant", "lapsed", "inactive"), or an attribute (country, level, server, channel) — the predicate is plain dimension filters, so it is `kind='query'`. The measures catalog will NOT contain the member, so finding "no matching measure" is **expected and not a dead end**:

1. Call `get_cube_meta({ cubes: ['mf_users'] })` (or the relevant cube) to list its dimensions verbatim.
2. Map the user's phrase to a real dimension. For recency, look for `days_since_last_active` (a numeric "days since last active" dimension — filter `>= N`), `last_active_date` / `last_login_date` (date dimensions — filter `beforeDate` `CURRENT_DATE - N`), or `days_since_last_recharge`. Recharge-recency uses the recharge member, not the active one.
3. Build the `filters` array against the verbatim member name and emit `propose_segment({ kind: 'query', cube: 'mf_users', filters: [...] })`.

Never tell the user "no measure matches" and ask them to supply a member name or pick a weaker lifetime proxy (e.g. `active_days`) **before** you have introspected the cube's dimensions. The member almost always exists — `get_cube_meta` is how you find it.

## Identifying the right measure entry

- Match the user's phrase to the catalog's `label` or `concept`.
- Window-match: "spend last 30 days" → find the entry with `window: '30d'`, NOT the lifetime entry. Wrong window = silently wrong segment.
- If no catalog entry matches, tell the user what is available (list `label` values); do not guess.

## Four predicate shapes

### 1. Threshold (`kind: 'threshold'`)
User says "users who spent > X", "users with LTV ≥ X", an **upper bound** like "fewer than 3 active days" / "spent under 1000", or a **range** like "spent between 500 and 1000".
- No cutoff resolution needed.
- `threshold_value` = the bound value (inclusive). For a range it is the **lower** bound.
- `threshold_op` = the **direction** for a single bound: `gte` (default) for a lower bound ("at least / more than"); **`lte` for an upper bound** ("under / at most / fewer than / no more than"). A measure ceiling like "fewer than 3 active days" is `threshold_op='lte'`, value 3.
- `threshold_value_max` = the **upper** bound for a **range** ("between X and Y"): set `threshold_value=X` + `threshold_value_max=Y` → `X ≤ measure ≤ Y` (`threshold_op` ignored). Must be ≥ `threshold_value`.
- All of these are measure predicates → use `kind='threshold'`, NOT `kind='query'` (the query path rejects measure members).
- `estCount` is unknown; disclose that count is computed on first refresh.

### 2. Percentile (`kind: 'percentile'`)
User says "top P% spenders" or "top quartile by LTV".
- `percentile_top_pct` = the P% the user specified (e.g. 25 for "top 25%").
- The tool converts to the `(100-P)`th percentile and calls `/resolve-cutoff`.
- **Requires `over`** on the catalog entry. If absent, ask the user for the population scope; never emit an unscoped percentile.

### 3. Top-N (`kind: 'top_n'`)
User says "top 100 spenders" or "top 500 payers".
- `top_n` = the absolute count.
- The tool (1) probes the population size, (2) converts N to a percentile, (3) calls `/resolve-cutoff` again.
- **Requires `over`** on the catalog entry (same reason as percentile).
- Disclose "rolling ~top-N — count drifts as population changes".

### 4. Query (`kind: 'query'`) — "save that as a segment"
User says "save that as a segment", "turn that into a segment", or "create a segment from these users" after an exploration turn.
- Use this when the predicate is plain dimension filters (e.g. `country = VN AND level > 10`), NOT a measure threshold/percentile.
- Pass `filters` = the `CubeQuery.filters` array from the last `emit_query_artifact` call (same shape — array of `{member, operator, values}` or `{and: [...]}` / `{or: [...]}`).
- Pass `cube` = the logical cube name (member prefix, e.g. `"mf_users"`).
- **Verify value casing on equals/contains filters.** Before emitting an `equals`/`contains`/`in` filter on a string dimension (country, tier, server, channel, payer_tier), call `list_dimension_values({ member })` to get the exact stored casing — `whale` not `Whale`, `VN` not `vn`. A wrong case silently produces an empty segment, which looks like a working save until the refresh returns 0 members. Skip only for filters lifted verbatim from a prior exploration artifact (already validated there).
- Do **NOT** call `get_segmentable_measures` first — this path converts query filters directly, not a catalog measure.
- The tool calls `cubeQueryToPredicateTree` internally. If the filters contain a measure filter, a time-leaf inside OR, or an order+limit without a ranked measure, it returns `ok:false` with a reason — relay the `detail` to the user and suggest they use `kind='threshold'` or `kind='percentile'` instead.
- No cutoff is resolved; `estCount` is 0 and computed on confirm-refresh.

## Guardrails (hard rules)

- **Never** modify `measure.dimension` or `measure.over` fields from the catalog response.
- **Never** emit a percentile or top-N proposal when `measure.over` is absent — return an error so the user is asked for a scope.
- If the measure concept is not in the catalog, list what IS available and ask the user to pick.
- If the user's phrase is ambiguous (e.g. "top spenders" could match multiple windows), call `offer_choices` to let the user pick.
- **Do not loop on errors.** `propose_segment` returning `ok:false` is terminal feedback, not a retry signal. Apply the fix its `detail`/`hint` names **once** (e.g. `threshold_op='lte'` for an upper bound, `threshold_value`+`threshold_value_max` for a range, or `kind='threshold'` for a measure filter the query path rejected), then re-call at most one more time. If it still fails — or the request is genuinely inexpressible — **stop and tell the user in one plain message** what isn't supported and the closest expressible alternative. Never silently re-issue the same shape repeatedly; that hangs the turn.

### Name fidelity — the `name` must match the predicate exactly

The `name` you pass is shown verbatim on the confirm card, but the **predicate is what actually selects users**. They must agree. A name that promises a condition the predicate does not encode is a silently-wrong segment.

- `threshold`, `percentile`, and `top_n` encode one condition on a single measure **by default** — but you can AND extra conditions onto them with `additional_filters` (see below). `measure.over` only scopes the *population the percentile is computed over*; it does NOT add a membership filter.
- Do **NOT** put a second concept in the name that the predicate omits. "High-Engagement Never-Payers" with a predicate of only `top 25% active_days` is wrong — either add the `ltv_vnd = 0` condition via `additional_filters`, or drop "Never-Payers" from the name.
- When unsure whether the user wants one condition or several, call `offer_choices` rather than guessing a richer name than the predicate supports.

### Compound predicates — `additional_filters`

A compound intent like "**top 25% by active days who have never paid**" is ONE proposal, not a probe + a manual-floor question. Use the percentile/threshold/top_n shape on the *primary* measure and AND the rest via `additional_filters`:

```
propose_segment({
  kind: 'percentile', percentile_top_pct: 25,
  measure: <active_days catalog entry>,
  additional_filters: [{ member: 'mf_users.ltv_vnd', operator: 'equals', values: [0] }],
  name: 'High-Engagement Never-Payers', ...
})
```

- `additional_filters` are plain comparisons (`equals`/`notEquals`/`gt`/`gte`/`lt`/`lte`/`set`/`notSet`) on members of the **same cube**. They need no cutoff resolution.
- The percentile cutoff is still resolved over its own population; the extra conditions narrow membership. The tool discloses that the estimated size counts the percentile population only (actual is smaller, computed on first refresh).
- **Never** emit a probe-named proposal (e.g. `_cutoff_probe_*`) or ask the user to hand-pick a fixed floor when they already gave a percentile — resolve it with `kind='percentile'` + `additional_filters` directly.
- `kind='query'` remains the path for predicates built entirely from plain dimension filters the user already explored (it rejects measure filters — use `additional_filters` for measure conditions like `ltv_vnd = 0`).

## Disclosure requirements

After emitting the proposal, your text response must include:
1. What predicate was built (member, operator, value).
2. If percentile/top-N: the resolved cutoff value and estimated cohort size.
3. Rolling semantics: "this percentile is re-resolved on each refresh".
4. Population scope: which population the percentile was taken over (e.g. "payers only").
5. Mirror in Vietnamese when the turn language is `vi` or `mixed`.

## "Save that as a segment" — reading prior context

When the user says "save that", "turn that into a segment", or "create a segment from these users":
- Look at the last `emit_query_artifact` call you made in this turn (or the prior turn). Its `query.filters` array is the predicate source.
- **Plain dimension filters** (e.g. `country = VN`, `level > 10`, `user_type = payer`) → use `kind='query'`, passing `filters` and `cube` directly. Do NOT call `get_segmentable_measures`.
- **Measure-threshold shape** (a single `gte/lte` filter on a well-known measure like `ltv_vnd`) → use `kind='threshold'`, call `get_segmentable_measures` to get the catalog entry.
- **Top-N leaderboard** (query had `order + limit`) → use `kind='top_n'`, call `get_segmentable_measures`.
- If the tool returns `ok:false` for `kind='query'` (e.g. time-leaf-in-OR, measure filter), relay the error and ask the user whether to restructure the query or use a measure-threshold instead.

## Round budget

Target ≤ 2 tool rounds before emitting:

**For threshold/percentile/top_n:**
1. `get_segmentable_measures` (+ optional `offer_choices` if ambiguous) — one round.
2. `propose_segment` — one round; this handles `/resolve-cutoff` internally.

**For kind='query' ("save that as a segment", filters from prior exploration):**
1. `propose_segment` with `kind='query'` directly — one round. No catalog lookup needed.

**For kind='query' (cold dimension predicate, e.g. recency):**
1. `get_cube_meta({ cubes: ['mf_users'] })` to find the dimension member — one round.
2. `propose_segment` with `kind='query'` — one round.

Do not call `preview_cube_query` or `emit_query_artifact` in this skill — you are proposing a segment, not exploring data.
