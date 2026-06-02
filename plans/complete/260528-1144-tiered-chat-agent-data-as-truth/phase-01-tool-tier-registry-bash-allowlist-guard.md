---
phase: 1
title: "Tool-tier registry + Bash allowlist guard"
status: pending
priority: P1
effort: "1d"
dependencies: []
---

# Phase 1: Tool-tier registry + Bash allowlist guard

## Overview
Introduce a single source of truth for tool capability tiers, then enforce a runtime
allowlist for Bash so dangerous ops can never execute even if the model attempts them.
Foundation for every downstream phase.

## Architecture
- **Tier enum** (`chat-service/src/tools/tool-tiers.ts`):
  - `source-of-truth` — Cube MCP tools: `preview_cube_query`, `explain_cube_sql`,
    `get_cube_meta`, `get_business_metric`, `list_business_metrics`,
    `get_business_metric_history`, `list_segments`, `get_segment`.
  - `enrichment` — `WebSearch`, Atlassian MCP (read), Files (`Read`, `Grep`, `Glob`).
  - `meta` — `emit_query_artifact`, `emit_chart`, `disambiguate_query`.
  - `destructive` — `Write`, `Edit`, `Bash` (network/write subset). Default OFF.
- **Registry** (`chat-service/src/tools/tool-registry.ts`): single map
  `{ [toolName]: { tier, description, allowlist? } }`. Every existing registration site
  imports the registry → cannot register an untiered tool. Tier-check lint test.
- **Bash allowlist guard** (`chat-service/src/tools/bash-guard.ts`): a wrapper invoked
  before any Bash tool call. Allow only the fixed list: `ls`, `cat`, `head`, `tail`,
  `grep`, `find` (no `-exec`), `gh issue view`, `gh pr view`. Block on any other
  binary, pipe to disallowed binary, `&&` chains containing disallowed, network
  commands (curl/wget/nc), or write/delete (rm/mv/cp/echo>). Return tool error with
  a clear message so the model can recover.

## Related Code Files
- Create: `chat-service/src/tools/tool-tiers.ts`,
  `chat-service/src/tools/tool-registry.ts`,
  `chat-service/src/tools/bash-guard.ts`,
  `chat-service/test/tool-registry.test.ts`, `bash-guard.test.ts`
- Modify: every tool registration site under `chat-service/src/tools/` to import + tag

## Implementation Steps
1. Define tier enum + registry; migrate existing tool registrations to require a tier.
2. Add lint test: scan registered tools, fail if any has no tier metadata.
3. Implement `bash-guard` parser + denylist for shell metachars/networking/write ops.
4. Wire guard as a `preToolCall` hook for Bash invocations from the SDK subprocess.
5. Unit tests: allowed commands pass; disallowed/network/chained/destructive fail with audit log.

## Success Criteria
- [ ] Every tool in `chat-service/src/tools/` carries a tier; lint test green.
- [ ] Bash guard tests: 20+ disallowed patterns blocked, 10+ allowed pass.
- [ ] Disallowed Bash returns a structured error the model can read and retry differently.

## Risk Assessment
- **False-positive Bash blocks** — overly aggressive denylist breaks legitimate use.
  Mitigation: start strict, add allowed patterns from observed traffic via audit log.
- **Tier creep** — future tools added without a tier. Mitigation: lint test enforces.
