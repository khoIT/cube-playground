# Phase 07 — Tool surface + omniscient context + hybrid provenance gate

## Context links
- BUILT engines to wrap (verified signatures):
  - `diagnose(input, ctx, reader?)` — `server/src/advisor/diagnosis-engine.ts:56`
  - `rankCandidates(RankerInput[])` — `server/src/advisor/candidate-ranker.ts:6` (chains mapLevers + checkPower + expectedIncremental + getPrior internally)
  - `mapLevers(opportunity)` — `lever-map.ts:239`; `checkPower(input)` — `power-check.ts:127`; `expectedIncremental(input)` — `money-model.ts:47`; `getPrior(...)` / `listPriors(gameId)` — `treatment-effect-library.ts:55/85`
  - `scaffoldDraft(ScaffoldInput): ExperimentDraft` — `handoff-scaffolder.ts:110`
  - `recommend(input, ctx, params, reader?, llm?)` — `recommend.ts:81` (the diagnose→rank→phrase orchestrator; expose as one high-level tool)
- Cube reads: `loadWithCtx` / `getMetaWithCtx` + `WorkspaceCtx` — `services/cube-client.ts:153/137/19`; per-request ctx via `middleware/workspace-header.ts` + `introspectionCtx` (`routes/identity-map.ts`).
- Segments: `computeMemberProfiles` — `services/member-profile-runner.ts:94`; `predicateToSql` — `services/predicate-to-sql.ts`; `cube-member-resolver.ts` for logical↔physical names.
- The injected-seam types the engines already accept: `CubeReaderFn` (`advisor/cube-read.ts:36`), `LlmCallerFn = (prompt)=>Promise<string>` (`advisor/llm-phrasing.ts:34`).
- SDK tool API (research): `tool(name, desc, zodSchema, handler)` + `createSdkMcpServer({name,version,tools})`; allowlist via `allowedTools:["mcp__advisor__*"]`; handler returns `{content:[{type:'text',text}], structuredContent?, isError?}`.

## Overview
- **Priority:** P1. **Status:** ✅ DONE (2026-06-15). **Depends on:** 6.
- **Built:** `agent-redaction-guard.ts` (tail-match denylist handles dotted Cube keys + numeric-PII), `agent-provenance-gate.ts` (per-session ledger + validateDraftNumbers; coincidence-tolerant v1, field-bound match is a follow-up), `tools/` (diagnose, recommend, map_levers, check_power, expected_incremental, list_priors, scaffold_draft, cube_query, cube_meta, predicate_compile) via per-session `buildAdvisorToolServer`, `agent-context-pack.ts` (pure injected goal-trees + lever taxonomy + playbook index + scope), runtime wired with deny-by-default allowlist. **DEFERRED:** the member-row `segmentMembers` tool (highest PII + coupled to segment store/on-demand resolver) — the agent reasons on aggregates; member drill-through stays on the Segments page. tsc clean; full server suite 1605/1605 (+18 new). Code-reviewed: S1 dotted-key PII leak fixed, N1 numeric-PII denied, N4 try/catch consistency, N2 documented. Live OAuth smoke deferred to Phase 9.
- Turn the deterministic engines + Cube/Segments reads into typed in-process SDK tools; build the **omniscient context pack** the agent receives; implement the **HYBRID provenance gate** (any number in a card/draft must trace to a tool call) and the **redaction guard** on everything entering the agent.

## Key insights
- **Do NOT fork the engines.** Each tool is a thin adapter: validate args (zod) → call the BUILT engine with the per-request `WorkspaceCtx` → wrap the result with a `provenanceId`. DRY: the engines already take injected `CubeReaderFn`; the tool passes the live `loadWithCtx`-backed reader.
- **Provenance is the contract that makes "free Explore / gated Decide" enforceable.** Every tool result is registered in a per-session `provenanceLedger`: `{provenanceId, tool, inputsHash, outputsDigest, ts}`. The card/draft assembler (Phase 8 consumes; the validator lives here) accepts a number ONLY if it carries a `provenanceId` present in the ledger AND the number matches the ledger's recorded output (digest check) — so the agent cannot paraphrase a tool number into a different value.
- **Context pack: injection vs retrieval.** Small, stable, high-value context → system-prompt injection (data-model summary, goal trees, lever map, playbook registry index, the active segment's def + size). Large/volatile → retrieval tools (`cubeMeta`, `cubeQuery`, `segmentMembers`). Keep the system prompt under a budget; the agent pulls detail on demand. This is the "more omniscient than the chat-agent" part — the chat-agent has no curated goal/lever/playbook context.
- **Redaction guard wraps tool I/O, not just inbound.** `segmentMembers` and any member-level read pass through the ranked-members allowlist (`user_id` + numeric + reachability only) BEFORE the rows enter the agent context. cfm strips `std_*` cubes already (memory); reuse that posture.

## Requirements
**Functional — tool surface (`server/src/advisor/agent/tools/`):**
1. `diagnoseTool` → wraps `diagnose`; input = scope+goal+asOf+options; output rows carry diagnosis provenance (the engine already emits PlaygroundLink per lens — surface those ids).
2. `recommendTool` → wraps `recommend` (diagnose→rank→phrase); the high-level "give me ranked experiments" tool. Numbers (effect, N, ₫, power verdict) are the authoritative ones.
3. Granular tools for agent reasoning: `mapLeversTool`, `checkPowerTool`, `expectedIncrementalTool`, `listPriorsTool` (so the agent can explore a lever/power/₫ what-if and still get provenanced numbers).
4. `scaffoldDraftTool` → wraps `scaffoldDraft`; produces the editable `ExperimentDraft` (status='draft').
5. Cube tools: `cubeQueryTool` (`loadWithCtx`, returns rows + a PlaygroundLink provenance), `cubeMetaTool` (`getMetaWithCtx`, returns the cube/measure/dimension catalog for the active workspace).
6. Segments tools: `segmentMembersTool` (`computeMemberProfiles`, REDACTED rows), `predicateCompileTool` (`predicateToSql` + Phase-0 percentile/derived-date operators, returns compiled SQL for inspection — no execution side effect beyond a count).
7. All tools registered via one `createSdkMcpServer({name:'advisor', tools:[...]})`; the runtime allowlist (Phase 6 `canUseTool`) is set to exactly these `mcp__advisor__*` names — deny everything else.

**Functional — context pack (`agent-context-pack.ts`):**
8. Build a system-prompt context object per session from: data-model summary (from `cubeMeta`, trimmed to ops cubes for the active game), the Revenue + Engagement goal trees (`goal-tree.ts`), the lever map taxonomy (`lever-map.ts`), the playbook registry index (VIP-Care 21 — names + availability only), and the active Segment's definition + size. Injected; detail retrieved via tools.
9. The pack + the agent's role/instructions = the system prompt. Instructions encode the HYBRID rule in plain language ("you may reason with numbers, but any number you place in a card or draft must come from a tool call and you must cite its provenanceId").

**Functional — provenance gate (`agent-provenance-gate.ts`):**
10. `provenanceLedger` per session: tool results registered with a stable `provenanceId` + output digest.
11. `validateCardNumbers(card)` / `validateDraftNumbers(draft)` → reject any numeric field lacking a ledger-backed `provenanceId` or whose value diverges from the recorded output. Returns structured violations.
12. Numbers spoken in the transcript (assistant_delta) are NOT gated but are tagged `exploratory` by the UI (Phase 8); only card/draft assembly is gated.

**Functional — redaction guard (`agent-redaction-guard.ts`):**
13. Allowlist filter applied to every tool OUTPUT containing member rows (and reused for inbound from Phase 6). No contact/PII columns ever enter agent context.

**Non-functional:** each tool file <200 LOC; one adapter per engine; kebab-case; no plan-artifact strings in code.

## Architecture — data flow
```
session start → build context pack (cubeMeta trim + goal trees + lever map + playbook index + segment def)
              → system prompt = role + HYBRID rule + context pack
agent turn → agent calls mcp__advisor__<tool>
   tool adapter: zod-validate args → call BUILT engine with live WorkspaceCtx reader
              → redaction guard on member rows
              → register result in provenanceLedger (id + digest)
              → return {content, structuredContent:{...,provenanceId}}
card/draft assembly (Phase 8) → validateCardNumbers/validateDraftNumbers against ledger → reject un-provenanced
```

## Related code files
**Create** (`server/src/advisor/agent/`):
- `tools/diagnose-tool.ts`, `tools/recommend-tool.ts`, `tools/lever-tools.ts` (mapLevers+checkPower+expectedIncremental+listPriors), `tools/scaffold-draft-tool.ts`, `tools/cube-tools.ts` (cubeQuery+cubeMeta), `tools/segment-tools.ts` (segmentMembers+predicateCompile), `tools/index.ts` (the `createSdkMcpServer`).
- `agent-context-pack.ts` — builds the injected context.
- `agent-provenance-gate.ts` — ledger + validators.
- `agent-redaction-guard.ts` — member-row allowlist (shared with Phase 6 inbound).
**Modify:**
- `server/src/advisor/agent/agent-runtime.ts` — register the MCP server + set the real allowlist.
- `server/src/advisor/agent/agent-guardrails.ts` — `canUseTool` allowlist = the advisor tool names.

## Implementation steps
1. `agent-redaction-guard.ts` first (everything depends on it).
2. `agent-provenance-gate.ts`: ledger + `register` + `validateCardNumbers`/`validateDraftNumbers`.
3. Tool adapters one per file; each: zod schema → BUILT engine call → redact → register → return with `provenanceId`. Reuse `cube-read.ts` `readWithProvenance` for cube tools (it already mints PlaygroundLink).
4. `tools/index.ts`: `createSdkMcpServer({name:'advisor', version, tools:[...]})`.
5. `agent-context-pack.ts`: assemble from goal-tree / lever-map / playbook registry / cubeMeta(trim) / segment def.
6. Wire server + allowlist into runtime + guardrails.
7. System-prompt assembly (role + HYBRID rule + pack).
8. tsc/build clean; local OAuth smoke: agent calls `recommendTool` and the result carries a provenanceId in the ledger.

## Todo
- [ ] redaction guard (member-row allowlist) + test
- [ ] provenance ledger + validateCard/validateDraft + tests
- [ ] diagnoseTool, recommendTool
- [ ] lever-tools (mapLevers/checkPower/expectedIncremental/listPriors)
- [ ] scaffoldDraftTool
- [ ] cube-tools (cubeQuery via readWithProvenance, cubeMeta)
- [ ] segment-tools (segmentMembers redacted, predicateCompile)
- [ ] tools/index createSdkMcpServer + runtime allowlist
- [ ] context pack builder + system prompt
- [ ] tsc/build clean; OAuth smoke: tool call lands in ledger

## Success criteria (measurable)
- Agent (local OAuth smoke) calls ≥3 distinct advisor tools in one investigation and every tool result is in the `provenanceLedger`.
- `validateDraftNumbers` REJECTS a draft whose effect/N/₫ field carries no `provenanceId` or a divergent value (unit test with a forged number) and ACCEPTS a genuine tool-produced draft.
- `segmentMembersTool` output contains only allowlisted columns (assert no contact/PII keys) — automated grep + runtime test.
- Agent has access to ONLY `mcp__advisor__*` tools (assert allowlist; deny on any other tool name).
- Context pack stays under the system-prompt budget (assert serialized size); detail reachable via `cubeMeta`/`cubeQuery`.
- Engines unchanged: their existing unit suites still pass (no fork/regression).

## Risk assessment
| Risk | L×I | Mitigation |
|---|---|---|
| Agent paraphrases a tool number into a wrong value in a card | M×H | digest check in validateCardNumbers — value must match ledger, not just carry an id |
| Context pack too large → token cost / latency | M×M | trim cubeMeta to ops cubes for active game; index-only playbook registry; size assertion |
| Member rows leak PII into agent context | L×H | redaction guard on every member-bearing tool output; PII allowlist grep test (required) |
| Agent invents a lever/playbook not in registry | M×M | scaffoldDraft only accepts registry-backed levers (engine already feasibility-gates); validator rejects unknown lever id |
| Tool fan-out → many cube reads on cold Trino | M×M | reuse Phase-1 lazy-lens posture; cap concurrent cube tool calls; short-TTL cache deferred (open Q#5) |

## Backwards compatibility / rollback
- Additive: tools wrap existing engines without modifying them. Rollback = empty the MCP server tool list; harness (Phase 6) still runs with echo tool.
- No schema change. The STUB draft store (migration 054) remains the swap-point for the real registry (deferred).

## Security
- Redaction guard on every member-bearing output (PII allowlist = ranked-members API parity).
- Provenance digest prevents the agent from publishing fabricated numbers.
- Allowlist-only tools; no filesystem/Bash reachable.
- No PII in prompts, tool inputs, tool outputs, audit log, or SSE.

## Open questions
- Q-A3: system-prompt injection vs retrieval split for the data-model summary — start injected+trimmed; move to retrieval if token budget bites.
- Q-A4: should granular what-if tools (`checkPowerTool`) write to the ledger too, or only the high-level `recommendTool`/`scaffoldDraftTool`? Decision: yes, all numeric tools register — lets the agent explore yet stay provenanced.

## Next steps
Phase 8 consumes the tool stream + ledger to fill the Experiment-Builder stages live and badge exploratory-vs-validated numbers.
