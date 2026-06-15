/**
 * scaffold_draft tool — wraps the BUILT scaffoldDraft().
 *
 * Turns a ranked candidate into an EDITABLE experiment draft (status always
 * 'draft' — never launches). The draft's headline numbers are validated against
 * the provenance ledger: pass the provenanceId of the recommend result that
 * produced the candidate so the gate can confirm the numbers trace to a tool
 * (the HYBRID "gated Decide" rule). Violations are returned, not hidden.
 */

import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { scaffoldDraft } from '../../handoff-scaffolder.js';
import { saveDraft } from '../../command-center-draft-store.js';
import { resolveAddressableN, resolveReachablePct } from '../../cohort-resolver.js';
import { validateDraftNumbers } from '../agent-provenance-gate.js';
import { scoreExperiment, resolveScoringGoal } from '../experiment-quality-score.js';
import type { ExperimentCandidate } from '../../candidate-types.js';
import { ok, fail, provenance, type ToolContext } from './tool-context.js';

const NAME = 'scaffold_draft';

export function makeScaffoldDraftTool(tctx: ToolContext) {
  return tool(
    NAME,
    'Build an EDITABLE experiment draft from a candidate. This never launches — ' +
      'it produces a proposal (cohort, treatment/hold-out arms, window, power, ' +
      'safety guardrails) the manager reviews. Pass the candidate object from ' +
      'recommend and its provenanceId so the draft numbers stay verified.',
    {
      candidate: z.record(z.string(), z.unknown()).describe('an ExperimentCandidate from recommend'),
      addressableN: z.number().describe('cohort size'),
      reachablePct: z.number().optional(),
      windowDays: z.number().optional(),
      treatmentShare: z.number().optional().describe('clamped to ≤0.85 so hold-out ≥15%'),
      provenanceId: z.string().optional().describe('provenanceId of the recommend result'),
    },
    async (args: {
      candidate: Record<string, unknown>;
      addressableN: number;
      reachablePct?: number;
      windowDays?: number;
      treatmentShare?: number;
      provenanceId?: string;
    }) => {
      if (tctx.scope.kind !== 'segment') {
        return fail('a draft needs a segment scope (the cohort is a Segment); diagnose a segment first');
      }
      const candidate = args.candidate as unknown as ExperimentCandidate;
      if (!candidate || typeof candidate.id !== 'string') {
        return fail('candidate must be a full ExperimentCandidate object (with id) from recommend');
      }
      try {
        // Ground the Target in what the platform already knows: fall back to the
        // segment's real cohort size + CS-reachable fraction when the caller
        // didn't supply (or supplied a non-positive) value.
        const addressableN =
          args.addressableN > 0
            ? args.addressableN
            : resolveAddressableN(tctx.scope.segmentId) ?? args.addressableN;
        const reachablePct =
          args.reachablePct ?? resolveReachablePct(tctx.scope.segmentId) ?? 0.75;
        const draft = scaffoldDraft({
          candidate,
          segmentId: tctx.scope.segmentId,
          gameId: tctx.scope.gameId,
          addressableN,
          reachablePct,
          windowDays: args.windowDays,
          treatmentShare: args.treatmentShare,
        });
        // Score the draft on the five quality dimensions so Decide can gate the
        // hand-off (provenance validated against THIS session's ledger).
        const scoringGoal = resolveScoringGoal(tctx.goal, draft.candidateId);
        const scorecard = scoreExperiment(draft, scoringGoal, {
          ledger: tctx.ledger,
          provenanceId: args.provenanceId,
        });
        // Stamp the tool result the headline numbers trace to, onto the
        // trace-back receipt (segment + evidence are already set by the
        // scaffolder). This is what the scorecard's provenance dimension checks.
        const scoredDraft = {
          ...draft,
          scorecard,
          provenance: args.provenanceId
            ? { ...draft.provenance!, ledgerProvenanceId: args.provenanceId }
            : draft.provenance,
        };
        // Persist so the finished Drive investigation's artifact is retrievable
        // by the client (the SSE edge strips structured tool output).
        saveDraft(scoredDraft);
        const violations = validateDraftNumbers(draft, args.provenanceId, tctx.ledger);
        // Register the UN-scored draft: the scorecard's derived 0/0.5/1 numbers
        // are not a citable source and would only add low-information noise to
        // the ledger's coincidence-tolerant value match.
        const draftProvenanceId = provenance(tctx, NAME, draft);
        const summary =
          violations.length === 0
            ? `Draft scaffolded (status=draft) for segment ${draft.segmentId}. All headline numbers trace to a tool result.`
            : `Draft scaffolded (status=draft), but ${violations.length} number(s) do NOT trace to a tool result ` +
              `(${violations.map((v) => `${v.field}:${v.reason}`).join(', ')}). Re-run the tool that ` +
              `produces them and cite its provenanceId before hand-off.`;
        return ok(summary, { provenanceId: draftProvenanceId, draft: scoredDraft, violations, scorecard });
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
