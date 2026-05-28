---
phase: 4
title: "MCP bindings: Atlassian read-only + WebSearch verify"
status: pending
priority: P2
effort: "1d"
dependencies: [1, 2]
---

# Phase 4: MCP bindings — Atlassian read-only + WebSearch end-to-end verify

## Overview
Wire the Atlassian MCP server into chat-service with a strict read-only scope, and prove the
WebSearch built-in actually reaches the model end-to-end (the audit of the user's session
showed the SDK was instructed but no call ever happened — confirm wiring on a new turn).

## Architecture
- **Atlassian MCP** — register Atlassian as an MCP server in the SDK subprocess config
  (`chat-service/src/core/claude-runner.ts` / wherever `mcpServers` is configured). Use a
  **service account token with read-only scope** (Atlassian Cloud API token + read perms
  only on relevant projects/spaces). Tools exposed by the MCP that we whitelist:
  `getJiraIssue`, `searchJiraIssuesUsingJql`, `getConfluencePage`, `searchConfluenceUsingCql`,
  `getJiraIssueRemoteIssueLinks`, `atlassianUserInfo`. All others tier-tagged `destructive`
  and OFF.
- **WebSearch verification** — write an integration test that triggers a `research` skill
  turn with a question requiring fresh info; assert `tool_calls_json` contains at least one
  `WebSearch` call. Goes hand-in-hand with the live audit-UI badge from Phase 6.
- **Credentials**: env `ATLASSIAN_API_TOKEN`, `ATLASSIAN_EMAIL`, `ATLASSIAN_SITE`. Document
  in `.env.example`. Future Phase 6 of workspace plan may swap to per-user via Keycloak.
- **Resilience**: Atlassian outage shouldn't break chat. The runner catches MCP init errors
  → degrades to "Atlassian unavailable in this turn" without aborting the turn.

## Related Code Files
- Modify: `chat-service/src/core/claude-runner.ts` (MCP server config + init),
  `chat-service/src/config.ts` (Atlassian env vars),
  `chat-service/src/tools/tool-registry.ts` (tier-tag each Atlassian tool)
- Create: `chat-service/test/atlassian-mcp.integration.test.ts`,
  `chat-service/test/websearch-end-to-end.test.ts`
- Modify: `.env.example`, `chat-service/.env.example`

## Implementation Steps
1. Provision a read-only Atlassian service account; capture token + email in env.
2. Add MCP server registration; whitelist read tools; tier-tag in registry.
3. Add graceful-degradation wrapper for MCP init failures.
4. Integration test: `research` skill answering "find Jira tickets about cfm churn" returns
   real ticket data with `🗂 Atlassian` source.
5. Integration test: `research` skill with a fresh-info question triggers WebSearch.
6. Confirm Atlassian write/admin tools rejected by tier guard.

## Success Criteria
- [ ] Atlassian MCP available to `research` + `data_with_context` skills, read-only.
- [ ] Atlassian outage degrades to a clear message, no turn abort.
- [ ] WebSearch end-to-end test passes (proves the bug surfaced in audit is fixed).
- [ ] Tier guard rejects any non-allowlisted Atlassian tool.

## Risk Assessment
- **Service-account credential management** — production needs a real token in env or a
  secret manager. Don't commit. Doc in `.env.example` only.
- **Atlassian rate limits** — research turns may burst. Mitigation: rely on MCP server's
  own throttling; surface 429s as a friendly tool error.
- **Token leak** — never include Atlassian token in trace/log output. Sanitize headers in
  observer.
