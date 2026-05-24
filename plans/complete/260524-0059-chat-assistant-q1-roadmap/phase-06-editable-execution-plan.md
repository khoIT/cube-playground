# Phase 06 — Editable Execution Plan (F5) — CRITICAL

## Context Links
- Brainstorm: §M2 F5. **§"Catalog-consistency rule"** (non-negotiable).
- Builds on phase-02 (cartographer field chips) + phase-03 (glossary mapping).

## Overview
- **Priority:** P0 (M2 keystone)
- **Status:** pending
- **Description:** Before running a query, show the agent's interpretation as an editable "plan card" with cells that render catalog entries. User edits create **divergence flags**, not hidden overrides. Three resolution paths per cell: use catalog default, save as personal override (→ phase-11), propose catalog update (→ deeplink to metric-detail).

## Key Insights (from brainstorm)
- This is the single most important feature in Q1 — it operationalises the catalog-consistency rule.
- Plan cells = thin presentational layer over catalog. NO chat-side metric/segment storage independent of catalog.
- Doubles tokens per turn (plan + execute). +$0.05/turn estimated. Budget pre-M2.

## Requirements

### Functional
- Agent emits structured `execution_plan` artifact before running: `{ steps: [{ kind, catalogRef, params, naturalLanguage }] }`.
- UI renders each step as a cell with:
  - Resolved catalog entry (id + label + description).
  - Editable params (e.g. threshold, time window).
  - Status: `default | edited | diverged | overridden`.
- Edits trigger divergence calculation against catalog default → divergence flag with delta summary.
- Per-cell action menu: `Use default | Save as personal override | Propose catalog update`.
  - **Save as personal override** posts to glossary-memory endpoint (phase-11) keyed by `(owner_id, game_id, catalog_ref)`.
  - **Propose catalog update** deeplinks to `/catalog/metric/<id>/edit` (existing metric-detail) — no auto-edit.
- "Run" button executes the plan; "Cancel" discards.
- If any cell has divergence and user clicks Run without resolving → confirm dialog "Running with personal overrides — proceed?".

### Non-functional
- Plan render <300ms after agent emits artifact.
- Edits validated client-side before run (no roundtrip).
- E2E test: assert every emitted segment cites a catalog id (governance gate).

## Architecture
- **Tool:** new `chat-service/src/tools/emit-execution-plan.ts` — agent invokes BEFORE `preview-cube-query`.
- **Artifact type:** extend `chat-service/src/tools/emit-query-artifact.ts` pattern.
- **Reducer:** extend `src/pages/Chat/hooks/use-chat-stream-reducer.ts` to surface `execution_plan` event.
- **UI:**
  - `src/pages/Chat/components/execution-plan-card.tsx`
  - `src/pages/Chat/components/execution-plan-cell.tsx`
  - `src/pages/Chat/components/divergence-flag-badge.tsx`
- **Override sink:** POST → `chat-service` glossary-override route (built in phase-11; phase-06 ships UI calling stub endpoint).

### Plan artifact shape
```ts
type ExecutionPlanArtifact = {
  id: string;
  steps: ExecutionPlanStep[];
};
type ExecutionPlanStep =
  | { kind: 'metric'; catalogRef: 'business_metrics/<id>'; label: string; params: Record<string, unknown>; naturalLanguage: string }
  | { kind: 'segment'; catalogRef: 'segments/<id>' | null; predicate?: Predicate; naturalLanguage: string }
  | { kind: 'filter'; dimensionRef: 'cube/<id>.<dim>'; op: string; value: unknown; naturalLanguage: string };
```

### Data flow
```
user prompt ─► agent plans ─► emit-execution-plan (artifact)
            ─► UI: execution-plan-card renders cells
            ↘ user edits ─► divergence calc ─► flag
            ↘ user clicks Run ─► agent resumes ─► preview-cube-query with final plan
            ↘ user clicks "Save override" ─► POST glossary-override (phase-11)
            ↘ user clicks "Propose catalog update" ─► deeplink /catalog/metric/<id>/edit
```

## Related Code Files

### Existing infra
| Capability | Path | Use |
|---|---|---|
| Tool registry | `chat-service/src/tools/registry.ts` | Register new tool |
| Query artifact pattern | `chat-service/src/tools/emit-query-artifact.ts` | Pattern reuse |
| Stream reducer | `src/pages/Chat/hooks/use-chat-stream-reducer.ts` | Surface artifact |
| Query artifact card | `src/pages/Chat/components/query-artifact-card.tsx` | Sibling pattern reference |
| Catalog meta | `src/pages/Catalog/use-catalog-meta.ts` | Resolve `catalogRef` |
| Metric detail page (propose) | `src/pages/Catalog/metric-detail/` | Deeplink target |
| Glossary mapping (phase-03) | `server/src/routes/glossary.ts` | Term → catalog id |

### Create
- `chat-service/src/tools/emit-execution-plan.ts`
- `src/pages/Chat/components/execution-plan-card.tsx`
- `src/pages/Chat/components/execution-plan-cell.tsx`
- `src/pages/Chat/components/divergence-flag-badge.tsx`
- `src/pages/Chat/services/divergence-calculator.ts`
- `src/pages/Chat/__tests__/execution-plan-card.test.tsx`
- `tests/e2e/catalog-consistency.test.ts` (gate)

### Modify
- `chat-service/src/tools/registry.ts` (register tool)
- `chat-service/src/core/` agent prompt — instruct agent to call `emit-execution-plan` before any `preview-cube-query`
- `src/pages/Chat/hooks/use-chat-stream-reducer.ts` (handle event)
- `src/pages/Chat/components/assistant-message.tsx` (render card slot)

### Delete
- None.

## Implementation Steps
1. Design artifact JSON schema; lock with Zod in `chat-service`.
2. Implement `emit-execution-plan.ts` tool — agent emits artifact, awaits user "Run" before further tool calls.
3. Update agent core prompt to always call `emit-execution-plan` before `preview-cube-query`.
4. Build `divergence-calculator.ts` — diff edited params vs catalog default.
5. Build `execution-plan-cell.tsx` — render kind-specific UI; emit `onEdit/onAccept/onOverride/onPropose`.
6. Build `execution-plan-card.tsx` — manages cell list state + Run/Cancel.
7. Wire reducer to surface artifact; render card in `assistant-message.tsx`.
8. Stub override POST (phase-11 lands the route).
9. E2E catalog-consistency gate: spin up agent, run 16 starter questions, assert every emitted segment in `chat_turns.artifacts_json` cites a `business_metrics/*` or `segments/*` id.
10. QA flow with mock divergences.

## Todo List
- [ ] Artifact schema (Zod)
- [ ] `emit-execution-plan.ts` tool
- [ ] Agent prompt update
- [ ] `divergence-calculator.ts`
- [ ] `execution-plan-cell.tsx`
- [ ] `execution-plan-card.tsx`
- [ ] Reducer event handling
- [ ] Override POST stub
- [ ] E2E catalog-consistency gate test
- [ ] Cost benchmark (validate +$0.05/turn estimate)

## Success Criteria (from brainstorm)
- ≥15% of turns edit the plan before run (M2 target).
- 100% of emitted segments cite a catalog id (e2e gate).
- 0 parallel-truth definitions in audit query (validation criterion).

## Risk Assessment
| Risk | L | I | Mitigation |
|---|---|---|---|
| Agent skips emit-execution-plan call | Med | High | Tool-call gating in agent core — block `preview-cube-query` until plan emitted; e2e test. |
| Cost blow-out (>+$0.05/turn) | Med | Med | Cost benchmark step 10; if >0.07, force smaller model for plan phase. |
| User confusion ("why edit?") | Med | Med | First-time tooltip; default values pre-filled from catalog. |
| Divergence calc bugs flag false-positives | Med | High | Unit test matrix per cell kind. |
| Override POST stub left in prod | Low | Med | Lint rule + integration test once phase-11 lands. |

## Security Considerations
- Plan artifact never includes user PII; references catalog ids and params only.
- Override POST validates owner_id from session, never trusts client-supplied owner.
- Catalog-consistency gate prevents agent from inventing definitions.

## Next Steps
- Blocked by: phase-02 (cartographer chips for cell labels), phase-03 (glossary mapping).
- Blocks: phase-07 (sample preview consumes plan output), phase-08 (filter trace), phase-11 (override route consumer).

## Rollback
Disable `emit-execution-plan` tool registration in `registry.ts` + revert prompt. Stream reducer ignores unknown event. UI card unrendered. Plan-edits in `chat_turns.artifacts_json` remain (read-only).
