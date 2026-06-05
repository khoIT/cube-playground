# Freshness probe tool + topic-blind pref-fill gate

**Status:** done · **Branch:** `main`

## Problem (session d57eb4d8, stop_reason=timeout @249s)

1. **Freshness blindness** — "this month" (June) on `etl_money_flow` whose latest
   data is April. Agent burned ~8–10 `preview_cube_query` probes hunting a date
   window with data; the cube's ≤31-day bound guard guaranteed every "recent"
   probe was empty. No primitive answers "what's the latest date with data?".
2. **Topic-blind saved-defaults fill** — `fillGapsFromUserPrefs` filled
   `metric=active_daily.dau` at 0.92 into a currency-outflow question because the
   per-turn metric slot was empty → metric clarification dropped → action flipped
   `clarify`→`auto` (disambiguate-memory-merge.ts:146-163). Skill hard rule says
   never second-guess `auto` → obedient run charts DAU for a money-sink question.

## Fix 1 — `get_time_coverage` tool

`src/tools/get-time-coverage.ts`: input `{member, maxWindows?}` (member = time
dimension ref). Server-side walks 31-day windows backwards from today (default 6),
per window one `/load`: `{dimensions:[member], timeDimensions:[{dimension, dateRange}],
order desc, limit 1}` → first hit IS the latest date with data. Returns
`{found, latestDate, probedWindows, searchedBack}`. Rejects measures and
non-time dimensions without querying. Registry + explore-skill wiring:
"empty preview on a recent range → ONE get_time_coverage call, re-anchor, disclose staleness."

## Fix 2 — gate topic slots in memory/pref fill

Signal: `result.unresolved` (engine's unaccounted-text spans) — for the failed turn
it held essentially the whole question. Gate: when any unresolved span has ≥3 words,
the message is a new question with its own (unknown) subject — skip gap-fill of
**topic-bearing slots** (metric, intent, concept, entity) from BOTH L2 session
memory and L3 user prefs. Keep dimension/timeRange/filter fills (benign refinements).
Legit reply flows unaffected: "by country"/"theo quốc gia"/"ARPU" have no ≥3-word
unresolved span (or resolve the metric themselves).

## Phases

| Phase | Title | Status |
|-------|-------|--------|
| 01 | `get_time_coverage` tool + registry + tests | done |
| 02 | Topic gate in fill paths + tests | done |
| 03 | Explore-skill wiring + lessons-learned | done |

## Out of scope (YAGNI)

- Earliest-date probing / full coverage map (only latest matters for re-anchoring).
- Caching freshness per cube (probe is 1–6 cheap queries; revisit if hot).
- Clarification option offering saved default as a choice (nicer UX, more wiring).
