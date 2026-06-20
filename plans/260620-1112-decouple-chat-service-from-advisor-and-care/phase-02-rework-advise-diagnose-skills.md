# Phase 02 — Rework advise / diagnose skills to the native loop

## Overview
- **Priority:** after phase-01
- **Status:** DONE (2026-06-20) (Decision 1 = rework, Decision 3 = re-home capability)
- Make `advise` / `diagnose` answer as a **self-contained expert game-liveops
  analyst** from chat's own Cube-query loop — deep diagnosis + sound, genre-aware,
  data-grounded recommendations — with no advisor/care tools.

## Persona + grounding contract (drives both skill rewrites)
Both skills must instruct the model to operate as a senior liveops practitioner +
business leader at a ~$300M-revenue publisher, speaking to a peer. Two non-negotiables:
1. **Genre expertise picks the hypotheses/levers to consider** (FPS, MMORPG, gacha,
   sports, MOBA, casual each monetize/retain differently — reason from that).
2. **Real data decides what is true.** Every driver named must come from an actual
   `preview_cube_query` over the affected vs baseline window; every "good/bad" call
   must be anchored to `get_metric_benchmark` (internal band / external norm) or the
   `get_topic_knowledge` bank; never invent a Cube member, percentile, norm, or a
   lever the game's data model can't see. Genre says *consider X*; the data says
   *X applies / X is invisible here → drop it*.

## Decision gate (from plan.md)
- **If REWORK (B, recommended):** do the steps below.
- **If DELETE (A):** remove `chat-service/.claude/skills/advise/` and
  `.../diagnose/`; ensure `explore` trigger keywords cover "why/drop/what should
  i" (add if missing) so those questions still route somewhere. Skip the rest.

## Related code files (rework path)
- `chat-service/.claude/skills/diagnose/SKILL.md`
- `chat-service/.claude/skills/advise/SKILL.md`

## Implementation steps (rework path)
1. **allowed_tools:** remove `decompose_metric`, `recommend_actions`,
   `care_queue` from both skills. Keep `preview_cube_query`, `emit_query_artifact`,
   `emit_chart`, `list_business_metrics`, `get_business_metric`, `list_segments`,
   `get_segment`, `get_cube_meta`, `get_topic_knowledge`, `offer_choices`,
   (diagnose) `explain_cube_sql`, `get_business_metric_history`.
   `get_metric_benchmark` per Decision 2. (`get_topic_knowledge` is self-contained —
   verified no advisor/care coupling — and carries the per-game genre/topic grounding.)
2. **diagnose body — native expert walk:** promote the existing **Manual fallback**
   to the PRIMARY path, framed by the persona contract above:
   - Orient with `get_topic_knowledge` (what this game's data can actually answer for
     the topic) before probing.
   - Hypothesis walk over **real data**, ordered by *genre-informed* likelihood (not a
     fixed list): e.g. FPS revenue drop → battle-pass cycle / new-content cadence /
     match-health first; MMORPG → endgame loop / guild activity / server economy;
     gacha → banner schedule / pity exhaustion / whale concentration. Run
     `preview_cube_query` grouped by the candidate dimension over affected vs baseline.
   - **Conclude (mandatory, benchmark-aware):** name the driver, quantify the gap,
     anchor it to `get_metric_benchmark` (internal band / external norm) — say so
     explicitly when a benchmark is unavailable rather than guessing.
   - Drop the engine-payload trust guard; **keep** the grounding/genre-honesty
     guardrails (now enforced by the persona contract, not the engine).
   - Emit one explanatory artifact + contribution chart; cap hypotheses per turn; no
     row dumps beyond 5 values.
3. **advise body — expert recommendation, grounded:** run the same diagnosis to find
   the driver, then give a **sound, genre-aware recommended action** for it:
   - Lead with a one-line benchmark-aware framing of the driver, then 1–3 concrete
     actions drawn from genre best practice that **this game's data supports**.
     Target each at the cohort/segment it addresses (so the reader can build the
     segment / brief the team / run the test in their own tools).
   - Cite **data + benchmark + topic-bank provenance** for each action (not machine
     `sourceEngine` citations — those live in the Advisor console). Be explicit that
     it's an expert, data-grounded recommendation, not a system-emitted one.
     NO genre-lever engine, NO care, NO write-actuation / confirm-to-write step.
   - Genre-honesty: never recommend a lever the game's Cube members can't see (a
     social-MMORPG with no guild/gacha/PvP data is not told to act on clan or gacha
     levers); say "can't assess — no data path" instead.
4. Keep the "lead with strongest signals" framing idea OPTIONAL — re-add only if
   user wants (it was reverted with d79d299f); not required for decouple.

## Todo
- [x] Resolve Decision 1 + 3
- [x] Edit allowed_tools (both)
- [x] Rewrite diagnose body to native walk
- [x] Rewrite advise body to native expert recommendation (grounded, not engine-cited)
- [x] Confirm no SKILL.md mentions the removed tools

## Success criteria
- Neither skill references decompose_metric / recommend_actions / care_queue.
- A "why did revenue drop" question completes with a benchmark-anchored driver
  named from a real Cube query (manual verification or eval).
- A "what should I do" question returns 1–3 concrete, genre-aware actions, each
  grounded in this game's data and a benchmark/topic-bank source, with no invented
  members/levers.
- Both skill bodies carry the persona + grounding contract.

## Risk
- **Ungrounded/hallucinated advice** once the engine no longer gates output — the
  primary risk. Mitigate in the skill body: mandatory real-query-before-claim,
  mandatory benchmark anchor, genre-honesty ("can't assess — no data path"), and an
  explicit "you are an expert reasoning over real data, not inventing levers" frame.
