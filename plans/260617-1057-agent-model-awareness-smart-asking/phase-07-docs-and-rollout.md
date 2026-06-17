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
- [ ] system-architecture + codebase-summary updates
- [ ] lessons-learned entry
- [ ] staged-rollout checklist
- [ ] final implementation report

## Success criteria
- Docs match shipped behavior; all flags on in dev with eval green; rollback path documented per flag.

## Risks
- Enabling everything at once hides which capability regressed → strict one-flag-at-a-time order above.

## Open questions
- None.
