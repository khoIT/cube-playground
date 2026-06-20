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

1. **Direct chat** — user describes the segment ("top 25% spenders", "users who spent > 1000", "top 100 payers").
2. **After exploration** — user says "save that as a segment" or "create a segment from these users"; the prior turn's query filters become the predicate.
3. **Named concept** — user names a concept the glossary defines (e.g. "whales", "VIP payers").

## Mandatory first step

**Always call `get_segmentable_measures({ game: <game_id> })` before `propose_segment`.** Never fabricate a `dimension` member name or a `over` population spec — these reference server-controlled physical paths. Use the catalog entry verbatim.

## Identifying the right measure entry

- Match the user's phrase to the catalog's `label` or `concept`.
- Window-match: "spend last 30 days" → find the entry with `window: '30d'`, NOT the lifetime entry. Wrong window = silently wrong segment.
- If no catalog entry matches, tell the user what is available (list `label` values); do not guess.

## Four predicate shapes

### 1. Threshold (`kind: 'threshold'`)
User says "users who spent > X" or "users with LTV ≥ X".
- No cutoff resolution needed.
- `threshold_value` = the numeric lower bound (use `gte` semantics — inclusive).
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
- Do **NOT** call `get_segmentable_measures` first — this path converts query filters directly, not a catalog measure.
- The tool calls `cubeQueryToPredicateTree` internally. If the filters contain a measure filter, a time-leaf inside OR, or an order+limit without a ranked measure, it returns `ok:false` with a reason — relay the `detail` to the user and suggest they use `kind='threshold'` or `kind='percentile'` instead.
- No cutoff is resolved; `estCount` is 0 and computed on confirm-refresh.

## Guardrails (hard rules)

- **Never** modify `measure.dimension` or `measure.over` fields from the catalog response.
- **Never** emit a percentile or top-N proposal when `measure.over` is absent — return an error so the user is asked for a scope.
- If the measure concept is not in the catalog, list what IS available and ask the user to pick.
- If the user's phrase is ambiguous (e.g. "top spenders" could match multiple windows), call `offer_choices` to let the user pick.

### Name fidelity — the `name` must match the predicate exactly

The `name` you pass is shown verbatim on the confirm card, but the **predicate is what actually selects users**. They must agree. A name that promises a condition the predicate does not encode is a silently-wrong segment.

- `threshold`, `percentile`, and `top_n` each encode **exactly ONE condition** on a single measure. They CANNOT express a compound intent like "high-engagement **never-payers**" (engagement percentile AND spend = 0) — `measure.over` only scopes the *population the percentile is computed over*, it does NOT add a membership filter.
- Do **NOT** put a second concept in the name that the predicate omits. "High-Engagement Never-Payers" with a predicate of only `top 25% active_days` is wrong — drop "Never-Payers" from the name, or build the compound predicate instead.
- For a genuine **compound** intent (two or more conditions AND/OR-ed), use `kind='query'`: explore the conditions as a Cube query first (or have the user do so), then pass the full `filters` array. That is the only shape that carries more than one condition.
- When unsure whether the user wants one condition or several, call `offer_choices` rather than guessing a richer name than the predicate supports.

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

**For kind='query' ("save that as a segment"):**
1. `propose_segment` with `kind='query'` directly — one round. No catalog lookup needed.

Do not call `preview_cube_query` or `emit_query_artifact` in this skill — you are proposing a segment, not exploring data.
