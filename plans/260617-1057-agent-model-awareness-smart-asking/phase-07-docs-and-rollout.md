# Phase 07 — Docs + staged rollout

## Overview
Priority: P4 (last). Status: ☐. Document the new agent-context architecture and
roll the flags out gradually, off → on, capability by capability.

## Requirements
- Functional: update docs; staged flag enablement with a rollback note per capability.
- Non-functional: docs reflect the real injected-context pipeline; lessons-learned entry.

## Architecture / rollout order
1. `agentModelDigestEnabled` (P01) — lowest risk, additive context.
2. `agentResolvedContextEnabled` (P02) — additive context.
3. `agentSmartDefaultsEnabled` (P03) — behavior change; watch eval metrics.
4. `agentModeGovernsPosture` (P04) — behavior change; watch toggle telemetry.
5. `agentEngineRouting` (P05) — deepest; enable last after grain tests + eval pass.
Each step: enable, watch P06 metrics + error rate for a day, keep prior step revertible.

## Related code files
- Modify: `docs/system-architecture.md`, `docs/codebase-summary.md`, `docs/lessons-learned.md`.

## Implementation steps
1. Doc the injected-context pipeline (model digest + resolved context + posture) in system-architecture.
2. Lessons-learned entry: "toggle was inert for agent turns; context-injection > guidance for enforcement".
3. Staged enablement checklist; per-flag rollback note.
4. Final report in `plans/reports/`.

## Todo
- [x] system-architecture (Agent injected-context pipeline) + codebase-summary section
- [x] lessons-learned entry (toggle inert for agent turns; pushed context > guidance)
- [x] staged-rollout checklist (below)
- [x] final implementation report (`plans/reports/agent-model-awareness-implementation-260617-report.md`)

## Staged rollout checklist (enable one flag at a time, watch a day, keep prior step revertible)
1. `AGENT_MODEL_DIGEST_ENABLED=true` — additive context, lowest risk. Watch: turn latency (cold /meta), token/turn.
2. `AGENT_RESOLVED_CONTEXT_ENABLED=true` — additive context. Watch: re-ask rate ↓, no stale-lock complaints.
3. `AGENT_SMART_DEFAULTS_ENABLED=true` — behavior change. Watch: clarifying-turns ↓, no wrong-default complaints (must always state + offer chip).
4. `AGENT_MODE_GOVERNS_POSTURE=true` — behavior change. Watch: the profiling telemetry (mode → askedClarification) actually differs by mode.
   - NOTE: the FE toggle default is already **Aggressive** (a FE pref, not server-flag-gated). New users auto-answer; existing users keep their stored pick. Revert = set `DEFAULT_MODE='targeted'` in `use-chat-disambiguation-mode.ts`.
5. `AGENT_ENGINE_ROUTING=true` — deepest; enable last after the grain-gate test + eval pass. Watch: 0 ARPU-for-individuals; group ARPU still offered.
Per-flag rollback: unset the env var (all server flags default false). The grain gate is also flag-gated (`gateIndividualRatios=config.agentEngineRouting`).

## Success criteria
- Docs match shipped behavior; all flags on in dev with eval green; rollback path documented per flag.

## Risks
- Enabling everything at once hides which capability regressed → strict one-flag-at-a-time order above.

## Open questions
- None.
