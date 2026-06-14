/**
 * recommend tool — wraps the BUILT recommend() orchestrator (diagnose → rank).
 *
 * The high-level "give me ranked, runnable experiments" tool. The numbers it
 * returns (expected effect, power verdict, ₫) are the AUTHORITATIVE ones an
 * experiment draft is built from. Power/money inputs the diagnosis cannot derive
 * are taken from explicit args with documented defaults — never invented.
 */

import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { recommend, type RecommendParams } from '../../recommend.js';
import type { DiagnosisInput } from '../../diagnosis-types.js';
import { ok, fail, provenance, type ToolContext } from './tool-context.js';

const NAME = 'recommend';

export function makeRecommendTool(tctx: ToolContext) {
  return tool(
    NAME,
    'Turn the diagnosis into ranked experiment candidates (Lever + Proof). ' +
      'Each candidate carries a feasibility verdict, a statistical-power verdict, ' +
      'an expected-effect prior (with a confidence label), and a money estimate. ' +
      'Requires addressableN (the size of the cohort you can act on). Use this to ' +
      'propose the experiment after diagnose finds the Opportunity.',
    {
      addressableN: z.number().describe('cohort size you can act on (>0)'),
      reachablePct: z.number().optional().describe('fraction reachable by the lever, 0-1 (default 0.75)'),
      windowDays: z.number().optional().describe('experiment window in days (default 14)'),
      baselineRate: z.number().optional().describe('baseline conversion rate 0-1 for the power check (default 0.4)'),
      valuePerUnitVnd: z.number().optional().describe('gross ₫ per addressed unit; omit to leave money TBD'),
    },
    async (args: {
      addressableN: number;
      reachablePct?: number;
      windowDays?: number;
      baselineRate?: number;
      valuePerUnitVnd?: number;
    }): Promise<ReturnType<typeof ok>> => {
      if (!(args.addressableN > 0)) return fail('addressableN must be > 0 to rank candidates');
      const input: DiagnosisInput = {
        scope: tctx.scope,
        goal: tctx.goal,
        asOf: tctx.asOf,
      };
      const params: RecommendParams = {
        addressableN: args.addressableN,
        reachablePct: args.reachablePct,
        windowDays: args.windowDays,
        baselineRate: args.baselineRate,
        valuePerUnitVnd: args.valuePerUnitVnd,
      };
      try {
        const result = await recommend(input, tctx.ctx, params, tctx.reader);
        const provenanceId = provenance(tctx, NAME, result);
        const top = result.candidates
          .slice(0, 3)
          .map((c) => `• ${c.rankReason}`)
          .join('\n');
        const summary =
          result.candidates.length === 0
            ? 'No experiment candidates — no feasible lever maps to the diagnosed opportunities.'
            : `Ranked candidates:\n${top}`;
        return ok(summary, { provenanceId, candidates: result.candidates, diagnosis: result.diagnosis });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
