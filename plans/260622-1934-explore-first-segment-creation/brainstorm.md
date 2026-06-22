# Brainstorm — Explore-first segment creation

**Date:** 2026-06-22 · **Lens:** LiveOps + game-publishing product

## The reframe
A segment is the **residue of an exploration**, not the starting point. Producers/analysts think *"who's about to churn?"*, *"where's whale leakage?"*, *"did the festival move D7?"* — the cohort is what they keep at the *end* of answering that, so they can action it.

Today's funnel:
> Question → (thin) Exploration → `propose_segment` → Cohort → (no action loop)

The exploration middle is thin and there is **no lineage**: a `segment_proposal` doesn't remember the query it came from, and a query artifact has no "make this a segment" bridge (`src/pages/Chat/components/query-artifact-card.tsx` offers only *Refine* + *Open in Playground*). The in-flight plan `260622-1833-segment-size-multimeasure-edit` hardens *authoring* (pre-confirm size, multi-measure, edit). This plan widens the *on-ramp before authoring*.

## Current-state facts (scouted)
- `POST /api/preview` → `{ estimated_count, cube_query, sql_preview }` from a predicate_tree + cube (`src/api/segments-client.ts:238`). Backbone for live count, distribution base population, and profiling.
- `QueryArtifact` carries `query` (CubeQuery), `game`, `source`, `chart` (`src/api/chat-sse-client.ts:101`). Enough to seed a segment — needs a CubeQuery→predicate_tree translation.
- `server/src/services/predicate-to-sql.ts` already turns a predicate tree → SQL WHERE (incl. AND/OR + percentile subqueries).
- `segment-overlap-counts.ts` set-maths **two saved segments** off the nightly membership snapshot — a *candidate* (unsaved) has no snapshot row, so overlap pre-save needs a different path (sampled uid_list vs snapshot membership).
- Member-panel aggregates exist for *saved* segments (`segmentsClient.memberPanels`) — profiling a *candidate* predicate is net-new but reuses the same query shapes.
- No histogram/distribution endpoint exists — net-new.
- `stashEditorPrefill` + `EditorLocationState.advisorPrefill` already bridge a proposal into `/segments/new` — reusable for the explore→author hop.

## The four moves

### 1. "Build segment from this" bridge (+ lineage)
Every query artifact / chart gets a **Build segment from this** action. The explored CubeQuery (filters + game + cube) is translated into a predicate_tree and handed to the existing propose-card. The created segment records *born-from: <question/artifact id>*.
- **Why (LiveOps):** makes exploration the default on-ramp; kills the "blank segment builder" cold-start. Lineage answers *"why does this cohort exist?"* months later — critical for shared workspaces and audit.
- **Reuses:** `QueryArtifact.query`, `predicate-to-sql`, prefill path, `propose_segment`.
- **New:** CubeQuery→predicate translation (filters→leaves; measure thresholds), a `source_query`/`born_from` field on proposal + segment.
- **Risk:** not every explored query is segmentable (aggregate-only, multi-cube, time-series). Gate the button on a per-user-grain, single-cube, filterable shape; hide otherwise.

### 2. Distribution-first cutoff picker
Before committing a threshold, show the **histogram of the measure** (LTV, `days_since_last_active`, sessions) and let the user *see the curve and place the knife* — drag a line, watch cohort size update live.
- **Why:** producers stop arguing about arbitrary cutoffs because they see where the population clusters (whale tail, D3 cliff). "Explore first" made literal.
- **Reuses:** in-flight dry-run count for the live size readout.
- **New:** `POST /api/distribution` — bucketed counts of a measure over a population (CASE buckets or approx_percentile deciles via Cube/Trino); draggable-threshold UI bound to live count.
- **Risk:** distribution query latency on big cubes — must run against per-user pre-agg grain, timeout-bounded, fall back to plain numeric input if it times out.

### 3. Pre-save cohort profile ("who are these people?")
A count is not understanding. Before saving, show a quick qualitative panel — top countries, platform split, tenure band, avg LTV, favorite mode.
- **Why:** turns a number into a cohort a producer can reason about and trust before they spend budget on it.
- **Reuses:** `/api/preview` for the base population; member-panel query shapes.
- **New:** `POST /api/profile` (predicate + cube + a few dims → top-k breakdowns), profile panel in the propose card.
- **Risk:** profile dims vary per game/cube — pick from the segmentable-dimension catalog, degrade gracefully when a dim is absent.

### 4. Overlap / novelty guard
*"This candidate is ~80% the same as your existing 'Lapsing Whales' segment."*
- **Why:** segment sprawl — dozens of near-dup cohorts nobody trusts — is a real publishing-ops disease. A novelty nudge at propose-time keeps the library clean.
- **Reuses:** `segment-overlap-counts.ts` set-math + membership snapshot.
- **New:** candidate-vs-existing path. Candidate has no snapshot, so: sample candidate uid_list (preview already returns a 5k sample) and intersect against snapshot membership of the user's segments in the same game; surface top overlaps as a badge.
- **Risk:** sample-vs-full overlap is approximate — label it "~" and scope to same game/cube to bound cost.

## Sequencing rationale
Lineage + translation (foundation) unblocks the bridge. Distribution and profile both lean on the preview/count infra and are independent of each other. Overlap is last (most approximate, lowest urgency). Each move is shippable on its own — no big-bang.

## Alternatives considered / deferred
- **Save the *exploration* as its own object** (lightweight pinned query+chart, promote-to-segment later). Powerful, but introduces a new durable primitive — deferred pending the open question below.
- **Intent-shaped templates** (Win-back / Whale-care / Activation) — overlaps the VIP Care Playbook work; keep there, not here.
- **Outcome forecast** ("≈5k users → ~400 conversions at 8% take-rate") — valuable leader-facing framing but needs take-rate priors we don't have yet; deferred.
- **Forward-looking/predicted cohorts** — needs a model; out of scope.

## Open questions
1. Should explore-first artifacts be **saveable as their own object** (a "saved exploration"/view), or is a segment the only durable cohort primitive? (Decides whether the deferred alternative comes back.)
2. Distribution buckets: fixed count (deciles) vs adaptive (Freedman–Diaconis)? Deciles are simpler and cheaper — default unless you want true shape fidelity.
3. Overlap guard scope: compare against **only the user's own** segments, or workspace-shared too? (Privacy + cost.)
4. Is approximate overlap (sampled candidate) acceptable, or must the candidate be materialized first? (Affects Phase 06 shape.)
