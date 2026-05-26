# chat-service Agent Revamp — Plan Overview

**Created:** 2026-05-26 | **Branch:** main | **Owner:** TBD
**Inputs:**
- `plans/reports/researcher-260526-0441-chat-service-agent-sdk-review.md` (SDK + architecture review)
- `plans/reports/researcher-260526-0705-glossary-resolution-failures-session-analysis.md` (**centre of gravity** — real session showed 8 turns to deliver 1 query)
- Cross-turn-context gap analysis (2026-05-26 chat)

## Primary Business Goal

**The agent answers in 1 turn, not 5.** Today, ambiguous concept phrases ("top spenders this week") trigger 3–4 clarification loops that re-ask things the agent already knows. The analysis report breaks down the eight failure modes in session `b93d68e4`; five of them are not addressed by the original plan. **Phase 02a (glossary resolution v2) is the headline phase** — every other phase is supporting infrastructure.

Concretely, this means:

1. **Concept tier in the glossary** — "spender" / "whale" / "churner" resolve to `(entity, default_measure, default_filter, ranking)`, not just to a metric id.
2. **Resolver auto-routes on obvious matches** — exact id, fully-qualified cube ref, or one high-confidence concept → no clarify; emit answer with an assumption-disclosure footer.
3. **Leaderboard intent resolves an entity, not a metric** — "top X" becomes `{entity, orderBy DESC, limit}` directly when the concept is rankable.

## Approach

| Layer | What it solves | Phase |
|---|---|---|
| **Resolution** (headline) | "Don't ask me 4 questions to answer 1" | **02a** |
| **Thread-as-memory** (primary) | "Agent sees the whole conversation, not just the latest message" | **01 (SDK resume) + compaction** |
| **Deterministic slots** (backup) | Slot-level continuity when thread visibility isn't enough | 02 (focus store) + 02a sub-deliverable D |
| **User control** | "Show me + let me edit what you remember" | 03 |
| **Robustness** | Cancellable, observable, deterministic | 04 + 05 |
| **Scope expansion** | Research mode, web search, decomposed nl-to-query | 06 + 07 |
| **Governance + safety net** | Audit trail, tests, evals | 08 + 09 + 00 |

### Why thread-as-memory is now the primary mechanism

Claude Code, claude.ai, and the broader Anthropic SDK ecosystem converged on the same pattern: **the conversation thread itself is the memory**. Every turn the model sees the entire prior thread (tool calls + results + user replies) and re-derives understanding in context. There is no slot-extraction state machine in those products — anaphora ("show that by country"), clarification merging ("Revenue" answering a prior question), and topic pivots are handled implicitly because the question being answered is literally in the prompt.

Our chat-service today does the opposite: each turn opens a fresh SDK conversation (`claude-runner.ts:130-133`) AND flattens user input through a deterministic NL-to-slot pipeline (`nl-to-query/`) whose memory layer only carries 4 slots. Anything outside that schema evaporates between turns.

The fix is to align with the industry pattern: **SDK session resume gives the model the whole thread**, while slot extraction stays as a *determinism layer* on the happy path (not as the memory layer). Phase 01 is therefore promoted to P0 and lands alongside 02a — together they collapse the painful sessions from 8 turns to 2.

### Compaction

The model's context window is finite. We already have `compact-service.ts` (80% threshold → summarise recent turns → fresh session with summary preamble). With Phase 01 active this becomes critical: as the thread grows the SDK resume bill grows too. Compaction is what makes thread-as-memory affordable.

Compaction strategy (phase 01 spec):
- Trigger threshold lowered to **60%** when SDK resume is on (more aggressive — sooner summary, smaller resumes).
- Summary preserves: the original question / goal, every emitted artifact ref, every confidently-resolved slot from disambig + focus, plus a model-generated prose summary of the last N turns. Compacted summary becomes the new `system_preamble`.
- New session opens with **fresh SDK resume id** (cleared on compact) — model sees only the summary, not the full prior thread.
- Focus store + disambig memory port over verbatim (already speccd in phase 02 + 02a).
- Per-session telemetry: how often compaction fires, what % of token budget was saved.

### Two-layer context

Both layers retained — primary + backup — to give the model continuity even when the thread/summary is incomplete:

- **Layer A (primary) — SDK session resume + compaction.** Persist the Claude SDK's conversation id; pass it back on subsequent turns so the model sees its prior thread. Compaction summarises when the thread bloats.
- **Layer B (backup) — Focus store + extended disambig memory.** Per-session structured slots (`last_skill`, `last_concept`, `last_metric`, `last_dimension`, `last_timeRange`, `last_segment`, `last_artifact_ref`, `last_filters` + the extended disambig slots `intent`, `concept`, `entity` from 02a sub-deliverable D) injected into the system preamble. Survives compaction; deterministic.

Both layers are gated by feature flags and observable from day 1. Their interaction is tested in the 4-cell A/B (`{resume on/off} × {focus on/off}`) before either ramps to 100%.

### What we explicitly defer (Fix B)

A "pending clarification" state machine — snapshot the entire pre-clarify resolution at SSE emit time and merge the next reply into the snapshot — is **deferred** unless Phase 01 + the slot bridging in 02a sub-deliverable D leave observable gaps. Rationale: thread visibility from Phase 01 handles the same edge cases (replies like "yes", "actually 30d", "the second one") without adding a new state machine. Revisit only if evals show ≥10% failure rate on clarification-reply cases after 01 + 02a-D ship.

## Phase Index

| # | Phase | Priority | Status | Flag |
|---|---|---|---|---|
| 00 | [Foundations](./phase-00-foundations.md) | P0 | **Done** (code lands; spike A/B deferred to phases 01/04 kickoff) | — |
| **01** | **[SDK session resume + compaction (primary memory)](./phase-01-sdk-session-resume.md)** | **P0** | **MVP done** (capture/resume/clear loop + 5 unit tests; sub-phases 01b/01c carry threshold + eval) | **`CHAT_CONTEXT_SDK_RESUME`** |
| **02a** | **[Glossary resolution v2 (headline)](./phase-02a-glossary-resolution-v2.md)** | **P0** | **MVP + sub-deliverable D done** (concept tier + resolver short-circuits + leaderboard path + b93d68e4 replay 8→2 turn collapse verified; sub-phases 02a-FE / 02a-E carry FE + 50-case eval) | **`CHAT_GLOSSARY_V2`** |
| 02 | [Focus store (context layer B)](./phase-02-focus-store.md) | P1 | **Done** (adapter + compose + turn write + compact port + 17 tests; anaphora eval lives in phase 09) | `CHAT_CONTEXT_FOCUS_STORE` |
| 03 | [Memory settings panel + chat header chip](./phase-03-memory-settings-panel.md) | P1 | Pending | `CHAT_MEMORY_UI` |
| 04 | [Cancellation, timeouts, error UX](./phase-04-robustness-cancel-timeout.md) | P1 | Pending | `CHAT_TURN_TIMEOUT_MS` |
| 05 | [Observability unification](./phase-05-observability-unification.md) | P1 | Pending | — |
| 06 | [Research mode + web search](./phase-06-research-mode-web-search.md) | P2 | Pending | `CHAT_ENABLE_WEB_SEARCH`, `CHAT_ENABLE_RESEARCH_MODE` |
| 07 | [nl-to-query decomposition](./phase-07-nl-to-query-decomposition.md) | P3 (reduced) | **Done (reduced)** — parse_date_range tool registered flag-gated; 7 tests | `CHAT_NLQ_DECOMPOSED_TOOLS` |
| 08 | [Business-metric audit trail](./phase-08-business-metric-audit.md) | P3 | Pending | — |
| 09 | [Test coverage uplift](./phase-09-test-coverage.md) | P2 | Pending | — |

## Dependencies

- 00 → all (presets + tool-registry validation + streaming clarity)
- **02a** → 02 (`last_concept` slot from 02a feeds focus store)
- **02a** → 09 (concept-resolution eval suite extends 09's eval harness)
- **02a** absorbs concept-resolution tools from 07; **07 reduces in scope** to `parse_date_range` only
- 01 + 02 → 03 (UI needs both context layers landed to render correctly)
- 04 → 05 (cancellation events must flow through the unified tracer)
- 05 → 06 (research mode needs reliable tracing to detect misbehaviour)
- 08 independent

## Sequencing recommendation

Land in this order:
**00 → (01 + 02a in parallel) → 02 → 03 → 04 → 05 → 06 → 07 → 08; 09 continuous**.

Rationale:
- 01 and 02a are both P0 and target different bug classes — 02a fixes resolution + slot persistence; 01 fixes thread visibility. They share zero file ownership; safe to land in parallel branches.
- 02 (focus store) lands after both so it can read the `last_concept` slot from 02a and inherit thread-survival behaviour from 01.
- 03 (UI) follows once 01/02/02a are stable in staging.
- 04/05 (robustness + observability) follow because they observe the new SSE events (`turn_aborted`, `focus_updated`, `context_resumed`, `assumption_applied`) from earlier phases.
- 06 (research mode) needs reliable tracing from 05.
- 07 reduces to `parse_date_range` only after 02a absorbs glossary tools.
- 08 (audit) and 09 (tests + evals) ship continuously alongside.

## Success Metrics

- **Resolution (HEADLINE — phase 02a):** median `turns_to_answer` drops ≥40% vs the prod-audit baseline; the session-`b93d68e4` regression set resolves in ≤2 turns; concept-resolution eval pass rate ≥85% on a 50-case suite.
- **Thread continuity (HEADLINE — phase 01):** thread-continuity eval ≥90% pass on 30-case suite (model correctly references any prior turn — anaphora, clarification merge, multi-step follow-ups). Long-session compaction preserves goal/artifact context with ≤5% information-loss on the regression set.
- **Helpfulness (phase 02):** ≥30% drop in repeat-disambig rate (same slot asked twice in one session).
- **Robustness (phase 04):** zero hung turns >`CHAT_TURN_TIMEOUT_MS` in prod; cancellation success rate ≥99% within 2s.
- **User control (phase 03):** memory settings panel surfaces every remembered slot; "forget" round-trip <500ms.
- **Test coverage (phase 09):** `src/core/*.ts` ≥80% lines.

## Risk Register (top items)

- **R1** SDK resume token cost growth → mitigate via auto-compact threshold + telemetry; flag-gated.
- **R2** Focus store + SDK resume both leak stale context if not cleared on `/reset` → phase 03 ships a single "reset session focus" action that clears both layers + emits SSE.
- **R3** Research mode latency regression → scope to diagnose skill only behind flag.
- **R4** Observability refactor drops signals → phase 05 lands behind parallel-emit shim, A/B compared before cutover.

## Rollout

Each phase ships behind its flag, dark-launched in staging for ≥1 week, then ramped 10%→50%→100% in prod with metrics gating each ramp.

**Context-layer A/B (phases 01 + 02).** Before either layer ramps to 100%, run a four-cell comparison for ≥3 days at 10%: `{resume on/off} × {focus on/off}`. Track anaphora-eval pass rate, input-token cost, model-repetition rate. Both-on must beat either-alone on coherence without ≥2× cost regression; otherwise demote the loser layer to flag-off until investigated. This explicitly tests for double-conditioning (model seeing same context twice).

## Out of Scope

- Cross-organization memory sharing.
- Voice / multimodal input.
- Background "remembered facts" mining from chat history (separate proposal).

## Open Questions

Resolved this iteration (no further action — see linked phase file):
- ~~X1 disambig memory port on compact~~ → folded into phase 01 functional reqs
- ~~X3 information-loss quiz design~~ → hybrid (exact-match + LLM-as-judge); spec in phase 01
- ~~X4 tool-result stripping on resume~~ → >2 KB → placeholder; spec in phase 01
- ~~X6 chip × compaction hand-off~~ → hook re-subscribes on `context_compacted`; spec in phase 03
- ~~X8 VI/code-switched compaction cases~~ → scenario 5a added to phase 01 eval
- ~~X9 spike sequencing~~ → Spike A + B run Day-1 of phase 00, block dependent phases
- ~~X10 forget matrix includes 02a-D slots~~ → phase 03 matrix updated
- ~~SDK resume API~~ / ~~auto-compact × resume interaction~~ → covered by Spike A + phase 01 scenarios 5–9

Resolved this iteration (in addition to the X-series above):
- ~~Concept catalog source of truth~~ → **extend existing `glossary_terms` table**, not a parallel `concepts/*.yml`. Reuses schema, seed loader, API, FE CRUD, chat-service glossary client. Migration `009-glossary-concept-tier.sql` adds nullable columns.
- ~~Trust tier day-1~~ → **certified** for all 10 seed concepts.
- ~~Intent persistence (X7)~~ → **Option B with always-disclose**: two-tier write — session tier (7d TTL, conf 0.95) + cross-session tier (`user_disambig_prefs` extended with `intent / concept / entity` slot variants, conf 0.7 on read). Cross-session-sourced defaults *always* render an explicit-history assumption footer, never silent-auto. Mitigates stale-pref drift.
- ~~Ownership template~~ → not a blocker for this work; treat user as owner, subagents as implementers.

**Nothing left to decide before coding starts.** All defaults locked; phases gated only by their own spike steps (Spike A + B run Day-1 of phase 00).

Decide-when-the-phase-starts (can defer):
5. **(phase 02a / 02)** When concept is resolved with assumption, write `last_concept` to focus BEFORE or AFTER user confirms? Pre-confirm = faster continuity; "not that" must clear cleanly. Default proposal: pre-confirm + "not that" handler.
6. **(phase 02a)** Deprecate `payers` synonym from `paying_users.yml` once the `spender` concept exists, or keep both for backwards compatibility? Default proposal: keep both for one release cycle, deprecate-on-warning in next.
7. **(phase 01)** Compaction frequency target ≤1 per 30 user turns at p95 — tune up or down based on first week of telemetry.
8. **(phase 06 — X5)** Research-mode turns bloat the resume thread fast. Force-compact at end of research turn, or run research in a separate non-resumed sub-conversation? Decide during phase 06 design.
9. **(phase 06)** Memory store: stick with `user_disambig_prefs` table, or migrate to SDK's native memory store if available? Tied to Spike 2 results inside phase 06.
10. **(phase 02 / 02a-D)** Per-user vs per-(user, game) scoping for the new focus slots (`intent`, `concept`, `entity`). Current disambig prefs are per-(user, game); keep symmetric?
11. **(phase 08)** Audit trail backfill — mine YAML git history or start fresh? Stakeholder call.
12. **(phase 09 — finance)** `EVAL_DAILY_BUDGET_USD` default is $50; needs finance review for production setting.
