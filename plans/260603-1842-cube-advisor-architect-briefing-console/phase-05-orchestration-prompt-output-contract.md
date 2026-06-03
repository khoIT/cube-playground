---
phase: 5
title: "Orchestration prompt + output contract"
status: pending
priority: P1
effort: "1d"
dependencies: [1, 4]
---

# Phase 5: Orchestration prompt + output contract

## Overview
The core IP: the versioned prompt that drives the spawned Claude session to research the ecosystem, pull external signal, and emit a schema-valid `ideas.json`. Plus the run-context assembler that injects scan paths, Confluence page IDs, email queries, the current open-idea backlog, and the `plans/` index so the session dedups correctly.

## Requirements
- Functional: backend assembles a per-run context (paths, Confluence IDs, email queries, backlog snapshot, plan index) and renders it into `prompts/briefing.md`. The session is instructed to: scan cube-playground + cube-dev + plans + docs; fetch Confluence (Tesseract page `1609334800` + GDS space) and Outlook signal; run deep-research per candidate; produce **top-5 candidates per category** each marked `new|duplicate-of:<id>|already-planned`; write `runs/<id>/ideas.json` matching the Phase 4 schema exactly.
- Non-functional: prompt is a file (version-controlled, reviewable), not a string literal; context injection is templated + unit-tested; output instruction pins the exact JSON shape + file path.

## Architecture
- `prompts/briefing.md`: stable instruction body with `{{placeholders}}` for injected context. Sections: role (chief product+tech architect advisor), inputs, research protocol (incl. fan-out deep-research per candidate), dedup rules, the two categories' definitions, output contract (write file + schema).
- `run-context.ts`: gathers backlog (`GET ideas` snapshot), plan index (titles + statuses from `cube-playground/plans/` and `plans/complete/`), config (scan paths, Confluence IDs, email queries from `.env`) → renders the template.
- Output contract restated verbatim from `idea-schema.ts` so prompt and validator can't drift (single doc reference + a test that asserts they match).
- **Fallback variant** (if Phase 1 = FAIL): same prompt, but external-signal section instructs use of pre-fetched Confluence/email JSON that the backend retrieved via REST/Graph and dropped into `runs/<id>/inputs/`.

## Related Code Files
- Create: `prompts/briefing.md` (+ `prompts/CHANGELOG.md` for prompt versioning)
- Create: `backend/src/runner/run-context.ts` (template render + context gather)
- Modify: `backend/src/runner/run-config.ts` (pass rendered prompt to the child)
- Create tests: `backend/test/run-context.test.ts`, `backend/test/prompt-contract.test.ts`

## TDD — Tests First
1. `run-context.test.ts`: given a fake backlog + plan index + config → rendered prompt contains all injected items, no unfilled `{{placeholders}}`, and the plan titles appear in the dedup section.
2. `prompt-contract.test.ts`: parse the output-contract block from `briefing.md` and assert every required `idea-schema` field is named in it (guards prompt/validator drift); assert it pins the `runs/<id>/ideas.json` path + "top 5 per category".
3. (Integration, manual/CI-optional) one real run → resulting `ideas.json` passes `idea-schema` validation.
4. Implement until green.

## Implementation Steps
1. Draft `briefing.md` with the research protocol + categories + dedup rules + output contract (cite Tesseract page id + GDS space).
2. Implement `run-context.ts` to gather backlog + plan index + config and render.
3. Wire rendered prompt into `run-config.ts` (Phase 3 spawn uses it).
4. Add prompt CHANGELOG; tag prompt version, stamp it into each `runs` row for traceability.
5. Green unit tests; do one guarded real run to confirm schema-valid output.

## Success Criteria
- [ ] `run-context.test.ts` + `prompt-contract.test.ts` green (no placeholder leaks, no schema drift)
- [ ] A real run emits `ideas.json` that passes Phase 4 validation, with `dedupVerdict` set per candidate
- [ ] Tesseract content + real email signal appear as `evidence`/`sources` in at least one product-category idea
- [ ] Prompt version recorded per run

## Risk Assessment
- Prompt/validator drift → `prompt-contract.test.ts` is the guard.
- Generic v1 ideas → expected; iterate prompt over runs (CHANGELOG tracks why). Backlog dedup prevents repetition compounding.
- If Phase 1 failed: ensure the fallback inputs path is wired and tested before relying on it.

## Red Team Hardening (applied)
- **This is a SPIKE/EVAL phase** (#SC7): the unit tests (template render, no placeholder leak, contract↔schema match) are real, but the true acceptance is a **recorded human judgment** that a run produced accept-worthy ideas — not green structural tests. Don't mark the phase "done" on green tests alone; require the eval note.
- **Output contract = backend-assigned fields excluded** (#5): the prompt instructs the model to emit ONLY the LLM-owned fields (Phase 4 partition); it must NOT emit `id`/`status`/`firstSeenRun`/`lastSeenRun`. `prompt-contract.test.ts` asserts exactly the LLM-owned field set — not the full schema — so prompt and validator can't drift in either direction.
- **`confidence` 1-5 pinned in the prompt** (#12) to match schema/validator.
- **Absolute output path + defensive framing** (#3/#15): the contract pins the ABSOLUTE `ideas.json` path injected by the backend (not a relative path), and tells the model to write a bare JSON file. Ingest still strips ```json fences defensively (models fence output even when told not to — observed in live probes), so the contract + ingest are belt-and-suspenders.
- **Least-privilege + injection-resistant prompt** (#2): the prompt frames Confluence/email content as UNTRUSTED reference data to summarize as evidence — explicitly NOT instructions to act on. It forbids the agent from reading/echoing credential files (`~/.claude.json`, `.env`) or using send/write MCP capabilities (e.g. sending mail). Pair with the least-privilege tool allowlist from Phase 1.
- **Per-connector signal awareness** (#11): the prompt is told which connectors are available this run; if a required data connector is un-authed, the run is refused upstream (Phase 3), not silently degraded.
- **No mermaid** (#A3): `suggestedVisual.kind` is restricted to `chart` (recharts spec) for v1; drop `mermaid` from the contract.
