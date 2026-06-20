# Decouple chat-service from the advisor engine + care

## Goal

chat-service becomes a **self-contained, expert game-liveops analyst**: it answers
deep **diagnostic** ("why did X drop") and **prescriptive** ("what should I do")
questions through its own understand → query Cube → reason → conclude → recommend
loop, with **no dependency on the advisor lens/recommend engine and no care
concepts**.

Decoupling is **not** a capability downgrade. The depth re-homes from a separate
engine *into the agent itself*:

- **Reason like an expert.** The skills embody a senior liveops practitioner +
  a business leader at a ~$300M-revenue game publisher, talking to peers. Apply
  **genre-specific industry-standard practice** (FPS vs MMORPG vs gacha vs sports
  have different monetization/retention levers) from that expertise — not from a
  fetched lever library.
- **Ground every claim in real data.** Insights and recommendations stand on
  Trino data queried through Cube (`preview_cube_query` / `emit_query_artifact`),
  the per-game curated knowledge bank (`get_topic_knowledge`: verified
  liveops/UA/monetization questions + metrics), and benchmark anchors
  (`get_metric_benchmark`: internal percentile band + external published norm).
- **Stay honest to the data model.** Only diagnose/recommend what the game's
  actual Cube members support; never invent levers a genre "should" have but the
  data can't see. Name the driver from the data, quantify it, benchmark it, then
  give a sound, genre-aware recommended action the reader can carry into their own
  tools (build the segment, brief CS/the team, run the test). No write-actuation.

**Keep** (explicit user decision): segments (`propose_segment` / `list_segments`
/ `get_segment` / `get_segmentable_measures` + the `segment` skill) and the
query builder / disambiguation loop.

**Out of scope:** the server-side advisor engine (`server/src/advisor/*`) and
`/api/advisor` stay — they power the **Advisor FE console** (`src/pages/Advisor/*`),
which calls the server directly (`src/api/advisor.ts`), NOT chat-service.
Verified: removing chat's advisor coupling does not touch the console. Care FE
console (if any) likewise unaffected.

## Why now

The advisor + care rail was previously wired *into* chat-service (`advise` /
`diagnose` skills drive `decompose_metric` + `recommend_actions` + `care_queue`).
Direction is now: those are **front-end artifacts only**; chat must stand alone.

## Scope of coupling (verified by grep)

| Surface | Coupled to advisor/care | Action |
|---|---|---|
| `advise` skill | decompose_metric, recommend_actions, care_queue | rework or remove (Decision A) |
| `diagnose` skill | decompose_metric, recommend_actions, care_queue, get_metric_benchmark | rework or remove (Decision A) |
| `explore`, `compare`, `segment`, `metric_explain` | none (segments only) | unchanged |
| tools | `recommend_actions`, `decompose_metric`, `care_queue` | delete + unregister |
| helpers | `recommendation-citation`, `recommendation-trust-guard` (shared only by the two tools above) | delete |
| tests | `tool-decompose-metric`, `tool-prescriptive-reads`, `recommendation-trust-guard` | delete/adjust |

## Phases

- [x] **phase-01** — Remove advisor + care tools from chat-service (registry,
      tool files, helpers, tests). See `phase-01-remove-advisor-care-tools.md`.
- [x] **phase-02** — Rework `advise` / `diagnose` skills to the native loop (drop
      the 3 tools; promote the existing manual hypothesis walk to the primary
      path). See `phase-02-rework-advise-diagnose-skills.md`.
- [x] **phase-03** — Cleanup + verify: docs/lessons, no dangling refs, full test
      run, confirm Advisor FE console still green. See `phase-03-cleanup-verify.md`.

## Status: DONE (2026-06-20)

- Phase-01: registry trimmed (3 imports + 3 registrations removed); 5 src + 3
  test files deleted; `tsc --noEmit` clean; `registry-boot-guard` green.
- Phase-02: `advise` + `diagnose` SKILL.md rewritten to the self-contained expert
  loop (persona + grounding contract); 3 engine tools removed from `allowed_tools`;
  `skill-loader` + `registry-boot-guard` green (16 tests).
- Phase-03: lessons-learned scope note added; `mode-prompts.ts` clean; zero
  dangling refs in `src`/`.claude`; `get-metric-benchmark.ts` comment/description
  refs to `decompose_metric` rephrased; root FE build green (Advisor console
  compiles); Care FE = CS dashboard (`src/pages/Dashboards/cs`), server-direct,
  unaffected. Chat suite: 1289 passed / 2 failed — both the pre-existing
  `mode-prompts.snapshot` stale-snapshot reds (commit d9e3a945), zero new.

## Decisions (RESOLVED)

1. **advise/diagnose skills → REWORK** to the native Cube-query loop (keep the
   doors; drop decompose_metric/recommend_actions/care_queue).
2. **`get_metric_benchmark` → KEEP** (metric/portfolio benchmark, not the lens
   engine).
3. **Cited-recommendation capability → re-homed, not dropped.** The *engine-cited*
   recommend experience (sourceEngine/triggeringSignal/lever-library citations)
   stays in the **Advisor FE console** (`src/pages/Advisor/*` → `/api/advisor/*`,
   incl. its own agent at `/api/advisor/agent/turn`) — that console is untouched.
   Chat does NOT lose the ability to recommend; it changes the *source of
   authority*: instead of rendering candidates emitted by the lens engine, chat
   produces recommendations from **its own expert reasoning grounded in real
   data + `get_topic_knowledge` + `get_metric_benchmark`** (see Goal). Grounding,
   benchmarking, and genre-honesty are preserved; the dependency on
   `/api/advisor` + the genre-lever library is what's removed.

## Risks

- **Hallucinated/ungrounded advice.** Once the lens engine no longer gates output,
  the skill prompt must hard-enforce grounding: every driver named from a real
  Cube query, every benchmark from `get_metric_benchmark` or `get_topic_knowledge`,
  no invented members/levers. Genre expertise informs *which* levers to consider;
  the data decides *whether* they apply. Mitigated in phase-02 guardrails.
- **Engine-citation loss in chat.** Chat stops emitting `{sourceEngine,
  triggeringSignal}` machine citations. Accepted per Decision 3 — the console keeps
  those; chat cites data + benchmark + topic-bank provenance instead.
- Hidden importers: confirm nothing else in chat imports the deleted tools/helpers
  (grep clean so far — only the two tools + their tests).
