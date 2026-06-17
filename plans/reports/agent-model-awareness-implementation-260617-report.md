# Agent model-awareness & ask-frugality — implementation report (2026-06-17)

Plan: `plans/260617-1057-agent-model-awareness-smart-asking/`. All 8 phases (P0–P7) done.
Two commits: P0–P2 = `99a02edd`; P3–P7 = (this batch).

## What shipped
Make the chat agent reason from each game's data model + the session's resolved
context, answer with sensible defaults instead of re-asking, and enforce the
hard correctness rule (grain) in code. Everything additive + behind default-off
flags → flags-off is byte-identical to prior behavior.

| Capability | Mechanism | Flag |
|---|---|---|
| Model-graph digest | per-game hub+joins+clusters map in the cacheable prompt prefix | `AGENT_MODEL_DIGEST_ENABLED` |
| Resolved-context | "Resolved so far" from the engine's own memory, in the volatile tail | `AGENT_RESOLVED_CONTEXT_ENABLED` |
| Smart defaults | default metric=Revenue (glossary), time=last 30d; entity grain ask-first | `AGENT_SMART_DEFAULTS_ENABLED` |
| Toggle → posture | aggressive/targeted now reaches the agent prompt; FE default = Aggressive | `AGENT_MODE_GOVERNS_POSTURE` |
| Engine routing + grain gate | drop ratio metrics (ARPU…) from individual leaderboards in code | `AGENT_ENGINE_ROUTING` |

## Key decisions / deviations
- **Shared builder = byte-identical vendored copy + drift guard**, NOT the plan's
  top-level `shared/`. Verified infeasible: chat-service `tsc rootDir:src` + a Docker
  image with no FE source. The two copies can't diverge silently (drift test).
- **Grain gate fires only when the entity is KNOWN individual** (user-grain pk or
  mf_users/user_roles cube). Groups + unknown grain keep ratios → no false exclusion
  of valid group rankings (top countries by ARPU).
- **FE toggle default flipped to Aggressive** (Q-C/Q-B locked). The one change not
  behind a server flag (it's a FE pref). Storage key unchanged → existing users keep
  their pick; only new users get auto-answer. Revert = one line.
- **Continuity write-back is conservative**: emit_query_artifact persists only a
  single-measure metric + an explicit window; entity grain inference left to the
  engine path (avoids wrong-slot pollution). Staleness guarded by the existing
  shared rephrase gate — no second policy.

## Verification
- chat-service: `tsc --noEmit` exit 0; full vitest **1199 passing** (140 files; +18 new).
- FE: cube-graph 33/33; root tsc has only pre-existing unrelated errors (none in touched files).
- Drift guard verified byte-identical. Code review (P0–P2): no Critical/Major.
- Live N-run smoke (P6): **deferred — manual** (needs the OAuth+Cube lane). Deterministic
  eval gates CI; the live runner + corpus are committed for operational verification.

## Rollout
One flag at a time, watch a day each (order + per-flag watch items in
`phase-07-docs-and-rollout.md`). The FE Aggressive default ships independent of the
server flags — call it out to users; it is the only non-flag-gated behavior change.

## Unresolved questions
- Is `/meta` cube ordering stable across fetches? (Hardened the digest PK fallback to
  be order-independent anyway, so this is no longer load-bearing.)
- Live eval has not been run — the "↓ clarifying turns / 0 grain errors / 0 re-asks"
  numbers are asserted by unit tests, not yet measured end-to-end on the live lane.
