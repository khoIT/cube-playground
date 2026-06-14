/**
 * diagnose tool — wraps the BUILT diagnosis engine.
 *
 * Runs the descriptive lenses over the session's scope+goal and returns the
 * ranked opportunities (where the money/engagement is slipping). Numbers are
 * provenanced so the agent can cite the diagnosis as the source of an opportunity.
 */

import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { diagnose } from '../../diagnosis-engine.js';
import type { DiagnosisInput } from '../../diagnosis-types.js';
import { ok, fail, provenance, type ToolContext } from './tool-context.js';

const NAME = 'diagnose';

export function makeDiagnoseTool(tctx: ToolContext) {
  return tool(
    NAME,
    'Diagnose where the chosen goal is weak for this scope. Runs descriptive ' +
      'lenses over the segment/game and returns ranked opportunities (the factor ' +
      'that is below baseline and how many independent lenses agree). Call this ' +
      'first to find the Opportunity. Lenses 1-4 run by default; pass [1,2,3,4,5,6,7,8,9] ' +
      'for the deeper (slower) lenses.',
    { lenses: z.array(z.number()).optional().describe('lens ids to run; omit for the fast 1-4') },
    async (args: { lenses?: number[] }): Promise<ReturnType<typeof ok>> => {
      const input: DiagnosisInput = {
        scope: tctx.scope,
        goal: tctx.goal,
        asOf: tctx.asOf,
        options: args.lenses && args.lenses.length > 0 ? { lenses: args.lenses } : undefined,
      };
      try {
        const diagnosis = await diagnose(input, tctx.ctx, tctx.reader);
        const provenanceId = provenance(tctx, NAME, diagnosis);
        const top = diagnosis.opportunities
          .slice(0, 5)
          .map(
            (o) =>
              `• ${o.factor}: ${o.gapPct.toFixed(1)}% below baseline (confidence ${o.confidence}, lenses ${o.agreeingLenses.join('/')})`,
          )
          .join('\n');
        const summary =
          diagnosis.opportunities.length === 0
            ? 'No weak factors found — this scope looks healthy on the diagnosed lenses.'
            : `Top opportunities:\n${top}`;
        return ok(summary, { provenanceId, diagnosis });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
