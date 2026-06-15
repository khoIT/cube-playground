/**
 * Builds the per-session advisor tool server.
 *
 * Tools are session-scoped (they close over the session's WorkspaceCtx, asOf,
 * and provenance ledger), so the MCP server is constructed per session rather
 * than as a module singleton. The returned allowlist is exactly these tool
 * names — the runtime's deny-by-default canUseTool gate is set to it.
 */

import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { makeDiagnoseTool } from './diagnose-tool.js';
import { makeRecommendTool } from './recommend-tool.js';
import {
  makeMapLeversTool,
  makeCheckPowerTool,
  makeExpectedIncrementalTool,
  makeListPriorsTool,
} from './lever-tools.js';
import { makeScaffoldDraftTool } from './scaffold-draft-tool.js';
import { makeCubeQueryTool, makeCubeMetaTool } from './cube-tools.js';
import { makePredicateCompileTool } from './segment-tools.js';
import { makeProposeCohortTool } from './propose-cohort-tool.js';
import type { ToolContext } from './tool-context.js';

export const ADVISOR_SERVER_NAME = 'advisor';

/** Bare tool names (without the `mcp__advisor__` prefix). */
const TOOL_NAMES = [
  'diagnose',
  'recommend',
  'map_levers',
  'check_power',
  'expected_incremental',
  'list_priors',
  'scaffold_draft',
  'cube_query',
  'cube_meta',
  'predicate_compile',
  'propose_cohort',
] as const;

/** Fully-qualified allowlist the runtime gates on. */
export const ADVISOR_TOOL_ALLOWLIST = TOOL_NAMES.map(
  (n) => `mcp__${ADVISOR_SERVER_NAME}__${n}`,
);

/** Construct the advisor MCP server bound to one session's context. */
export function buildAdvisorToolServer(tctx: ToolContext): ReturnType<typeof createSdkMcpServer> {
  return createSdkMcpServer({
    name: ADVISOR_SERVER_NAME,
    version: '0.1.0',
    tools: [
      makeDiagnoseTool(tctx),
      makeRecommendTool(tctx),
      makeMapLeversTool(tctx),
      makeCheckPowerTool(tctx),
      makeExpectedIncrementalTool(tctx),
      makeListPriorsTool(tctx),
      makeScaffoldDraftTool(tctx),
      makeCubeQueryTool(tctx),
      makeCubeMetaTool(tctx),
      makePredicateCompileTool(tctx),
      makeProposeCohortTool(tctx),
    ],
  });
}
