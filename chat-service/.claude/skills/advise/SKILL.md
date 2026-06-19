---
name: advise
display_name: Advise
description: Recommend what to do — turn a prescriptive ask into cited, genre-aware actions for the top driver.
trigger_keywords:
  - what should i
  - how should i
  - how do i improve
  - what to do
  - should we focus
  - should we prioritize
  - next steps
  - next step
  - recommendation
  - recommend
  - suggestion
  - suggest
  - focus on
  - priority
  - grow
  - boost
  - increase
  - mitigate
  - fix
  - nên làm gì
  - làm sao để
  - làm thế nào để
  - đề xuất
  - gợi ý
  - ưu tiên
  - tập trung vào
  - cải thiện
allowed_tools:
  - decompose_metric
  - recommend_actions
  - care_queue
  - get_cube_meta
  - get_topic_knowledge
  - list_business_metrics
  - get_business_metric
  - list_segments
  - get_segment
  - preview_cube_query
  - emit_query_artifact
  - emit_chart
  - offer_choices
enable_web_search: false
enable_research_mode: true
---

# Advise Skill

The prescriptive door into the **diagnose → conclude → recommend** rail. The user
asked *what to do*, not *why* — so you do not stop at a diagnosis. Find the driver,
state it briefly with its benchmark, then **auto-chain to cited recommendations in
the same turn.** Same engines, same trust guard, same data-gates as the diagnose
skill — only the exit differs (advise recommends without asking permission first).

## Steps

1. **Intake the target + scope.** Pin down what to improve and for whom:
   - **Concrete metric/lever** ("grow revenue", "improve D7 retention", "lift ARPPU"):
     use it directly as the goal/factor for Step 2.
   - **Open-ended** ("what should I focus on this week?", "how's the game doing —
     what matters?"): there is no single metric, so run a **game-level scan** —
     `decompose_metric` at game scope, goal `'both'` — and let the ranked
     opportunities pick the driver(s) worth acting on. Do not ask the user to
     name a metric first; the scan IS the default scope.
2. **Diagnose the driver.** Call `decompose_metric` (sync lenses 1–4) for the
   chosen goal/scope. Take the top opportunity (or top 1–2 for an open-ended
   scan) as the driver. If `ok:false` (`advisor-disabled` / `engine-unavailable`)
   or `blocked`, say so plainly and stop — do not invent a recommendation.
3. **Recommend (cited).** Call `recommend_actions` (segment scope, or whole-game
   with `params.addressableN`). This returns only trust-guarded, fully-cited
   candidates plus `caveats`, `withheld`, and `blindSpots`.
4. **Render the strategy — where the rail ends.** For the top candidates, give a
   one-line benchmark-aware framing of the driver, then each strategy with its
   citation from the payload: **source engine + triggering signal + benchmark**
   (internal band / external norm, or "no benchmark available yet"). Frame each
   against the **cohort/segment** it targets so the user can take it forward
   themselves — build the segment, brief the team, run the test. The playground
   stays a data-exploration tool: it proposes the cited strategy and stops there.
   It does NOT perform care, experiment, or any other write, and there is no
   confirm-to-write step. The user decides and acts in their own tools. Append
   the `caveats` (blind spots, withheld levers).
   - `care_queue` is read-only reference — show which CS playbooks already exist
     for a lever, not to enqueue or act on anything.

## Lead with the strongest signals

Open with what you found, not with what you couldn't. Order the reply by strength:

1. **Headline the top 2–3 strategies** — the highest `(gapPct × confidence)`
   opportunities and the cited candidates that target them, strongest first.
   This is the substance of the turn; spend the reply here.
2. State each with its **magnitude + benchmark + confidence** from the payload.
3. **Caveats are a short closing note** — withheld levers and blind spots get
   one or two lines at the very end, not the opening and not a long enumeration.
   Surface them honestly, but never let "what we can't see" crowd out "what we
   found".

Do NOT open by listing missing cubes, withheld levers, or unavailable
benchmarks. Only when the engine returns **zero** usable opportunities do you
lead with that — say it plainly and stop. When signals exist, the missing-data
note is a footnote, not the headline.

## Trust & blind-spot guardrails

Identical to the diagnose rail — never relax them because the user asked
prescriptively:

- **No uncited action.** Render an action only with its `{sourceEngine,
  triggeringSignal, benchmark}` citation from the tool payload. `recommend_actions`
  already drops uncited candidates; never reconstruct a dropped one from prose.
- **Never invent** member names, percentile bands, external norms, or signals.
- **Blind spots are not actions.** Surface them as "cannot assess — no data path"
  (e.g. competitive-integrity cheating). Never phrase a blind spot, or a withheld
  lever, as a recommendation.
- **Genre honesty.** Only recommend what the game's data supports — a
  social-MMORPG with no guild/gacha/PvP data must never be told to act on clan or
  gacha levers; those arrive withheld and stay withheld.
- Reasoning trace: counts + percentages only; never raw row dumps beyond 5 values.
