/**
 * Granular what-if tools — let the agent explore a single lever / power / money
 * / prior question and still get provenanced numbers, without re-running the
 * full recommend orchestrator. Each wraps one BUILT engine, one-to-one.
 */

import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { mapLevers } from '../../lever-map.js';
import { checkPower } from '../../power-check.js';
import { expectedIncremental } from '../../money-model.js';
import { listPriors } from '../../treatment-effect-library.js';
import type { Opportunity } from '../../diagnosis-types.js';
import { ok, fail, provenance, type ToolContext } from './tool-context.js';

export function makeMapLeversTool(tctx: ToolContext) {
  return tool(
    'map_levers',
    'List the intervention levers that can move a given factor, each with a ' +
      'feasibility verdict (feasible now via CS / nearest-feasible substitute / ' +
      'infeasible). Use to find the Lever for an opportunity.',
    {
      factor: z.string().describe('opportunity factor key, e.g. "lifespan"'),
      gapPct: z.number().optional(),
      gapValue: z.number().optional(),
    },
    async (args: { factor: string; gapPct?: number; gapValue?: number }) => {
      try {
        const opportunity: Opportunity = {
          factor: args.factor,
          gapPct: args.gapPct ?? 0,
          gapValue: args.gapValue ?? 0,
          confidence: 1,
          agreeingLenses: [],
        };
        const levers = mapLevers(opportunity);
        const provenanceId = provenance(tctx, 'map_levers', levers);
        const summary = levers
          .map((l) => `• ${l.family.family} — ${l.verdict.status}${l.verdict.substitute ? ` (→ ${l.verdict.substitute})` : ''}`)
          .join('\n');
        return ok(summary || 'No levers mapped.', { provenanceId, levers });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );
}

export function makeCheckPowerTool(tctx: ToolContext) {
  return tool(
    'check_power',
    'Statistical-power check: given cohort size N, reachable fraction, window, ' +
      'and baseline rate, returns whether the experiment can detect a realistic ' +
      'lift (powered / underpowered) and the minimum detectable effect. Use for the Proof step.',
    {
      N: z.number().describe('total addressable members'),
      reachablePct: z.number().describe('fraction reachable 0-1'),
      windowDays: z.number().describe('experiment window in days'),
      baselineRate: z.number().describe('baseline conversion rate 0-1'),
    },
    async (args: { N: number; reachablePct: number; windowDays: number; baselineRate: number }) => {
      try {
        const verdict = checkPower(args);
        const provenanceId = provenance(tctx, 'check_power', verdict);
        return ok(`${verdict.status}: ${verdict.detail}`, { provenanceId, verdict });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );
}

export function makeExpectedIncrementalTool(tctx: ToolContext) {
  return tool(
    'expected_incremental',
    'Monetize an expected effect: incremental gross ₫ = addressableN × effect × ' +
      '₫/unit. Leave valuePerUnit out to get a TBD estimate (ranks by effect × N). Use for the Proof/money step.',
    {
      effectFraction: z.number().describe('expected effect as a fraction, e.g. 0.06'),
      addressableN: z.number(),
      valuePerUnit: z.number().optional().describe('gross ₫ per addressed unit per period'),
    },
    async (args: { effectFraction: number; addressableN: number; valuePerUnit?: number }) => {
      try {
        const estimate = expectedIncremental({
          effectFraction: args.effectFraction,
          addressableN: args.addressableN,
          valuePerUnit: args.valuePerUnit ?? null,
        });
        const provenanceId = provenance(tctx, 'expected_incremental', estimate);
        return ok(estimate.note, { provenanceId, estimate });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );
}

export function makeListPriorsTool(tctx: ToolContext) {
  return tool(
    'list_priors',
    'List the treatment-effect priors recorded for this game (measured > ' +
      'benchmark > assumption). Tells you which levers have evidence behind their ' +
      'expected effect vs which are still assumptions.',
    { gameId: z.string().optional().describe('defaults to this scope\'s game') },
    async (args: { gameId?: string }) => {
      const gameId = args.gameId ?? tctx.scope.gameId;
      const priors = listPriors(gameId);
      const provenanceId = provenance(tctx, 'list_priors', priors);
      const summary =
        priors.length === 0
          ? `No recorded priors for ${gameId} — expected effects fall back to conservative assumptions.`
          : `${priors.length} prior(s) on record for ${gameId}.`;
      return ok(summary, { provenanceId, priors });
    },
  );
}
