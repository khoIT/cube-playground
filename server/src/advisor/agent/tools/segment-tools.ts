/**
 * Segment-shaping tools.
 *
 * predicate_compile turns a predicate tree into the SQL WHERE clause it would
 * compile to — lets the agent show the manager exactly who a proposed peer/target
 * cohort is, without executing anything. The asOf anchor for derived-date
 * operators is the session's fixed anchor (reproducible).
 *
 * Member-level row inspection is deliberately NOT exposed as an agent tool: the
 * agent reasons on aggregates (diagnose + cube_query + the segment size in the
 * context pack), which keeps PII out of agent context by construction. Member
 * drill-through stays on the Segments page (glass-box deep-link).
 */

import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { predicateToSql } from '../../../services/predicate-to-sql.js';
import type { PredicateNode } from '../../../types/predicate-tree.js';
import { ok, fail, type ToolContext } from './tool-context.js';

export function makePredicateCompileTool(tctx: ToolContext) {
  return tool(
    'predicate_compile',
    'Compile a target/peer cohort definition (a predicate tree) into the SQL ' +
      'WHERE clause it represents, so you can describe exactly who is in the cohort. ' +
      'Supports relative-date and percentile predicates. Does not execute the query.',
    { predicate: z.record(z.string(), z.unknown()).describe('a PredicateNode tree') },
    async (args: { predicate: Record<string, unknown> }) => {
      const asOf = tctx.asOf.toISOString().slice(0, 10);
      try {
        const sql = predicateToSql(args.predicate as unknown as PredicateNode, { asOf });
        return ok(`Compiled WHERE clause:\n${sql}`, { sql });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
